(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — ESBD IMPORT & TRIAGE  (SLED intake)
  //  Paste the txsmartbuy.gov ESBD "Export to CSV" → the NIGP routing brain
  //  (window.SCC_NIGP) splits product buys we can resell from the sea of
  //  service/construction sols, crosswalks each to FSC lanes, and pushes the
  //  ones you pick into the SLED pipeline (window.SCC_ESBD store).
  //  Exposes: window.SCC_TABS.SledImportTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState } = React;
  const NIGP = window.SCC_NIGP || {};
  const DB = window.SCC_ESBD || {};

  const GOLD = "var(--gold-solid,#c9a84c)";
  const DIM = "var(--body-dim,rgba(245,240,232,.55))";
  const FAINT = "var(--body-faint,rgba(245,240,232,.35))";
  const MONO = "var(--font-mono,'JetBrains Mono',monospace)";

  const VERDICT_COLOR = {
    PRODUCT: "rgba(61,214,140,.9)",
    MIXED: "rgba(201,168,76,.9)",
    SERVICE: "rgba(160,160,160,.5)",
    UNKNOWN: "rgba(232,116,116,.7)",
  };

  function parseCsv(text) {
    // ESBD export has quoted fields with embedded newlines/commas (NIGP list) —
    // use SheetJS (already loaded) for a correct parse.
    if (!window.XLSX) throw new Error("XLSX library not loaded");
    const wb = window.XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { defval: "" });
  }

  function col(row, names) {
    for (const n of names) {
      const k = Object.keys(row).find((key) => key.trim().toLowerCase() === n.toLowerCase());
      if (k != null) return row[k];
    }
    return "";
  }

  function SledImportTab({ goPipeline, showToast }) {
    const [csv, setCsv] = useState("");
    const [rows, setRows] = useState(null);   // classified rows
    const [err, setErr] = useState("");
    const [filter, setFilter] = useState("ROUTABLE");
    const [sel, setSel] = useState(() => new Set());

    const runTriage = () => {
      setErr("");
      if (!csv.trim()) { setErr("Paste the ESBD 'Export to CSV' contents first."); return; }
      let parsed;
      try { parsed = parseCsv(csv); } catch (e) { setErr("Parse failed: " + e.message); return; }
      if (!parsed.length) { setErr("No rows found. Paste the full CSV including its header row."); return; }
      const classified = parsed.map((r, i) => {
        const nigp = col(r, ["NIGP Codes", "NIGP"]);
        const c = NIGP.classify ? NIGP.classify(nigp) : { verdict: "UNKNOWN", fscLanes: [], label: "" };
        return {
          i,
          name: col(r, ["Name"]) || "(untitled)",
          sol_id: col(r, ["Solicitation ID"]),
          due_date: col(r, ["Due Date"]),
          due_time: col(r, ["Due Time"]),
          agency_num: col(r, ["Agency/Texas SmartBuy Member Number", "Agency"]),
          status: col(r, ["Status"]),
          posted: col(r, ["Posting Date"]),
          nigp,
          verdict: c.verdict,
          lane: c.label,
          fscLanes: c.fscLanes || [],
          unmapped: c.unmappedClasses || [],
        };
      });
      setRows(classified);
      // preselect routable (PRODUCT) rows
      setSel(new Set(classified.filter((r) => r.verdict === "PRODUCT").map((r) => r.i)));
    };

    const counts = rows
      ? rows.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {})
      : {};

    const shown = !rows ? [] : rows.filter((r) =>
      filter === "ALL" ? true
      : filter === "ROUTABLE" ? (r.verdict === "PRODUCT" || r.verdict === "MIXED")
      : r.verdict === filter);

    const toggle = (i) => setSel((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

    const pushSelected = async () => {
      if (!rows) return;
      const chosen = rows.filter((r) => sel.has(r.i));
      if (!chosen.length) { if (showToast) showToast("Nothing selected"); return; }
      let saved = 0;
      for (const r of chosen) {
        const bid = {
          id: "esbd_" + r.sol_id + "_" + r.i,
          sol_id: r.sol_id, state: "TX", source: "ESBD", status: "Draft",
          title: r.name, agency_num: r.agency_num, nigp_code: (r.nigp || "").split(/[;\n]/)[0].trim(),
          due_date: r.due_date, due_time: r.due_time, posted_date: r.posted,
          fsc_lanes: r.fscLanes, lane_label: r.lane, esbd_status: r.status,
          suppliers: [], est_cost: "", margin_pct: "", bid_total: "",
          date_added: new Date().toLocaleDateString(),
        };
        if (DB.esbdSave) { try { await DB.esbdSave(bid); saved++; } catch (e) {} }
      }
      if (showToast) showToast(saved + " sol" + (saved === 1 ? "" : "s") + " → SLED pipeline");
      if (goPipeline) goPipeline();
    };

    const btn = (c, disabled) => ({ background: "transparent", border: "1px solid " + c, color: c, borderRadius: "6px", fontFamily: MONO, fontSize: "11px", padding: "7px 14px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 });
    const chip = (active, c) => ({ background: active ? c : "transparent", border: "1px solid " + c, color: active ? "#1a0f0a" : c, borderRadius: "20px", fontFamily: MONO, fontSize: "10px", padding: "4px 12px", cursor: "pointer" });

    return h("div", { style: { animation: "fadeUp .4s ease both", maxWidth: "1020px", margin: "0 auto", padding: "8px 4px 40px" } },
      h("div", { style: { marginBottom: "4px" } },
        h("div", { style: { fontFamily: MONO, fontSize: "10px", letterSpacing: ".18em", color: "rgba(201,168,76,.6)" } }, "TEXAS ESBD · txsmartbuy.gov"),
        h("div", { style: { fontFamily: "var(--font-serif,Georgia,serif)", fontSize: "24px", color: "var(--body,#f5f0e8)" } }, "ESBD Import & Triage"),
      ),
      h("p", { style: { fontFamily: MONO, fontSize: "11px", color: FAINT, margin: "6px 0 16px", lineHeight: 1.5 } },
        "Paste the ESBD 'Export to CSV'. The router keeps product buys we can resell, drops services / road / construction, and crosswalks NIGP → FSC lanes."),

      !rows ? h("div", null,
        h("textarea", {
          value: csv, onChange: (e) => setCsv(e.target.value),
          placeholder: "Paste ESBD CSV export here (include the header row)...",
          style: { width: "100%", minHeight: "220px", background: "rgba(0,0,0,.35)", border: "1px solid rgba(201,168,76,.25)", borderRadius: "8px", color: "var(--body,#f5f0e8)", fontFamily: MONO, fontSize: "12px", padding: "12px", outline: "none", resize: "vertical" },
        }),
        err ? h("div", { style: { color: "rgba(232,116,116,.9)", fontFamily: MONO, fontSize: "12px", margin: "8px 0" } }, err) : null,
        h("div", { style: { marginTop: "12px" } }, h("button", { onClick: runTriage, style: btn(GOLD) }, "Triage →")),
      ) : h("div", null,
        // summary
        h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" } },
          h("span", { style: { fontFamily: MONO, fontSize: "12px", color: DIM } }, rows.length + " sols · "),
          ["PRODUCT", "MIXED", "SERVICE", "UNKNOWN"].map((v) => counts[v]
            ? h("span", { key: v, style: { fontFamily: MONO, fontSize: "11px", color: VERDICT_COLOR[v] } }, counts[v] + " " + v)
            : null),
          h("div", { style: { flex: 1 } }),
          h("button", { onClick: () => { setRows(null); setSel(new Set()); }, style: btn(FAINT) }, "↺ New paste"),
        ),
        // filter chips
        h("div", { style: { display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" } },
          [["ROUTABLE", GOLD], ["PRODUCT", VERDICT_COLOR.PRODUCT], ["MIXED", VERDICT_COLOR.MIXED], ["SERVICE", VERDICT_COLOR.SERVICE], ["ALL", DIM]]
            .map(([f, c]) => h("button", { key: f, onClick: () => setFilter(f), style: chip(filter === f, c) }, f)),
        ),
        // table
        h("div", { style: { border: "1px solid rgba(201,168,76,.15)", borderRadius: "8px", overflow: "hidden" } },
          shown.slice(0, 400).map((r) => h("div", {
            key: r.i,
            onClick: () => (r.verdict === "PRODUCT" || r.verdict === "MIXED") && toggle(r.i),
            style: { display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px", borderBottom: "1px solid rgba(201,168,76,.08)", cursor: (r.verdict === "PRODUCT" || r.verdict === "MIXED") ? "pointer" : "default", background: sel.has(r.i) ? "rgba(61,214,140,.06)" : "transparent" },
          },
            (r.verdict === "PRODUCT" || r.verdict === "MIXED")
              ? h("input", { type: "checkbox", checked: sel.has(r.i), onChange: () => toggle(r.i), onClick: (e) => e.stopPropagation() })
              : h("span", { style: { width: "13px", display: "inline-block" } }),
            h("span", { style: { fontFamily: MONO, fontSize: "9px", color: VERDICT_COLOR[r.verdict], width: "58px", flexShrink: 0 } }, r.verdict),
            h("div", { style: { minWidth: 0, flex: 1 } },
              h("div", { style: { fontSize: "12px", color: "var(--body,#f5f0e8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.name),
              h("div", { style: { fontFamily: MONO, fontSize: "10px", color: FAINT } }, [r.sol_id, "Agy " + r.agency_num, r.due_date].filter(Boolean).join(" · ")),
            ),
            h("div", { style: { textAlign: "right", flexShrink: 0 } },
              h("div", { style: { fontFamily: MONO, fontSize: "11px", color: GOLD } }, r.lane || "—"),
              h("div", { style: { fontFamily: MONO, fontSize: "10px", color: FAINT } }, r.fscLanes.length ? "FSC " + r.fscLanes.slice(0, 4).join("/") : (r.verdict === "MIXED" ? "no product lane" : "")),
            ),
          )),
          shown.length > 400 ? h("div", { style: { padding: "10px", textAlign: "center", fontFamily: MONO, fontSize: "10px", color: FAINT } }, "Showing first 400 of " + shown.length + " — narrow with filters or push in batches") : null,
        ),
        // action bar
        h("div", { style: { position: "sticky", bottom: 0, marginTop: "14px", display: "flex", gap: "10px", alignItems: "center" } },
          h("span", { style: { fontFamily: MONO, fontSize: "12px", color: DIM } }, sel.size + " selected"),
          h("div", { style: { flex: 1 } }),
          h("button", { onClick: pushSelected, disabled: !sel.size, style: btn(sel.size ? "rgba(61,214,140,.9)" : FAINT, !sel.size) }, "Push " + sel.size + " → SLED Pipeline"),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SledImportTab = SledImportTab;
})();
