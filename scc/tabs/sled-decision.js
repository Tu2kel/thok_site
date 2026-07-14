(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SLED DECISION / TRIAGE  (two-pane)
  //  LEFT: biddable opportunities (product + coverage + open + undecided).
  //  RIGHT: distributors that match the selected opp's FSC lanes — pick a few,
  //         send them an RFQ from here. When a vendor replies with a price, Bid.
  //    Bid  → decision=BID → Pipeline (source → margin → submit)
  //    Pass → decision=PASS → hidden
  //  Exposes: window.SCC_TABS.SledDecisionTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;
  const ESBD = "/.netlify/functions/scc-esbd";
  const DIST = "/.netlify/functions/scc-distributors";
  const SEND = "/.netlify/functions/send-rfq";

  const GOLD = "var(--gold-solid,#c9a84c)";
  const DIM = "var(--body-dim,rgba(245,240,232,.55))";
  const FAINT = "var(--body-faint,rgba(245,240,232,.35))";
  const MONO = "var(--font-mono,'JetBrains Mono',monospace)";
  const GREEN = "rgba(61,214,140,.9)";
  const RED = "rgba(232,116,116,.85)";
  const BLUE = "rgba(135,206,235,.85)";

  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  function buildRfq(opp, vendor) {
    const item = opp.name || "the item below";
    const d = opp._detail || {};
    const subject = "RFQ — " + item.slice(0, 60) + " — Imperio Federal Logistics";
    const body = [
      "Good morning,", "",
      "Imperio Federal Logistics (SDVOSB · VetHUB) is pursuing a Texas state/local solicitation and needs pricing and availability:", "",
      "  Solicitation: " + (opp.sol_id || "") + (opp.agency_num ? "  (Agency " + opp.agency_num + ")" : ""),
      "  Item: " + item,
      opp.due_date ? "  Response due: " + opp.due_date : null,
      d.description ? "" : null,
      d.description ? "Scope: " + d.description.slice(0, 500) : null,
      "",
      "As a reseller we buy at distributor / wholesale pricing, not retail. Please send your best price, lead time, and availability. Full specifications are on the Texas ESBD — txsmartbuy.gov/esbd/" + (opp.sol_id || "") + ".", "",
      "Thank you,",
      "Anthony K Kelley | Founder and CEO",
      "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
      "SDVOSB | VetHUB | (254) 226-5216",
      "anthony@ifedlog.com | ifedlog.com",
    ].filter((l) => l !== null).join("\n");
    return { subject, body };
  }

  const btn = (c, disabled) => ({ background: "transparent", border: "1px solid " + c, color: c, borderRadius: "6px", fontFamily: MONO, fontSize: "14px", padding: "6px 12px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 });

  function SledDecisionTab({ goPipeline, showToast }) {
    const [rows, setRows] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sel, setSel] = useState(null);          // selected opportunity
    const [vendors, setVendors] = useState([]);    // matching distributors
    const [vLoading, setVLoading] = useState(false);
    const [picked, setPicked] = useState(() => new Set());
    const [sending, setSending] = useState(false);

    const reload = useCallback(() => {
      setLoading(true);
      Promise.all([post(ESBD, { action: "list", biddable: true, limit: 500 }), post(ESBD, { action: "stats" })])
        .then(([l, s]) => { setRows((l.opportunities || []).map((o) => ({ ...o, id: o._id }))); setStats(s.ok ? s : null); setLoading(false); })
        .catch(() => setLoading(false));
    }, []);
    useEffect(() => { reload(); }, [reload]);

    // Select an opp → load distributors matching its FSC lanes (emailable first).
    const selectOpp = async (opp) => {
      setSel(opp); setVendors([]); setPicked(new Set()); setVLoading(true);
      // Enrich from the ESBD detail page (real description, bid-response email,
      // attachments, service hint) — runs in parallel with the vendor match.
      post(ESBD, { action: "enrich", sol_id: opp.sol_id, id: opp._id })
        .then((j) => { if (j.ok && j.detail) setSel((s) => (s && s.id === opp.id) ? { ...s, _detail: j.detail } : s); })
        .catch(() => {});
      const lanes = opp.fsc_lanes || [];
      const byId = new Map();
      for (const fsc of lanes) {
        try {
          const j = await post(DIST, { action: "distGetByFSC", payload: { fsc } });
          const arr = Array.isArray(j) ? j : (j.result || j.data || []);
          for (const v of arr) if (v && v.id && !byId.has(v.id)) byId.set(v.id, v);
        } catch (e) {}
      }
      // emailable first, then by tier; cap so we don't render hundreds
      const list = [...byId.values()]
        .sort((a, b) => (!!b.email - !!a.email) || ((a.tier || 9) - (b.tier || 9)))
        .slice(0, 40);
      setVendors(list);
      setPicked(new Set(list.filter((v) => v.email).slice(0, 5).map((v) => v.id)));  // preselect top 5 emailable
      setVLoading(false);
    };

    const decide = async (opp, decision) => {
      setRows((prev) => prev.filter((r) => r.id !== opp.id));
      if (sel && sel.id === opp.id) { setSel(null); setVendors([]); }
      try { await post(ESBD, { action: "update", id: opp._id, fields: { decision } }); } catch (e) {}
      if (showToast) showToast(decision === "BID" ? "Bid → Pipeline" : "Passed");
    };

    const sendRfqs = async () => {
      if (!sel) return;
      const chosen = vendors.filter((v) => picked.has(v.id) && v.email);
      if (!chosen.length) { if (showToast) showToast("Pick at least one vendor with an email"); return; }
      setSending(true);
      let sent = 0, failed = 0;
      for (const v of chosen) {
        const { subject, body } = buildRfq(sel, v);
        try { const r = await post(SEND, { to: v.email, subject, emailBody: body }); (r && (r.id || r.ok)) ? sent++ : failed++; }
        catch (e) { failed++; }
      }
      // record on the opportunity
      const stamp = new Date().toISOString();
      const rfq_sent = [...(sel.rfq_sent || []), ...chosen.map((v) => ({ vendor_id: v.id, name: v.name, email: v.email, at: stamp }))];
      try { await post(ESBD, { action: "update", id: sel._id, fields: { rfq_sent } }); } catch (e) {}
      setSel((s) => s ? { ...s, rfq_sent } : s);
      setRows((prev) => prev.map((r) => r.id === sel.id ? { ...r, rfq_sent } : r));
      setSending(false);
      if (showToast) showToast(sent + " RFQ" + (sent === 1 ? "" : "s") + " sent" + (failed ? " · " + failed + " failed" : "") + " — reply → Bid");
    };

    const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const emailable = vendors.filter((v) => v.email).length;

    // ── LEFT: opportunity list ───────────────────────────────────────────────
    const left = h("div", { style: { flex: "1 1 520px", minWidth: 0 } },
      loading ? h("div", { style: { color: DIM, fontFamily: MONO, fontSize: "16px", padding: "40px", textAlign: "center" } }, "Loading…")
      : rows.length === 0 ? h("div", { style: { color: FAINT, fontFamily: MONO, fontSize: "16px", padding: "50px 20px", textAlign: "center", border: "1px dashed rgba(201,168,76,.2)", borderRadius: "10px" } }, "Queue clear.")
      : rows.map((o) => {
          const isSel = sel && sel.id === o.id;
          const rfqCount = (o.rfq_sent || []).length;
          return h("div", {
            key: o.id, onClick: () => selectOpp(o),
            style: { border: "1px solid " + (isSel ? "rgba(201,168,76,.6)" : "rgba(201,168,76,.16)"), borderRadius: "8px", padding: "11px 13px", marginBottom: "8px", display: "flex", gap: "10px", alignItems: "center", cursor: "pointer", background: isSel ? "rgba(201,168,76,.07)" : "transparent" },
          },
            h("div", { style: { minWidth: 0, flex: 1 } },
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                h("span", { style: { fontFamily: MONO, fontSize: "13px", color: GOLD, border: "1px solid rgba(201,168,76,.4)", borderRadius: "3px", padding: "1px 6px" } }, o.lane_label || "—"),
                h("span", { style: { fontFamily: MONO, fontSize: "13px", color: GREEN } }, o.distributor_coverage + "v"),
                rfqCount ? h("span", { style: { fontFamily: MONO, fontSize: "13px", color: BLUE } }, "✉ " + rfqCount + " RFQ") : null,
                h("span", { style: { color: "var(--body,#f5f0e8)", fontSize: "16px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" } }, o.name),
              ),
              h("div", { style: { fontFamily: MONO, fontSize: "13px", color: DIM, marginTop: "3px" } }, [o.sol_id, "Agy " + o.agency_num, o.due_date ? "Due " + o.due_date : null].filter(Boolean).join(" · ")),
            ),
            h("button", { onClick: (e) => { e.stopPropagation(); decide(o, "PASS"); }, style: btn(RED) }, "Pass"),
            h("button", { onClick: (e) => { e.stopPropagation(); decide(o, "BID"); }, style: btn(GREEN) }, "Bid ▸"),
          );
        }),
    );

    // ── RIGHT: matching vendors + send RFQ ───────────────────────────────────
    const right = h("div", { style: { flex: "1 1 380px", minWidth: 0, borderLeft: "1px solid rgba(201,168,76,.12)", paddingLeft: "18px" } },
      !sel ? h("div", { style: { color: FAINT, fontFamily: MONO, fontSize: "15px", padding: "50px 16px", textAlign: "center", border: "1px dashed rgba(201,168,76,.2)", borderRadius: "10px" } }, "Select an opportunity to see matching distributors and send RFQs.")
      : h("div", null,
          h("div", { style: { marginBottom: "10px" } },
            h("div", { style: { fontFamily: MONO, fontSize: "13px", color: FAINT, letterSpacing: ".1em" } }, "Class/Item " + ((sel.nigp || "").split(/[;\n]/).map((s) => s.trim().split("-")[0]).filter(Boolean).slice(0, 4).join(", ") || (sel.lane_label || ""))),
            h("div", { style: { color: "var(--body,#f5f0e8)", fontSize: "16px", fontWeight: 600, marginTop: "2px" } }, sel.name),
          ),
          // ── enriched detail from the ESBD detail page ──
          sel._detail ? h("div", { style: { border: "1px solid rgba(201,168,76,.14)", borderRadius: "8px", padding: "10px 12px", marginBottom: "14px", background: "rgba(0,0,0,.15)" } },
            sel._detail.service_hint ? h("div", { style: { fontFamily: MONO, fontSize: "14px", color: RED, marginBottom: "6px" } }, "⚠ Reads like a SERVICE — consider Pass") : null,
            sel._detail.description ? h("div", { style: { fontSize: "15px", color: DIM, lineHeight: 1.45, marginBottom: "8px", maxHeight: "120px", overflowY: "auto" } }, sel._detail.description) : null,
            sel._detail.bid_response_email ? h("div", { style: { fontFamily: MONO, fontSize: "14px", color: DIM } }, "Bid to: ", h("span", { style: { color: GOLD } }, sel._detail.bid_response_email)) : null,
            sel._detail.response_due_date ? h("div", { style: { fontFamily: MONO, fontSize: "13px", color: FAINT, marginTop: "2px" } }, "Due " + sel._detail.response_due_date + (sel._detail.response_due_time ? " " + sel._detail.response_due_time : "")) : null,
            (sel._detail.attachments || []).length ? h("div", { style: { marginTop: "6px" } },
              (sel._detail.attachments || []).slice(0, 4).map((a, i) => h("a", { key: i, href: a.url, target: "_blank", rel: "noopener", style: { display: "block", fontFamily: MONO, fontSize: "13px", color: BLUE, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "📎 " + a.name))) : null,
          ) : h("div", { style: { fontFamily: MONO, fontSize: "13px", color: FAINT, marginBottom: "12px" } }, "Loading solicitation detail…"),
          vLoading ? h("div", { style: { color: DIM, fontFamily: MONO, fontSize: "15px", padding: "24px", textAlign: "center" } }, "Matching vendors…")
          : vendors.length === 0 ? h("div", { style: { color: FAINT, fontFamily: MONO, fontSize: "15px", padding: "24px", textAlign: "center" } }, "No distributors on record for these lanes.")
          : h("div", null,
              h("div", { style: { fontFamily: MONO, fontSize: "13px", color: DIM, margin: "0 0 8px" } }, vendors.length + " matched · " + emailable + " emailable" + (vendors.length >= 40 ? " (top 40)" : "")),
              h("div", { style: { maxHeight: "440px", overflowY: "auto", marginBottom: "12px" } },
                vendors.map((v) => h("label", {
                  key: v.id, style: { display: "flex", gap: "8px", alignItems: "center", padding: "6px 4px", borderBottom: "1px solid rgba(201,168,76,.07)", cursor: v.email ? "pointer" : "default", opacity: v.email ? 1 : 0.45 },
                },
                  h("input", { type: "checkbox", disabled: !v.email, checked: picked.has(v.id), onChange: () => toggle(v.id) }),
                  h("div", { style: { minWidth: 0, flex: 1 } },
                    h("div", { style: { fontSize: "15px", color: "var(--body,#f5f0e8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, (v.name || v.id) + (v.tier ? "  ·T" + v.tier : "")),
                    h("div", { style: { fontFamily: MONO, fontSize: "13px", color: v.email ? DIM : FAINT } }, v.email || "no email on file"),
                  ),
                )),
              ),
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
                h("span", { style: { fontFamily: MONO, fontSize: "14px", color: DIM } }, picked.size + " selected"),
                h("div", { style: { flex: 1 } }),
                h("button", { onClick: sendRfqs, disabled: sending || !picked.size, style: btn(sending || !picked.size ? FAINT : BLUE, sending || !picked.size) }, sending ? "Sending…" : "✉ Send RFQ to " + picked.size),
              ),
              (sel.rfq_sent || []).length ? h("div", { style: { fontFamily: MONO, fontSize: "13px", color: BLUE, marginTop: "10px" } }, "Already RFQ'd: " + sel.rfq_sent.map((r) => r.name || r.email).slice(0, 6).join(", ")) : null,
            ),
        ),
    );

    return h("div", { style: { animation: "fadeUp .4s ease both", maxWidth: "1240px", margin: "0 auto", padding: "8px 4px 40px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "6px", flexWrap: "wrap", gap: "10px" } },
        h("div", null,
          h("div", { style: { fontFamily: MONO, fontSize: "13px", letterSpacing: ".18em", color: "rgba(201,168,76,.6)" } }, "STATE · LOCAL · EDUCATION"),
          h("div", { style: { fontFamily: "var(--font-serif,Georgia,serif)", fontSize: "27px", color: "var(--body,#f5f0e8)" } }, "Decide — Bid, Pass, or RFQ"),
        ),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("button", { onClick: reload, style: btn(FAINT) }, "↻ Refresh"),
          goPipeline ? h("button", { onClick: goPipeline, style: btn(GOLD) }, "Pipeline →") : null,
        ),
      ),
      stats ? h("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap", fontFamily: MONO, fontSize: "14px", color: DIM, margin: "6px 0 16px" } },
        h("span", null, (stats.verdictCounts.PRODUCT || 0) + " product"),
        h("span", { style: { color: FAINT } }, (stats.verdictCounts.SERVICE || 0) + " service (skipped)"),
        h("span", { style: { color: GREEN } }, stats.biddable + " biddable"),
        h("span", { style: { color: GOLD } }, stats.committed + " committed"),
      ) : null,
      h("p", { style: { fontFamily: MONO, fontSize: "14px", color: FAINT, margin: "0 0 18px", lineHeight: 1.5 } },
        "Click an opportunity → matching distributors load on the right → RFQ the ones you want. When a vendor replies with a price, Bid it into the Pipeline."),

      h("div", { style: { display: "flex", gap: "18px", flexWrap: "wrap", alignItems: "flex-start" } }, left, right),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SledDecisionTab = SledDecisionTab;
})();
