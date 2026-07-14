(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SLED DECISION / TRIAGE
  //  The decision surface. The scraper dumps ~20k ESBD opps into Mongo nightly;
  //  this view shows only the BIDDABLE ones (product we can resell + we actually
  //  have distributor coverage + not yet decided) and lets you BID or PASS.
  //    BID  → decision=BID → drops into the Pipeline board (source → margin → submit)
  //    PASS → decision=PASS → hidden
  //  Exposes: window.SCC_TABS.SledDecisionTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;
  const API = "/.netlify/functions/scc-esbd";

  const GOLD = "var(--gold-solid,#c9a84c)";
  const DIM = "var(--body-dim,rgba(245,240,232,.55))";
  const FAINT = "var(--body-faint,rgba(245,240,232,.35))";
  const MONO = "var(--font-mono,'JetBrains Mono',monospace)";
  const GREEN = "rgba(61,214,140,.9)";
  const RED = "rgba(232,116,116,.85)";

  const post = (body) => fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  function SledDecisionTab({ goPipeline, showToast }) {
    const [rows, setRows] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(() => new Set());

    const reload = useCallback(() => {
      setLoading(true);
      Promise.all([
        post({ action: "list", biddable: true, limit: 500 }),
        post({ action: "stats" }),
      ]).then(([l, s]) => {
        setRows((l.opportunities || []).map((o) => ({ ...o, id: o._id })));
        setStats(s.ok ? s : null); setLoading(false);
      }).catch(() => setLoading(false));
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const decide = async (opp, decision) => {
      setBusy((p) => new Set(p).add(opp.id));
      // optimistic remove from the queue
      setRows((prev) => prev.filter((r) => r.id !== opp.id));
      try { await post({ action: "update", id: opp._id, fields: { decision } }); } catch (e) {}
      if (showToast) showToast(decision === "BID" ? "Bid → Pipeline: " + (opp.name || "").slice(0, 40) : "Passed");
      setBusy((p) => { const n = new Set(p); n.delete(opp.id); return n; });
    };

    const btn = (c, disabled) => ({ background: "transparent", border: "1px solid " + c, color: c, borderRadius: "6px", fontFamily: MONO, fontSize: "11px", padding: "7px 16px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 });

    return h("div", { style: { animation: "fadeUp .4s ease both", maxWidth: "980px", margin: "0 auto", padding: "8px 4px 40px" } },
      // header
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "6px", flexWrap: "wrap", gap: "10px" } },
        h("div", null,
          h("div", { style: { fontFamily: MONO, fontSize: "10px", letterSpacing: ".18em", color: "rgba(201,168,76,.6)" } }, "STATE · LOCAL · EDUCATION"),
          h("div", { style: { fontFamily: "var(--font-serif,Georgia,serif)", fontSize: "24px", color: "var(--body,#f5f0e8)" } }, "Decide — Bid or Pass"),
        ),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("button", { onClick: reload, style: btn(FAINT) }, "↻ Refresh"),
          goPipeline ? h("button", { onClick: goPipeline, style: btn(GOLD) }, "Pipeline →") : null,
        ),
      ),
      // stat strip
      stats ? h("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap", fontFamily: MONO, fontSize: "11px", color: DIM, margin: "6px 0 20px" } },
        h("span", null, (stats.verdictCounts.PRODUCT || 0) + " product"),
        h("span", { style: { color: FAINT } }, (stats.verdictCounts.SERVICE || 0) + " service (skipped)"),
        h("span", { style: { color: GREEN } }, stats.biddable + " biddable"),
        h("span", { style: { color: GOLD } }, stats.committed + " committed to bid"),
        h("span", { style: { color: FAINT } }, stats.productNoLane + " product w/ no lane mapped yet"),
      ) : null,
      h("p", { style: { fontFamily: MONO, fontSize: "11px", color: FAINT, margin: "0 0 18px", lineHeight: 1.5 } },
        "Product opportunities where we have distributor coverage, highest coverage first. Bid drops it into the Pipeline; Pass hides it."),

      loading ? h("div", { style: { color: DIM, fontFamily: MONO, fontSize: "13px", padding: "40px", textAlign: "center" } }, "Loading…")
        : rows.length === 0 ? h("div", { style: { color: FAINT, fontFamily: MONO, fontSize: "13px", padding: "50px 20px", textAlign: "center", border: "1px dashed rgba(201,168,76,.2)", borderRadius: "10px" } }, "Queue clear — nothing left to decide. Run the ESBD sync or widen NIGP→FSC coverage.")
        : rows.map((o) => h("div", {
            key: o.id,
            style: { border: "1px solid rgba(201,168,76,.18)", borderRadius: "8px", padding: "12px 14px", marginBottom: "10px", display: "flex", gap: "12px", alignItems: "center", opacity: busy.has(o.id) ? 0.4 : 1 },
          },
            h("div", { style: { minWidth: 0, flex: 1 } },
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                h("span", { style: { fontFamily: MONO, fontSize: "10px", color: GOLD, border: "1px solid rgba(201,168,76,.4)", borderRadius: "3px", padding: "1px 6px" } }, o.lane_label || "—"),
                h("span", { style: { fontFamily: MONO, fontSize: "10px", color: GREEN } }, o.distributor_coverage + " vendors"),
                h("span", { style: { color: "var(--body,#f5f0e8)", fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" } }, o.name),
              ),
              h("div", { style: { fontFamily: MONO, fontSize: "10px", color: DIM, marginTop: "3px" } },
                [o.sol_id, "Agy " + o.agency_num, "FSC " + (o.fsc_lanes || []).slice(0, 4).join("/"), o.due_date ? "Due " + o.due_date : null].filter(Boolean).join("  ·  ")),
            ),
            h("button", { onClick: () => decide(o, "PASS"), disabled: busy.has(o.id), style: btn(RED, busy.has(o.id)) }, "Pass"),
            h("button", { onClick: () => decide(o, "BID"), disabled: busy.has(o.id), style: btn(GREEN, busy.has(o.id)) }, "Bid ▸"),
          )),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SledDecisionTab = SledDecisionTab;
})();
