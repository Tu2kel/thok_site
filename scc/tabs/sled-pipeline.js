(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SLED PIPELINE ROUTER
  //  State / Local / Education bid lane — parallel to the federal DIBBS lane.
  //  Federal blasts distributors for quotes; SLED just needs a livable price:
  //  intake → cost (manual default, optional quick-source) → +margin → submit.
  //
  //  Shares the ESBD store (window.SCC_ESBD, localStorage "imperio_esbd_bids")
  //  and the ESBD detail workspace (EsbdTab) for deep sourcing.
  //  Exposes: window.SCC_TABS.SledPipelineTab
  //           window.SCC_TABS.SledSubmissionsTab
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, Fragment, useState, useEffect, useCallback } = React;
  const DB = window.SCC_ESBD || {};
  const M  = window.SCC_MATH || {};

  const GOLD  = "var(--gold-solid,#c9a84c)";
  const DIM   = "var(--body-dim,rgba(245,240,232,.55))";
  const FAINT = "var(--body-faint,rgba(245,240,232,.35))";
  const MONO  = "var(--font-mono,'JetBrains Mono',monospace)";
  const DEFAULT_MARGIN = 25;

  // Pre-submission stages the router walks a bid through. Terminal stages
  // (Submitted, Pending Award, Awarded, Lost, No Bid) live on the Submissions tab.
  const PIPE_STAGES = ["Draft", "Sourcing", "Ready to Bid"];
  const STAGE_COLOR = {
    Draft: "rgba(201,168,76,.5)",
    Sourcing: "rgba(135,206,235,.8)",
    "Ready to Bid": "rgba(61,214,140,.85)",
    Submitted: "rgba(201,168,76,.95)",
    "Pending Award": "rgba(232,143,203,.8)",
    Awarded: "rgba(61,214,140,1)",
    Lost: "rgba(232,116,116,.75)",
    "No Bid": "rgba(160,160,160,.55)",
  };
  const ALL_STATUSES = ["Draft", "Sourcing", "Ready to Bid", "Submitted", "Pending Award", "Awarded", "Lost", "No Bid"];

  function money(n) {
    const v = parseFloat(n);
    if (isNaN(v)) return "—";
    if (typeof M.fmt === "function") { try { return M.fmt(v); } catch (e) {} }
    return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function pct(n) {
    const v = parseFloat(n);
    return isNaN(v) ? "—" : v.toFixed(1) + "%";
  }

  // ── Bid math: cost (manual est_cost, else cheapest supplier) + margin → bid ──
  function calcRow(bid) {
    const qty = parseFloat(bid.qty) || 0;
    const supPrices = (bid.suppliers || [])
      .map((s) => parseFloat(s.unit_price))
      .filter((v) => !isNaN(v) && v > 0);
    const supplierCost = supPrices.length ? Math.min(...supPrices) : null;
    const manual = parseFloat(bid.est_cost);
    const cost = !isNaN(manual) && manual > 0 ? manual : supplierCost || 0;
    const costSource = !isNaN(manual) && manual > 0 ? "manual" : supplierCost != null ? "supplier" : "none";
    const marginRaw = parseFloat(bid.margin_pct);
    const margin = isNaN(marginRaw) ? DEFAULT_MARGIN : marginRaw;
    const bidUnit = cost > 0 && margin < 100 ? cost / (1 - margin / 100) : 0;
    const bidTotal = bidUnit * qty;
    const gp = bidTotal - cost * qty;
    return { qty, cost, costSource, margin, bidUnit, bidTotal, gp };
  }

  // ── shared small controls ──────────────────────────────────────────────────
  function Badge({ status }) {
    const c = STAGE_COLOR[status] || FAINT;
    return h("span", {
      style: {
        fontFamily: MONO, fontSize: "9px", letterSpacing: ".08em", textTransform: "uppercase",
        padding: "2px 8px", borderRadius: "3px", border: "1px solid " + c, color: c, whiteSpace: "nowrap",
      },
    }, status);
  }

  function NumField({ label, value, prefix, suffix, onCommit, width }) {
    const [v, setV] = useState(value == null ? "" : String(value));
    useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
    return h("label", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
      h("span", { style: { fontFamily: MONO, fontSize: "8px", letterSpacing: ".08em", color: FAINT, textTransform: "uppercase" } }, label),
      h("div", { style: { display: "flex", alignItems: "center", gap: "3px" } },
        prefix ? h("span", { style: { color: FAINT, fontSize: "11px" } }, prefix) : null,
        h("input", {
          value: v,
          inputMode: "decimal",
          onChange: (e) => setV(e.target.value),
          onBlur: () => onCommit(v),
          onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); },
          style: {
            width: (width || 62) + "px", background: "rgba(0,0,0,.35)", border: "1px solid rgba(201,168,76,.25)",
            borderRadius: "4px", color: "var(--body,#f5f0e8)", fontFamily: MONO, fontSize: "12px",
            padding: "4px 6px", outline: "none",
          },
        }),
        suffix ? h("span", { style: { color: FAINT, fontSize: "11px" } }, suffix) : null,
      ),
    );
  }

  // ── one bid card ────────────────────────────────────────────────────────────
  function BidCard({ bid, onPatch, onQuickSource, onSubmitBid, onOpen }) {
    const m = calcRow(bid);
    const [srcOpen, setSrcOpen] = useState(false);
    const [supName, setSupName] = useState("");
    const [supPrice, setSupPrice] = useState("");
    const ready = m.cost > 0 && m.bidTotal > 0;

    const addSupplier = () => {
      const price = parseFloat(supPrice);
      if (isNaN(price) || price <= 0) return;
      onQuickSource(bid, { name: supName.trim() || "Quick quote", unit_price: price });
      setSupName(""); setSupPrice(""); setSrcOpen(false);
    };

    return h("div", {
      style: {
        border: "1px solid rgba(201,168,76,.18)", borderRadius: "8px", padding: "12px 14px",
        background: "linear-gradient(180deg,rgba(255,255,255,.02),rgba(0,0,0,.15))", marginBottom: "10px",
      },
    },
      // header row
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "10px" } },
        h("div", { style: { minWidth: 0 } },
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            bid.state ? h("span", { style: { fontFamily: MONO, fontSize: "10px", color: GOLD, border: "1px solid rgba(201,168,76,.4)", borderRadius: "3px", padding: "1px 6px" } }, bid.state) : null,
            h("span", { style: { color: "var(--body,#f5f0e8)", fontSize: "14px", fontWeight: 600 } }, bid.title || bid.item_desc || "Untitled bid"),
          ),
          h("div", { style: { fontFamily: MONO, fontSize: "11px", color: DIM, marginTop: "3px" } },
            [bid.agency, bid.agency_num, bid.nigp_code ? "NIGP " + bid.nigp_code : null].filter(Boolean).join(" · ") || "—"),
          h("div", { style: { fontFamily: MONO, fontSize: "10px", color: FAINT, marginTop: "2px" } },
            [bid.qty ? "Qty " + bid.qty + (bid.uom ? " " + bid.uom : "") : null, bid.mfr_pn ? "P/N " + bid.mfr_pn : null, bid.due_date ? "Due " + bid.due_date : null].filter(Boolean).join("  ·  ") || "—"),
        ),
        h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" } },
          h(Badge, { status: bid.status }),
          h("select", {
            value: bid.status,
            onChange: (e) => onPatch(bid, { status: e.target.value }),
            style: { background: "rgba(0,0,0,.4)", color: DIM, border: "1px solid rgba(201,168,76,.25)", borderRadius: "4px", fontFamily: MONO, fontSize: "10px", padding: "2px 4px" },
          }, ALL_STATUSES.map((s) => h("option", { key: s, value: s }, s))),
        ),
      ),

      // math row
      h("div", { style: { display: "flex", gap: "14px", alignItems: "flex-end", flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid rgba(201,168,76,.1)", borderBottom: "1px solid rgba(201,168,76,.1)" } },
        h(NumField, { label: "Cost / unit", prefix: "$", value: bid.est_cost, onCommit: (v) => onPatch(bid, { est_cost: v }) }),
        h(NumField, { label: "Margin", suffix: "%", value: bid.margin_pct === "" || bid.margin_pct == null ? DEFAULT_MARGIN : bid.margin_pct, width: 46, onCommit: (v) => onPatch(bid, { margin_pct: v }) }),
        h("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          h("span", { style: { fontFamily: MONO, fontSize: "8px", letterSpacing: ".08em", color: FAINT, textTransform: "uppercase" } }, "Bid / unit"),
          h("span", { style: { fontFamily: MONO, fontSize: "13px", color: GOLD } }, m.bidUnit ? money(m.bidUnit) : "—"),
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          h("span", { style: { fontFamily: MONO, fontSize: "8px", letterSpacing: ".08em", color: FAINT, textTransform: "uppercase" } }, "Bid total"),
          h("span", { style: { fontFamily: MONO, fontSize: "13px", color: "var(--body,#f5f0e8)", fontWeight: 600 } }, m.bidTotal ? money(m.bidTotal) : "—"),
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          h("span", { style: { fontFamily: MONO, fontSize: "8px", letterSpacing: ".08em", color: FAINT, textTransform: "uppercase" } }, "Gross profit"),
          h("span", { style: { fontFamily: MONO, fontSize: "12px", color: m.gp > 0 ? "rgba(61,214,140,.9)" : FAINT } }, m.gp ? money(m.gp) + " (" + pct(m.margin) + ")" : "—"),
        ),
        h("span", { style: { fontFamily: MONO, fontSize: "9px", color: FAINT, marginLeft: "auto" } },
          "cost: " + (m.costSource === "manual" ? "manual" : m.costSource === "supplier" ? "supplier quote" : "not set")),
      ),

      // quick-source (optional)
      srcOpen ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "10px" } },
        h("input", { value: supName, onChange: (e) => setSupName(e.target.value), placeholder: "Supplier",
          style: { flex: "1", background: "rgba(0,0,0,.35)", border: "1px solid rgba(135,206,235,.3)", borderRadius: "4px", color: "var(--body,#f5f0e8)", fontFamily: MONO, fontSize: "12px", padding: "5px 8px", outline: "none" } }),
        h("input", { value: supPrice, onChange: (e) => setSupPrice(e.target.value), placeholder: "$ / unit", inputMode: "decimal",
          onKeyDown: (e) => { if (e.key === "Enter") addSupplier(); },
          style: { width: "90px", background: "rgba(0,0,0,.35)", border: "1px solid rgba(135,206,235,.3)", borderRadius: "4px", color: "var(--body,#f5f0e8)", fontFamily: MONO, fontSize: "12px", padding: "5px 8px", outline: "none" } }),
        h("button", { onClick: addSupplier, style: btn("rgba(135,206,235,.85)") }, "Add quote"),
        h("button", { onClick: () => setSrcOpen(false), style: btnGhost() }, "×"),
      ) : null,

      // actions
      h("div", { style: { display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" } },
        !srcOpen ? h("button", { onClick: () => setSrcOpen(true), style: btnGhost() }, "＋ Quick-source") : null,
        h("button", { onClick: () => onOpen(bid), style: btnGhost() }, "Open in Intake ▸"),
        bid.status !== "Ready to Bid" ? h("button", {
          onClick: () => onPatch(bid, { status: "Ready to Bid", bid_unit_price: m.bidUnit ? m.bidUnit.toFixed(4) : "", bid_total: m.bidTotal ? m.bidTotal.toFixed(2) : "" }),
          disabled: !ready, style: btn(ready ? GOLD : FAINT, !ready),
          title: ready ? "" : "Set a cost first",
        }, "Route → Ready to Bid") : null,
        h("button", {
          onClick: () => onSubmitBid(bid, m),
          disabled: !ready, style: btn(ready ? "rgba(61,214,140,.9)" : FAINT, !ready),
          title: ready ? "" : "Set a cost first",
        }, "Submit bid ▸"),
      ),
    );
  }

  function btn(color, disabled) {
    return {
      background: "transparent", border: "1px solid " + color, color: color, borderRadius: "5px",
      fontFamily: MONO, fontSize: "11px", letterSpacing: ".03em", padding: "6px 12px",
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
    };
  }
  function btnGhost() {
    return { background: "transparent", border: "1px solid rgba(201,168,76,.25)", color: DIM, borderRadius: "5px", fontFamily: MONO, fontSize: "11px", padding: "6px 12px", cursor: "pointer" };
  }

  // ── data hook ────────────────────────────────────────────────────────────────
  function useBids() {
    const [bids, setBids] = useState([]);
    const [loading, setLoading] = useState(true);
    const reload = useCallback(() => {
      setLoading(true);
      Promise.resolve(DB.esbdGetAll ? DB.esbdGetAll() : []).then((all) => {
        setBids(Array.isArray(all) ? all : []); setLoading(false);
      }).catch(() => setLoading(false));
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const patch = useCallback(async (bid, fields) => {
      const merged = { ...bid, ...fields };
      setBids((prev) => prev.map((b) => (b.id === bid.id ? merged : b)));
      if (DB.esbdSave) { try { await DB.esbdSave(merged); } catch (e) {} }
    }, []);

    return { bids, loading, reload, patch };
  }

  // ── PIPELINE ROUTER TAB ───────────────────────────────────────────────────────
  function SledPipelineTab({ goIntake, goSubmissions, showToast }) {
    const { bids, loading, reload, patch } = useBids();

    const active = bids.filter((b) => PIPE_STAGES.includes(b.status || "Draft"));
    const byStage = PIPE_STAGES.map((st) => ({ stage: st, items: active.filter((b) => (b.status || "Draft") === st) }));

    const quickSource = (bid, supplier) => {
      const suppliers = [...(bid.suppliers || []), { id: "s" + Date.now(), ...supplier, date_quoted: new Date().toLocaleDateString() }];
      const nextStatus = bid.status === "Draft" ? "Sourcing" : bid.status;
      patch(bid, { suppliers, status: nextStatus });
      if (showToast) showToast("Quote added — cost basis updated");
    };
    const submitBid = (bid, m) => {
      patch(bid, { status: "Submitted", bid_unit_price: m.bidUnit ? m.bidUnit.toFixed(4) : "", bid_total: m.bidTotal ? m.bidTotal.toFixed(2) : "", submitted_at: new Date().toISOString() });
      if (showToast) showToast("Bid submitted → see Submissions");
    };
    const openIntake = (bid) => {
      try { localStorage.setItem("sled_focus_bid", bid.id); } catch (e) {}
      if (goIntake) goIntake();
    };

    const totalPipeline = active.reduce((sum, b) => sum + (calcRow(b).bidTotal || 0), 0);

    return h("div", { style: { animation: "fadeUp .4s ease both", maxWidth: "980px", margin: "0 auto", padding: "8px 4px 40px" } },
      // header
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "6px", flexWrap: "wrap", gap: "10px" } },
        h("div", null,
          h("div", { style: { fontFamily: MONO, fontSize: "10px", letterSpacing: ".18em", color: "rgba(201,168,76,.6)" } }, "STATE · LOCAL · EDUCATION"),
          h("div", { style: { fontFamily: "var(--font-serif,Georgia,serif)", fontSize: "24px", color: "var(--body,#f5f0e8)", letterSpacing: ".02em" } }, "SLED Pipeline Router"),
        ),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("span", { style: { fontFamily: MONO, fontSize: "11px", color: DIM } }, active.length + " active · " + money(totalPipeline) + " staged"),
          h("button", { onClick: reload, style: btnGhost() }, "↻ Refresh"),
          h("button", { onClick: () => goIntake && goIntake(), style: btn(GOLD) }, "＋ New / Intake"),
        ),
      ),
      h("p", { style: { fontFamily: MONO, fontSize: "11px", color: FAINT, margin: "0 0 22px", lineHeight: 1.5 } },
        "Manual cost by default — type what it lands at, set your margin, submit. Quick-source a supplier only when you need a number."),

      loading ? h("div", { style: { color: DIM, fontFamily: MONO, fontSize: "13px", padding: "40px", textAlign: "center" } }, "Loading…")
        : active.length === 0 ? h("div", { style: { color: FAINT, fontFamily: MONO, fontSize: "13px", padding: "50px 20px", textAlign: "center", border: "1px dashed rgba(201,168,76,.2)", borderRadius: "10px" } },
            "No active SLED bids. Hit ＋ New / Intake to add a state/local solicitation.")
        : byStage.map(({ stage, items }) => h("div", { key: stage, style: { marginBottom: "26px" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" } },
              h(Badge, { status: stage }),
              h("span", { style: { fontFamily: MONO, fontSize: "11px", color: FAINT } }, items.length + " bid" + (items.length === 1 ? "" : "s")),
              h("div", { style: { flex: 1, height: "1px", background: "linear-gradient(90deg,rgba(201,168,76,.2),transparent)" } }),
            ),
            items.length === 0
              ? h("div", { style: { fontFamily: MONO, fontSize: "11px", color: FAINT, paddingLeft: "4px" } }, "—")
              : items.map((b) => h(BidCard, { key: b.id, bid: b, onPatch: patch, onQuickSource: quickSource, onSubmitBid: submitBid, onOpen: openIntake })),
          )),
    );
  }

  // ── SUBMISSIONS TAB ────────────────────────────────────────────────────────────
  function SledSubmissionsTab({ goAward }) {
    const { bids, loading, reload, patch } = useBids();
    const SUBMITTED = ["Submitted", "Pending Award", "Awarded", "Lost", "No Bid"];
    const rows = bids.filter((b) => SUBMITTED.includes(b.status)).sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""));

    return h("div", { style: { animation: "fadeUp .4s ease both", maxWidth: "980px", margin: "0 auto", padding: "8px 4px 40px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "22px", flexWrap: "wrap", gap: "10px" } },
        h("div", null,
          h("div", { style: { fontFamily: MONO, fontSize: "10px", letterSpacing: ".18em", color: "rgba(201,168,76,.6)" } }, "STATE · LOCAL · EDUCATION"),
          h("div", { style: { fontFamily: "var(--font-serif,Georgia,serif)", fontSize: "24px", color: "var(--body,#f5f0e8)" } }, "SLED Submissions"),
        ),
        h("button", { onClick: reload, style: btnGhost() }, "↻ Refresh"),
      ),
      loading ? h("div", { style: { color: DIM, fontFamily: MONO, fontSize: "13px", padding: "40px", textAlign: "center" } }, "Loading…")
        : rows.length === 0 ? h("div", { style: { color: FAINT, fontFamily: MONO, fontSize: "13px", padding: "50px 20px", textAlign: "center", border: "1px dashed rgba(201,168,76,.2)", borderRadius: "10px" } }, "Nothing submitted yet.")
        : rows.map((b) => {
            const m = calcRow(b);
            return h("div", { key: b.id, style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", border: "1px solid rgba(201,168,76,.15)", borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" } },
              h("div", { style: { minWidth: 0 } },
                h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                  b.state ? h("span", { style: { fontFamily: MONO, fontSize: "10px", color: GOLD } }, b.state) : null,
                  h("span", { style: { color: "var(--body,#f5f0e8)", fontSize: "13px", fontWeight: 600 } }, b.title || b.item_desc || "Untitled"),
                ),
                h("div", { style: { fontFamily: MONO, fontSize: "11px", color: DIM, marginTop: "2px" } }, [b.agency, b.agency_num].filter(Boolean).join(" · ") || "—"),
              ),
              h("div", { style: { display: "flex", gap: "16px", alignItems: "center" } },
                h("span", { style: { fontFamily: MONO, fontSize: "12px", color: "var(--body,#f5f0e8)" } }, b.bid_total ? money(b.bid_total) : (m.bidTotal ? money(m.bidTotal) : "—")),
                h("select", { value: b.status, onChange: (e) => { const v = e.target.value; patch(b, { status: v }); if (v === "Awarded" && goAward) goAward(b); },
                  style: { background: "rgba(0,0,0,.4)", color: DIM, border: "1px solid rgba(201,168,76,.25)", borderRadius: "4px", fontFamily: MONO, fontSize: "10px", padding: "3px 5px" } },
                  ALL_STATUSES.map((s) => h("option", { key: s, value: s }, s))),
              ),
            );
          }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SledPipelineTab = SledPipelineTab;
  window.SCC_TABS.SledSubmissionsTab = SledSubmissionsTab;
})();
