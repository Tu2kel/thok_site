(function () {
  "use strict";
  const hA = window.React.createElement;
  const { useState, useEffect } = window.React;

  const FN = "/.netlify/functions/scc-usaspending";

  function fmt$(n) {
    if (!n) return "$0";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + Math.round(n).toLocaleString();
  }

  function fmtDate(d) {
    if (!d) return "—";
    return d.slice(0, 10);
  }

  const S = {
    wrap: { padding: "14px 16px", display: "flex", flexDirection: "column", gap: "14px" },
    noFsc: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      color: "var(--body-dim)",
      padding: "20px 0",
    },
    loadBtn: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      padding: "8px 18px",
      border: "1px solid var(--accent-warm)",
      background: "linear-gradient(180deg,#c8a84b 0%,#a07830 100%)",
      color: "#fff",
      borderRadius: "3px",
      cursor: "pointer",
      letterSpacing: "0.05em",
      alignSelf: "flex-start",
    },
    sectionTitle: {
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: "0.12em",
      color: "var(--gold-solid)",
      opacity: 0.7,
      textTransform: "uppercase",
      marginBottom: "6px",
    },
    statsRow: {
      display: "flex",
      gap: "16px",
      flexWrap: "wrap",
    },
    statBox: {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
    },
    statVal: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "16px",
      fontWeight: "bold",
      color: "var(--gold-solid)",
    },
    statLabel: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "9px",
      color: "var(--body-dim)",
      letterSpacing: "0.05em",
    },
    divider: {
      borderTop: "1px solid var(--accent-warm)",
      opacity: 0.3,
    },
    recipientRow: (i) => ({
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "5px 0",
      borderBottom: i < 4 ? "1px solid rgba(201,168,76,0.08)" : "none",
    }),
    rank: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "var(--body-dim)",
      width: "14px",
      flexShrink: 0,
    },
    recipientName: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      color: "var(--body-text)",
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    recipientAmt: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      color: "var(--gold-solid)",
      flexShrink: 0,
    },
    awardTable: {
      width: "100%",
      borderCollapse: "collapse",
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
    },
    th: {
      textAlign: "left",
      padding: "5px 8px",
      color: "var(--body-dim)",
      borderBottom: "1px solid rgba(201,168,76,0.2)",
      letterSpacing: "0.05em",
      fontSize: "9px",
      fontFamily: "Cinzel,serif",
    },
    td: (alt) => ({
      padding: "5px 8px",
      color: "var(--body-text)",
      borderBottom: "1px solid rgba(201,168,76,0.06)",
      background: alt ? "rgba(201,168,76,0.02)" : "transparent",
      verticalAlign: "top",
    }),
    tdAmt: (alt) => ({
      padding: "5px 8px",
      color: "var(--gold-solid)",
      borderBottom: "1px solid rgba(201,168,76,0.06)",
      background: alt ? "rgba(201,168,76,0.02)" : "transparent",
      fontWeight: "bold",
      whiteSpace: "nowrap",
    }),
    competitorSection: {
      background: "rgba(207,90,90,0.06)",
      border: "1px solid rgba(207,90,90,0.25)",
      borderRadius: "4px",
      padding: "10px 12px",
    },
    competitorTitle: {
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: "0.12em",
      color: "#cf8e8e",
      textTransform: "uppercase",
      marginBottom: "8px",
    },
    competitorRow: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "4px 0",
      borderBottom: "1px solid rgba(207,90,90,0.10)",
    },
    competitorName: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "#cf8e8e",
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    competitorAmt: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "var(--body-dim)",
      flexShrink: 0,
    },
    dnsBtn: (done) => ({
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "9px",
      padding: "3px 8px",
      border: done ? "1px solid rgba(100,180,100,0.4)" : "1px solid rgba(207,90,90,0.4)",
      background: done ? "rgba(100,180,100,0.08)" : "rgba(207,90,90,0.10)",
      color: done ? "#80c080" : "#cf8e8e",
      borderRadius: "3px",
      cursor: done ? "default" : "pointer",
      flexShrink: 0,
      letterSpacing: "0.04em",
    }),
    errorMsg: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "#cf8e8e",
      padding: "10px 0",
    },
    spinner: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "var(--body-dim)",
      padding: "20px 0",
    },
    fyNote: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "9px",
      color: "var(--body-faint)",
      marginTop: "4px",
    },
  };

  function MarketIntelPanel({ record }) {
    const fsc = record.fsc || (record.nsn ? record.nsn.replace(/-/g, "").slice(0, 4) : null);

    const [loaded, setLoaded]           = useState(false);
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [awards, setAwards]           = useState([]);
    const [lane, setLane]               = useState(null);
    const [totalAwards, setTotalAwards] = useState(0);
    const [competitors, setCompetitors] = useState([]);

    async function load() {
      if (!fsc) return;
      setLoading(true);
      setError(null);
      try {
        const [awardsRes, laneRes] = await Promise.all([
          fetch(FN, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "awardsByFsc", fsc }),
          }).then(r => r.json()),
          fetch(FN, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "laneSummary", fsc }),
          }).then(r => r.json()),
        ]);

        if (awardsRes.ok) {
          setAwards(awardsRes.result.awards || []);
          setTotalAwards(awardsRes.result.total || 0);
        }
        if (laneRes.ok) {
          setLane(laneRes.result);
          setCompetitors(laneRes.result.competitor_matches || []);
        }
        if (!awardsRes.ok && !laneRes.ok) throw new Error(awardsRes.error || laneRes.error);

        setLoaded(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (!fsc) {
      return hA("div", { style: S.wrap },
        hA("div", { style: S.noFsc }, "No FSC code — add NSN to the solicitation first.")
      );
    }

    const avgAward = lane && lane.award_count > 0
      ? lane.total_obligations / lane.award_count
      : null;

    // Current FY label
    const now = new Date();
    const fyYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
    const fyLabel = `FY${fyYear - 1}–${String(fyYear).slice(2)} · DLA only · contract awards`;

    return hA("div", { style: S.wrap },

      // Load button
      !loaded && !loading && hA("button", {
        style: S.loadBtn,
        onClick: load,
      }, `Load Market Data — FSC ${fsc}`),

      // Loading state
      loading && hA("div", { style: S.spinner }, "Fetching USASpending data…"),

      // Error
      error && hA("div", { style: S.errorMsg }, "Error: " + error),

      // ── Lane Stats ──────────────────────────────────────────────────
      loaded && lane && hA("div", null,
        hA("div", { style: S.sectionTitle }, `DLA LANE STATS — FSC ${fsc}`),
        hA("div", { style: S.statsRow },
          hA("div", { style: S.statBox },
            hA("div", { style: S.statVal }, fmt$(lane.total_obligations)),
            hA("div", { style: S.statLabel }, "Total Obligated"),
          ),
          hA("div", { style: S.statBox },
            hA("div", { style: S.statVal }, (lane.award_count || 0).toLocaleString()),
            hA("div", { style: S.statLabel }, "Awards"),
          ),
          avgAward && hA("div", { style: S.statBox },
            hA("div", { style: S.statVal }, fmt$(avgAward)),
            hA("div", { style: S.statLabel }, "Avg Award"),
          ),
        ),
        hA("div", { style: S.fyNote }, fyLabel),
      ),

      // ── Top Recipients ───────────────────────────────────────────────
      loaded && lane && lane.top_recipients && lane.top_recipients.length > 0 && hA("div", null,
        hA("hr", { style: S.divider }),
        hA("div", { style: S.sectionTitle }, "Top Recipients (your competition)"),
        hA("div", null,
          ...lane.top_recipients.map((r, i) =>
            hA("div", { key: i, style: S.recipientRow(i) },
              hA("span", { style: S.rank }, `${i + 1}.`),
              hA("span", { style: S.recipientName }, r.name),
              hA("span", { style: S.recipientAmt }, fmt$(r.amount)),
            )
          )
        ),
      ),

      // ── Auto-flagged Competitors ─────────────────────────────────────
      loaded && competitors.length > 0 && hA("div", { style: S.competitorSection },
        hA("div", { style: S.competitorTitle },
          `🚫 ${competitors.length} competitor${competitors.length > 1 ? "s" : ""} auto-flagged DNS — FSC ${fsc}`
        ),
        hA("div", null,
          ...competitors.map((c, i) =>
            hA("div", { key: c.db_id, style: { ...S.competitorRow, borderBottom: i < competitors.length - 1 ? "1px solid rgba(207,90,90,0.10)" : "none" } },
              hA("span", { style: S.competitorName, title: c.db_name }, c.db_name),
              hA("span", { style: S.competitorAmt }, fmt$(c.usa_amount)),
              hA("span", { style: { ...S.dnsBtn(true), cursor: "default" } }, "✓ DNS"),
            )
          )
        ),
      ),

      // ── Recent Awards Table ──────────────────────────────────────────
      loaded && awards.length > 0 && hA("div", null,
        hA("hr", { style: S.divider }),
        hA("div", { style: S.sectionTitle },
          `Recent Awards — ${awards.length} shown of ${totalAwards.toLocaleString()} total`
        ),
        hA("table", { style: S.awardTable },
          hA("thead", null,
            hA("tr", null,
              hA("th", { style: S.th }, "Date"),
              hA("th", { style: S.th }, "Recipient"),
              hA("th", { style: S.th }, "Amount"),
              hA("th", { style: S.th }, "Description"),
            )
          ),
          hA("tbody", null,
            ...awards.map((a, i) =>
              hA("tr", { key: i },
                hA("td", { style: S.td(i % 2) }, fmtDate(a.date)),
                hA("td", { style: S.td(i % 2) }, a.recipient),
                hA("td", { style: S.tdAmt(i % 2) }, fmt$(a.amount)),
                hA("td", { style: { ...S.td(i % 2), color: "var(--body-dim)", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                  a.description || "—"
                ),
              )
            )
          ),
        ),
      ),

      // No data state
      loaded && awards.length === 0 && !error && hA("div", { style: S.noFsc },
        `No DLA contract awards found for FSC ${fsc} in last 2 fiscal years.`
      ),

      // Refresh
      loaded && hA("button", {
        style: { ...S.loadBtn, background: "transparent", color: "var(--body-dim)", marginTop: "4px" },
        onClick: load,
      }, "↻ Refresh"),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.MarketIntelPanel = MarketIntelPanel;
})();
