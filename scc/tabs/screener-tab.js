(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DIBBS SCREENER TAB
  //  Paste screenshot or table text → Claude extracts + screens each sol
  //  GO/VERIFY items can be bulk-added to pipeline at "Sourcing" stage
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef } = React;

  const FUNC_URL = "/.netlify/functions/analyze-sols";

  // ── Local pre-filter — instant rejects before Claude sees them ───────────
  const BLOCKED_FSCS = new Set(
    [1305,1310,1315,1320,1340,1350,1360,1376,2835,2840,1560,1720,1730,5860].map(String)
  );
  const BLOCKED_SET_ASIDES = new Set(["AL","FG","PO","FI","H","L","E"]);
  const BLOCKED_KEYWORDS   = ["AIDC","SUREFIRE","STREAMLIGHT","FURUNO TZT9F"];

  function localPreFilter(sols) {
    const clean = [], preRejected = [];
    for (const s of sols) {
      const fsc        = String(s.fsc || "").slice(0, 4);
      const setAside   = (s.set_aside || "").trim().toUpperCase();
      const itemUpper  = (s.item_name || "").toUpperCase();
      const kw         = BLOCKED_KEYWORDS.find(k => itemUpper.includes(k));

      let reason = null;
      if (BLOCKED_FSCS.has(fsc))                      reason = "Prime-dominated FSC " + fsc;
      else if (setAside && BLOCKED_SET_ASIDES.has(setAside)) reason = "Ineligible set-aside: " + setAside;
      else if (kw)                                     reason = "Blocked item: " + kw;

      if (reason) preRejected.push({ ...s, verdict: "REJECT", reason, margin_flag: "blocked", winProbabilityPct: 0 });
      else        clean.push(s);
    }
    return { clean, preRejected };
  }

  // ── FSC name map (for RFQ Blast) ─────────────────────────────────────────
  const FSC_NAMES = {
    2510:"Vehicular Cab/Body/Frame",2530:"Brake/Steering/Axle",2910:"Engine Fuel System",
    2940:"Engine Filters",4110:"Refrigeration",4330:"Filters/Separators",
    4730:"Hose/Pipe Fittings",4820:"Valves",5305:"Screws",5306:"Bolts",
    5310:"Nuts/Washers",5315:"Pins",5320:"Rivets",5330:"Packing/Gaskets",
    5331:"Seals/O-Rings",5340:"Hardware",5920:"Fuses",5925:"Circuit Breakers",
    5935:"Connectors",6110:"Electrical Control",6145:"Wire/Cable",
    6210:"Lighting Fixtures",6230:"Portable Lighting",7110:"Office Furniture",
    7310:"Food Cooking Equipment",8415:"Individual Equipment",9510:"Bars/Rods/Wire",
  };
  const fscName = (fsc) => FSC_NAMES[parseInt(fsc)] || "FSC " + fsc;

  function buildRFQEmail(dist, sols) {
    const items = sols.map((s, i) => {
      const lines = ["  " + (i+1) + ". " + (s.item_name || "Item")];
      const pn = s.ref_part_number || s.piece_part_no || "";
      if (pn)        lines.push("     Part #: " + pn);
      if (s.quantity) lines.push("     Qty: " + s.quantity + (s.unit_issue ? " " + s.unit_issue : ""));
      if (s.delivery_days) lines.push("     Required Delivery: " + s.delivery_days + " days ARO");
      if (s.sol_number)    lines.push("     Ref #: " + s.sol_number);
      return lines.join("\n");
    }).join("\n\n");
    return [
      "Hi " + (dist.name || dist.Company || "Team") + ",",
      "",
      "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting active DLA requirements and have an immediate procurement need in your lane.",
      "",
      "I need pricing and availability on the following item" + (sols.length > 1 ? "s" : "") + ":",
      "", items, "",
      "Requirements:",
      "- Destination: Government delivery address (continental US)",
      "- Payment: Immediate PO upon award — Factoring Express for third-party PO funding. Supplier receives direct wire before shipment.",
      "- Compliance: BAA/TAA required — please confirm country of origin",
      "- Shipping: FOB Destination required",
      "- Condition: New/unused only",
      "",
      "Please provide unit price, lead time, and country of origin confirmation. We issue POs same-day upon award.",
      "",
      "Thank you,",
      "",
      "Anthony K. Kelley | Founder & CEO",
      "Imperio Federal Logistics | The House of Kel LLC · CAGE 152U4",
      "SDVOSB | VetHUB",
      "anthony@ifedlog.com | (254) 226-5216",
    ].join("\n");
  }

  function openGmailCompose(to, subject, body) {
    const url = "https://mail.google.com/mail/?view=cm&fs=1"
      + "&to=" + encodeURIComponent(to)
      + "&su=" + encodeURIComponent(subject)
      + "&body=" + encodeURIComponent(body);
    window.open(url, "_blank");
  }

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
    // Default to dibbs mode if a batch exists in localStorage
    const _hasBatch = (() => {
      try { const s = JSON.parse(localStorage.getItem(DIBBS_STORE_KEY) || "null"); return !!(s?.sols?.length); } catch { return false; }
    })();

    const [mode, setMode]         = useState(_hasBatch ? "dibbs" : "image");
    const [imageData, setImageData] = useState(null);
    const [textInput, setTextInput] = useState("");
    const [dibbsBatch, setDibbsBatch] = useState(null);
    const [dibbsProgress, setDibbsProgress] = useState("");
    const [loading, setLoading]   = useState(false);
    const [results, setResults]   = useState(null);
    const [provider, setProvider] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [adding, setAdding]     = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [blastPlan, setBlastPlan] = useState(null);
    const [blastView, setBlastView] = useState(false);
    const fileRef = useRef(null);

    // ── Load DIBBS batch + persisted analysis whenever mode = "dibbs" ────
    useEffect(() => {
      if (mode !== "dibbs") return;
      try {
        const saved = JSON.parse(localStorage.getItem(DIBBS_STORE_KEY) || "null");
        if (!saved || !saved.sols || !saved.sols.length) {
          setDibbsBatch(null);
          return;
        }
        setDibbsBatch({
          date: saved.scrapeDate || "unknown date",
          sols: saved.sols.map(normalizeDibbsSol),
        });
        // Restore previous analysis if present
        if (saved.analysis) {
          const all = [
            ...(saved.analysis.go     || []),
            ...(saved.analysis.verify || []),
            ...(saved.analysis.reject || []),
          ];
          if (all.length) {
            setResults(all);
            setSelected(new Set(saved.analysis.go.map(r => r.sol_number)));
            setProvider("claude · " + (saved.scrapeDate || ""));
            return;
          }
        }
        setResults(null);
        setSelected(new Set());
        setDibbsProgress("");
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

    // ── Analyze DIBBS batch — pre-filter then chunk 20 at a time ────────
    async function analyzeDibbsBatch() {
      if (!dibbsBatch || !dibbsBatch.sols.length) {
        showToast("No DIBBS batch — run a scrape first", true);
        return;
      }

      // Step 1: instant local pre-filter (no API call)
      const { clean, preRejected } = localPreFilter(dibbsBatch.sols);
      setDibbsProgress(`Pre-filtered: ${preRejected.length} instant rejects · sending ${clean.length} to Claude…`);

      const CHUNK = 3;
      const chunks = [];
      for (let i = 0; i < clean.length; i += CHUNK) chunks.push(clean.slice(i, i + CHUNK));

      setLoading(true);
      setResults(null);
      setSelected(new Set());
      setBlastPlan(null);
      setBlastView(false);

      const allResults = [];
      let skipped = 0;
      try {
        for (let i = 0; i < chunks.length; i++) {
          setDibbsProgress(`Batch ${i + 1}/${chunks.length} (${chunks[i].length} sols)…`);
          const payload = chunks[i].map((s) => ({
            sol_number: s.sol_number, item_name: s.item_name, fsc: s.fsc,
            nsn: s.nsn, qty: s.quantity || s.qty, unit_issue: s.unit_issue,
            unit_price: s.unit_price, ext_price: s.ext_price,
            delivery_days: s.delivery_days, set_aside: s.set_aside,
            supplier_restrictions: s.supplier_restrictions,
            piece_part_no: s.ref_part_number || s.piece_part_no,
            material: s.material, part_char: s.part_char, quote_due: s.quote_due,
            amsc: s.amsc || "", approved_sources: s.approved_sources || [],
          }));
          try {
            const res = await fetch(FUNC_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sols: payload }),
            });
            if (!res.ok) { skipped += chunks[i].length; continue; }
            const data = await res.json();
            if (!data.ok) { skipped += chunks[i].length; continue; }
            allResults.push(...data.results);
          } catch { skipped += chunks[i].length; }
        }

        // Merge Claude results with original sol data + pre-rejected
        const merged = [
          ...allResults.map((r) => {
            const orig = clean.find((s) => s.sol_number === r.sol_number) || {};
            return { ...orig, ...r };
          }),
          ...preRejected,
        ];

        // Save analysis back to localStorage
        try {
          const saved = JSON.parse(localStorage.getItem(DIBBS_STORE_KEY) || "{}");
          saved.analysis = {
            go:     merged.filter((r) => r.verdict === "GO"),
            verify: merged.filter((r) => r.verdict === "VERIFY FIRST"),
            reject: merged.filter((r) => r.verdict === "REJECT"),
          };
          localStorage.setItem(DIBBS_STORE_KEY, JSON.stringify(saved));
        } catch {}

        setResults(merged);
        setProvider(`claude · ${dibbsBatch.date}`);
        const autoSel = new Set(merged.filter((r) => r.verdict === "GO").map((r) => r.sol_number));
        setSelected(autoSel);
        setDibbsProgress("");
        showToast(`Analysis complete — ${autoSel.size} GO · ${merged.filter(r=>r.verdict==="VERIFY FIRST").length} VERIFY · ${merged.filter(r=>r.verdict==="REJECT").length} REJECT` + (skipped > 0 ? ` · ${skipped} skipped (API error)` : ""));
      } catch (e) {
        showToast("Analysis failed: " + e.message, true);
        setDibbsProgress("");
      }
      setLoading(false);
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
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Server ${res.status}: ${txt.slice(0, 120)}`);
        }
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
            status:               mode === "dibbs" ? "New" : "Sourcing",
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

        // DIBBS batch analyze
        mode === "dibbs" && h("div", null,
          dibbsBatch
            ? h("div", { style: { background: "var(--surface-card)", border: "1px solid rgba(201,168,76,.2)", borderRadius: "6px", padding: "16px" } },
                h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--gold-solid)", marginBottom: "4px" } },
                  "DIBBS Batch — " + dibbsBatch.date),
                h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: "var(--body-dim)", marginBottom: "14px" } },
                  dibbsBatch.sols.length + " solicitations ready to analyze"),
                dibbsProgress
                  ? h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: "var(--accent-green)", marginBottom: "12px" } },
                      "⟳ " + dibbsProgress)
                  : h("button", {
                      onClick: analyzeDibbsBatch,
                      disabled: loading,
                      className: "btn btn-primary",
                      style: { fontSize: "10px", padding: "10px 28px", opacity: loading ? .7 : 1 },
                    },
                      h("span", { className: "glint" }),
                      "◆ Analyze " + dibbsBatch.sols.length + " Sols",
                    ),
              )
            : h("div", { style: { textAlign: "center", padding: "28px 16px", color: "var(--gold-dim)", fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".1em" } },
                "No DIBBS batch found.",
                h("div", { style: { marginTop: "6px", fontSize: "11px", fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontWeight: 400, letterSpacing: 0 } },
                  "Run a batch in the DIBBS tab first — you'll be sent here automatically."),
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

        // ── RFQ Blast modal ──
        blastView && blastPlan && h("div", {
          style: {
            position: "fixed", inset: 0, zIndex: 400,
            background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-start",
            justifyContent: "center", paddingTop: "60px",
          },
          onClick: (e) => { if (e.target === e.currentTarget) setBlastView(false); },
        },
          h("div", {
            style: {
              background: "var(--surface-card)", border: "1px solid rgba(201,168,76,.3)",
              borderRadius: "10px", width: "680px", maxWidth: "95vw",
              maxHeight: "75vh", overflowY: "auto", padding: "24px",
            },
          },
            h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" } },
              h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "14px", color: "var(--gold-solid)", letterSpacing: ".1em" } }, "🚀 RFQ BLAST PLAN"),
              h("button", {
                onClick: () => setBlastView(false),
                style: { background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "18px" },
              }, "✕"),
            ),
            Object.entries(blastPlan).map(([fsc, { sols: fscSols, dists }]) =>
              h("div", {
                key: fsc,
                style: { marginBottom: "20px", border: "1px solid rgba(255,255,255,.07)", borderRadius: "6px", padding: "14px" },
              },
                h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--gold-solid)", marginBottom: "8px" } },
                  "FSC " + fsc + " — " + fscName(fsc) + " (" + fscSols.length + " sol" + (fscSols.length !== 1 ? "s" : "") + ")",
                ),
                h("div", { style: { fontSize: "10px", color: "var(--text-muted)", marginBottom: "10px" } },
                  fscSols.map(s => s.sol_number).join("  ·  "),
                ),
                dists.length === 0
                  ? h("div", { style: { fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" } }, "No matched distributors for this FSC")
                  : dists.map((dist, di) => {
                    const subject = "RFQ — " + fscName(fsc) + " Parts (FSC " + fsc + ")";
                    const body = buildRFQEmail(dist, fscSols);
                    return h("div", {
                      key: di,
                      style: {
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "8px 0",
                        borderTop: di > 0 ? "1px solid rgba(255,255,255,.05)" : "none",
                      },
                    },
                      h("div", { style: { flex: 1, fontSize: "12px", color: "var(--text-primary)" } },
                        dist.name,
                        dist.email && h("span", { style: { fontSize: "10px", color: "var(--text-muted)", marginLeft: "6px" } }, "· " + dist.email),
                      ),
                      dist.email && h("button", {
                        onClick: () => openGmailCompose(dist.email, subject, body),
                        style: {
                          fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".06em",
                          padding: "6px 14px", background: "rgba(201,168,76,.12)",
                          border: "1px solid rgba(201,168,76,.35)", color: "var(--gold-solid)",
                          cursor: "pointer", whiteSpace: "nowrap",
                        },
                      }, "Gmail Compose"),
                      h("button", {
                        onClick: () => {
                          navigator.clipboard.writeText(body).then(() => showToast("Email copied")).catch(() => showToast("Copy failed", true));
                        },
                        style: {
                          fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".06em",
                          padding: "6px 14px", background: "transparent",
                          border: "1px solid rgba(255,255,255,.15)", color: "var(--text-muted)",
                          cursor: "pointer",
                        },
                      }, "Copy"),
                    );
                  }),
              ),
            ),
          ),
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
          mode === "dibbs" && h("button", {
            onClick: () => {
              const goSols = (results || []).filter(r => selected.has(r.sol_number) && r.verdict === "GO");
              if (!goSols.length) { showToast("Select GO sols first", true); return; }
              const SCC_DIST = window.SCC_DIST;
              if (!SCC_DIST) { showToast("Distributor DB not loaded", true); return; }
              const byFSC = {};
              for (const s of goSols) {
                const fsc = s.fsc || "0000";
                if (!byFSC[fsc]) byFSC[fsc] = [];
                byFSC[fsc].push(s);
              }
              const plan = {};
              for (const [fsc, fscSols] of Object.entries(byFSC)) {
                plan[fsc] = { sols: fscSols, dists: SCC_DIST.getDistsByFSC(fsc).slice(0, 5) };
              }
              setBlastPlan(plan);
              setBlastView(true);
            },
            style: {
              fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".08em",
              padding: "11px 20px", background: "rgba(201,168,76,.12)",
              border: "1px solid rgba(201,168,76,.4)", color: "var(--gold-solid)",
              cursor: "pointer",
            },
          }, "🚀 RFQ Blast"),
          h("button", {
            onClick: addToPipeline,
            disabled: adding,
            className: "btn btn-primary",
            style: { fontSize: "10px", padding: "11px 26px", opacity: adding ? .7 : 1, cursor: adding ? "wait" : "pointer" },
          },
            h("span", { className: "glint" }),
            adding ? "Adding…" : "→ Pipeline",
          ),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.ScreenerTab = ScreenerTab;
})();
