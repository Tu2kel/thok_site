(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DIBBS SCREENER TAB
  //  Paste screenshot or table text → Claude extracts + screens each sol
  //  GO/VERIFY items can be bulk-added to pipeline at "Sourcing" stage
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef } = React;

  const FUNC_URL = "/.netlify/functions/analyze-sols";

  const VERDICT_STYLE = {
    "GO":           { color: "#4caf50", bg: "rgba(76,175,80,.08)",   border: "rgba(76,175,80,.3)" },
    "VERIFY FIRST": { color: "#ffc107", bg: "rgba(255,193,7,.07)",   border: "rgba(255,193,7,.28)" },
    "REJECT":       { color: "#ef5350", bg: "rgba(239,83,80,.04)",   border: "rgba(239,83,80,.18)" },
  };

  const DIBBS_STORE_KEY = "scc_dibbs_tab_v1";

  // Normalize DIBBS batch sol fields → Screener field names
  function normalizeDibbsSol(r) {
    return {
      ...r,
      quantity:       r.quantity       ?? r.qty          ?? 0,
      ref_part_number: r.ref_part_number ?? r.piece_part_no ?? "",
      fsc:            r.fsc            || (r.nsn || "").replace(/\D/g, "").slice(0, 4),
    };
  }

  function ScreenerTab({ showToast, loadPipeline, setTab }) {
    const [mode, setMode]         = useState("image");   // "image" | "text" | "dibbs"
    const [imageData, setImageData] = useState(null);    // { base64, mediaType, preview }
    const [textInput, setTextInput] = useState("");
    const [dibbsBatch, setDibbsBatch] = useState(null);  // { date, goCount, verifyCount, rejectCount, flat[] }
    const [loading, setLoading]   = useState(false);
    const [results, setResults]   = useState(null);
    const [provider, setProvider] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [adding, setAdding]     = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);

    // ── Load DIBBS batch summary whenever mode switches to "dibbs" ───────
    useEffect(() => {
      if (mode !== "dibbs") return;
      try {
        const saved = JSON.parse(localStorage.getItem(DIBBS_STORE_KEY) || "null");
        if (!saved || !saved.analysis) {
          setDibbsBatch(null);
          return;
        }
        const { go = [], verify = [], reject = [] } = saved.analysis;
        setDibbsBatch({
          date: saved.scrapeDate || "unknown date",
          goCount: go.length,
          verifyCount: verify.length,
          rejectCount: reject.length,
          flat: [
            ...go.map(normalizeDibbsSol),
            ...verify.map(normalizeDibbsSol),
            ...reject.map(normalizeDibbsSol),
          ],
        });
      } catch {
        setDibbsBatch(null);
      }
    }, [mode]);

    // ── Clipboard paste (Ctrl+V image) ──────────────────────────────────
    useEffect(() => {
      const onPaste = (e) => {
        const items = [...(e.clipboardData?.items || [])];
        const imgItem = items.find((it) => it.type.startsWith("image/"));
        if (imgItem) {
          e.preventDefault();
          readImageFile(imgItem.getAsFile());
        }
      };
      window.addEventListener("paste", onPaste);
      return () => window.removeEventListener("paste", onPaste);
    }, []);

    function readImageFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        const [header, base64] = dataUrl.split(",");
        const mediaType = (header.match(/data:(.*);/) || [])[1] || "image/png";
        setImageData({ base64, mediaType, preview: dataUrl });
        setResults(null);
        setSelected(new Set());
      };
      reader.readAsDataURL(file);
    }

    const handleDrop = (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) readImageFile(file);
    };

    // ── Load pre-analyzed DIBBS batch (no API call needed) ───────────────
    function loadDibbsBatch() {
      if (!dibbsBatch || !dibbsBatch.flat.length) {
        showToast("No DIBBS batch data found — run a batch in the DIBBS tab first", true);
        return;
      }
      setResults(dibbsBatch.flat);
      setProvider("DIBBS batch · " + dibbsBatch.date);
      const autoSel = new Set(
        dibbsBatch.flat.filter((r) => r.verdict === "GO").map((r) => r.sol_number),
      );
      setSelected(autoSel);
    }

    // ── Analyze ──────────────────────────────────────────────────────────
    async function analyze() {
      if (mode === "image" && !imageData) {
        showToast("Paste (Ctrl+V) or drop a DIBBS screenshot first", true);
        return;
      }
      if (mode === "text" && !textInput.trim()) {
        showToast("Paste DIBBS table text first", true);
        return;
      }
      setLoading(true);
      setResults(null);
      setSelected(new Set());
      try {
        const body = mode === "image"
          ? { imageBase64: imageData.base64, imageMediaType: imageData.mediaType }
          : { rawText: textInput.trim() };

        const res = await fetch(FUNC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Analysis failed");

        setResults(data.results || []);
        setProvider(data.provider || "claude");

        // Auto-select all GO items
        const autoSel = new Set(
          (data.results || []).filter((r) => r.verdict === "GO").map((r) => r.sol_number),
        );
        setSelected(autoSel);
      } catch (e) {
        showToast("Screener error: " + e.message, true);
      } finally {
        setLoading(false);
      }
    }

    // ── Add selected to pipeline ─────────────────────────────────────────
    async function addToPipeline() {
      const toAdd = (results || []).filter((r) => selected.has(r.sol_number));
      if (!toAdd.length) { showToast("Select at least one sol", true); return; }

      setAdding(true);
      let added = 0, skipped = 0;

      try {
        const existing = await window.SCC_DB.dbGetAll();
        const existingNums = new Set((existing || []).map((s) => s.sol_number));

        for (const r of toAdd) {
          if (existingNums.has(r.sol_number)) { skipped++; continue; }
          const sol = {
            sol_number:           r.sol_number,
            item_name:            r.item_name || "",
            nsn:                  r.nsn || "",
            ref_part_number:      r.ref_part_number || "",
            fsc:                  r.fsc || (r.nsn || "").replace(/\D/g, "").slice(0, 4),
            quantity:             r.quantity || 0,
            unit_price:           r.unit_price || 0,
            unit_issue:           r.unit_issue || "EA",
            quote_due:            r.quote_due || "",
            delivery_days:        r.delivery_days || "",
            set_aside:            r.set_aside || "",
            status:               "Sourcing",
            supplier_restrictions: r.supplier_restrictions || "",
            qa:                   r.qa || "",
            naics:                r.naics || "",
            notes:                r.sourcing_path ? "Sourcing path: " + r.sourcing_path : "",
            screener_verdict:     r.verdict,
            screener_reason:      r.reason,
            win_probability:      r.winProbabilityPct,
            date_added:           new Date().toISOString().slice(0, 10),
          };
          await window.SCC_DB.dbSave(sol);
          added++;
        }
      } catch (e) {
        showToast("Pipeline save error: " + e.message, true);
        setAdding(false);
        return;
      }

      await loadPipeline();
      showToast(
        added + " sol" + (added !== 1 ? "s" : "") + " added to pipeline" +
        (skipped ? " (" + skipped + " already existed)" : ""),
      );
      setAdding(false);
      setTab("pipeline");
    }

    // ── Selection helpers ────────────────────────────────────────────────
    const toggleSel = (num) =>
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(num)) n.delete(num); else n.add(num);
        return n;
      });

    const selectByVerdict = (v) =>
      setSelected((prev) => {
        const n = new Set(prev);
        (results || []).filter((r) => r.verdict === v).forEach((r) => n.add(r.sol_number));
        return n;
      });

    const deselectAll = () => setSelected(new Set());

    // ── Counts ───────────────────────────────────────────────────────────
    const goCount     = (results || []).filter((r) => r.verdict === "GO").length;
    const verifyCount = (results || []).filter((r) => r.verdict === "VERIFY FIRST").length;
    const rejectCount = (results || []).filter((r) => r.verdict === "REJECT").length;

    // ── Shared styles ────────────────────────────────────────────────────
    const surface  = { background: "var(--surface-inset)", border: "1px solid rgba(201,168,76,.15)", borderRadius: "6px", padding: "16px", marginBottom: "16px" };
    const cinzel8  = { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".12em", color: "var(--gold-dim)", textTransform: "uppercase" };
    const monoSm   = { fontFamily: "JetBrains Mono,monospace", fontSize: "11px" };

    const modeBtn = (id, label) =>
      h("button", {
        key: id,
        onClick: () => { setMode(id); setResults(null); setSelected(new Set()); },
        style: {
          padding: "5px 14px", fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".1em",
          background: mode === id ? "rgba(201,168,76,.2)" : "transparent",
          border: mode === id ? "1px solid rgba(201,168,76,.4)" : "1px solid rgba(201,168,76,.15)",
          color: mode === id ? "var(--gold-solid)" : "var(--gold-dim)",
          borderRadius: "4px", cursor: "pointer", transition: "all .15s",
        },
      }, label);

    return h("div", { style: { padding: "20px", animation: "fadeUp .3s ease both" } },

      // ── Header ──
      h("div", { style: { marginBottom: "20px" } },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "18px", letterSpacing: ".1em", color: "var(--gold-solid)" } }, "DIBBS Screener"),
        h("div", { style: { fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontSize: "13px", color: "var(--gold-dim)", marginTop: "3px" } },
          "Paste a DIBBS screenshot · Claude screens each sol · Add GO items to pipeline"),
      ),

      // ── Input zone ──
      h("div", { style: surface },
        h("div", { style: { display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" } },
          modeBtn("image", "📋 Screenshot"),
          modeBtn("text",  "⌨  Text Paste"),
          modeBtn("dibbs", "📊 DIBBS Batch"),
        ),

        // Image drop zone
        mode === "image" && h("div", null,
          h("div", {
            onDrop: handleDrop,
            onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
            onDragLeave: () => setDragOver(false),
            onClick: () => fileRef.current?.click(),
            style: {
              border: "2px dashed " + (dragOver ? "rgba(201,168,76,.7)" : "rgba(201,168,76,.22)"),
              borderRadius: "8px", padding: "28px 16px", textAlign: "center",
              cursor: "pointer", background: dragOver ? "rgba(201,168,76,.05)" : "transparent",
              transition: "all .2s",
            },
          },
            h("div", { style: { fontSize: "28px", marginBottom: "8px" } }, imageData ? "🖼" : "📋"),
            h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".1em", color: "var(--gold-dim)" } },
              imageData ? "Image loaded · click to replace" : "Ctrl+V to paste · Drag & drop · Click to browse"),
            h("div", { style: { fontSize: "11px", color: "var(--body-dim)", marginTop: "4px" } },
              imageData ? "" : "Take a screenshot of DIBBS solicitations table and paste it here"),
          ),
          h("input", {
            ref: fileRef, type: "file", accept: "image/*", style: { display: "none" },
            onChange: (e) => readImageFile(e.target.files[0]),
          }),
          imageData && h("div", { style: { marginTop: "12px" } },
            h("img", {
              src: imageData.preview,
              style: { maxWidth: "100%", maxHeight: "220px", objectFit: "contain", borderRadius: "4px", border: "1px solid rgba(201,168,76,.2)" },
            }),
          ),
        ),

        // Text area
        mode === "text" && h("textarea", {
          placeholder: "Paste DIBBS table text here (copied from browser, tab-delimited, or plain text)...",
          value: textInput,
          onChange: (e) => { setTextInput(e.target.value); setResults(null); },
          rows: 9,
          style: {
            width: "100%", background: "var(--surface-card)", border: "1px solid rgba(201,168,76,.2)",
            borderRadius: "4px", padding: "10px 12px", color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace", fontSize: "11px",
            outline: "none", resize: "vertical", boxSizing: "border-box",
          },
        }),

        // DIBBS batch loader
        mode === "dibbs" && h("div", null,
          dibbsBatch
            ? h("div", { style: { background: "var(--surface-card)", border: "1px solid rgba(201,168,76,.2)", borderRadius: "6px", padding: "16px" } },
                h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--gold-solid)", marginBottom: "6px" } },
                  "Last DIBBS Batch — " + dibbsBatch.date),
                h("div", { style: { display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" } },
                  [["GO", "#4caf50", dibbsBatch.goCount], ["VERIFY FIRST", "#ffc107", dibbsBatch.verifyCount], ["REJECT", "#ef5350", dibbsBatch.rejectCount]].map(([v, c, n]) =>
                    h("div", { key: v, style: { background: c + "22", border: "1px solid " + c + "55", color: c, borderRadius: "12px", padding: "3px 10px", fontSize: "9px", fontFamily: "Cinzel,serif", letterSpacing: ".08em" } },
                      n + "  " + v),
                  ),
                ),
                h("div", { style: { fontSize: "11px", color: "var(--gold-dim)", marginBottom: "12px" } },
                  "Already analyzed — load directly into Screener, no API call needed."),
                h("button", {
                  onClick: loadDibbsBatch,
                  className: "btn btn-primary",
                  style: { fontSize: "10px", padding: "10px 28px" },
                },
                  h("span", { className: "glint" }),
                  "◆ Load " + dibbsBatch.flat.length + " Sols into Screener",
                ),
              )
            : h("div", { style: { textAlign: "center", padding: "28px 16px", color: "var(--gold-dim)", fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".1em" } },
                "No DIBBS batch found.",
                h("div", { style: { marginTop: "6px", fontSize: "11px", fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontWeight: 400, letterSpacing: 0 } },
                  "Run a batch in the DIBBS tab first, then come back here."),
              ),
        ),

        // Analyze button — only shown for image/text modes
        mode !== "dibbs" && h("div", { style: { marginTop: "14px" } },
          h("button", {
            onClick: analyze,
            disabled: loading,
            className: "btn btn-primary",
            style: { fontSize: "10px", padding: "10px 28px", opacity: loading ? .7 : 1, cursor: loading ? "wait" : "pointer" },
          },
            h("span", { className: "glint" }),
            loading ? "Analyzing…" : "◆ Analyze Solicitations",
          ),
        ),
      ),

      // ── Results ──
      results && h("div", null,

        // Summary / filter bar
        h("div", { style: { display: "flex", gap: "10px", marginBottom: "14px", alignItems: "center", flexWrap: "wrap" } },
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--gold-dim)", marginRight: "4px" } },
            results.length + " sol" + (results.length !== 1 ? "s" : "") + (provider ? "  ·  " + provider : ""),
          ),
          [["GO", "#4caf50", goCount], ["VERIFY FIRST", "#ffc107", verifyCount], ["REJECT", "#ef5350", rejectCount]].map(([v, c, n]) =>
            h("div", {
              key: v,
              onClick: () => n && selectByVerdict(v),
              title: n ? "Click to select all " + v : "",
              style: {
                background: c + "22", border: "1px solid " + c + "55", color: c,
                borderRadius: "12px", padding: "3px 10px", fontSize: "9px",
                fontFamily: "Cinzel,serif", letterSpacing: ".08em",
                cursor: n && v !== "REJECT" ? "pointer" : "default",
              },
            }, n + "  " + v),
          ),
          selected.size > 0 && h("button", {
            onClick: deselectAll,
            style: { background: "transparent", border: "none", color: "var(--gold-dim)", fontSize: "10px", cursor: "pointer", marginLeft: "auto" },
          }, "× clear selection"),
        ),

        // Cards
        h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginBottom: "72px" } },
          results.map((r) => {
            const vs        = VERDICT_STYLE[r.verdict] || VERDICT_STYLE["REJECT"];
            const selectable = r.verdict !== "REJECT";
            const isSel      = selected.has(r.sol_number);

            return h("div", {
              key: r.sol_number,
              onClick: () => selectable && toggleSel(r.sol_number),
              style: {
                background: isSel ? vs.bg : (r.verdict === "REJECT" ? "rgba(255,255,255,.02)" : "transparent"),
                border: "1px solid " + (isSel ? vs.border : "rgba(201,168,76,.1)"),
                borderRadius: "6px", padding: "12px 14px",
                cursor: selectable ? "pointer" : "default",
                opacity: r.verdict === "REJECT" ? .5 : 1,
                transition: "border-color .15s, background .15s",
                display: "flex", alignItems: "flex-start", gap: "12px",
              },
            },

              // Checkbox
              selectable && h("div", {
                style: {
                  width: "15px", height: "15px", flexShrink: 0, marginTop: "3px",
                  border: "1px solid " + (isSel ? vs.color : "rgba(201,168,76,.3)"),
                  borderRadius: "3px", background: isSel ? vs.color + "33" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                },
              },
                isSel && h("div", { style: { width: "7px", height: "7px", background: vs.color, borderRadius: "1px" } }),
              ),

              // Content
              h("div", { style: { flex: 1, minWidth: 0 } },
                // Row 1: sol# + verdict badge + win %
                h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" } },
                  h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--gold-solid)", letterSpacing: ".06em" } }, r.sol_number),
                  h("span", {
                    style: {
                      background: vs.color + "22", border: "1px solid " + vs.color + "55", color: vs.color,
                      borderRadius: "3px", padding: "1px 7px", fontSize: "8px",
                      fontFamily: "Cinzel,serif", letterSpacing: ".08em",
                    },
                  }, r.verdict),
                  r.winProbabilityPct != null && h("span", { style: { fontSize: "10px", color: "var(--gold-dim)" } },
                    r.winProbabilityPct + "% win"),
                  r.margin_flag && r.margin_flag !== "ok" && h("span", {
                    style: { fontSize: "9px", color: r.margin_flag === "blocked" ? "#ef5350" : "#ffc107",
                      fontFamily: "Cinzel,serif", letterSpacing: ".06em" },
                  }, r.margin_flag.toUpperCase()),
                ),

                // Row 2: item name
                h("div", { style: { ...monoSm, color: "var(--alabaster)", marginBottom: "3px", fontSize: "12px" } },
                  r.item_name || "—"),

                // Row 3: key fields
                h("div", { style: { ...monoSm, fontSize: "10px", color: "var(--gold-dim)", marginBottom: "4px" } },
                  [
                    r.quantity && (r.quantity + " " + (r.unit_issue || "EA")),
                    r.unit_price && ("$" + r.unit_price + " hist."),
                    r.quote_due && ("Due " + r.quote_due),
                    r.delivery_days && (r.delivery_days + "d del."),
                    r.nsn && ("NSN " + r.nsn),
                    r.ref_part_number && ("P/N " + r.ref_part_number),
                  ].filter(Boolean).join("  ·  "),
                ),

                // Row 4: verdict reason
                r.reason && h("div", { style: { fontSize: "11px", color: vs.color + "cc", marginBottom: r.sourcing_path ? "2px" : 0 } },
                  r.reason),

                // Row 5: sourcing path
                r.sourcing_path && h("div", { style: { fontSize: "10px", color: "var(--gold-dim)", fontStyle: "italic" } },
                  "↳ " + r.sourcing_path),
              ),
            );
          }),
        ),

        // ── Sticky CTA ──
        selected.size > 0 && h("div", {
          style: {
            position: "fixed", bottom: "20px", right: "24px", zIndex: 300,
            display: "flex", gap: "10px", alignItems: "center",
          },
        },
          h("div", { style: { background: "var(--surface-card)", border: "1px solid rgba(201,168,76,.2)", borderRadius: "8px", padding: "8px 14px", fontSize: "11px", color: "var(--gold-dim)" } },
            selected.size + " selected"),
          h("button", {
            onClick: addToPipeline,
            disabled: adding,
            className: "btn btn-primary",
            style: { fontSize: "10px", padding: "11px 26px", opacity: adding ? .7 : 1, cursor: adding ? "wait" : "pointer" },
          },
            h("span", { className: "glint" }),
            adding ? "Adding…" : "→ Add to Pipeline",
          ),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.ScreenerTab = ScreenerTab;
})();
