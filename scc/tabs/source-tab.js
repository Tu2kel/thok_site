(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE TAB
  //  Tabs: Vendor Rolodex | Distributor DB
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.SourceTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;

  // ── PENDING VENDOR QUEUE (from Intel runs) ───────────────────────────
  const INTEL_PENDING_KEY = "scc_intel_pending_v1";

  function PendingVendorQueue({ onAdded }) {
    const [pending, setPending] = useState(() => {
      try { return JSON.parse(localStorage.getItem(INTEL_PENDING_KEY) || "[]"); } catch { return []; }
    });
    const [adding, setAdding] = useState(null);

    if (!pending.length) return null;

    const save = (updated) => {
      localStorage.setItem(INTEL_PENDING_KEY, JSON.stringify(updated));
      setPending(updated);
    };

    const skip = (id) => save(pending.filter(v => v.id !== id));

    const approve = async (v) => {
      setAdding(v.id);
      try {
        await window.SCC_DIST.distSave({
          id: v.id,
          name: v.name,
          cage: v.cage || "",
          email: v.email || "",
          phone: v.phone || "",
          fsc: v.fsc || [],
          tags: v.tags || ["usa-spending-verified"],
          notes: v.notes || "",
        });
        await window.SCC_DIST.distReloadCache();
        onAdded();
        save(pending.filter(p => p.id !== v.id));
      } catch (e) {
        alert("Add failed: " + e.message);
      } finally {
        setAdding(null);
      }
    };

    const approveAll = async () => {
      const safe = pending.filter(v => !v.isPrime);
      for (const v of safe) await approve(v);
    };

    const primeCount  = pending.filter(v => v.isPrime).length;
    const safeCount   = pending.length - primeCount;
    const noContactCount = pending.filter(v => !v.email).length;

    const qBlue = "rgba(56,189,248,";

    return h("div", {
      style: {
        border: "1px solid " + qBlue + ".25)",
        borderRadius: "6px",
        marginBottom: "20px",
        overflow: "hidden",
      },
    },
      // Header
      h("div", {
        style: {
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 16px",
          background: qBlue + ".06)",
        },
      },
        h("div", {
          style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".15em", textTransform: "uppercase", color: qBlue + ".9)", display: "flex", alignItems: "center", gap: "10px" },
        },
          "⚡ Intel Queue — " + pending.length + " pending",
          primeCount > 0 && h("span", { style: { color: "rgba(245,158,11,.8)", fontSize: "8px" } }, "⚠ " + primeCount + " possible prime"),
          noContactCount > 0 && h("span", { style: { color: "var(--body-faint)", fontSize: "8px" } }, noContactCount + " no email"),
        ),
        safeCount > 0 && h("button", {
          onClick: approveAll,
          disabled: !!adding,
          style: {
            fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".1em",
            padding: "4px 12px",
            background: "rgba(61,214,140,.1)", border: "1px solid rgba(61,214,140,.35)",
            color: "#3dd68c", borderRadius: "3px", cursor: adding ? "wait" : "pointer",
          },
        }, "Add All Safe (" + safeCount + ")"),
      ),

      // Rows
      h("div", { style: { maxHeight: "340px", overflowY: "auto" } },
        pending.map(v => {
          const isAdding = adding === v.id;
          return h("div", {
            key: v.id,
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 90px 100px 60px 90px 65px 65px",
              gap: "0 10px",
              padding: "8px 16px",
              borderBottom: "1px solid rgba(255,255,255,.04)",
              alignItems: "center",
              background: v.isPrime ? "rgba(245,158,11,.03)" : "transparent",
            },
          },
            // Name + tags
            h("div", null,
              h("div", {
                style: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", color: "var(--alabaster)", display: "flex", alignItems: "center", gap: "6px" },
              },
                v.name,
                v.isPrime && h("span", { title: "Description suggests prime contractor, not supplier", style: { fontSize: "8px", color: "rgba(245,158,11,.8)" } }, "⚠ prime?"),
                !v.sam && h("span", { title: "Not found in SAM.gov", style: { fontSize: "8px", color: "var(--body-faint)" } }, "no SAM"),
              ),
              v.fsc && v.fsc.length > 0 && h("div", {
                style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", color: "rgba(201,168,76,.6)", marginTop: "2px" },
              }, "FSC " + v.fsc.join(", ")),
            ),
            // CAGE
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)" } }, v.cage || "—"),
            // Email
            h("span", {
              style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: v.email ? "rgba(56,189,248,.7)" : "var(--body-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              title: v.email || "",
            }, v.email || "no email"),
            // Awards
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)", textAlign: "right" } }, v.awards || "—"),
            // Smallest award
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "rgba(201,168,76,.8)", textAlign: "right" }, title: "Smallest contract — unit price proxy" },
              v.smallestAward > 0 ? "$" + Math.round(v.smallestAward).toLocaleString() : "—",
            ),
            // Add
            h("button", {
              onClick: () => approve(v),
              disabled: isAdding,
              style: {
                fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".08em",
                padding: "3px 8px",
                background: "rgba(61,214,140,.08)", border: "1px solid rgba(61,214,140,.3)",
                color: "#3dd68c", borderRadius: "3px", cursor: isAdding ? "wait" : "pointer",
                opacity: isAdding ? 0.6 : 1,
              },
            }, isAdding ? "…" : "+ Add"),
            // Skip
            h("button", {
              onClick: () => skip(v.id),
              style: {
                fontFamily: "JetBrains Mono,monospace", fontSize: "9px",
                padding: "3px 8px",
                background: "transparent", border: "1px solid rgba(255,255,255,.1)",
                color: "var(--body-faint)", borderRadius: "3px", cursor: "pointer",
              },
            }, "Skip"),
          );
        }),
      ),

      // Column header
      h("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "1fr 90px 100px 60px 90px 65px 65px",
          gap: "0 10px",
          padding: "4px 16px",
          fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".12em",
          textTransform: "uppercase", color: "var(--body-faint)",
          borderTop: "1px solid rgba(255,255,255,.06)",
        },
      },
        h("span", null, "Company"),
        h("span", null, "CAGE"),
        h("span", null, "Email"),
        h("span", { style: { textAlign: "right" } }, "Awards"),
        h("span", { style: { textAlign: "right" } }, "Smallest"),
        h("span", null, ""),
        h("span", null, ""),
      ),
    );
  }

  // ── USASPENDING INTELLIGENCE FEED ────────────────────────────────────
  function USASpendingIntel({ dists, onRefresh }) {
    const [open, setOpen] = useState(false);
    const [qtype, setQtype] = useState("fsc");
    const [qval, setQval] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const [results, setResults] = useState([]);
    const [addingKey, setAddingKey] = useState(null);
    const [addedKeys, setAddedKeys] = useState(new Set());

    const existingNames = new Set(
      (dists || []).map((d) => (d.name || "").toUpperCase().trim()),
    );

    const fmtNSN = (raw) => {
      const d = raw.replace(/\D/g, "");
      return d.length === 13
        ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 9) + "-" + d.slice(9, 13)
        : raw.trim();
    };

    const runQuery = async () => {
      const raw = qval.trim();
      if (!raw) return;
      setLoading(true);
      setErr(null);
      setResults([]);
      try {
        let filters, fscForTag;

        if (qtype === "fsc") {
          // FSC/PSC codes are 4 chars. Auto-extract if user pasted a full NSN.
          // psc_codes filter is hierarchical: Tier1=Product, Tier2=first 2 digits, Tier3=full 4-digit code
          const psc = raw.replace(/\D/g, "").slice(0, 4) || raw.slice(0, 4).toUpperCase();
          const tier2 = psc.slice(0, 2);
          fscForTag = psc;
          filters = {
            award_type_codes: ["A", "B", "C", "D"],
            psc_codes: { require: [["Product", tier2, psc]] },
          };
        } else {
          // NSN mode — search both dashed (4320-01-047-1927) and plain (4320010471927) formats
          const dashed = fmtNSN(raw);
          const plain = raw.replace(/\D/g, "");
          fscForTag = plain.slice(0, 4) || dashed.slice(0, 4);
          // Use both formats as separate keywords (API treats array as OR within keywords)
          const kws = [...new Set([dashed, plain].filter(Boolean))];
          filters = {
            keywords: kws,
            award_type_codes: ["A", "B", "C", "D"],
          };
        }

        const res = await fetch(
          "https://api.usaspending.gov/api/v2/search/spending_by_award/",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filters,
              fields: ["Recipient Name", "Award Amount", "Description"],
              sort: "Award Amount",
              order: "desc",
              limit: 100,
              page: 1,
              subawards: false,
            }),
          },
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error("USASpending " + res.status + (body ? ": " + body.slice(0, 120) : ""));
        }
        const data = await res.json();

        const map = new Map();
        for (const a of data.results || []) {
          const name = (a["Recipient Name"] || "").trim();
          if (!name || name === "MULTIPLE RECIPIENTS") continue;
          const key = name.toUpperCase();
          const amt = Number(a["Award Amount"] || 0);
          if (!map.has(key)) {
            map.set(key, {
              name,
              psc: fscForTag,
              total: 0,
              count: 0,
              minAward: Infinity,
              maxAward: 0,
              descs: [],
            });
          }
          const e = map.get(key);
          e.total += amt;
          e.count++;
          if (amt > 0 && amt < e.minAward) e.minAward = amt;
          if (amt > e.maxAward) e.maxAward = amt;
          const desc = (a["Description"] || "").trim().slice(0, 100);
          if (desc && !e.descs.includes(desc) && e.descs.length < 2)
            e.descs.push(desc);
        }

        setResults(
          [...map.values()]
            .map((e) => ({ ...e, minAward: e.minAward === Infinity ? 0 : e.minAward }))
            .sort((a, b) => b.total - a.total),
        );
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    };

    const addVendor = async (v) => {
      const key = v.name.toUpperCase().trim();
      setAddingKey(key);
      try {
        const id =
          "usa-" +
          v.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        const titleCase = v.name
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase());
        await window.SCC_DIST.distSave({
          id,
          name: titleCase,
          fsc: v.psc ? [v.psc] : [],
          tags: ["usa-spending-verified"],
          notes:
            "USASpending · " +
            v.count +
            " award" +
            (v.count !== 1 ? "s" : "") +
            " · $" +
            Math.round(v.total).toLocaleString() +
            " total · Last: " +
            (v.lastDate ? v.lastDate.slice(0, 10) : "unknown"),
        });
        await window.SCC_DIST.distReloadCache();
        onRefresh();
        setAddedKeys((prev) => new Set([...prev, key]));
      } catch (e) {
        alert("Add failed: " + e.message);
      } finally {
        setAddingKey(null);
      }
    };

    const intelBlue = "rgba(56,189,248,";
    const btnBase = {
      fontFamily: "Cinzel,serif",
      fontSize: "8px",
      letterSpacing: ".1em",
      borderRadius: "3px",
      cursor: "pointer",
      border: "1px solid",
    };

    return h(
      "div",
      {
        style: {
          border: "1px solid " + intelBlue + ".18)",
          borderRadius: "6px",
          marginBottom: "20px",
          overflow: "hidden",
        },
      },

      // ── Collapse toggle ──
      h(
        "div",
        {
          onClick: () => setOpen((v) => !v),
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 16px",
            background: intelBlue + ".04)",
            cursor: "pointer",
            userSelect: "none",
          },
        },
        h(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".15em",
              textTransform: "uppercase",
              color: intelBlue + ".9)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            },
          },
          "⚡ USASpending Intelligence Feed",
          results.length > 0 &&
            h(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: intelBlue + ".6)",
                  letterSpacing: 0,
                },
              },
              results.length + " vendors",
            ),
        ),
        h(
          "span",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: intelBlue + ".4)",
            },
          },
          open ? "▲" : "▼",
        ),
      ),

      // ── Body ──
      open &&
        h(
          "div",
          {
            style: {
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            },
          },

          // Query bar
          h(
            "div",
            {
              style: {
                display: "flex",
                gap: "6px",
                alignItems: "center",
                flexWrap: "wrap",
              },
            },
            h(
              "div",
              {
                style: {
                  display: "flex",
                  borderRadius: "3px",
                  overflow: "hidden",
                  border: "1px solid " + intelBlue + ".2)",
                  flexShrink: 0,
                },
              },
              ...["fsc", "nsn"].map((t) =>
                h(
                  "button",
                  {
                    onClick: () => setQtype(t),
                    style: {
                      padding: "4px 12px",
                      fontFamily: "Cinzel,serif",
                      fontSize: "8px",
                      letterSpacing: ".1em",
                      border: "none",
                      borderRadius: 0,
                      cursor: "pointer",
                      background:
                        qtype === t
                          ? intelBlue + ".18)"
                          : "rgba(255,255,255,.04)",
                      color:
                        qtype === t
                          ? "rgb(56,189,248)"
                          : "var(--body-faint)",
                    },
                  },
                  t === "fsc" ? "FSC" : "NSN",
                ),
              ),
            ),
            h("input", {
              value: qval,
              onChange: (e) => setQval(e.target.value),
              onKeyDown: (e) => e.key === "Enter" && runQuery(),
              placeholder:
                qtype === "fsc"
                  ? "e.g. 5305  (4-digit FSC/PSC code)"
                  : "e.g. 4320-01-047-1927  (dashes optional)",
              style: {
                flex: 1,
                minWidth: "140px",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "11px",
                background: intelBlue + ".05)",
                border: "1px solid " + intelBlue + ".25)",
                borderRadius: "3px",
                color: "var(--alabaster)",
                padding: "5px 10px",
                outline: "none",
              },
            }),
            h(
              "button",
              {
                onClick: runQuery,
                disabled: loading || !qval.trim(),
                style: {
                  ...btnBase,
                  padding: "5px 14px",
                  background: loading
                    ? intelBlue + ".04)"
                    : intelBlue + ".12)",
                  borderColor: intelBlue + ".4)",
                  color: "rgb(56,189,248)",
                  opacity: !qval.trim() ? 0.4 : 1,
                  cursor:
                    loading || !qval.trim() ? "not-allowed" : "pointer",
                },
              },
              loading ? "Querying…" : "Query USASpending",
            ),
          ),

          // Error
          err &&
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  color: "#e74c3c",
                },
              },
              "Error: " + err,
            ),

          // Results table
          results.length > 0 &&
            h(
              "div",
              { style: { display: "flex", flexDirection: "column" } },
              // Header row
              h(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "1fr 55px 110px 110px 70px",
                    gap: "0 10px",
                    padding: "4px 8px 6px",
                    fontFamily: "Cinzel,serif",
                    fontSize: "7px",
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "var(--body-faint)",
                    borderBottom: "1px solid rgba(255,255,255,.06)",
                  },
                },
                h("span", null, "Company"),
                h("span", { style: { textAlign: "right" } }, "Awards"),
                h("span", { style: { textAlign: "right" } }, "Total Paid"),
                h("span", { style: { textAlign: "right" } }, "Smallest Contract"),
                h("span", null, ""),
              ),
              // Data rows
              ...results.map((v) => {
                const key = v.name.toUpperCase().trim();
                const inDb = existingNames.has(key);
                const wasAdded = addedKeys.has(key);
                const isAdding = addingKey === key;
                return h(
                  "div",
                  {
                    key,
                    style: {
                      display: "grid",
                      gridTemplateColumns: "1fr 55px 110px 110px 70px",
                      gap: "0 10px",
                      padding: "7px 8px",
                      borderBottom: "1px solid rgba(255,255,255,.04)",
                      alignItems: "center",
                    },
                  },
                  h(
                    "div",
                    null,
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "10px",
                          color: "var(--alabaster)",
                        },
                      },
                      v.name,
                    ),
                    v.descs[0] &&
                      h(
                        "div",
                        {
                          style: {
                            fontFamily: "Cormorant Garamond,serif",
                            fontStyle: "italic",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            marginTop: "2px",
                          },
                        },
                        v.descs[0],
                      ),
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "var(--body-dim)",
                        textAlign: "right",
                      },
                    },
                    v.count,
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "#3dd68c",
                        textAlign: "right",
                      },
                    },
                    "$" + Math.round(v.total).toLocaleString(),
                  ),
                  h(
                    "span",
                    {
                      title: "Smallest single contract — best proxy for their unit pricing",
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "rgba(201,168,76,.8)",
                        textAlign: "right",
                      },
                    },
                    v.minAward > 0 ? "$" + Math.round(v.minAward).toLocaleString() : "—",
                  ),
                  inDb || wasAdded
                    ? h(
                        "span",
                        {
                          style: {
                            fontFamily: "Cinzel,serif",
                            fontSize: "7px",
                            letterSpacing: ".08em",
                            color: "#3dd68c",
                            whiteSpace: "nowrap",
                          },
                        },
                        "✓ In Roster",
                      )
                    : h(
                        "button",
                        {
                          onClick: () => addVendor(v),
                          disabled: isAdding,
                          style: {
                            ...btnBase,
                            padding: "3px 10px",
                            background: "rgba(61,214,140,.08)",
                            borderColor: "rgba(61,214,140,.35)",
                            color: "#3dd68c",
                            whiteSpace: "nowrap",
                            opacity: isAdding ? 0.6 : 1,
                            cursor: isAdding ? "wait" : "pointer",
                          },
                        },
                        isAdding ? "Adding…" : "+ Add",
                      ),
                );
              }),
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "9px",
                    color: "var(--body-faint)",
                    fontStyle: "italic",
                    padding: "8px 8px 0",
                  },
                },
                results.length +
                  " unique vendors · ranked by total award value · Smallest Contract = best unit price signal · source: USASpending.gov",
              ),
            ),

          // Empty prompt
          results.length === 0 &&
            !loading &&
            !err &&
            h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  textAlign: "center",
                  padding: "16px 0 8px",
                },
              },
              "Enter an FSC code or NSN to pull real award history from USASpending.gov",
            ),
        ),
    );
  }

  // ── DISTRIBUTOR DB PANEL ─────────────────────────────────────────────
  function DistributorDB() {
    const { distBatch, distDelete, distReloadCache, needsSeed, DISTRIBUTORS } =
      window.SCC_DIST;

    const [dists, setDists] = useState([]);
    const [paste, setPaste] = useState("");
    const [status, setStatus] = useState(null); // { ok, msg }
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [dragging, setDragging] = useState(false);

    // Load current cache on mount
    useEffect(() => {
      window.SCC_DIST.onReady(() => {
        setDists([...window.SCC_DIST.DISTRIBUTORS]);
      });
    }, []);

    const refresh = () => setDists([...window.SCC_DIST.DISTRIBUTORS]);

    // ── Parse + seed ──────────────────────────────────────────────────
    const handleSeed = useCallback(async () => {
      if (!paste.trim()) {
        setStatus({ ok: false, msg: "Paste JSON array first." });
        return;
      }
      let records;
      try {
        const raw = paste.trim();
        records = JSON.parse(raw);
        if (!Array.isArray(records))
          throw new Error("Must be a JSON array [ {...}, ... ]");
        if (records.length === 0) throw new Error("Array is empty.");
        // Validate each record has minimum required fields
        const bad = records.filter((r) => !r.id || !r.name);
        if (bad.length)
          throw new Error(`${bad.length} record(s) missing id or name.`);
      } catch (e) {
        setStatus({ ok: false, msg: "Parse error: " + e.message });
        return;
      }
      setLoading(true);
      setStatus(null);
      try {
        const result = await distBatch(records);
        await distReloadCache();
        refresh();
        setStatus({
          ok: true,
          msg: `Done — ${result.inserted || 0} inserted, ${result.merged || 0} merged.${
            result.errors?.length ? " Errors: " + result.errors.join("; ") : ""
          }`,
        });
        setPaste("");
      } catch (e) {
        setStatus({ ok: false, msg: "Batch error: " + e.message });
      } finally {
        setLoading(false);
      }
    }, [paste, distBatch, distReloadCache]);

    const [dedupLoading, setDedupLoading] = useState(false);
    const handleDedup = useCallback(async () => {
      if (
        !confirm(
          "Scan Mongo for duplicate distributor names and merge them into single records?",
        )
      )
        return;
      setDedupLoading(true);
      setStatus(null);
      try {
        const res = await fetch("/.netlify/functions/scc-distributors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "distDedup", payload: {} }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Dedup failed");
        await distReloadCache();
        refresh();
        setStatus({
          ok: true,
          msg: `Dedup complete — ${data.result.merged} name groups merged, ${data.result.deleted} duplicate records removed.`,
        });
      } catch (e) {
        setStatus({ ok: false, msg: "Dedup error: " + e.message });
      } finally {
        setDedupLoading(false);
      }
    }, [distReloadCache]);

    const [purgeLoading, setPurgeLoading] = useState(false);
    const [expandedCards, setExpandedCards] = useState({});
    const [hiDollarFscs, setHiDollarFscs] = useState(() => {
      try { return new Set(JSON.parse(localStorage.getItem("scc_hi_fsc") || "[]")); }
      catch { return new Set(); }
    });
    const toggleCard = (id) =>
      setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));

    const [editingCards, setEditingCards] = useState({}); // id → draft object | undefined
    const [savingCards, setSavingCards] = useState({}); // id → bool
    const [dnsPrompt, setDnsPrompt] = useState({}); // id → draft reason string
    const [dnsSaving, setDnsSaving] = useState({}); // id → bool

    const startEdit = (d) =>
      setEditingCards((prev) => ({
        ...prev,
        [d.id]: {
          name: d.name || "",
          phone: d.phone || "",
          email: d.email || "",
          website: d.website || "",
          notes: d.notes || "",
          fsc: (d.fsc || []).join(", "),
          tags: (d.tags || []).filter((t) => t !== "preferred-alt").join(", "),
          item_keywords: (d.item_keywords || []).join(", "),
          is_manufacturer: !!d.is_manufacturer,
        },
      }));

    const cancelEdit = (id) =>
      setEditingCards((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });

    const patchDraft = (id, field, val) =>
      setEditingCards((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: val },
      }));

    const saveCard = async (d) => {
      const draft = editingCards[d.id];
      if (!draft) return;
      setSavingCards((prev) => ({ ...prev, [d.id]: true }));
      try {
        const parseCsv = (s) =>
          s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        const updated = {
          ...d,
          name: draft.name.trim() || d.name,
          phone: draft.phone.trim(),
          email: draft.email.trim(),
          website: draft.website.trim(),
          notes: draft.notes.trim(),
          fsc: parseCsv(draft.fsc),
          tags: [
            ...parseCsv(draft.tags),
            ...(d.tags || []).filter((t) => t === "preferred-alt"),
          ],
          item_keywords: parseCsv(draft.item_keywords).map((k) => k.toLowerCase()),
          is_manufacturer: !!draft.is_manufacturer,
        };
        await window.SCC_DIST.distSave(updated);
        await window.SCC_DIST.distReloadCache();
        setDists([...window.SCC_DIST.DISTRIBUTORS]);
        cancelEdit(d.id);
      } catch (e) {
        alert("Save failed: " + e.message);
      } finally {
        setSavingCards((prev) => {
          const n = { ...prev };
          delete n[d.id];
          return n;
        });
      }
    };
    const handlePurge = useCallback(async () => {
      if (
        !confirm(
          "PURGE ALL distributors from MongoDB?\n\nThis deletes every record and cannot be undone. Use only when starting fresh with real contacts.",
        )
      )
        return;
      setPurgeLoading(true);
      setStatus(null);
      try {
        const result = await window.SCC_DIST.distPurge();
        await distReloadCache();
        refresh();
        setStatus({
          ok: true,
          msg: `Purged — ${result.purged || 0} record(s) removed. DB is now empty.`,
        });
      } catch (e) {
        setStatus({ ok: false, msg: "Purge error: " + e.message });
      } finally {
        setPurgeLoading(false);
      }
    }, [distReloadCache]);

    // ── File / drop ───────────────────────────────────────────────────
    const readFile = useCallback((file) => {
      if (!file) return;
      if (!file.name.endsWith(".json")) {
        setStatus({ ok: false, msg: "Drop a .json file." });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setPaste(e.target.result);
      reader.onerror = () =>
        setStatus({ ok: false, msg: "Could not read file." });
      reader.readAsText(file);
    }, []);
    const handleDrop = useCallback(
      (e) => {
        e.preventDefault();
        setDragging(false);
        readFile(e.dataTransfer.files[0]);
      },
      [readFile],
    );
    const handleDragOver = (e) => {
      e.preventDefault();
      setDragging(true);
    };
    const handleDragLeave = () => setDragging(false);
    const handleFileInput = (e) => readFile(e.target.files[0]);

    // ── Delete ────────────────────────────────────────────────────────
    const handleDelete = useCallback(
      async (id) => {
        if (!confirm(`Remove distributor "${id}" from DB?`)) return;
        try {
          await distDelete(id);
          await distReloadCache();
          refresh();
          setStatus({ ok: true, msg: `Deleted: ${id}` });
        } catch (e) {
          setStatus({ ok: false, msg: "Delete error: " + e.message });
        }
      },
      [distDelete, distReloadCache],
    );

    // ── Account / Rep toggle ──────────────────────────────────────────
    const toggleHiFsc = useCallback((fsc) => {
      setHiDollarFscs((prev) => {
        const next = new Set(prev);
        next.has(fsc) ? next.delete(fsc) : next.add(fsc);
        try { localStorage.setItem("scc_hi_fsc", JSON.stringify([...next])); } catch {}
        return next;
      });
    }, []);

    const handleToggle = useCallback(
      async (d, field) => {
        const updated = { ...d, [field]: !d[field] };
        try {
          await window.SCC_DIST.distSave(updated);
          await window.SCC_DIST.distReloadCache();
          setDists([...window.SCC_DIST.DISTRIBUTORS]);
        } catch (e) {
          setStatus({ ok: false, msg: "Toggle error: " + e.message });
        }
      },
      [distReloadCache],
    );

    const handleDNS = useCallback(
      async (d, reason) => {
        setDnsSaving((prev) => ({ ...prev, [d.id]: true }));
        try {
          await window.SCC_DIST.distSave({
            ...d,
            is_dns: true,
            dns_reason: (reason || "").trim() || "No reason given.",
          });
          await window.SCC_DIST.distReloadCache();
          setDists([...window.SCC_DIST.DISTRIBUTORS]);
          setDnsPrompt((prev) => { const n = { ...prev }; delete n[d.id]; return n; });
        } catch (e) {
          alert("DNS save failed: " + e.message);
        } finally {
          setDnsSaving((prev) => { const n = { ...prev }; delete n[d.id]; return n; });
        }
      },
      [distReloadCache],
    );

    const handleRestoreDNS = useCallback(
      async (d) => {
        try {
          await window.SCC_DIST.distSave({ ...d, is_dns: false, dns_reason: "" });
          await window.SCC_DIST.distReloadCache();
          setDists([...window.SCC_DIST.DISTRIBUTORS]);
        } catch (e) {
          alert("Restore failed: " + e.message);
        }
      },
      [distReloadCache],
    );

    const filtered = dists.filter((d) => {
      const q = search.toLowerCase();
      return (
        !q ||
        (d.name || "").toLowerCase().includes(q) ||
        (d.id || "").includes(q) ||
        (d.tags || []).some((t) => t.includes(q)) ||
        (d.fsc || []).some((f) => f.includes(q))
      );
    });

    const card = {
      background: "var(--surface-inset)",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "6px",
      padding: "16px",
      marginBottom: "16px",
    };

    const label = {
      fontFamily: "Cinzel,serif",
      fontSize: "8px",
      letterSpacing: ".15em",
      textTransform: "uppercase",
      color: "var(--gold-dim)",
      marginBottom: "6px",
    };

    return h(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },

      // ── Header ──
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "20px",
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
                fontSize: "18px",
                letterSpacing: ".1em",
                color: "var(--gold-solid)",
              },
            },
            "Distributor DB",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "13px",
                color: "var(--gold-dim)",
                marginTop: "3px",
              },
            },
            (() => {
              const mCount = dists.filter((d) => d.is_manufacturer).length;
              const dCount = dists.length - mCount;
              return (
                (mCount ? mCount + " manufacturer" + (mCount !== 1 ? "s" : "") + " · " : "") +
                dCount + " distributor" + (dCount !== 1 ? "s" : "") +
                (needsSeed ? " — ⚠ Mongo empty, seed required" : "")
              );
            })(),
          ),
        ),
        h("input", {
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: "Filter by name, FSC, tag…",
          style: {
            padding: "7px 12px",
            background: "var(--inset-bg)",
            border: "1px solid rgba(201,168,76,.2)",
            color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "12px",
            borderRadius: "4px",
            width: "220px",
          },
        }),
      ),

      // ── Seed panel ──
      h(
        "div",
        { style: card },
        h(
          "div",
          { style: label },
          "Seed / Import — drop dist-seed.json, pick a file, or paste JSON",
        ),

        // ── Drop zone ──
        h(
          "div",
          {
            onDrop: handleDrop,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            style: {
              border: dragging
                ? "2px dashed rgba(201,168,76,.8)"
                : paste.trim()
                  ? "2px dashed rgba(61,214,140,.5)"
                  : "2px dashed rgba(201,168,76,.25)",
              borderRadius: "6px",
              padding: "20px 16px",
              marginBottom: "10px",
              textAlign: "center",
              background: dragging
                ? "rgba(201,168,76,.06)"
                : paste.trim()
                  ? "rgba(61,214,140,.04)"
                  : "var(--surface-sheen)",
              transition: "all .15s",
              position: "relative",
            },
          },
          h("input", {
            type: "file",
            accept: ".json",
            onChange: handleFileInput,
            style: {
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              width: "100%",
              height: "100%",
            },
          }),
          paste.trim()
            ? h(
                "div",
                null,
                h(
                  "div",
                  { style: { fontSize: "18px", marginBottom: "4px" } },
                  "\u2713",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: ".1em",
                      color: "#3dd68c",
                    },
                  },
                  (() => {
                    try {
                      return JSON.parse(paste).length + " records ready";
                    } catch {
                      return "JSON loaded — check format";
                    }
                  })(),
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      marginTop: "4px",
                    },
                  },
                  "Drop another file or click to replace",
                ),
              )
            : h(
                "div",
                null,
                h(
                  "div",
                  { style: { fontSize: "22px", marginBottom: "6px" } },
                  dragging ? "\u2B07" : "\uD83D\uDCC2",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "10px",
                      letterSpacing: ".08em",
                      color: dragging ? "var(--gold-solid)" : "var(--gold-dim)",
                    },
                  },
                  dragging
                    ? "Drop it"
                    : "Drop dist-seed.json or click to browse",
                ),
              ),
        ),

        // ── Paste fallback ──
        h("textarea", {
          value: paste,
          onChange: (e) => setPaste(e.target.value),
          placeholder: '[{"id":"zoro","name":"Zoro Tools",...}, ...]',
          rows: 2,
          style: {
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            background: "var(--surface-sheen)",
            border: "1px solid rgba(201,168,76,.15)",
            color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "10px",
            borderRadius: "4px",
            resize: "vertical",
            marginBottom: "10px",
            opacity: 0.6,
          },
        }),
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            },
          },
          h(
            "button",
            {
              onClick: handleSeed,
              disabled: loading || !paste.trim(),
              style: {
                padding: "8px 20px",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                background: loading
                  ? "rgba(201,168,76,.15)"
                  : "rgba(201,168,76,.2)",
                border: "1px solid rgba(201,168,76,.4)",
                color: "var(--gold-solid)",
                borderRadius: "4px",
                cursor: loading ? "wait" : "pointer",
              },
            },
            loading ? "Loading…" : "Parse & Seed Mongo",
          ),
          h(
            "button",
            {
              onClick: handleDedup,
              disabled: dedupLoading,
              title:
                "Find all duplicate distributor names in Mongo and merge them into single records",
              style: {
                padding: "8px 20px",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                background: dedupLoading
                  ? "rgba(231,76,60,.08)"
                  : "rgba(231,76,60,.15)",
                border: "1px solid rgba(231,76,60,.4)",
                color: "#e74c3c",
                borderRadius: "4px",
                cursor: dedupLoading ? "wait" : "pointer",
                marginLeft: "8px",
              },
            },
            dedupLoading ? "Merging\u2026" : "\u26a1 Dedup & Merge",
          ),
          h(
            "button",
            {
              onClick: handlePurge,
              disabled: purgeLoading || dists.length === 0,
              title:
                "Delete ALL distributor records from MongoDB — use when starting fresh",
              style: {
                padding: "8px 20px",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                background: purgeLoading
                  ? "rgba(180,0,0,.08)"
                  : "rgba(100,0,0,.25)",
                border: "1px solid rgba(180,0,0,.5)",
                color: "#ff6b6b",
                borderRadius: "4px",
                cursor:
                  purgeLoading || dists.length === 0
                    ? "not-allowed"
                    : "pointer",
                marginLeft: "8px",
                opacity: dists.length === 0 ? 0.4 : 1,
              },
            },
            purgeLoading ? "Purging\u2026" : "\uD83D\uDDD1 Purge All",
          ),
          status &&
            h(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: status.ok ? "#3dd68c" : "#e74c3c",
                },
              },
              status.msg,
            ),
        ),
      ),

      // ── Pending Vendor Queue (from Intel runs) ──
      h(PendingVendorQueue, { onAdded: refresh }),

      // ── USASpending Intel Feed ──
      h(USASpendingIntel, { dists, onRefresh: refresh }),

      // -- Tiered card grid --
      (() => {
        if (dists.length === 0) return null;
        const isPreferred = (d) => (d.tags || []).includes("preferred-alt");

        const activeDists = filtered.filter((d) => !d.is_dns);
        const purgDists = filtered.filter((d) => !!d.is_dns);

        // Manufacturers are always shown first regardless of preferred tag
        const mfrs = activeDists.filter((d) => d.is_manufacturer);
        const mfrsJcp = mfrs.filter((d) => d.has_jcp);
        const mfrsOther = mfrs.filter((d) => !d.has_jcp);

        const nonMfrs = activeDists.filter((d) => !d.is_manufacturer);
        const preferred = nonMfrs.filter(isPreferred);
        const others = nonMfrs.filter((d) => !isPreferred(d));
        const p1 = preferred.filter((d) => (d.priority || 9) === 1);
        const p2 = preferred.filter((d) => (d.priority || 9) === 2);
        const p3 = preferred.filter((d) => (d.priority || 9) >= 3);

        const tierLabel = (text, count, color, sub) =>
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: sub ? "7px" : "8px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: color || "var(--gold-dim)",
                marginTop: sub ? "10px" : "18px",
                marginBottom: "8px",
                paddingLeft: sub ? "4px" : "0",
                borderLeft: sub
                  ? "3px solid " + (color || "rgba(201,168,76,.3)")
                  : "none",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              },
            },
            text,
            h(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                  letterSpacing: 0,
                },
              },
              "(" + count + ")",
            ),
          );

        // per-card state lives in component-level maps (expandedCards, editingCards)

        const renderDistCard = (d) => {
          const pref = isPreferred(d);
          const expanded = !!expandedCards[d.id];
          const draft = editingCards[d.id]; // undefined = view mode
          const isEditing = !!draft;
          const isSaving = !!savingCards[d.id];

          const hasAcct = !!d.has_account;
          const hasRep = !!d.has_rep;
          const hasJcp = !!d.has_jcp;
          const hasMilPack = !!d.has_mil_std_pack;
          const isMfr = !!d.is_manufacturer;
          const isWholesaler = !!d.is_wholesaler;
          const isDistributor = !!d.is_distributor;

          // Border + card bg: mfr+jcp > mfr > rep > account > pref tiers > default
          let borderColor, cardBg, cardBorder;
          if (isMfr && hasJcp) {
            borderColor = "#a78bfa";
            cardBg = "rgba(167,139,250,.07)";
            cardBorder = "1px solid rgba(167,139,250,.35)";
          } else if (isMfr) {
            borderColor = "rgba(249,200,80,.9)";
            cardBg = "rgba(249,200,80,.06)";
            cardBorder = "1px solid rgba(249,200,80,.35)";
          } else if (isWholesaler) {
            borderColor = "rgba(251,146,60,.85)";
            cardBg = "rgba(251,146,60,.05)";
            cardBorder = "1px solid rgba(251,146,60,.32)";
          } else if (isDistributor) {
            borderColor = "rgba(56,189,248,.8)";
            cardBg = "rgba(56,189,248,.04)";
            cardBorder = "1px solid rgba(56,189,248,.28)";
          } else if (hasRep) {
            borderColor = "rgba(61,214,140,.75)";
            cardBg = "rgba(61,214,140,.05)";
            cardBorder = "1px solid rgba(61,214,140,.28)";
          } else if (hasAcct) {
            borderColor = "rgba(201,168,76,.9)";
            cardBg = "rgba(201,168,76,.07)";
            cardBorder = "1px solid rgba(201,168,76,.38)";
          } else if (pref) {
            borderColor =
              d.priority === 1
                ? "rgba(61,214,140,.5)"
                : d.priority === 2
                  ? "rgba(201,168,76,.4)"
                  : "rgba(160,160,160,.3)";
            cardBg = isEditing
              ? "rgba(201,168,76,.04)"
              : "var(--surface-sheen)";
            cardBorder = isEditing
              ? "1px solid rgba(201,168,76,.35)"
              : "1px solid rgba(201,168,76,.14)";
          } else {
            borderColor = "rgba(201,168,76,.12)";
            cardBg = isEditing
              ? "rgba(201,168,76,.04)"
              : "var(--surface-sheen)";
            cardBorder = isEditing
              ? "1px solid rgba(201,168,76,.35)"
              : "1px solid rgba(201,168,76,.14)";
          }

          // Small toggle pill button
          const toggleBtn = (
            active,
            label,
            title,
            field,
            activeBg,
            activeBorder,
            activeColor,
          ) =>
            h(
              "button",
              {
                onClick: (e) => {
                  e.stopPropagation();
                  handleToggle(d, field);
                },
                title,
                style: {
                  padding: "3px 8px",
                  fontSize: "9px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontWeight: active ? "700" : "400",
                  letterSpacing: ".06em",
                  lineHeight: "14px",
                  background: active ? activeBg : "rgba(255,255,255,.04)",
                  border: "1px solid " + (active ? activeBorder : "rgba(255,255,255,.12)"),
                  color: active ? activeColor : "rgba(255,255,255,.25)",
                  borderRadius: "3px",
                  cursor: "pointer",
                  transition: "all .15s",
                  flexShrink: 0,
                  boxShadow: active ? ("0 0 6px " + activeBorder) : "none",
                  textShadow: active ? ("0 0 8px " + activeColor) : "none",
                },
              },
              label,
            );

          const allFsc = d.fsc || [];
          const shownFsc = expanded ? allFsc : allFsc.slice(0, 6);
          const hiddenCount = allFsc.length - 6;

          const chipStyle = {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "9px",
            color: "rgba(201,168,76,.7)",
            background: "rgba(201,168,76,.08)",
            border: "1px solid rgba(201,168,76,.18)",
            borderRadius: "3px",
            padding: "1px 5px",
            display: "inline-block",
          };

          const rowStyle = {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
          };

          const iconColor = "rgba(201,168,76,.5)";

          // ── shared input style ──
          const inputStyle = {
            flex: 1,
            minWidth: 0,
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            background: "rgba(201,168,76,.06)",
            border: "1px solid rgba(201,168,76,.25)",
            borderRadius: "3px",
            color: "var(--alabaster)",
            padding: "4px 8px",
            outline: "none",
          };

          const fieldLabel = (txt) =>
            h(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  flexShrink: 0,
                  width: "52px",
                },
              },
              txt,
            );

          // ── DNS prompt mode: show inline reason form instead of full card ──
          if (dnsPrompt[d.id] !== undefined) {
            const isSav = !!dnsSaving[d.id];
            return h(
              "div",
              {
                key: d.id,
                style: {
                  background: "rgba(139,92,246,.05)",
                  border: "1px solid rgba(139,92,246,.4)",
                  borderLeft: "3px solid rgba(139,92,246,.7)",
                  borderRadius: "4px",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "13px",
                    letterSpacing: ".04em",
                    color: "rgba(139,92,246,.8)",
                  },
                },
                d.name || d.id,
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "8px",
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "rgba(139,92,246,.6)",
                  },
                },
                "Why are you sending this to Purgatory?",
              ),
              h("textarea", {
                value: dnsPrompt[d.id] || "",
                onChange: (e) =>
                  setDnsPrompt((prev) => ({ ...prev, [d.id]: e.target.value })),
                placeholder: "e.g. came in too high on pricing, won’t negotiate…",
                rows: 2,
                autoFocus: true,
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "13px",
                  background: "rgba(139,92,246,.06)",
                  border: "1px solid rgba(139,92,246,.3)",
                  borderRadius: "3px",
                  color: "var(--alabaster)",
                  padding: "6px 10px",
                  resize: "vertical",
                  outline: "none",
                },
              }),
              h(
                "div",
                { style: { display: "flex", gap: "6px" } },
                h(
                  "button",
                  {
                    onClick: () => handleDNS(d, dnsPrompt[d.id] || ""),
                    disabled: isSav,
                    style: {
                      padding: "4px 12px",
                      fontFamily: "Cinzel,serif",
                      fontSize: "8px",
                      letterSpacing: ".1em",
                      background: "rgba(139,92,246,.18)",
                      border: "1px solid rgba(139,92,246,.6)",
                      color: "#a78bfa",
                      borderRadius: "3px",
                      cursor: isSav ? "wait" : "pointer",
                    },
                  },
                  isSav ? "Saving…" : "Confirm DNS",
                ),
                h(
                  "button",
                  {
                    onClick: () =>
                      setDnsPrompt((prev) => {
                        const n = { ...prev };
                        delete n[d.id];
                        return n;
                      }),
                    disabled: isSav,
                    style: {
                      padding: "4px 9px",
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,.12)",
                      color: "var(--body-faint)",
                      borderRadius: "3px",
                      cursor: "pointer",
                    },
                  },
                  "Cancel",
                ),
              ),
            );
          }

          return h(
            "div",
            {
              key: d.id,
              style: {
                background: cardBg,
                border: cardBorder,
                borderLeft: "3px solid " + borderColor,
                borderRadius: "4px",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                transition: "background .15s, border .15s",
              },
            },

            // ── Row 1: Name + badges + toggle buttons + action buttons ──
            h(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "8px",
                },
              },
              // Name (editable in edit mode)
              isEditing
                ? h("input", {
                    value: draft.name,
                    onChange: (e) => patchDraft(d.id, "name", e.target.value),
                    style: {
                      ...inputStyle,
                      fontFamily: "Cinzel,serif",
                      fontSize: "12px",
                      letterSpacing: ".05em",
                      color: "var(--gold-solid)",
                      flex: 1,
                    },
                    placeholder: "Company name",
                  })
                : h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "12px",
                        letterSpacing: ".06em",
                        color: isMfr && hasJcp
                          ? "#c4b5fd"
                          : isMfr
                            ? "#f9c850"
                            : hasRep
                              ? "#3dd68c"
                              : hasAcct
                                ? "#d4a843"
                                : "var(--gold-solid)",
                        lineHeight: 1.35,
                        flex: 1,
                        minWidth: 0,
                      },
                    },
                    d.name,
                  ),

              // Right cluster: status badges + toggle btns + edit/delete
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "4px",
                    alignItems: "center",
                    flexShrink: 0,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  },
                },

                // Status badges (view mode only)
                !isEditing &&
                  hasRep &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#3dd68c",
                        background: "rgba(61,214,140,.14)",
                        border: "1px solid rgba(61,214,140,.4)",
                        padding: "2px 6px",
                        borderRadius: "2px",
                        letterSpacing: ".05em",
                        whiteSpace: "nowrap",
                      },
                    },
                    "ACCT REP",
                  ),
                !isEditing &&
                  hasAcct &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#C9A84C",
                        background: "rgba(201,168,76,.14)",
                        border: "1px solid rgba(201,168,76,.4)",
                        padding: "2px 6px",
                        borderRadius: "2px",
                        letterSpacing: ".05em",
                        whiteSpace: "nowrap",
                      },
                    },
                    "WEB RFQ",
                  ),

                // NSN / NIIN badges
                !isEditing &&
                  d.nsn_search === "full" &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#3dd68c",
                        background: "rgba(61,214,140,.12)",
                        border: "1px solid rgba(61,214,140,.3)",
                        padding: "2px 5px",
                        borderRadius: "2px",
                      },
                    },
                    "NSN\u2713",
                  ),
                !isEditing &&
                  d.nsn_search === "niin" &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#7eb8f7",
                        background: "rgba(126,184,247,.12)",
                        border: "1px solid rgba(126,184,247,.3)",
                        padding: "2px 5px",
                        borderRadius: "2px",
                      },
                    },
                    "NIIN",
                  ),

                // Manufacturer badge
                !isEditing &&
                  isMfr &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: hasJcp ? "#c4b5fd" : "#f9c850",
                        background: hasJcp
                          ? "rgba(167,139,250,.18)"
                          : "rgba(249,200,80,.14)",
                        border:
                          "1px solid " +
                          (hasJcp
                            ? "rgba(167,139,250,.5)"
                            : "rgba(249,200,80,.45)"),
                        padding: "2px 6px",
                        borderRadius: "2px",
                        letterSpacing: ".06em",
                        whiteSpace: "nowrap",
                        fontWeight: "700",
                      },
                    },
                    hasJcp ? "MFR · JCP" : "MFR",
                  ),

                // Edit / Save / Cancel
                !isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => startEdit(d),
                      title: "Edit record",
                      style: {
                        padding: "2px 8px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        background: "rgba(201,168,76,.1)",
                        border: "1px solid rgba(201,168,76,.3)",
                        color: "var(--gold-dim)",
                        borderRadius: "3px",
                        cursor: "pointer",
                      },
                    },
                    "Edit",
                  ),
                isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => saveCard(d),
                      disabled: isSaving,
                      title: "Save changes",
                      style: {
                        padding: "2px 10px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        background: isSaving
                          ? "rgba(61,214,140,.1)"
                          : "rgba(61,214,140,.18)",
                        border: "1px solid rgba(61,214,140,.45)",
                        color: "#3dd68c",
                        borderRadius: "3px",
                        cursor: isSaving ? "wait" : "pointer",
                      },
                    },
                    isSaving ? "Saving\u2026" : "Save",
                  ),
                isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => cancelEdit(d.id),
                      disabled: isSaving,
                      title: "Cancel edit",
                      style: {
                        padding: "2px 8px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,.12)",
                        color: "var(--body-faint)",
                        borderRadius: "3px",
                        cursor: "pointer",
                      },
                    },
                    "Cancel",
                  ),
                !isEditing &&
                  h(
                    "button",
                    {
                      onClick: () =>
                        setDnsPrompt((prev) => ({ ...prev, [d.id]: "" })),
                      title: "Do Not Send \u2014 move to Purgatory",
                      style: {
                        padding: "2px 7px",
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        background: "rgba(139,92,246,.08)",
                        border: "1px solid rgba(139,92,246,.28)",
                        color: "rgba(139,92,246,.7)",
                        borderRadius: "3px",
                        cursor: "pointer",
                      },
                    },
                    "DNS",
                  ),
                !isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => handleDelete(d.id),
                      title: "Remove " + d.id,
                      style: {
                        padding: "2px 7px",
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        background: "rgba(231,76,60,.08)",
                        border: "1px solid rgba(231,76,60,.25)",
                        color: "rgba(231,76,60,.6)",
                        borderRadius: "3px",
                        cursor: "pointer",
                      },
                    },
                    "\u00D7",
                  ),
              ),
            ),

            // ── Toggle buttons (under card name) ──
            !isEditing &&
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "5px",
                    flexWrap: "wrap",
                  },
                },
                toggleBtn(
                  hasAcct,
                  "\u2605",
                  hasAcct
                    ? "Clear: web account"
                    : "Mark: have account — use web RFQ",
                  "has_account",
                  "rgba(201,168,76,.35)",
                  "#C9A84C",
                  "#ffe08a",
                ),
                toggleBtn(
                  hasRep,
                  "\uD83D\uDC64",
                  hasRep ? "Clear: account rep" : "Mark: have account rep",
                  "has_rep",
                  "rgba(61,214,140,.30)",
                  "#3dd68c",
                  "#9effd4",
                ),
                toggleBtn(
                  isMfr,
                  "MFR",
                  isMfr ? "Clear: manufacturer" : "Mark as manufacturer (direct source)",
                  "is_manufacturer",
                  "rgba(249,200,80,.28)",
                  "#f9c850",
                  "#fef08a",
                ),
                toggleBtn(
                  hasJcp,
                  "JCP",
                  hasJcp ? "Clear: JCP certified" : "Mark: JCP certified",
                  "has_jcp",
                  "rgba(167,139,250,.32)",
                  "#a78bfa",
                  "#ddd6fe",
                ),
                toggleBtn(
                  hasMilPack,
                  "MIL≡",
                  hasMilPack ? "Clear: mil-std packing" : "Mark: mil-std packing capable",
                  "has_mil_std_pack",
                  "rgba(96,165,250,.28)",
                  "#60a5fa",
                  "#bae6fd",
                ),
                toggleBtn(
                  isWholesaler,
                  "WHL",
                  isWholesaler ? "Clear: wholesaler" : "Mark: wholesaler (bulk distributor)",
                  "is_wholesaler",
                  "rgba(251,146,60,.28)",
                  "#fb923c",
                  "#fed7aa",
                ),
                toggleBtn(
                  isDistributor,
                  "DIST",
                  isDistributor ? "Clear: distributor" : "Mark: distributor (broad P/N sourcing)",
                  "is_distributor",
                  "rgba(56,189,248,.22)",
                  "#38bdf8",
                  "#bae6fd",
                ),
              ),

            // ════ VIEW MODE ════════════════════════════════════════════════
            !isEditing &&
              h(
                React.Fragment,
                null,

                // Tags
                (d.tags || []).filter((t) => t !== "preferred-alt").length >
                  0 &&
                  h(
                    "div",
                    {
                      style: { display: "flex", flexWrap: "wrap", gap: "4px" },
                    },
                    ...(d.tags || [])
                      .filter((t) => t !== "preferred-alt")
                      .map((t) =>
                        h(
                          "span",
                          {
                            key: t,
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "9px",
                              color: "var(--body-dim)",
                              background: "rgba(255,255,255,.04)",
                              border: "1px solid rgba(255,255,255,.08)",
                              borderRadius: "3px",
                              padding: "1px 5px",
                            },
                          },
                          t,
                        ),
                      ),
                  ),

                // FSC chips + more toggle
                allFsc.length > 0 &&
                  h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px",
                        alignItems: "center",
                      },
                    },
                    ...shownFsc.map((f) => {
                      const isHi = hiDollarFscs.has(f);
                      return h("span", {
                        key: f,
                        title: isHi ? "High-dollar FSC — click to unmark" : "Click to flag as high-dollar FSC",
                        onClick: () => toggleHiFsc(f),
                        style: isHi ? {
                          ...chipStyle,
                          color: "#22c55e",
                          background: "rgba(34,197,94,.12)",
                          border: "1px solid rgba(34,197,94,.45)",
                          fontWeight: "bold",
                          cursor: "pointer",
                          textShadow: "0 0 6px rgba(34,197,94,.5)",
                        } : { ...chipStyle, cursor: "pointer" },
                      }, f);
                    }),
                    !expanded &&
                      hiddenCount > 0 &&
                      h(
                        "button",
                        {
                          onClick: () => toggleCard(d.id),
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "9px",
                            color: "var(--gold-dim)",
                            background: "rgba(201,168,76,.06)",
                            border: "1px solid rgba(201,168,76,.2)",
                            borderRadius: "3px",
                            padding: "1px 6px",
                            cursor: "pointer",
                          },
                        },
                        "+" + hiddenCount + " more",
                      ),
                    expanded &&
                      allFsc.length > 6 &&
                      h(
                        "button",
                        {
                          onClick: () => toggleCard(d.id),
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "9px",
                            color: "var(--body-faint)",
                            background: "transparent",
                            border: "1px solid rgba(201,168,76,.12)",
                            borderRadius: "3px",
                            padding: "1px 6px",
                            cursor: "pointer",
                          },
                        },
                        "collapse",
                      ),
                  ),

                // Divider
                h("div", {
                  style: {
                    borderTop: "1px solid rgba(201,168,76,.08)",
                    margin: "0 -2px",
                  },
                }),

                // Phone
                h(
                  "div",
                  { style: rowStyle },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: iconColor,
                        flexShrink: 0,
                      },
                    },
                    "\uD83D\uDCDE",
                  ),
                  d.phone
                    ? h(
                        "a",
                        {
                          href: "tel:" + d.phone.replace(/[^0-9]/g, ""),
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "var(--accent-green)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        },
                        d.phone,
                      )
                    : h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            fontStyle: "italic",
                          },
                        },
                        "No phone",
                      ),
                ),

                // Email
                h(
                  "div",
                  { style: rowStyle },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: iconColor,
                        flexShrink: 0,
                      },
                    },
                    "\u2709",
                  ),
                  d.email
                    ? h(
                        "a",
                        {
                          href: "mailto:" + d.email,
                          title: d.email,
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "#7eb8f7",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          },
                        },
                        d.email,
                      )
                    : h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            fontStyle: "italic",
                          },
                        },
                        "No email",
                      ),
                ),

                // Website
                h(
                  "div",
                  { style: rowStyle },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: iconColor,
                        flexShrink: 0,
                      },
                    },
                    "\uD83C\uDF10",
                  ),
                  d.website
                    ? h(
                        "a",
                        {
                          href: d.website.startsWith("http")
                            ? d.website
                            : "https://" + d.website,
                          target: "_blank",
                          rel: "noopener noreferrer",
                          title: d.website,
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "rgba(201,168,76,.8)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          },
                        },
                        (d.website || "")
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, ""),
                      )
                    : h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            fontStyle: "italic",
                          },
                        },
                        "No website",
                      ),
                ),

                // Notes
                d.notes &&
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontStyle: "italic",
                        fontSize: "12px",
                        color: "var(--body-dim)",
                        lineHeight: 1.4,
                        borderTop: "1px solid rgba(201,168,76,.06)",
                        paddingTop: "6px",
                        marginTop: "2px",
                      },
                    },
                    d.notes,
                  ),
              ),

            // ════ EDIT MODE ════════════════════════════════════════════════
            isEditing &&
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "7px",
                  },
                },

                // Phone
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Phone"),
                  h("input", {
                    value: draft.phone,
                    onChange: (e) => patchDraft(d.id, "phone", e.target.value),
                    placeholder: "(xxx) xxx-xxxx",
                    style: inputStyle,
                  }),
                ),

                // Email
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Email"),
                  h("input", {
                    value: draft.email,
                    onChange: (e) => patchDraft(d.id, "email", e.target.value),
                    placeholder: "rep@company.com",
                    style: inputStyle,
                  }),
                ),

                // Website
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Website"),
                  h("input", {
                    value: draft.website,
                    onChange: (e) =>
                      patchDraft(d.id, "website", e.target.value),
                    placeholder: "company.com",
                    style: inputStyle,
                  }),
                ),

                // FSC lanes
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("FSC"),
                  h("input", {
                    value: draft.fsc,
                    onChange: (e) => patchDraft(d.id, "fsc", e.target.value),
                    placeholder: "4730, 4820, 4330",
                    title: "Comma-separated FSC codes",
                    style: inputStyle,
                  }),
                ),

                // Tags
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Tags"),
                  h("input", {
                    value: draft.tags,
                    onChange: (e) => patchDraft(d.id, "tags", e.target.value),
                    placeholder: "master-distributor, texas, fleet-pricing",
                    title: "Comma-separated tags",
                    style: inputStyle,
                  }),
                ),

                // Item keywords
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Items"),
                  h("input", {
                    value: draft.item_keywords,
                    onChange: (e) => patchDraft(d.id, "item_keywords", e.target.value),
                    placeholder: "bolt, screw, nut, stud",
                    title: "Only send RFQs where item name contains one of these keywords (comma-separated). Leave blank to match all items in covered FSCs.",
                    style: inputStyle,
                  }),
                ),

                // Notes
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "6px",
                    },
                  },
                  fieldLabel("Notes"),
                  h("textarea", {
                    value: draft.notes,
                    onChange: (e) => patchDraft(d.id, "notes", e.target.value),
                    placeholder:
                      "Account rep, pricing tier, special instructions…",
                    rows: 2,
                    style: {
                      ...inputStyle,
                      resize: "vertical",
                      lineHeight: 1.5,
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "12px",
                    },
                  }),
                ),

                // Hint
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      fontStyle: "italic",
                    },
                  },
                  "FSC + Tags: comma-separated. Saves merge into existing record.",
                ),
              ),
          );
        };

        const renderPurgCard = (d) =>
          h(
            "div",
            {
              key: d.id,
              style: {
                background: "rgba(139,92,246,.04)",
                border: "1px solid rgba(139,92,246,.22)",
                borderLeft: "3px solid rgba(139,92,246,.5)",
                borderRadius: "4px",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                opacity: 0.8,
              },
            },
            h(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "8px",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "13px",
                    letterSpacing: ".04em",
                    color: "rgba(139,92,246,.6)",
                    textDecoration: "line-through",
                    textDecorationColor: "rgba(139,92,246,.4)",
                  },
                },
                d.name || d.id,
              ),
              h(
                "button",
                {
                  onClick: () => handleRestoreDNS(d),
                  title: "Restore to active roster",
                  style: {
                    padding: "2px 9px",
                    fontFamily: "Cinzel,serif",
                    fontSize: "8px",
                    letterSpacing: ".1em",
                    background: "rgba(61,214,140,.08)",
                    border: "1px solid rgba(61,214,140,.3)",
                    color: "#3dd68c",
                    borderRadius: "3px",
                    cursor: "pointer",
                    flexShrink: 0,
                  },
                },
                "Restore",
              ),
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "12px",
                  color: "rgba(139,92,246,.55)",
                  lineHeight: 1.45,
                },
              },
              "“" + (d.dns_reason || "No reason given.") + "”",
            ),
          );

        const grid = (items, op) =>
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
                gap: "10px",
                marginBottom: "6px",
                opacity: op || 1,
              },
            },
            ...items.map(renderDistCard),
          );

        return h(
          "div",
          null,

          // \u2500\u2500 MANUFACTURERS (always first) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          mfrs.length > 0 &&
            h(
              "div",
              null,
              tierLabel("Manufacturers \u2014 Direct Source", mfrs.length, "#f9c850"),
              mfrsJcp.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "JCP Certified \u2014 Best Margin Path",
                    mfrsJcp.length,
                    "#c4b5fd",
                    true,
                  ),
                  grid(mfrsJcp),
                ),
              mfrsOther.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "Direct \u2014 No JCP on file",
                    mfrsOther.length,
                    "#f9c850",
                    true,
                  ),
                  grid(mfrsOther),
                ),
            ),

          // \u2500\u2500 PREFERRED DISTRIBUTORS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          preferred.length > 0 &&
            h(
              "div",
              null,
              tierLabel("Preferred Distributors", preferred.length, "#3dd68c"),
              p1.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "P1 \u2014 Broadest \u00B7 Hit First",
                    p1.length,
                    "#3dd68c",
                    true,
                  ),
                  grid(p1),
                ),
              p2.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "P2 \u2014 Lane Specialists",
                    p2.length,
                    "var(--gold-solid)",
                    true,
                  ),
                  grid(p2),
                ),
              p3.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "P3 \u2014 Need Account",
                    p3.length,
                    "var(--body-faint)",
                    true,
                  ),
                  grid(p3),
                ),
            ),

          // \u2500\u2500 OTHER DISTRIBUTORS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          others.length > 0 &&
            h(
              "div",
              null,
              tierLabel("Other Distributors", others.length, "var(--gold-dim)"),
              grid(others, 0.65),
            ),

          // \u2500\u2500 PURGATORY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          purgDists.length > 0 &&
            h(
              "div",
              null,
              tierLabel(
                "Purgatory \u2014 Do Not Send",
                purgDists.length,
                "rgba(139,92,246,.7)",
              ),
              h(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
                    gap: "10px",
                    marginBottom: "6px",
                  },
                },
                ...purgDists.map(renderPurgCard),
              ),
            ),
        );
      })(),

      // ── Empty state ──
      dists.length === 0 &&
        h(
          "div",
          {
            style: {
              padding: "40px",
              textAlign: "center",
              border: "1px dashed rgba(201,168,76,.2)",
              borderRadius: "6px",
              color: "var(--body-faint)",
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "15px",
            },
          },
          "No manufacturers or distributors loaded. Paste dist-seed.json above and click Parse & Seed Mongo.",
        ),
    );
  }

  // ── CONFIRMATION LANE ────────────────────────────────────────────────
  // Shows distributor outreach responses for a selected sol.
  // BID entries get a "Push to Pipeline" button that pre-fills the drawer.
  function ConfirmationLane({ rows, setRows, showToast, setOpenDrawer, goPipeline }) {
    const [search, setSearch] = useState("");
    const [selectedSol, setSelectedSol] = useState(null);
    const [bidEntries, setBidEntries] = useState([]);
    const [pushing, setPushing] = useState(null);

    const RESPONSE_STYLE = {
      bid:        { color: "#4caf50", label: "BID" },
      pending:    { color: "#ffc107", label: "PENDING" },
      no_bid:     { color: "#ef5350", label: "NO BID" },
      prior_win:  { color: "#a78bfa", label: "↩ PRIOR WIN" },
    };

    const filteredSols = (rows || []).filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (r.sol_number || "").toLowerCase().includes(q) ||
        (r.nsn || "").includes(q) ||
        (r.ref_part_number || "").toLowerCase().includes(q) ||
        (r.item_name || "").toLowerCase().includes(q)
      );
    });

    function selectSol(sol) {
      setSelectedSol(sol);
      const pns = [sol.ref_part_number, sol.nsn]
        .filter(Boolean)
        .map((s) => s.trim().toUpperCase());
      const dists = window.SCC_DIST?.DISTRIBUTORS || [];
      const results = [];

      // Inject win-ledger vendors at top (auto-populate)
      const WL = window.SCC_WIN_LEDGER;
      if (WL) {
        const priorWins = WL.lookup(sol.nsn, sol.ref_part_number);
        const seenVendors = new Set();
        for (const w of priorWins) {
          if (seenVendors.has(w.vendor_name)) continue;
          seenVendors.add(w.vendor_name);
          const matchedDist = dists.find(d => d.name.toLowerCase() === w.vendor_name.toLowerCase())
            || { id: "wl_" + w.id, name: w.vendor_name, email: "" };
          results.push({
            dist: matchedDist,
            entry: {
              pn: w.pn || w.nsn || sol.ref_part_number,
              response: "prior_win",
              price: w.price,
              bid_price: w.bid_price,
              qty: w.qty,
              date: w.date || w.logged,
              notes: "Win ledger · Sol " + (w.sol_number || "—"),
            },
            _win: w,
          });
        }
      }

      for (const d of dists) {
        for (const entry of d.outreach_log || []) {
          if (pns.includes((entry.pn || "").trim().toUpperCase())) {
            results.push({ dist: d, entry });
          }
        }
      }
      // Sort: prior_win first, then bid, then pending, then no_bid
      const order = { prior_win: 0, bid: 1, pending: 2, no_bid: 3 };
      results.sort((a, b) => (order[a.entry.response] ?? 9) - (order[b.entry.response] ?? 9));
      setBidEntries(results);
    }

    async function pushToPipeline(dist, entry) {
      const key = dist.id + ":" + entry.pn + ":" + entry.date;
      setPushing(key);
      try {
        const current = (rows || []).find((r) => r.sol_number === selectedSol.sol_number);
        if (!current) { showToast("Sol not in pipeline", true); return; }

        const ADVANCE_FROM = ["New", "Researching", "Sourcing"];
        const newStatus = ADVANCE_FROM.includes(current.status) ? "Awaiting Quotes" : current.status;

        const pocLine = [dist.name, dist.phone].filter(Boolean).join(" / ");
        const bidNote = [
          "Vendor: " + dist.name,
          entry.pn + " @ $" + (entry.price ?? "?"),
          entry.qty ? entry.qty + " EA" : null,
          entry.lead_time || null,
          entry.notes || null,
          entry.date || null,
        ].filter(Boolean).join(" · ");

        const updated = {
          ...current,
          status: newStatus,
          supplier_poc: pocLine,
          supplier_quote_price: entry.price != null ? String(entry.price) : current.supplier_quote_price,
          supplier_lead_time: entry.lead_time || current.supplier_lead_time,
          supplier_quote_date: entry.date || new Date().toISOString().slice(0, 10),
          notes: [current.notes, bidNote].filter(Boolean).join("\n"),
        };

        await window.SCC_DB.dbSave(updated);
        setRows((prev) => prev.map((r) => r.sol_number === updated.sol_number ? updated : r));
        showToast(updated.sol_number + " → " + newStatus + " · " + dist.name);
        goPipeline(updated.sol_number);
        setOpenDrawer(updated.sol_number);
      } catch (e) {
        showToast("Push failed: " + e.message, true);
      } finally {
        setPushing(null);
      }
    }

    const surface = { background: "var(--surface-inset)", border: "1px solid rgba(201,168,76,.15)", borderRadius: "6px", padding: "14px", marginBottom: "12px" };
    const gold8 = { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".12em", color: "var(--gold-dim)", textTransform: "uppercase", marginBottom: "6px" };
    const mono = { fontFamily: "JetBrains Mono,monospace", fontSize: "12px" };

    return h(
      "div",
      { style: { animation: "fadeUp .3s ease both" } },

      // Header
      h("div", { style: { marginBottom: "20px" } },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "18px", letterSpacing: ".1em", color: "var(--gold-solid)" } }, "Confirm Quote"),
        h("div", { style: { fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontSize: "13px", color: "var(--gold-dim)", marginTop: "3px" } },
          "Surface vendor bid responses · advance sol to pipeline"),
      ),

      // Sol search
      h("div", { style: surface },
        h("div", { style: gold8 }, "Search solicitation"),
        h("input", {
          type: "text",
          placeholder: "Sol #, NSN, Part Number, or Item Name...",
          value: search,
          onChange: (e) => { setSearch(e.target.value); setSelectedSol(null); setBidEntries([]); },
          style: { width: "100%", background: "var(--surface-card)", border: "1px solid rgba(201,168,76,.2)", borderRadius: "4px", padding: "8px 12px", color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "12px", outline: "none", boxSizing: "border-box" },
        }),
        search.trim() && h(
          "div",
          { style: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "4px", maxHeight: "200px", overflowY: "auto" } },
          filteredSols.length === 0
            ? h("div", { style: { color: "var(--gold-dim)", fontSize: "12px", fontStyle: "italic" } }, "No matching solicitations in pipeline.")
            : filteredSols.map((r) =>
                h("button", {
                  key: r.sol_number,
                  onClick: () => selectSol(r),
                  style: {
                    textAlign: "left", background: selectedSol?.sol_number === r.sol_number ? "rgba(201,168,76,.15)" : "transparent",
                    border: "1px solid rgba(201,168,76,.12)", borderRadius: "4px", padding: "7px 10px", cursor: "pointer",
                    color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "11px",
                  },
                },
                  h("span", { style: { color: "var(--gold-solid)", marginRight: "8px" } }, r.sol_number),
                  (r.item_name || "").slice(0, 50),
                  h("span", { style: { marginLeft: "8px", color: "var(--gold-dim)", fontSize: "10px" } }, r.status),
                ),
              ),
        ),
      ),

      // Selected sol + outreach results
      selectedSol && h("div", null,

        // ── Prior Win callout ──────────────────────────────────────────
        (() => {
          const WL = window.SCC_WIN_LEDGER;
          if (!WL) return null;
          const priorWins = WL.lookup(selectedSol.nsn, selectedSol.ref_part_number);
          if (priorWins.length === 0) return null;
          return h("div", {
            style: { background: "rgba(61,214,140,.06)", border: "1px solid rgba(61,214,140,.35)",
              borderLeft: "4px solid rgba(61,214,140,.7)", padding: "12px 16px", marginBottom: "12px" }
          },
            h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".14em",
              textTransform: "uppercase", color: "var(--accent-green)", marginBottom: "8px" } },
              "↩ Won Before — " + priorWins.length + " vendor" + (priorWins.length > 1 ? "s" : "") + " · go here first"),
            h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
              ...priorWins.map(w => {
                const age = WL.winAge(w);
                const net = WL.netAfterFE(w.bid_price, w.price);
                return h("div", { key: w.id,
                  style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: "var(--body-dim)",
                    display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center",
                    borderBottom: "1px solid rgba(61,214,140,.1)", paddingBottom: "4px" }
                },
                  h("span", { style: { color: "var(--gold-solid)", fontFamily: "Cinzel,serif", fontSize: "12px" } }, w.vendor_name),
                  age && h("span", { title: age.days + " days ago",
                    style: { fontSize: "9px", padding: "1px 5px", background: age.color + "18",
                      border: "1px solid " + age.color + "44", color: age.color, borderRadius: "2px" }
                  }, age.label),
                  w.price     ? h("span", null, "Cost $" + Number(w.price).toFixed(2))     : null,
                  w.bid_price ? h("span", null, "Bid $"  + Number(w.bid_price).toFixed(2)) : null,
                  net != null ? h("span", { style: { color: net >= 0 ? "#4caf50" : "#ef5350", fontWeight: "600" } },
                    "Net $" + net.toFixed(2)) : null,
                  w.qty       ? h("span", null, "Qty " + w.qty) : null,
                  w.sol_number? h("span", { style: { color: "var(--body-faint)" } }, w.sol_number) : null,
                );
              })
            ),
          );
        })(),

        h("div", { style: { ...surface, borderColor: "rgba(201,168,76,.3)" } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" } },
            h("div", null,
              h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "12px", color: "var(--gold-solid)", letterSpacing: ".08em" } }, selectedSol.sol_number),
              h("div", { style: { fontSize: "12px", color: "var(--alabaster)", marginTop: "2px" } }, selectedSol.item_name || "—"),
              h("div", { style: { fontSize: "11px", color: "var(--gold-dim)", marginTop: "2px" } },
                ["NSN: " + (selectedSol.nsn || "—"), "P/N: " + (selectedSol.ref_part_number || "—"), "Status: " + (selectedSol.status || "—")].join("  ·  "),
              ),
            ),
          ),

          bidEntries.length === 0
            ? h("div", { style: { color: "var(--gold-dim)", fontSize: "12px", fontStyle: "italic", padding: "10px 0" } },
                "No outreach responses logged for this solicitation's P/Ns yet.")
            : h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                bidEntries.map(({ dist, entry, _win }, i) => {
                  const rs = RESPONSE_STYLE[entry.response] || { color: "var(--body-dim)", label: entry.response };
                  const key = dist.id + ":" + entry.pn + ":" + (entry.date || i);
                  const isBid = entry.response === "bid";
                  const isPriorWin = entry.response === "prior_win";
                  return h("div", {
                    key: key + i,
                    style: {
                      background: isPriorWin ? "rgba(167,139,250,.06)" : isBid ? "rgba(76,175,80,.06)" : "var(--surface-card)",
                      border: isPriorWin ? "1px solid rgba(167,139,250,.35)" : isBid ? "1px solid rgba(76,175,80,.3)" : "1px solid rgba(201,168,76,.1)",
                      borderLeft: isPriorWin ? "3px solid #a78bfa" : undefined,
                      borderRadius: "5px", padding: "10px 12px",
                      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px",
                    },
                  },
                    h("div", { style: { flex: 1 } },
                      h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" } },
                        h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--gold-solid)" } }, dist.name),
                        h("span", { style: { background: rs.color + "22", border: "1px solid " + rs.color + "66", color: rs.color, borderRadius: "3px", padding: "1px 6px", fontSize: "9px", fontFamily: "Cinzel,serif", letterSpacing: ".08em" } }, rs.label),
                      ),
                      h("div", { style: { ...mono, color: "var(--body-dim)", fontSize: "11px" } },
                        [
                          "P/N: " + entry.pn,
                          entry.price != null ? "$" + entry.price : null,
                          entry.qty ? entry.qty + " EA" : null,
                          entry.lead_time || null,
                          entry.notes || null,
                        ].filter(Boolean).join("  ·  "),
                      ),
                      entry.date && h("div", { style: { fontSize: "10px", color: "var(--gold-dim)", marginTop: "2px" } }, entry.date),
                    ),
                    isBid && h("button", {
                      onClick: () => pushToPipeline(dist, entry),
                      disabled: !!pushing,
                      style: {
                        background: "linear-gradient(135deg,#1a5c1a,#2e7d32)",
                        border: "1px solid #4caf50", borderRadius: "5px",
                        color: "#fff", fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".08em",
                        padding: "7px 14px", cursor: pushing ? "wait" : "pointer", whiteSpace: "nowrap",
                        opacity: pushing === key ? .6 : 1,
                      },
                    }, pushing === key ? "Pushing..." : "→ Push to Pipeline"),
                  );
                }),
              ),
        ),
      ),
    );
  }

  // ── SOURCE TAB ROOT ───────────────────────────────────────────────────
  function SourceTab({ showToast, rows, setRows, setOpenDrawer, goPipeline }) {
    const [subTab, setSubTab] = useState("rolodex");

    const { VendorRolodex } = window.SCC_TABS;

    const tabBtn = (id, label) =>
      h(
        "button",
        {
          onClick: () => setSubTab(id),
          style: {
            padding: "6px 16px",
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".1em",
            background: subTab === id ? "rgba(201,168,76,.2)" : "transparent",
            border:
              subTab === id
                ? "1px solid rgba(201,168,76,.4)"
                : "1px solid rgba(201,168,76,.15)",
            color: subTab === id ? "var(--gold-solid)" : "var(--gold-dim)",
            borderRadius: "4px",
            cursor: "pointer",
            transition: "all .15s",
          },
        },
        label,
      );

    return h(
      "div",
      { style: { padding: "20px" } },
      // Sub-tab bar
      h(
        "div",
        { style: { display: "flex", gap: "8px", marginBottom: "20px" } },
        tabBtn("rolodex", "Vendor Rolodex"),
        tabBtn("distdb", "Distributor DB"),
        tabBtn("confirm", "✓ Confirm Quote"),
      ),
      subTab === "rolodex" && VendorRolodex && h(VendorRolodex, { showToast }),
      subTab === "distdb" && h(DistributorDB, null),
      subTab === "confirm" && h(ConfirmationLane, { rows, setRows, showToast, setOpenDrawer, goPipeline }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SourceTab = SourceTab;
})();
