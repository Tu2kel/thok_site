(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — AWARDS INTEL PANEL
  //  USASpending.gov award history + 0-100 Bid Worthiness Score
  //  DIBBS NSN API for AMSC code + approved sources (NSN-specific)
  //  Exposes: AwardsIntelPanel, BidWorthinessGauge, AwardsTable,
  //           calcNSNScore, fetchAwardHistory, fetchDIBBSData, fetchFSCDemand
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef } = React;

  const USA_SPENDING_URL =
    "https://api.usaspending.gov/api/v2/search/spending_by_award/";

  const AWARD_FIELDS = [
    "Award ID",
    "Recipient Name",
    "recipient_id",
    "Award Amount",
    "Start Date",
    "End Date",
    "Award Type",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Description",
    "Period of Performance Current End Date",
  ];

  const OEM_NAMES = [
    "OSHKOSH", "GENERAL ELECTRIC", "FALCOM", "BOEING",
    "LOCKHEED", "RAYTHEON", "NORTHROP", "L3 TECH",
    "BAE SYSTEMS", "HONEYWELL", "TEXTRON", "SIKORSKY",
  ];

  function fscToPsc(nsn) {
    return nsn.replace(/-/g, "").slice(0, 4);
  }

  async function postAwards(body) {
    const res = await fetch(USA_SPENDING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let errBody = "";
      try { errBody = await res.text(); } catch (_) {}
      throw new Error("USASpending " + res.status + " — " + errBody.slice(0, 200));
    }
    const data = await res.json();
    return data.results || [];
  }

  async function fetchAwardHistory(nsn) {
    if (!nsn) return { results: [], mode: "none" };

    const nsnDashed = nsn.includes("-")
      ? nsn
      : nsn.replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4");
    const nsnRaw = nsn.replace(/-/g, "");

    const nsnResults = await postAwards({
      filters: {
        keywords: [nsnDashed, nsnRaw],
        award_type_codes: ["A", "B", "C", "D"],
      },
      fields: AWARD_FIELDS,
      page: 1,
      limit: 15,
      sort: "Start Date",
      order: "desc",
    });

    if (nsnResults.length > 0) return { results: nsnResults, mode: "nsn" };

    const psc = fscToPsc(nsn);
    const pscResults = await postAwards({
      filters: {
        award_type_codes: ["A", "B", "C", "D"],
        psc_codes: { require: [["Product", psc]] },
        time_period: [{ start_date: "2020-01-01", end_date: "2026-12-31" }],
      },
      fields: AWARD_FIELDS,
      page: 1,
      limit: 15,
      sort: "Start Date",
      order: "desc",
    });

    return { results: pscResults, mode: pscResults.length > 0 ? "psc" : "none" };
  }

  // ── FSC DEMAND COUNT — how many awards in this PSC lane (last 2y) ──────
  async function fetchFSCDemand(fsc) {
    if (!fsc) return 0;
    const res = await fetch(USA_SPENDING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: {
          award_type_codes: ["A", "B", "C", "D"],
          psc_codes: { require: [["Product", String(fsc).slice(0, 4)]] },
          time_period: [{ start_date: "2024-01-01", end_date: "2026-12-31" }],
        },
        fields: ["Award ID"],
        page: 1,
        limit: 1,
        sort: "Start Date",
        order: "desc",
      }),
    });
    if (!res.ok) throw new Error("FSC demand " + res.status);
    const data = await res.json();
    return (data.page_metadata && (data.page_metadata.total || data.page_metadata.count)) ||
           (data.results || []).length;
  }

  // ── DIBBS NSN DATA — AMSC + approved sources ────────────────────────────
  async function fetchDIBBSData(nsn) {
    if (!nsn) return null;
    const res = await fetch("/.netlify/functions/dibbs-nsn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nsn }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data : null;
  }

  // AMSC codes that allow open bidding (no approved-source restriction)
  const AMSC_OPEN = new Set(["A", "B", ""]);
  // AMSC codes that are fully blocked (sole source / no commercial source)
  const AMSC_BLOCKED = new Set(["D", "E", "V", "K"]);

  // ── BID WORTHINESS SCORE (0-100) ────────────────────────────────────────
  // opts: { restriction, amsc, approvedSources, mode }
  // mode: "nsn" = exact match | "psc" = FSC fallback | "none" = no history
  function calcNSNScore(awards, restriction, opts) {
    const amsc = ((opts && opts.amsc) || "").toUpperCase().trim();
    const mode = (opts && opts.mode) || "nsn";
    const approvedSources = (opts && opts.approvedSources) || [];

    // AMSC blocked = immediate low score regardless of history
    if (AMSC_BLOCKED.has(amsc)) {
      return {
        score: 8, color: "#e74c3c", label: "Blocked",
        reason: "AMSC " + amsc + " — not procured from commercial sources or sole-source. Do not bid.",
        uniqueWinners: [], avgAward: 0, oemHit: false, hasRestriction: true,
        amsc, approvedSources, fallback: mode !== "nsn",
      };
    }

    if (!awards || !awards.length) {
      const baseScore = amsc && !AMSC_OPEN.has(amsc) ? 15 : 25;
      return {
        score: baseScore, color: "#e74c3c", label: "No Data",
        reason: "No award history in USASpending" + (amsc ? " · AMSC " + amsc : ""),
        uniqueWinners: [], avgAward: 0, oemHit: false,
        hasRestriction: !AMSC_OPEN.has(amsc),
        amsc, approvedSources, fallback: mode !== "nsn",
      };
    }

    const uniqueWinners = [
      ...new Set(
        awards.map(a => (a["Recipient Name"] || "").toUpperCase().trim()).filter(Boolean)
      ),
    ];
    const amounts = awards.map(a => parseFloat(a["Award Amount"] || 0)).filter(v => v > 0);
    const avgAward = amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;
    const oemHit = uniqueWinners.some(n => OEM_NAMES.some(k => n.includes(k)));
    const hasRestriction =
      !AMSC_OPEN.has(amsc) ||
      (restriction || "").toLowerCase().includes("approved source") ||
      (restriction || "").toLowerCase().includes("source only") ||
      (restriction || "").toLowerCase().includes("restricted");

    let score = 40;

    // Demand signal
    score += Math.min(25, awards.length * 4);

    // Market openness
    if (uniqueWinners.length >= 4) score += 20;
    else if (uniqueWinners.length === 3) score += 14;
    else if (uniqueWinners.length === 2) score += 7;

    // Value signal
    if (avgAward > 50000) score += 12;
    else if (avgAward > 10000) score += 8;
    else if (avgAward > 1000) score += 4;

    // AMSC penalty — R/C/F/G = approved source restriction
    if (amsc === "R") score -= 30;
    else if (amsc === "C" || amsc === "F" || amsc === "G") score -= 15;
    else if (AMSC_OPEN.has(amsc) && amsc) score += 5; // confirmed open

    // Concentration penalties
    if (uniqueWinners.length === 1 && oemHit) score -= 40;
    else if (uniqueWinners.length === 1) score -= 18;
    if (hasRestriction && !amsc) score -= 10; // generic restriction signal
    if (oemHit && uniqueWinners.length > 1) score -= 8;

    // FSC fallback uncertainty discount
    if (mode === "psc") score -= 12;

    score = Math.min(100, Math.max(0, Math.round(score)));

    const color =
      score >= 80 ? "#3dd68c" :
      score >= 60 ? "#7eb8f7" :
      score >= 40 ? "#f59e0b" :
      score >= 20 ? "#e87474" : "#e74c3c";

    const label =
      score >= 80 ? "Strong Play" :
      score >= 60 ? "Good Odds" :
      score >= 40 ? "Possible" :
      score >= 20 ? "Risky" : "Avoid";

    const amscNote = amsc === "R" ? " — AMSC R: approved sources only" :
                     amsc === "C" ? " — AMSC C: approved sources required" :
                     mode === "psc" ? " — FSC lane estimate, not NSN-specific" : "";

    const reason =
      (score >= 80 ? "Open market with active demand — bid it" :
       score >= 60 ? "Competitive history, viable dealer channel" :
       score >= 40 ? "Limited competition — verify approved-source restriction" :
       score >= 20 ? "Concentrated or OEM-linked — high risk" :
       "Sole-source or manufacturer-controlled — do not bid without CAGE") + amscNote;

    return {
      score, color, label, reason, uniqueWinners, avgAward, oemHit, hasRestriction,
      amsc, approvedSources, fallback: mode !== "nsn",
    };
  }

  // ── BID WORTHINESS GAUGE (SVG circular ring) ────────────────────────────
  function BidWorthinessGauge({ score, size }) {
    const sz = size || 100;
    const radius = sz * 0.38;
    const circ = 2 * Math.PI * radius;
    const filled = (score / 100) * circ;
    const cx = sz / 2;
    const cy = sz / 2;
    const sw = sz * 0.09;

    const color =
      score >= 80 ? "#3dd68c" :
      score >= 60 ? "#7eb8f7" :
      score >= 40 ? "#f59e0b" :
      score >= 20 ? "#e87474" : "#e74c3c";

    const label =
      score >= 80 ? "Strong Play" :
      score >= 60 ? "Good Odds" :
      score >= 40 ? "Possible" :
      score >= 20 ? "Risky" : "Avoid";

    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" } },
      h(
        "svg",
        { width: sz, height: sz, viewBox: "0 0 " + sz + " " + sz, style: { overflow: "visible" } },
        // track
        h("circle", {
          cx, cy, r: radius,
          fill: "none",
          stroke: "rgba(255,255,255,.07)",
          strokeWidth: sw,
        }),
        // fill
        h("circle", {
          cx, cy, r: radius,
          fill: "none",
          stroke: color,
          strokeWidth: sw,
          strokeDasharray: circ,
          strokeDashoffset: circ - filled,
          strokeLinecap: "round",
          transform: "rotate(-90 " + cx + " " + cy + ")",
          style: { transition: "stroke-dashoffset .9s ease, stroke .4s ease" },
        }),
        // score number
        h("text", {
          x: cx, y: cy - sz * 0.04,
          textAnchor: "middle",
          dominantBaseline: "central",
          fill: color,
          fontFamily: "JetBrains Mono,monospace",
          fontSize: sz * 0.22,
          fontWeight: "700",
        }, String(score)),
        // /100 sub
        h("text", {
          x: cx, y: cy + sz * 0.23,
          textAnchor: "middle",
          dominantBaseline: "central",
          fill: "rgba(245,240,232,.28)",
          fontFamily: "Cinzel,serif",
          fontSize: sz * 0.09,
          letterSpacing: "0.08em",
        }, "/100"),
      ),
      h("div", {
        style: {
          fontFamily: "Cinzel,serif",
          fontSize: "8px",
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color,
          textAlign: "center",
        },
      }, label),
    );
  }

  // ── AWARDS TABLE (clean tabular layout) ─────────────────────────────────
  function AwardsTable({ awards }) {
    const fmt = n => "$" + Math.round(Number(n) || 0).toLocaleString();

    if (!awards || !awards.length) {
      return h("div", {
        style: {
          padding: "20px 16px",
          fontFamily: "Cormorant Garamond,serif",
          fontSize: "14px",
          fontStyle: "italic",
          color: "rgba(245,240,232,.38)",
          textAlign: "center",
        },
      }, "No award history found in USASpending for this NSN.");
    }

    const thS = {
      fontFamily: "Cinzel,serif",
      fontSize: "8px",
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "rgba(245,240,232,.35)",
      padding: "7px 10px",
      borderBottom: "1px solid rgba(255,255,255,.06)",
      textAlign: "left",
      background: "rgba(255,255,255,.018)",
      whiteSpace: "nowrap",
    };
    const tdS = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "11px",
      padding: "8px 10px",
      borderBottom: "1px solid rgba(255,255,255,.04)",
      verticalAlign: "top",
    };

    return h("div", {
      style: { borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(201,168,76,.15)" },
    },
      h("table", { style: { width: "100%", borderCollapse: "collapse" } },
        h("thead", null,
          h("tr", null,
            h("th", { style: thS }, "Date"),
            h("th", { style: thS }, "Award ID"),
            h("th", { style: thS }, "Winner"),
            h("th", { style: { ...thS, textAlign: "right" } }, "Amount"),
            h("th", { style: thS }, "Type"),
          ),
        ),
        h("tbody", null,
          ...awards.slice(0, 14).map((a, i) => {
            const amt = parseFloat(a["Award Amount"] || 0);
            const date = (a["Start Date"] || "").slice(0, 7);
            const rawName = a["Recipient Name"] || "—";
            const winner = rawName.length > 32 ? rawName.slice(0, 32) + "…" : rawName;
            const awardId = (a["Award ID"] || "—").slice(0, 18);
            const type = a["Award Type"] || "—";
            const rowBg = i % 2 === 0 ? "rgba(255,255,255,.013)" : "transparent";
            return h("tr", { key: i, style: { background: rowBg } },
              h("td", { style: { ...tdS, color: "rgba(245,240,232,.42)", fontSize: "10px" } }, date || "—"),
              h("td", { style: { ...tdS, color: "rgba(201,168,76,.65)", fontSize: "10px" } }, awardId),
              h("td", { style: { ...tdS, color: "rgba(245,240,232,.82)" } }, winner),
              h("td", { style: { ...tdS, color: "#f59e0b", textAlign: "right", fontWeight: "600" } },
                amt > 0 ? fmt(amt) : "—"),
              h("td", { style: { ...tdS, color: "rgba(245,240,232,.32)", fontSize: "9px", letterSpacing: ".04em" } }, type),
            );
          }),
        ),
      ),
    );
  }

  // ── AWARDS INTEL PANEL (pipeline drawer tab) ────────────────────────────
  function AwardsIntelPanel({ record }) {
    const [status, setStatus] = useState("idle");
    const [awards, setAwards] = useState([]);
    const [nsnScore, setNsnScore] = useState(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [queryMode, setQueryMode] = useState(null);
    const fetchedNsn = useRef(null);

    const nsn = record.nsn || "";
    const fsc = record.fsc || nsn.replace(/-/g, "").slice(0, 4);
    const histPrice = parseFloat(record.unit_price) || null;
    const restriction = record.supplier_restrictions || "";
    const [dibbsData, setDibbsData] = useState(null);

    const runFetch = async () => {
      if (!nsn) return;
      setStatus("loading");
      setAwards([]);
      setNsnScore(null);
      setQueryMode(null);
      setErrorMsg("");
      setDibbsData(null);
      try {
        // Parallel: USASpending + DIBBS
        const [{ results, mode }, dibbs] = await Promise.all([
          fetchAwardHistory(nsn),
          fetchDIBBSData(nsn),
        ]);
        setAwards(results);
        setQueryMode(mode);
        setDibbsData(dibbs);
        setNsnScore(calcNSNScore(results, restriction, {
          amsc: dibbs ? dibbs.amsc : "",
          approvedSources: dibbs ? dibbs.approvedSources : [],
          mode,
        }));
        setStatus("done");
      } catch (e) {
        setErrorMsg(e.message);
        setStatus("error");
      }
    };

    useEffect(() => {
      if (!nsn || fetchedNsn.current === nsn) return;
      fetchedNsn.current = nsn;
      runFetch();
    }, [nsn]);

    // ── idle / loading ──
    if (status === "idle" || status === "loading") {
      return h("div", { style: { padding: "40px 0", textAlign: "center" } },
        status === "loading"
          ? h("div", null,
              h("div", {
                style: {
                  width: "36px", height: "36px",
                  border: "2px solid rgba(201,168,76,.12)",
                  borderTop: "2px solid #C9A84C",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 14px",
                },
              }),
              h("div", {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontSize: "15px",
                  color: "rgba(245,240,232,.42)",
                  fontStyle: "italic",
                },
              }, "Querying USASpending.gov…"),
            )
          : h("div", null,
              h("div", {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "13px",
                  color: "rgba(201,168,76,.55)",
                  marginBottom: "10px",
                  letterSpacing: ".1em",
                },
              }, nsn ? "NSN " + nsn : "No NSN on this solicitation"),
              nsn && h("button", {
                onClick: runFetch,
                style: {
                  background: "rgba(201,168,76,.08)",
                  border: "1px solid rgba(201,168,76,.3)",
                  color: "#C9A84C",
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  padding: "11px 28px",
                  cursor: "pointer",
                  borderRadius: "3px",
                },
              }, "⬡ Pull Award History"),
            ),
      );
    }

    // ── error ──
    if (status === "error") {
      return h("div", { style: { padding: "20px 0" } },
        h("div", {
          style: {
            color: "#e74c3c",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "12px",
            marginBottom: "14px",
          },
        }, "USASpending fetch failed: " + errorMsg),
        h("button", {
          onClick: runFetch,
          style: {
            background: "transparent",
            border: "1px solid rgba(245,240,232,.15)",
            color: "rgba(245,240,232,.5)",
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".16em",
            textTransform: "uppercase",
            padding: "8px 16px",
            cursor: "pointer",
          },
        }, "Retry"),
      );
    }

    // ── done ──
    const scoreColor = nsnScore ? nsnScore.color : "rgba(201,168,76,.4)";
    const uniqueWinners = nsnScore ? nsnScore.uniqueWinners : [];
    const avgAward = nsnScore ? nsnScore.avgAward : 0;
    const fmt = n => "$" + Math.round(Number(n) || 0).toLocaleString();

    return h("div", { style: { animation: "fadeUp .4s ease both" } },

      // ── Bid Worthiness header card ──
      h("div", {
        style: {
          display: "flex",
          gap: "22px",
          alignItems: "flex-start",
          padding: "20px",
          marginBottom: "18px",
          background: "#201f2d",
          border: "1px solid rgba(201,168,76,.18)",
          borderTop: "2px solid " + scoreColor,
          borderRadius: "6px",
          boxShadow: "0 8px 32px rgba(0,0,0,.55)",
        },
      },
        nsnScore && h(BidWorthinessGauge, { score: nsnScore.score, size: 88 }),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(201,168,76,.45)",
              marginBottom: "7px",
            },
          }, "Bid Worthiness — " + nsn),
          nsnScore && h("div", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "15px",
              color: nsnScore.color,
              letterSpacing: ".04em",
              marginBottom: "5px",
            },
          }, nsnScore.label),
          nsnScore && h("div", {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontSize: "13.5px",
              color: "rgba(245,240,232,.52)",
              fontStyle: "italic",
              lineHeight: 1.55,
              marginBottom: "14px",
            },
          }, nsnScore.reason),

          // stat row
          h("div", { style: { display: "flex", gap: "22px", flexWrap: "wrap" } },
            avgAward > 0 && h("div", null,
              h("div", {
                style: {
                  fontFamily: "Cinzel,serif", fontSize: "8px",
                  letterSpacing: ".14em", textTransform: "uppercase",
                  color: "rgba(245,240,232,.32)", marginBottom: "3px",
                },
              }, "Avg Award"),
              h("div", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "16px", color: "#f59e0b", fontWeight: "600",
                },
              }, fmt(avgAward)),
            ),
            histPrice && h("div", null,
              h("div", {
                style: {
                  fontFamily: "Cinzel,serif", fontSize: "8px",
                  letterSpacing: ".14em", textTransform: "uppercase",
                  color: "rgba(245,240,232,.32)", marginBottom: "3px",
                },
              }, "Gov Price"),
              h("div", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "16px", color: "#C9A84C", fontWeight: "600",
                },
              }, "$" + histPrice.toFixed(2)),
            ),
            histPrice && avgAward > 0 && h("div", null,
              h("div", {
                style: {
                  fontFamily: "Cinzel,serif", fontSize: "8px",
                  letterSpacing: ".14em", textTransform: "uppercase",
                  color: "rgba(245,240,232,.32)", marginBottom: "3px",
                },
              }, "vs Avg"),
              h("div", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "16px", fontWeight: "600",
                  color: histPrice > avgAward ? "#e87474" : "#3dd68c",
                },
              }, (((histPrice - avgAward) / avgAward) * 100 > 0 ? "+" : "") +
                 (((histPrice - avgAward) / avgAward) * 100).toFixed(1) + "%"),
            ),
            uniqueWinners.length > 0 && h("div", null,
              h("div", {
                style: {
                  fontFamily: "Cinzel,serif", fontSize: "8px",
                  letterSpacing: ".14em", textTransform: "uppercase",
                  color: "rgba(245,240,232,.32)", marginBottom: "3px",
                },
              }, "Winners"),
              h("div", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "16px", fontWeight: "600",
                  color: uniqueWinners.length >= 3 ? "#3dd68c" :
                         uniqueWinners.length >= 2 ? "#7eb8f7" : "#e87474",
                },
              }, String(uniqueWinners.length)),
            ),
            h("div", null,
              h("div", {
                style: {
                  fontFamily: "Cinzel,serif", fontSize: "8px",
                  letterSpacing: ".14em", textTransform: "uppercase",
                  color: "rgba(245,240,232,.32)", marginBottom: "3px",
                },
              }, "Awards"),
              h("div", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "16px", color: "rgba(245,240,232,.65)", fontWeight: "600",
                },
              }, String(awards.length)),
            ),
          ),
        ),
      ),

      // ── Query mode indicator ──
      queryMode && h("div", {
        style: {
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "9px",
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: queryMode === "nsn" ? "#3dd68c" : queryMode === "psc" ? "#f59e0b" : "rgba(245,240,232,.3)",
          marginBottom: "16px",
          opacity: 0.8,
        },
      },
        queryMode === "nsn"
          ? "● Exact NSN match — " + nsn
          : queryMode === "psc"
            ? "◎ PSC fallback — FSC " + fsc + " lane (no NSN-specific history)"
            : "○ No award history found",
      ),

      // ── DIBBS: AMSC + Approved Sources ──
      dibbsData && h("div", {
        style: {
          marginBottom: "18px",
          padding: "14px 16px",
          background: dibbsData.amsc && !AMSC_OPEN.has(dibbsData.amsc)
            ? "rgba(231,76,60,.05)" : "rgba(61,214,140,.04)",
          border: "1px solid " + (dibbsData.amsc && !AMSC_OPEN.has(dibbsData.amsc)
            ? "rgba(231,76,60,.22)" : "rgba(61,214,140,.18)"),
          borderLeft: "3px solid " + (dibbsData.amsc && !AMSC_OPEN.has(dibbsData.amsc)
            ? "rgba(231,76,60,.55)" : "rgba(61,214,140,.5)"),
          borderRadius: "5px",
        },
      },
        h("div", { style: { display: "flex", gap: "16px", alignItems: "baseline", marginBottom: "10px", flexWrap: "wrap" } },
          h("div", {
            style: {
              fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".18em",
              textTransform: "uppercase", color: "rgba(201,168,76,.52)",
            },
          }, "DIBBS Approved Source Data"),
          dibbsData.amsc && h("div", {
            style: {
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "2px 10px",
              background: AMSC_OPEN.has(dibbsData.amsc) ? "rgba(61,214,140,.1)" : "rgba(231,76,60,.12)",
              border: "1px solid " + (AMSC_OPEN.has(dibbsData.amsc) ? "rgba(61,214,140,.35)" : "rgba(231,76,60,.45)"),
              borderRadius: "3px",
            },
          },
            h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".12em", color: "rgba(245,240,232,.45)" } }, "AMSC"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "13px", fontWeight: "700",
              color: AMSC_OPEN.has(dibbsData.amsc) ? "#3dd68c" : "#e87474" } }, dibbsData.amsc),
            h("span", { style: { fontFamily: "Cormorant Garamond,serif", fontSize: "12px", fontStyle: "italic",
              color: AMSC_OPEN.has(dibbsData.amsc) ? "rgba(61,214,140,.7)" : "rgba(232,116,116,.75)" } },
              dibbsData.amscDesc || ""),
          ),
          dibbsData.nomenclature && h("div", {
            style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: "rgba(245,240,232,.55)", letterSpacing: ".04em" },
          }, dibbsData.nomenclature),
        ),
        dibbsData.approvedSources && dibbsData.approvedSources.length > 0 && h("div", null,
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".14em", textTransform: "uppercase",
            color: "rgba(245,240,232,.32)", marginBottom: "8px" } }, "Approved CAGEs"),
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
            ...dibbsData.approvedSources.map((src, i) =>
              h("div", { key: i, style: { background: "rgba(201,168,76,.06)", border: "1px solid rgba(201,168,76,.18)",
                borderRadius: "3px", padding: "4px 10px" } },
                h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", fontWeight: "700",
                  color: "#C9A84C", marginBottom: "2px" } }, src.cage || "—"),
                src.partNumber && h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px",
                  color: "rgba(245,240,232,.45)" } }, src.partNumber),
                src.companyName && h("div", { style: { fontFamily: "Cormorant Garamond,serif", fontSize: "11px", fontStyle: "italic",
                  color: "rgba(245,240,232,.5)" } }, src.companyName),
              ),
            ),
          ),
        ),
      ),

      // ── Competitors — Prior Award Winners ──
      uniqueWinners.length > 0 && h("div", {
        style: {
          marginBottom: "18px",
          padding: "14px 16px",
          background: "rgba(231,76,60,.04)",
          border: "1px solid rgba(231,76,60,.2)",
          borderLeft: "3px solid rgba(231,76,60,.5)",
          borderRadius: "5px",
        },
      },
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" } },
          h("div", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(231,76,60,.8)",
            },
          }, "⚠ Competitors — Who Has Won Before"),
          h("div", {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "12px",
              color: "rgba(245,240,232,.35)",
            },
          }, "These companies bid and won — they compete in your lane. Do NOT add to vendor DB."),
        ),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
          ...uniqueWinners.map((name, i) => {
            const SA = window.SCC_SOURCE_ACTIONS || {};
            return h("div", {
              key: i,
              style: {
                display: "inline-flex",
                alignItems: "center",
                background: "rgba(231,76,60,.07)",
                border: "1px solid rgba(231,76,60,.22)",
                borderRadius: "3px",
              },
            },
              h("span", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  padding: "4px 8px",
                  color: "rgba(232,116,116,.9)",
                },
              }, name),
              h("button", {
                title: "SAM.gov entity lookup",
                onClick: () => SA.searchAwardee && SA.searchAwardee(name),
                style: {
                  background: "transparent",
                  border: "none",
                  borderLeft: "1px solid rgba(231,76,60,.15)",
                  color: "rgba(231,76,60,.5)",
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".1em",
                  padding: "4px 7px",
                  cursor: "pointer",
                },
              }, "SAM"),
              h("button", {
                title: "USASpending award history",
                onClick: () => SA.searchUSASpending && SA.searchUSASpending(name),
                style: {
                  background: "transparent",
                  border: "none",
                  borderLeft: "1px solid rgba(231,76,60,.15)",
                  color: "rgba(245,240,232,.3)",
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".1em",
                  padding: "4px 7px",
                  cursor: "pointer",
                },
              }, "$"),
            );
          }),
        ),
      ),

      // ── Procurement History Table ──
      h("div", { style: { marginBottom: "18px" } },
        h("div", {
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "rgba(201,168,76,.52)",
            marginBottom: "10px",
          },
        }, "Procurement History"),
        h(AwardsTable, { awards }),
      ),

      // ── Refresh ──
      h("button", {
        onClick: () => { fetchedNsn.current = null; runFetch(); },
        style: {
          background: "transparent",
          border: "1px solid rgba(201,168,76,.15)",
          color: "rgba(245,240,232,.35)",
          fontFamily: "Cinzel,serif",
          fontSize: "9px",
          letterSpacing: ".14em",
          textTransform: "uppercase",
          padding: "6px 14px",
          cursor: "pointer",
          borderRadius: "3px",
        },
      }, "↻ Refresh"),
    );
  }

  // ── Expose ──
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.AwardsIntelPanel = AwardsIntelPanel;
  window.SCC_TABS.BidWorthinessGauge = BidWorthinessGauge;
  window.SCC_TABS.AwardsTable = AwardsTable;
  window.SCC_TABS.calcNSNScore = calcNSNScore;
  window.SCC_TABS.fetchAwardHistory = fetchAwardHistory;
  window.SCC_TABS.fetchFSCDemand = fetchFSCDemand;
  window.SCC_TABS.fetchDIBBSData = fetchDIBBSData;
  window.SCC_TABS.AMSC_OPEN = AMSC_OPEN;
})();
