(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — INBOX MONITOR TAB
  //  Daily running report of vendor RFQ responses
  //  Reads from rfq_responses + rfq_scan_log via scc-rfq-inbox function
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.InboxTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;

  const FN   = "/.netlify/functions/scc-rfq-inbox";
  const mono = "JetBrains Mono,monospace";

  // ── Color constants ──────────────────────────────────────────────────────
  const gold  = "rgba(201,168,76,";
  const green = "rgba(61,214,140,";
  const red   = "rgba(239,68,68,";
  const amber = "rgba(251,191,36,";
  const blue  = "rgba(56,189,248,";
  const dim   = "rgba(245,240,232,0.35)";

  async function api(action, payload) {
    const res = await fetch(FN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "API error");
    return data;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function fmt$(n) {
    if (n == null) return "—";
    return "$" + Number(n).toFixed(4);
  }

  function fmtPct(n) {
    if (n == null) return null;
    return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  }

  function fmtTime(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true }) + " CT";
  }

  function fmtDate(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function minutesAgo(isoStr) {
    if (!isoStr) return null;
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hrs = Math.round(mins / 60);
    return hrs + "h ago";
  }

  // ── Chips ────────────────────────────────────────────────────────────────
  function histChip(flag, deviation) {
    if (!flag || flag === "NO_HIST" || flag === "NO_DATA") {
      return h("span", {
        style: { fontFamily: mono, fontSize: "9px", color: dim, border: "1px solid rgba(245,240,232,.15)", borderRadius: "3px", padding: "1px 5px" },
      }, "NO HIST");
    }
    const colors = {
      OVER:  { color: red + "1)", bg: red + ".12)", border: red + ".35)" },
      FAIR:  { color: green + "1)", bg: green + ".10)", border: green + ".30)" },
      UNDER: { color: gold + "1)", bg: gold + ".10)", border: gold + ".35)" },
    };
    const c = colors[flag] || colors.FAIR;
    const label = flag + (deviation != null ? " " + fmtPct(deviation) : "");
    return h("span", {
      style: { fontFamily: mono, fontSize: "9px", color: c.color, background: c.bg, border: "1px solid " + c.border, borderRadius: "3px", padding: "1px 6px", flexShrink: 0 },
    }, label);
  }

  function marginChip(flag, pct) {
    if (!flag) return null;
    const colors = {
      GOOD:     { color: green + "1)", bg: green + ".10)", border: green + ".30)" },
      OK:       { color: blue + "1)", bg: blue + ".10)", border: blue + ".28)" },
      TIGHT:    { color: amber + "1)", bg: amber + ".10)", border: amber + ".30)" },
      SQUEEZED: { color: red + "1)", bg: red + ".12)", border: red + ".35)" },
      NEGATIVE: { color: "#ff4444", bg: "rgba(255,0,0,.15)", border: "rgba(255,68,68,.4)" },
    };
    const c = colors[flag] || colors.OK;
    const label = flag + (pct != null ? " " + pct.toFixed(1) + "%" : "");
    return h("span", {
      style: { fontFamily: mono, fontSize: "9px", color: c.color, background: c.bg, border: "1px solid " + c.border, borderRadius: "3px", padding: "1px 6px", flexShrink: 0 },
    }, label);
  }

  function actionBadge(action) {
    if (!action) return null;
    const cfg = {
      ALL_NO_BID:      { label: "ALL NO-BID", color: red + "1)", bg: red + ".12)", border: red + ".35)" },
      REVIEW_PRICE:    { label: "REVIEW PRICE", color: amber + "1)", bg: amber + ".10)", border: amber + ".30)" },
      MARGIN_NEGATIVE: { label: "MARGIN NEGATIVE", color: red + "1)", bg: red + ".12)", border: red + ".35)" },
    };
    const c = cfg[action];
    if (!c) return null;
    return h("span", {
      style: { fontFamily: mono, fontSize: "9px", letterSpacing: ".04em", color: c.color, background: c.bg, border: "1px solid " + c.border, borderRadius: "3px", padding: "2px 8px", fontWeight: 700 },
    }, c.label);
  }

  // ── Quote Row ────────────────────────────────────────────────────────────
  function QuoteRow({ q, isBest }) {
    return h("div", {
      style: {
        display: "flex", alignItems: "flex-start", gap: "10px", padding: "7px 12px",
        borderLeft: isBest ? "2px solid " + gold + "0.7)" : "2px solid rgba(245,240,232,.08)",
        background: isBest ? gold + ".04)" : "transparent",
        marginBottom: "2px",
      },
    },
      // Star
      h("span", { style: { fontFamily: mono, fontSize: "11px", color: isBest ? gold + "1)" : "transparent", flexShrink: 0, width: "14px" } }, isBest ? "★" : ""),

      // Vendor
      h("div", { style: { flex: "0 0 200px", fontFamily: mono, fontSize: "11px", color: "var(--alabaster)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        q.vendor_name || q.vendor_email),

      // Price
      h("div", { style: { flex: "0 0 90px", fontFamily: mono, fontSize: "11px", color: "var(--alabaster)", fontWeight: isBest ? 700 : 400 } },
        fmt$(q.unit_price)),

      // Chips
      h("div", { style: { display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" } },
        histChip(q.hist_flag, q.hist_deviation_pct),
        marginChip(q.margin_flag, q.margin_at_hist_pct),
      ),

      // Target bid
      h("div", { style: { marginLeft: "auto", fontFamily: mono, fontSize: "10px", color: isBest ? gold + "0.9)" : dim, flexShrink: 0 } },
        q.target_bid ? "Bid@27.5%: " + fmt$(q.target_bid) : ""),

      // Lead time
      q.lead_time_days ? h("div", { style: { fontFamily: mono, fontSize: "10px", color: dim, flexShrink: 0 } }, q.lead_time_days + "d ARO") : null,
    );
  }

  // ── No-Bid Row ───────────────────────────────────────────────────────────
  function NoBidRow({ nb }) {
    return h("div", {
      style: {
        display: "flex", alignItems: "flex-start", gap: "10px", padding: "5px 12px",
        borderLeft: "2px solid " + red + ".3)",
        marginBottom: "2px",
      },
    },
      h("span", { style: { fontFamily: mono, fontSize: "10px", color: red + "0.6)", flexShrink: 0, width: "14px" } }, "✗"),
      h("div", { style: { flex: "0 0 200px", fontFamily: mono, fontSize: "11px", color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        nb.vendor_name || nb.vendor_email),
      h("div", { style: { fontFamily: mono, fontSize: "10px", color: red + "0.7)", fontStyle: "italic" } },
        nb.no_bid_reason || "No bid"),
    );
  }

  // ── SOL Card ─────────────────────────────────────────────────────────────
  function SolCard({ sol }) {
    const [expanded, setExpanded] = useState(true);

    const bestIdx = sol.quotes.length > 0
      ? sol.quotes.reduce((bi, q, i) => (q.unit_price || Infinity) < (sol.quotes[bi].unit_price || Infinity) ? i : bi, 0)
      : -1;

    return h("div", {
      style: {
        border: "1px solid rgba(201,168,76,.15)",
        marginBottom: "10px",
        background: "var(--inset-bg)",
      },
    },

      // ── Card Header ──
      h("div", {
        onClick: () => setExpanded((x) => !x),
        style: {
          display: "flex", alignItems: "center", gap: "10px",
          padding: "9px 14px", cursor: "pointer",
          borderBottom: expanded ? "1px solid rgba(201,168,76,.12)" : "none",
          background: "rgba(201,168,76,.04)",
        },
      },
        // Chevron
        h("span", { style: { fontFamily: mono, fontSize: "9px", color: dim, flexShrink: 0 } }, expanded ? "▼" : "▶"),

        // SOL + item name
        h("div", { style: { flex: 1 } },
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", letterSpacing: ".06em", color: gold + "1)" } }, sol.sol_number),
          sol.item_name && h("div", { style: { fontFamily: mono, fontSize: "10px", color: dim, marginTop: "1px" } }, sol.item_name),
        ),

        // Counts
        sol.quote_count > 0 && h("span", {
          style: { fontFamily: mono, fontSize: "10px", color: green + "1)", background: green + ".08)", border: "1px solid " + green + ".25)", borderRadius: "3px", padding: "2px 8px" },
        }, sol.quote_count + (sol.quote_count === 1 ? " QUOTE" : " QUOTES")),

        sol.no_bid_count > 0 && h("span", {
          style: { fontFamily: mono, fontSize: "10px", color: red + "0.7)", background: red + ".08)", border: "1px solid " + red + ".25)", borderRadius: "3px", padding: "2px 8px" },
        }, sol.no_bid_count + (sol.no_bid_count === 1 ? " NO-BID" : " NO-BIDS")),

        actionBadge(sol.action),
      ),

      // ── Card Body ──
      expanded && h("div", { style: { padding: "8px 0 4px" } },

        // Quotes
        sol.quotes.length > 0 && h("div", null,
          h("div", { style: { fontFamily: mono, fontSize: "9px", letterSpacing: ".08em", color: dim, padding: "2px 12px 6px", textTransform: "uppercase" } }, "Quotes — sorted by price"),
          ...sol.quotes
            .slice().sort((a, b) => (a.unit_price || Infinity) - (b.unit_price || Infinity))
            .map((q, i) => h(QuoteRow, { key: q.vendor_email + i, q, isBest: i === 0 })),
        ),

        // No-bids
        sol.no_bids.length > 0 && h("div", { style: { marginTop: sol.quotes.length ? "6px" : 0 } },
          h("div", { style: { fontFamily: mono, fontSize: "9px", letterSpacing: ".08em", color: dim, padding: "2px 12px 6px", textTransform: "uppercase" } }, "No-Bids"),
          ...sol.no_bids.map((nb, i) => h(NoBidRow, { key: nb.vendor_email + i, nb })),
        ),

        // Best recommendation
        bestIdx >= 0 && sol.quotes.length > 1 && h("div", {
          style: {
            margin: "8px 12px 6px",
            padding: "7px 12px",
            background: gold + ".06)",
            border: "1px solid " + gold + ".2)",
            fontFamily: mono,
            fontSize: "11px",
            color: gold + "0.9)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          },
        },
          h("span", null, "★ BEST:"),
          h("strong", null, (sol.quotes[0].vendor_name || sol.quotes[0].vendor_email) + " @ " + fmt$(sol.quotes[0].unit_price)),
          sol.quotes[0].target_bid && h("span", { style: { color: dim } }, "→ Bid " + fmt$(sol.quotes[0].target_bid)),
          sol.quotes[0].margin_flag && marginChip(sol.quotes[0].margin_flag, sol.quotes[0].margin_at_hist_pct),
        ),

        // All no-bid action prompt
        sol.action === "ALL_NO_BID" && h("div", {
          style: {
            margin: "8px 12px 4px",
            padding: "7px 12px",
            background: red + ".07)",
            border: "1px solid " + red + ".25)",
            fontFamily: mono,
            fontSize: "11px",
            color: red + "0.8)",
          },
        }, "!! All vendors declined — Re-blast to more distributors or mark No Source in pipeline"),
      ),
    );
  }

  // ── Scan Log Entry ───────────────────────────────────────────────────────
  function ScanLogRow({ entry }) {
    return h("div", {
      style: {
        display: "flex", alignItems: "center", gap: "16px",
        padding: "5px 0", borderBottom: "1px solid rgba(245,240,232,.05)",
        fontFamily: mono, fontSize: "10px",
      },
    },
      h("div", { style: { color: dim, width: "80px", flexShrink: 0 } }, fmtTime(entry.scanned_at)),
      h("div", { style: { color: "var(--body-dim)", flexShrink: 0 } }, entry.scanned + " checked"),
      entry.new_count > 0
        ? h("div", { style: { color: green + "1)" } }, "+" + entry.new_count + " new")
        : h("div", { style: { color: dim } }, "no new"),
      entry.errors > 0 && h("div", { style: { color: red + "0.7)" } }, entry.errors + " err"),
    );
  }

  // ── Main Tab ─────────────────────────────────────────────────────────────
  function InboxTab() {
    const [report,    setReport]    = useState(null);
    const [scanLogs,  setScanLogs]  = useState([]);
    const [loading,   setLoading]   = useState(true);
    const [scanning,  setScanning]  = useState(false);
    const [error,     setError]     = useState(null);
    const [lastScan,  setLastScan]  = useState(null);

    const loadReport = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const [rData, lData] = await Promise.all([
          api("getReport"),
          api("getScanLog"),
        ]);
        setReport(rData.report);
        setScanLogs(lData.logs || []);
        if (lData.logs && lData.logs.length > 0) {
          setLastScan(lData.logs[0].scanned_at);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { loadReport(); }, [loadReport]);

    const handleScan = async () => {
      setScanning(true);
      setError(null);
      try {
        await api("scan");
        await loadReport();
      } catch (e) {
        setError("Scan failed: " + e.message);
      } finally {
        setScanning(false);
      }
    };

    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    return h("div", { style: { animation: "fadeUp .5s ease both", paddingBottom: "60px" } },

      // ── Header ──
      h("div", { className: "pipe-header" },
        h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h("div", { className: "pipe-title" }, "Inbox Monitor"),
          h("div", {
            style: { fontFamily: "Cormorant Garamond,serif", fontSize: "14px", fontStyle: "italic", color: "var(--body-faint)" },
          }, "Vendor RFQ responses — prices, no-bids, margin analysis"),
        ),

        h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },

          // Last scan info
          lastScan && h("div", { style: { fontFamily: mono, fontSize: "10px", color: dim } },
            "Last scan: " + minutesAgo(lastScan)),

          // Refresh
          h("button", {
            onClick: loadReport,
            disabled: loading || scanning,
            style: {
              padding: "6px 12px", background: "transparent",
              border: "1px solid rgba(201,168,76,.3)", color: gold + "0.8)", cursor: "pointer",
              fontFamily: mono, fontSize: "10px", letterSpacing: ".04em",
            },
          }, loading ? "…" : "↻ Refresh"),

          // Scan Now
          h("button", {
            onClick: handleScan,
            disabled: scanning || loading,
            style: {
              padding: "6px 16px",
              background: scanning ? "rgba(201,168,76,.1)" : "rgba(201,168,76,.15)",
              border: "1px solid " + gold + (scanning ? ".2)" : ".45)"),
              color: gold + (scanning ? ".5)" : "1)"),
              cursor: scanning ? "default" : "pointer",
              fontFamily: mono, fontSize: "10px", letterSpacing: ".06em", fontWeight: 700,
            },
          }, scanning ? "Scanning…" : "⚡ Scan Now"),
        ),
      ),

      // ── Error ──
      error && h("div", {
        style: { margin: "12px 0", padding: "10px 16px", background: red + ".08)", border: "1px solid " + red + ".25)", fontFamily: mono, fontSize: "11px", color: red + "0.9)" },
      }, "Error: " + error),

      // ── Loading ──
      loading && h("div", {
        style: { padding: "40px", fontFamily: mono, fontSize: "12px", color: dim, textAlign: "center" },
      }, "Loading inbox data…"),

      // ── Report ──
      !loading && report && h("div", null,

        // ── Daily Summary Bar ──
        h("div", {
          style: {
            display: "flex", alignItems: "center", gap: "20px",
            padding: "10px 16px", marginBottom: "14px",
            background: "rgba(201,168,76,.05)",
            border: "1px solid rgba(201,168,76,.15)",
            fontFamily: mono, fontSize: "11px",
          },
        },
          h("div", { style: { color: gold + "0.7)", letterSpacing: ".06em", textTransform: "uppercase", fontSize: "9px" } }, todayStr),
          h("div", { style: { marginLeft: "auto", display: "flex", gap: "20px", alignItems: "center" } },
            h("span", { style: { color: "var(--alabaster)" } }, report.total_sols + " sol(s)"),
            h("span", { style: { color: green + "1)" } }, report.total_quotes + " quote(s)"),
            h("span", { style: { color: red + "0.8)" } }, report.total_no_bids + " no-bid(s)"),
          ),
        ),

        // ── SOL Cards ──
        report.sols.length === 0
          ? h("div", {
              style: { padding: "40px", fontFamily: mono, fontSize: "12px", color: dim, textAlign: "center" },
            }, "No vendor responses received today.\nHit \"Scan Now\" to check inbox, or wait for the next scheduled run.")
          : h("div", null, ...report.sols.map((sol) => h(SolCard, { key: sol.sol_number, sol }))),

        // ── Scan Log ──
        scanLogs.length > 0 && h("div", {
          style: { marginTop: "24px", padding: "14px 16px", border: "1px solid rgba(245,240,232,.08)", background: "var(--inset-bg)" },
        },
          h("div", {
            style: { fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".1em", color: gold + "0.6)", marginBottom: "10px" },
          }, "SCAN HISTORY — TODAY"),
          ...scanLogs
            .filter((l) => l.scanned_at && new Date(l.scanned_at).toISOString().slice(0, 10) === report.date)
            .map((l, i) => h(ScanLogRow, { key: i, entry: l })),
          scanLogs.filter((l) => l.scanned_at && new Date(l.scanned_at).toISOString().slice(0, 10) !== report.date).length > 0 && h("div", {
            style: { marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(245,240,232,.06)" },
          },
            h("div", {
              style: { fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".1em", color: gold + "0.5)", marginBottom: "8px" },
            }, "PREVIOUS"),
            ...scanLogs
              .filter((l) => l.scanned_at && new Date(l.scanned_at).toISOString().slice(0, 10) !== report.date)
              .slice(0, 5)
              .map((l, i) => h("div", { key: i, style: { display: "flex", gap: "12px", fontFamily: mono, fontSize: "10px", color: dim, padding: "3px 0" } },
                h("span", null, fmtDate(l.scanned_at)),
                h("span", null, fmtTime(l.scanned_at)),
                h("span", null, l.new_count + " new"),
              )),
          ),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.InboxTab = InboxTab;
})();
