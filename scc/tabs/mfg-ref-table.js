// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — MFG REFERENCE TABLE
//  Per-sol quote tracking + DIBBS pull button
//  Architecture: browser fetches DIBBS directly (avoids server IP block),
//  sends raw HTML to /.netlify/functions/dibbs-sol for parsing.
//  Storage: localStorage keyed by sol_number
//  Exports: window.SCC_TABS.MFGRefTable
//  Load order: before pipeline-drawer.js
// ═══════════════════════════════════════════════════════════════════════

(function () {
  const { createElement: hM, useState, useEffect } = React;

  const LS_KEY = "scc-mfg-quotes-v1";
  const DIBBS_RFQ_URL = "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=";

  function loadQuotes(sol) {
    try {
      const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      return all[sol] || [];
    } catch {
      return [];
    }
  }

  function saveQuotes(sol, rows) {
    try {
      const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      all[sol] = rows;
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch {}
  }

  function emptyRow() {
    return {
      id: Date.now() + Math.random(),
      mfg: "",
      pn: "",
      qty: "",
      price: "",
      lead_time: "",
      notes: "",
    };
  }

  // Step 1: browser fetches DIBBS page directly (uses your IP + session)
  // Step 2: sends raw HTML to Netlify function for parsing
  async function pullDIBBS(solNumber) {
    console.log("[MFG Pull] Browser fetching DIBBS for:", solNumber);

    // Browser fetch — works because it uses your real IP and cookies
    const dibbsRes = await fetch(
      DIBBS_RFQ_URL + encodeURIComponent(solNumber),
      {
        credentials: "include",
      },
    );

    if (!dibbsRes.ok) {
      throw new Error("DIBBS returned " + dibbsRes.status);
    }

    const html = await dibbsRes.text();
    console.log("[MFG Pull] DIBBS HTML received, length:", html.length);

    if (html.length < 500) {
      throw new Error(
        "DIBBS returned empty page — sol may be closed or removed",
      );
    }

    // Send HTML to Netlify function for parsing
    const parseRes = await fetch("/.netlify/functions/dibbs-sol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, sol_number: solNumber }),
    });

    return await parseRes.json();
  }

  // Margin calc: shows GM% and net after FE fees
  // FE fee tiers per protocol: Day 20 = 1.67%, Day 30 = 2.50%, Day 60 = 5.00%
  // With PO funding Day 30 = 5.00%, Day 45 = 5.833%, Day 60 = 7.50%
  // Default display: FE Day-30 factoring only (2.5%) for deals >= $10K
  function calcMargin(price, histUnit, qty) {
    const cost = parseFloat(price);
    const hist = parseFloat(histUnit);
    const q = parseFloat(qty) || 1;
    if (!cost || !hist) return null;
    const gm = ((hist - cost) / hist) * 100;
    const total = hist * q;
    // Self-funded under $10K, FE Day-30 factoring only above
    const feeFactor = total >= 10000 ? 2.5 : 0;
    const net = gm - feeFactor;
    return {
      gm: gm.toFixed(1),
      net: net.toFixed(1),
      isFE: total >= 10000,
      color: net >= 10 ? "#3dd68c" : net >= 5 ? "#C9A84C" : "#e87474",
    };
  }

  function MFGRefTable({ record, showToast }) {
    const sol = record.sol_number || "";
    const histUnit = record.unit_price || "";
    const qty = record.quantity || "1";

    const [rows, setRows] = useState(() => {
      const saved = loadQuotes(sol);
      return saved.length ? saved : [emptyRow()];
    });
    const [pullStatus, setPullStatus] = useState("idle");
    const [pullData, setPullData] = useState(null);

    useEffect(() => {
      saveQuotes(sol, rows);
    }, [rows, sol]);

    function updateRow(id, field, val) {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)),
      );
    }
    function addRow() {
      setRows((prev) => [...prev, emptyRow()]);
    }
    function deleteRow(id) {
      setRows((prev) => prev.filter((r) => r.id !== id));
    }

    async function handlePull() {
      if (!sol) return;
      setPullStatus("loading");
      try {
        const data = await pullDIBBS(sol);
        console.log("[MFG Pull] Parse result:", data);

        if (data.ok && data.sol) {
          setPullData(data.sol);
          setPullStatus("done");

          if (data.sol.suppliers && data.sol.suppliers.length) {
            const newRows = data.sol.suppliers.map((s) => ({
              ...emptyRow(),
              mfg: s.name || "",
              pn: s.pn || "",
            }));
            setRows((prev) => {
              const withData = prev.filter((r) => r.price || r.notes);
              const existing = new Set(
                withData.map((r) => r.mfg.toUpperCase()),
              );
              const toAdd = newRows.filter(
                (r) => !existing.has(r.mfg.toUpperCase()),
              );
              const merged = [...withData, ...toAdd];
              return merged.length ? merged : [emptyRow()];
            });
            if (showToast)
              showToast(
                "DIBBS pull complete — " +
                  data.sol.suppliers.length +
                  " approved sources loaded",
              );
          } else {
            if (showToast)
              showToast(
                "DIBBS pulled — no approved sources found on this sol.",
                true,
              );
          }
        } else {
          setPullStatus("error");
          if (showToast)
            showToast("DIBBS pull failed: " + (data.error || "unknown"), true);
        }
      } catch (err) {
        console.error("[MFG Pull] Error:", err.message);
        setPullStatus("error");
        if (showToast) showToast("DIBBS pull error: " + err.message, true);
      }
    }

    function inp(id, field, placeholder, width) {
      return hM("input", {
        value: rows.find((r) => r.id === id)?.[field] || "",
        onChange: (e) => updateRow(id, field, e.target.value),
        placeholder,
        style: {
          width: width || "100%",
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: "3px",
          padding: "5px 7px",
          color: "var(--body-bright)",
          fontSize: "11px",
          boxSizing: "border-box",
          fontFamily: "JetBrains Mono, monospace",
        },
      });
    }

    const colHdr = (label) =>
      hM(
        "span",
        {
          style: {
            fontSize: "9px",
            color: "var(--body-faint)",
            textTransform: "uppercase",
            letterSpacing: ".07em",
            padding: "2px 0",
          },
        },
        label,
      );

    const GRID = "2fr 1.5fr 55px 85px 70px 1.5fr 22px";

    const pullBtnStyle = {
      padding: "5px 12px",
      fontSize: "10px",
      fontWeight: 700,
      fontFamily: "Cinzel,serif",
      letterSpacing: ".06em",
      borderRadius: "3px",
      cursor: pullStatus === "loading" ? "wait" : "pointer",
      background:
        pullStatus === "done"
          ? "rgba(61,214,140,.12)"
          : pullStatus === "error"
            ? "rgba(231,76,60,.1)"
            : "rgba(201,168,76,.1)",
      border:
        "1px solid " +
        (pullStatus === "done"
          ? "rgba(61,214,140,.4)"
          : pullStatus === "error"
            ? "rgba(231,76,60,.4)"
            : "rgba(201,168,76,.3)"),
      color:
        pullStatus === "done"
          ? "#3dd68c"
          : pullStatus === "error"
            ? "#e87474"
            : "var(--gold-solid)",
    };

    return hM(
      "div",
      null,

      // ── Header ──
      hM(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "10px",
          },
        },
        hM(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "11px",
              letterSpacing: ".08em",
              color: "var(--gold-dim)",
              textTransform: "uppercase",
            },
          },
          "MFG Reference Table",
        ),
        hM(
          "div",
          { style: { display: "flex", gap: "6px" } },
          hM(
            "button",
            {
              onClick: handlePull,
              disabled: pullStatus === "loading",
              style: pullBtnStyle,
            },
            pullStatus === "loading"
              ? "⟳ Pulling..."
              : pullStatus === "done"
                ? "✓ DIBBS Pulled"
                : pullStatus === "error"
                  ? "✗ Retry Pull"
                  : "⬇ Pull from DIBBS",
          ),
          hM(
            "button",
            {
              onClick: addRow,
              style: {
                padding: "5px 10px",
                fontSize: "10px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,.15)",
                color: "var(--body-dim)",
                borderRadius: "3px",
                cursor: "pointer",
                fontFamily: "Cinzel,serif",
              },
            },
            "+ Add Row",
          ),
        ),
      ),

      // ── DIBBS pull banner ──
      pullData &&
        hM(
          "div",
          {
            style: {
              background: "rgba(61,214,140,.05)",
              border: "1px solid rgba(61,214,140,.2)",
              borderRadius: "4px",
              padding: "8px 12px",
              marginBottom: "10px",
            },
          },
          hM(
            "div",
            {
              style: {
                color: "#3dd68c",
                fontWeight: 700,
                marginBottom: "4px",
                fontSize: "9px",
                letterSpacing: ".1em",
                fontFamily: "Cinzel,serif",
              },
            },
            "DIBBS DATA LOADED",
          ),
          pullData.item_description &&
            hM(
              "div",
              {
                style: {
                  color: "var(--body-bright)",
                  marginBottom: "3px",
                  fontSize: "11px",
                },
              },
              pullData.item_description,
            ),
          hM(
            "div",
            {
              style: {
                color: "var(--body-dim)",
                fontSize: "10px",
                fontFamily: "JetBrains Mono, monospace",
              },
            },
            [
              pullData.nsn && "NSN: " + pullData.nsn,
              pullData.qty &&
                "Qty: " +
                  pullData.qty +
                  (pullData.unit_issue ? " " + pullData.unit_issue : ""),
              pullData.due_date && "Due: " + pullData.due_date,
              pullData.fob && "FOB: " + pullData.fob,
              pullData.set_aside && "Set-Aside: " + pullData.set_aside,
              pullData.delivery_days && "Del: " + pullData.delivery_days + "d",
            ]
              .filter(Boolean)
              .join("  ·  "),
          ),
        ),

      // ── Column headers ──
      hM(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: GRID,
            gap: "5px",
            padding: "4px 6px",
            background: "rgba(0,0,0,.25)",
            borderRadius: "3px 3px 0 0",
            marginBottom: "2px",
          },
        },
        colHdr("MFG / Supplier"),
        colHdr("Part Number"),
        colHdr("QTY"),
        colHdr("Price / ea"),
        colHdr("Lead Time"),
        colHdr("Notes"),
        hM("span", null),
      ),

      // ── Rows ──
      hM(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            marginBottom: "10px",
          },
        },
        rows.map((row) => {
          const margin = calcMargin(row.price, histUnit, row.qty || qty);
          return hM(
            "div",
            { key: row.id },
            hM(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: "5px",
                  alignItems: "center",
                  background: "rgba(255,255,255,.02)",
                  borderRadius: "3px",
                  padding: "4px 6px",
                  border: margin
                    ? "1px solid " + margin.color + "33"
                    : "1px solid rgba(255,255,255,.05)",
                },
              },
              inp(row.id, "mfg", "Manufacturer"),
              inp(row.id, "pn", "P/N"),
              inp(row.id, "qty", "Qty", "55px"),
              inp(row.id, "price", "$0.00", "85px"),
              inp(row.id, "lead_time", "Days", "70px"),
              inp(row.id, "notes", "Notes"),
              hM(
                "button",
                {
                  onClick: () => deleteRow(row.id),
                  style: {
                    background: "transparent",
                    border: "none",
                    color: "rgba(231,76,60,.5)",
                    cursor: "pointer",
                    fontSize: "16px",
                    padding: "0",
                    lineHeight: 1,
                  },
                },
                "×",
              ),
            ),
            margin &&
              row.price &&
              hM(
                "div",
                {
                  style: {
                    fontSize: "9px",
                    color: margin.color,
                    paddingLeft: "8px",
                    paddingBottom: "2px",
                    fontFamily: "JetBrains Mono, monospace",
                  },
                },
                "GM " +
                  margin.gm +
                  "%" +
                  (parseFloat(histUnit)
                    ? "  ·  Net ~" +
                      margin.net +
                      "% vs hist $" +
                      parseFloat(histUnit).toFixed(2)
                    : "") +
                  (margin.isFE ? "  (FE Day-30 baked in)" : "  (self-funded)"),
              ),
          );
        }),
      ),

      // ── Floor reminder ──
      hM(
        "div",
        {
          style: {
            fontSize: "10px",
            color: "var(--body-faint)",
            fontStyle: "italic",
            borderTop: "1px solid rgba(255,255,255,.06)",
            paddingTop: "6px",
            fontFamily: "JetBrains Mono, monospace",
          },
        },
        "Floor: 10% gross (all deals)  ·  Target: 27.5% gross  ·  Cost ceiling: hist × 90%",
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.MFGRefTable = MFGRefTable;
})();
