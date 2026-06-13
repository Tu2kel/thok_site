(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DIBBS EMAIL INGESTOR
  //  Paste daily solmlbsm@dla.mil email → auto-parse → auto-fetch → pipeline
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.DibbsIngestTab
  //  Load order: before app.js
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useRef, useCallback, useEffect } = React;

  // ── CONSTANTS ───────────────────────────────────────────────────────────
  const STORE_KEY = "scc_dibbs_ingest_v1";
  const DIBBS_BASE = "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=";

  // ── PARSE EMAIL TEXT → sol entries ──────────────────────────────────────
  // Line format from DLA email:
  //   https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=SPE4A526T120D 1560003405989 152U4
  //   https://...?sn=SPE7LX26U7245 2530219064380 152U4 ** AIDC **
  function parseEmail(raw) {
    const lines = raw.split(/\r?\n/);
    const results = [];
    const seen = new Set();

    for (const line of lines) {
      const trimmed = line.trim();
      // Must contain the DIBBS URL pattern
      const urlMatch = trimmed.match(
        /https:\/\/www\.dibbs\.bsm\.dla\.mil\/RFQ\/RFQRec\.aspx\?sn=([A-Z0-9]+)/i,
      );
      if (!urlMatch) continue;

      const solNumber = urlMatch[1].toUpperCase();
      if (seen.has(solNumber)) continue;
      seen.add(solNumber);

      // Extract NSN — 13-digit number after the URL
      const nsnMatch = trimmed.match(/\b(\d{13})\b/);
      const nsn = nsnMatch ? nsnMatch[1] : "";

      // FSC = first 4 digits of NSN
      const fsc = nsn ? nsn.slice(0, 4) : "";

      // AIDC flag — email marks these explicitly
      const isAIDC = /\*\*\s*AIDC\s*\*\*/i.test(trimmed);

      results.push({
        sol_number: solNumber,
        url: DIBBS_BASE + solNumber,
        nsn,
        fsc,
        isAIDC,
        status: "pending", // pending | fetching | saved | rejected | error
        rejection_reason: isAIDC ? "AIDC — no certification capability" : "",
        fetched: null, // populated after dibbs-sol fetch
      });
    }

    return results;
  }

  // ── FETCH ONE SOL via local agent (with Netlify fallback) ───────────────
  async function fetchSol(solNumber) {
    // Try local agent first (window.SCC_AGENT loaded from core/dibbs-agent-client.js)
    if (window.SCC_AGENT) {
      const result = await window.SCC_AGENT.fetchSol(solNumber);
      if (!result.ok) throw new Error(result.error || "Agent fetch failed");
      return result.sol;
    }
    // Fallback: Netlify function (ScraperAPI path — may fail on banner)
    const resp = await fetch("/.netlify/functions/dibbs-sol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sol_number: solNumber }),
      signal: AbortSignal.timeout(35000),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "fetch failed");
    return data.sol;
  }

  // ── HARD-REJECT SCREEN (mirrors parser.js logic) ─────────────────────────
  function hardReject(sol) {
    // Set-aside ineligibility codes in sol_number prefix or set_aside field
    const sa = (sol.set_aside || "").toUpperCase();
    if (/\b(FG|PO|FI|AL)\b/.test(sa) && !/\bAL\b.*aluminum/i.test(sa)) {
      // AL = check if it's AbilityOne vs aluminum material code
      // If set_aside field says FG/PO/FI it's AbilityOne
      if (/\b(FG|PO|FI)\b/.test(sa)) return "AbilityOne set-aside — ineligible";
    }
    if (/\bH\b/.test(sa)) return "HUBZone set-aside — ineligible";
    if (/QSL/i.test(sol.qa || "")) return "QA = QSL — hard reject";
    // AMSC lock
    const amsc = (sol.amsc || "").toUpperCase();
    if (/^[GBA]$/.test(amsc))
      return "AMSC:" + amsc + " — Government drawing / sole source lock";
    // Blocked CAGEs
    const blocked = ["81SA7", "R9004", "07482", "062W0"];
    if (sol.suppliers) {
      for (const s of sol.suppliers) {
        if (blocked.includes((s.cage || "").toUpperCase()))
          return "Blocked CAGE: " + s.cage;
      }
    }
    return null; // clear
  }

  // ── SAVE TO PIPELINE via SCC_DB ──────────────────────────────────────────
  async function saveToPipeline(fetched, emailEntry) {
    const { dbSave } = window.SCC_DB;
    const nsn = fetched.nsn || emailEntry.nsn || "";
    const record = {
      sol_number: emailEntry.sol_number,
      nsn: nsn,
      fsc: emailEntry.fsc || nsn.slice(0, 4),
      item_name: fetched.item_description || "",
      ref_part_number: (fetched.part_numbers || []).join(", "),
      quantity: fetched.qty || "",
      unit_issue: fetched.unit_issue || "",
      unit_price: fetched.hist_unit_price || fetched.unit_price || "",
      quote_due: fetched.due_date || "",
      posted_date: fetched.issue_date || "",
      delivery_days: fetched.delivery_days || "",
      set_aside: fetched.set_aside || "",
      fob: fetched.fob || "",
      ref_supplier:
        fetched.suppliers && fetched.suppliers[0]
          ? fetched.suppliers[0].name
          : "",
      ref_cage:
        fetched.suppliers && fetched.suppliers[0]
          ? fetched.suppliers[0].cage
          : "",
      approved_sources: fetched.suppliers || [],
      status: "New",
      date_added: new Date().toLocaleDateString(),
      notes: "Auto-ingested via DIBBS Email Ingestor",
      source: "email-ingest",
      supplier_poc: "",
      supplier_moq: "",
      supplier_website: "",
      supplier_phone: "",
      supplier_email: "",
      supplier_quote_price: "",
      supplier_quote_date: "",
      supplier_quote_expires: "",
      supplier_lead_time: "",
    };
    await dbSave(record);
  }

  // ── PERSIST STATE ─────────────────────────────────────────────────────────
  function storeLoad() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || {};
    } catch {
      return {};
    }
  }
  function storeSave(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {}
  }

  // ── MAIN TAB COMPONENT ───────────────────────────────────────────────────
  function DibbsIngestTab() {
    const storedState = storeLoad();
    const [paste, setPaste] = useState(storedState.paste || "");
    const [entries, setEntries] = useState(storedState.entries || []);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [savedCount, setSavedCount] = useState(0);
    const [agentAlive, setAgentAlive] = useState(null); // null=checking, true, false
    const abortRef = useRef(false);

    // Check agent health on mount
    useEffect(() => {
      if (window.SCC_AGENT) {
        window.SCC_AGENT.healthCheck().then((alive) => setAgentAlive(alive));
      } else {
        setAgentAlive(false);
      }
    }, []);

    // Persist
    useEffect(() => {
      storeSave({ paste, entries });
    }, [paste, entries]);

    // ── PARSE BUTTON ──
    const handleParse = useCallback(() => {
      if (!paste.trim()) return;
      const parsed = parseEmail(paste);
      setEntries(parsed);
      setProgress({ done: 0, total: parsed.length });
    }, [paste]);

    // ── RUN INGEST ──
    const handleRun = useCallback(async () => {
      const toFetch = entries.filter(
        (e) => !e.isAIDC && e.status === "pending",
      );
      if (!toFetch.length) return;

      setRunning(true);
      abortRef.current = false;
      setProgress({ done: 0, total: toFetch.length });

      let done = 0;
      for (const entry of toFetch) {
        if (abortRef.current) break;

        // Mark fetching
        setEntries((prev) =>
          prev.map((e) =>
            e.sol_number === entry.sol_number
              ? { ...e, status: "fetching" }
              : e,
          ),
        );

        try {
          const fetched = await fetchSol(entry.sol_number);

          // Hard-reject screen
          const rejectReason = hardReject(fetched);
          if (rejectReason) {
            setEntries((prev) =>
              prev.map((e) =>
                e.sol_number === entry.sol_number
                  ? { ...e, status: "rejected", rejection_reason: rejectReason }
                  : e,
              ),
            );
          } else {
            // Save to pipeline
            await saveToPipeline(fetched, entry);
            setEntries((prev) =>
              prev.map((e) =>
                e.sol_number === entry.sol_number
                  ? { ...e, status: "saved", fetched }
                  : e,
              ),
            );
            // Auto-RFQ: fire vendor emails without manual routing step
            if (window.SCC_AUTO_RFQ) {
              const savedRecord = {
                sol_number: entry.sol_number,
                nsn: fetched.nsn || entry.nsn || "",
                fsc: entry.fsc || (fetched.nsn || "").slice(0, 4),
                item_name: fetched.item_description || "",
                ref_part_number: (fetched.part_numbers || []).join(", "),
                quantity: fetched.qty || "",
                unit_of_issue: fetched.unit_issue || "",
                unit_price: fetched.hist_unit_price || fetched.unit_price || "",
                delivery_days: fetched.delivery_days || "",
                notes: "",
              };
              // Collect for batch summary — fire individually but track
              if (!window._autoRFQBatch) window._autoRFQBatch = [];
              window._autoRFQBatch.push(savedRecord);
            }
          }
        } catch (err) {
          setEntries((prev) =>
            prev.map((e) =>
              e.sol_number === entry.sol_number
                ? { ...e, status: "error", rejection_reason: err.message }
                : e,
            ),
          );
        }

        done++;
        setProgress({ done, total: toFetch.length });

        // 800ms between fetches — don't hammer DIBBS
        if (!abortRef.current) await new Promise((r) => setTimeout(r, 800));
      }

      // Fire auto-RFQ batch + send summary notification
      if (window.SCC_AUTO_RFQ && window._autoRFQBatch && window._autoRFQBatch.length > 0) {
        const batch = window._autoRFQBatch;
        window._autoRFQBatch = [];
        window.SCC_AUTO_RFQ.runBatch(batch, {
          onLog: (msg) => console.log("[AutoRFQ]", msg),
        });
      }

      setRunning(false);
    }, [entries]);

    const handleStop = () => {
      abortRef.current = true;
    };
    const handleClear = () => {
      setPaste("");
      setEntries([]);
      setProgress({ done: 0, total: 0 });
      storeSave({});
    };

    // ── COUNTS ──
    const total = entries.length;
    const aidc = entries.filter((e) => e.isAIDC).length;
    const pending = entries.filter(
      (e) => !e.isAIDC && e.status === "pending",
    ).length;
    const savedCnt = entries.filter((e) => e.status === "saved").length;
    const rejected = entries.filter(
      (e) => e.status === "rejected" && !e.isAIDC,
    ).length;
    const errors = entries.filter((e) => e.status === "error").length;
    const fetching = entries.filter((e) => e.status === "fetching").length;

    // ── STATUS COLOR ──
    function statusColor(e) {
      if (e.isAIDC) return "var(--body-faint)";
      if (e.status === "saved") return "var(--green, #2ecc71)";
      if (e.status === "rejected") return "var(--red-bright, #e74c3c)";
      if (e.status === "error") return "#e67e22";
      if (e.status === "fetching") return "var(--gold-solid)";
      return "var(--body-dim)";
    }

    function statusLabel(e) {
      if (e.isAIDC) return "❌ AIDC";
      if (e.status === "saved") return "✓ SAVED";
      if (e.status === "rejected") return "❌ " + e.rejection_reason;
      if (e.status === "error") return "⚠ " + e.rejection_reason;
      if (e.status === "fetching") return "⟳ Fetching...";
      return "· Pending";
    }

    const card = {
      background: "var(--surface, #111012)",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "6px",
      padding: "16px 20px",
      marginBottom: "12px",
    };

    const hdr = {
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: ".18em",
      textTransform: "uppercase",
      color: "var(--gold-dim, rgba(201,168,76,.6))",
      marginBottom: "10px",
    };

    const btnBase = {
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: ".12em",
      textTransform: "uppercase",
      padding: "8px 18px",
      border: "none",
      borderRadius: "3px",
      cursor: "pointer",
    };

    return h(
      "div",
      {
        style: {
          padding: "20px",
          maxWidth: "1100px",
          animation: "fadeUp .4s ease both",
        },
      },

      // ── HEADER ──
      h(
        "div",
        {
          style: {
            marginBottom: "20px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          },
        },
        h(
          "div",
          null,
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "15px",
                letterSpacing: ".12em",
                color: "var(--gold-solid, #C9A84C)",
                marginBottom: "4px",
              },
            },
            "DIBBS EMAIL INGESTOR",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "13px",
                color: "var(--body-dim, rgba(245,240,232,0.5))",
                fontStyle: "italic",
              },
            },
            "Paste your daily solmlbsm@dla.mil email → parse → fetch → pipeline. AIDC auto-rejected. All hard rejects screened.",
          ),
        ),
        // Agent status pill
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "6px 14px",
              border:
                "1px solid " +
                (agentAlive === true
                  ? "rgba(46,204,113,.3)"
                  : agentAlive === false
                    ? "rgba(231,76,60,.3)"
                    : "rgba(201,168,76,.2)"),
              borderRadius: "20px",
              background:
                agentAlive === true
                  ? "rgba(46,204,113,.08)"
                  : agentAlive === false
                    ? "rgba(231,76,60,.08)"
                    : "rgba(201,168,76,.06)",
              cursor: "pointer",
              flexShrink: 0,
            },
            onClick: () =>
              window.SCC_AGENT &&
              window.SCC_AGENT.healthCheck().then((a) => setAgentAlive(a)),
            title: "Click to recheck agent status",
          },
          h("div", {
            style: {
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background:
                agentAlive === true
                  ? "#2ecc71"
                  : agentAlive === false
                    ? "#e74c3c"
                    : "#C9A84C",
              flexShrink: 0,
            },
          }),
          h(
            "span",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "10px",
                color:
                  agentAlive === true
                    ? "#2ecc71"
                    : agentAlive === false
                      ? "#e74c3c"
                      : "var(--gold-solid)",
                whiteSpace: "nowrap",
              },
            },
            agentAlive === null
              ? "Checking agent..."
              : agentAlive
                ? "Agent Live · :3100"
                : "Agent Offline — run start-agent.bat",
          ),
        ),
      ),

      // ── PASTE AREA ──
      h(
        "div",
        { style: card },
        h("div", { style: hdr }, "Step 1 — Paste Email Body"),
        h("textarea", {
          value: paste,
          onChange: (e) => setPaste(e.target.value),
          placeholder:
            "Paste full DIBBS solicitation email here...\n\nExample line format:\nhttps://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=SPE4A526T120D 1560003405989 152U4",
          style: {
            width: "100%",
            height: "180px",
            background: "var(--inset-bg, rgba(0,0,0,.3))",
            border: "1px solid rgba(201,168,76,.2)",
            color: "var(--alabaster, #F5F0E8)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            padding: "12px",
            borderRadius: "4px",
            resize: "vertical",
            outline: "none",
          },
        }),
        h(
          "div",
          {
            style: {
              marginTop: "10px",
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            },
          },
          h(
            "button",
            {
              onClick: handleParse,
              disabled: !paste.trim() || running,
              style: {
                ...btnBase,
                background: "rgba(201,168,76,.15)",
                color: "var(--gold-solid, #C9A84C)",
                border: "1px solid rgba(201,168,76,.3)",
              },
            },
            "⬡ Parse Email",
          ),
          entries.length > 0 &&
            !running &&
            pending > 0 &&
            h(
              "button",
              {
                onClick: handleRun,
                style: {
                  ...btnBase,
                  background: "rgba(46,204,113,.15)",
                  color: "#2ecc71",
                  border: "1px solid rgba(46,204,113,.3)",
                },
              },
              "▶ Run Ingest (" + pending + " sols)",
            ),
          running &&
            h(
              "button",
              {
                onClick: handleStop,
                style: {
                  ...btnBase,
                  background: "rgba(231,76,60,.15)",
                  color: "#e74c3c",
                  border: "1px solid rgba(231,76,60,.3)",
                },
              },
              "⏹ Stop",
            ),
          entries.length > 0 &&
            !running &&
            h(
              "button",
              {
                onClick: handleClear,
                style: {
                  ...btnBase,
                  background: "transparent",
                  color: "var(--body-faint, rgba(245,240,232,.3))",
                  border: "1px solid rgba(245,240,232,.1)",
                },
              },
              "✕ Clear",
            ),
        ),
      ),

      // ── SUMMARY BAR ──
      entries.length > 0 &&
        h(
          "div",
          {
            style: {
              ...card,
              display: "flex",
              gap: "24px",
              flexWrap: "wrap",
              padding: "12px 20px",
            },
          },
          ...[
            ["Total", total, "var(--alabaster)"],
            ["Pending", pending, "var(--body-dim)"],
            ["AIDC Rejected", aidc, "var(--body-faint)"],
            ["Fetching", fetching, "var(--gold-solid)"],
            ["Saved", savedCnt, "#2ecc71"],
            ["Hard Rejected", rejected, "#e74c3c"],
            ["Errors", errors, "#e67e22"],
          ].map(([label, val, color]) =>
            h(
              "div",
              { key: label, style: { textAlign: "center" } },
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "20px",
                    fontWeight: "700",
                    color,
                  },
                },
                val,
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "8px",
                    letterSpacing: ".12em",
                    color: "var(--body-faint)",
                    textTransform: "uppercase",
                  },
                },
                label,
              ),
            ),
          ),
          running &&
            h(
              "div",
              {
                style: {
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "12px",
                    color: "var(--gold-solid)",
                  },
                },
                progress.done + " / " + progress.total,
              ),
              h(
                "div",
                {
                  style: {
                    width: "160px",
                    height: "6px",
                    background: "rgba(201,168,76,.15)",
                    borderRadius: "3px",
                    overflow: "hidden",
                  },
                },
                h("div", {
                  style: {
                    height: "100%",
                    width:
                      (progress.total
                        ? Math.round((progress.done / progress.total) * 100)
                        : 0) + "%",
                    background: "var(--gold-solid, #C9A84C)",
                    transition: "width .3s ease",
                  },
                }),
              ),
            ),
        ),

      // ── RESULTS TABLE ──
      entries.length > 0 &&
        h(
          "div",
          { style: card },
          h(
            "div",
            { style: hdr },
            "Step 2 — Results (" + total + " solicitations parsed)",
          ),
          h(
            "div",
            { style: { overflowX: "auto" } },
            h(
              "table",
              {
                style: {
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                },
              },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ...[
                    "Sol Number",
                    "NSN",
                    "FSC",
                    "Item",
                    "Qty",
                    "Unit Price",
                    "Status",
                  ].map((col) =>
                    h(
                      "th",
                      {
                        key: col,
                        style: {
                          textAlign: "left",
                          padding: "6px 10px",
                          fontFamily: "Cinzel,serif",
                          fontSize: "8px",
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          color: "var(--gold-dim)",
                          borderBottom: "1px solid rgba(201,168,76,.15)",
                          whiteSpace: "nowrap",
                        },
                      },
                      col,
                    ),
                  ),
                ),
              ),
              h(
                "tbody",
                null,
                ...entries.map((e, i) => {
                  const f = e.fetched || {};
                  const isEven = i % 2 === 0;
                  return h(
                    "tr",
                    {
                      key: e.sol_number,
                      style: {
                        background: isEven
                          ? "transparent"
                          : "rgba(255,255,255,.02)",
                        opacity: e.isAIDC ? 0.35 : 1,
                      },
                    },
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: "var(--alabaster)",
                          whiteSpace: "nowrap",
                        },
                      },
                      h(
                        "a",
                        {
                          href: e.url,
                          target: "_blank",
                          rel: "noopener noreferrer",
                          style: {
                            color: "var(--gold-solid)",
                            textDecoration: "none",
                          },
                        },
                        e.sol_number,
                      ),
                    ),
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: "var(--body-dim)",
                        },
                      },
                      f.nsn
                        ? f.nsn.replace(
                            /(\d{4})(\d{2})(\d{3})(\d{4})/,
                            "$1-$2-$3-$4",
                          )
                        : e.nsn
                          ? e.nsn.replace(
                              /(\d{4})(\d{2})(\d{3})(\d{4})/,
                              "$1-$2-$3-$4",
                            )
                          : "—",
                    ),
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: "var(--body-dim)",
                        },
                      },
                      e.fsc || "—",
                    ),
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: "var(--alabaster)",
                          maxWidth: "280px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        },
                      },
                      f.item_description || "—",
                    ),
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: "var(--body-dim)",
                          whiteSpace: "nowrap",
                        },
                      },
                      f.qty
                        ? f.qty + (f.unit_issue ? " " + f.unit_issue : "")
                        : "—",
                    ),
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: "var(--body-dim)",
                          whiteSpace: "nowrap",
                        },
                      },
                      f.hist_unit_price
                        ? "$" + parseFloat(f.hist_unit_price).toFixed(2)
                        : "—",
                    ),
                    h(
                      "td",
                      {
                        style: {
                          padding: "6px 10px",
                          color: statusColor(e),
                          whiteSpace: "nowrap",
                          fontSize: "10px",
                        },
                      },
                      statusLabel(e),
                    ),
                  );
                }),
              ),
            ),
          ),

          // ── GO TO PIPELINE BUTTON ──
          savedCnt > 0 &&
            h(
              "div",
              { style: { marginTop: "14px" } },
              h(
                "button",
                {
                  onClick: () => {
                    const pipelineBtn = document.querySelector(
                      '[data-tab="pipeline"]',
                    );
                    if (pipelineBtn) pipelineBtn.click();
                    window.dispatchEvent(
                      new CustomEvent("scc:goto", {
                        detail: { tab: "pipeline" },
                      }),
                    );
                  },
                  style: {
                    ...btnBase,
                    background: "rgba(201,168,76,.12)",
                    color: "var(--gold-solid)",
                    border: "1px solid rgba(201,168,76,.3)",
                  },
                },
                "→ View " +
                  savedCnt +
                  " New Sol" +
                  (savedCnt !== 1 ? "s" : "") +
                  " in Pipeline",
              ),
            ),
        ),
    );
  }

  // ── EXPOSE ───────────────────────────────────────────────────────────────
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DibbsIngestTab = DibbsIngestTab;
})();
