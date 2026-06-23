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
    5331:"Seals/O-Rings",5340:"Hardware",5365:"Retaining Rings",
    5920:"Fuses",5925:"Circuit Breakers",
    5935:"Connectors",6110:"Electrical Control",6145:"Wire/Cable",
    6210:"Lighting Fixtures",6230:"Portable Lighting",7110:"Office Furniture",
    7310:"Food Cooking Equipment",8415:"Individual Equipment",9510:"Bars/Rods/Wire",
    9330:"Rubber Fabricated Materials",9340:"Plastics Fabricated Materials",
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
      const rawDue = s.quote_due || s.quoteDue || "";
      if (rawDue) {
        const m = rawDue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (m) {
          const yr = m[3].length === 2 ? "20" + m[3] : m[3];
          const d = new Date(parseInt(yr), parseInt(m[1])-1, parseInt(m[2]));
          d.setDate(d.getDate() - 1);
          lines.push("     Please Respond By: " + (d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear());
        } else {
          lines.push("     Please Respond By: " + rawDue);
        }
      } else {
        lines.push("     Please Respond By: As soon as possible");
      }
      return lines.join("\n");
    }).join("\n\n");
    return [
      "Hi " + (dist.name || dist.Company || "Team") + ",",
      "",
      "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting active DLA requirements and have an immediate procurement need in your lane.",
      "",
      "Quick Note: I sent you an email from anthony@ifedlog.com — we went through a company restructure and transitioned to a new email. If you didn't see it, it may be in your spam folder.",
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
    const [intelRunning, setIntelRunning] = useState(null); // "go" | "verify" | null
    const [intelProgress, setIntelProgress] = useState("");
    const fileRef = useRef(null);

    // ── Intel helpers ────────────────────────────────────────────────────
    const _fmtNSN = (raw) => {
      const d = String(raw || "").replace(/\D/g, "");
      return d.length === 13
        ? d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,9)+"-"+d.slice(9,13)
        : String(raw || "").trim();
    };

    const _detectPrime = (descs) => {
      const kw = ["overhaul","repair","installation","system","assembly","integration","maintenance","service support"];
      const txt = descs.join(" ").toLowerCase();
      return kw.some(k => txt.includes(k));
    };

    const _queryUSASpending = async (type, val) => {
      try {
        const filters = type === "fsc"
          ? { award_type_codes: ["A","B","C","D"], psc_codes: { require: [["Product", val.slice(0,2), val]] } }
          : { award_type_codes: ["A","B","C","D"], keywords: [_fmtNSN(val), val.replace(/\D/g,"")] };
        const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filters,
            fields: ["Recipient Name", "Award Amount", "Description"],
            sort: "Award Amount", order: "asc",
            limit: 25, page: 1, subawards: false,
          }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const map = new Map();
        for (const a of data.results || []) {
          const name = (a["Recipient Name"] || "").trim();
          if (!name || name === "MULTIPLE RECIPIENTS") continue;
          const key = name.toUpperCase();
          const amt = Number(a["Award Amount"] || 0);
          if (!map.has(key)) map.set(key, { name, total: 0, count: 0, minAward: 0, descs: [] });
          const e = map.get(key);
          e.total += amt;
          e.count++;
          if (amt > 0 && (e.minAward === 0 || amt < e.minAward)) e.minAward = amt;
          const desc = (a["Description"] || "").trim().slice(0, 100);
          if (desc && !e.descs.includes(desc) && e.descs.length < 3) e.descs.push(desc);
        }
        return [...map.values()];
      } catch { return []; }
    };

    const _fetchSAM = async (name) => {
      try {
        const res = await fetch("/.netlify/functions/scc-intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "samLookup", payload: { name } }),
        });
        const data = await res.json();
        return data.ok ? data.result : null;
      } catch { return null; }
    };

    const runIntel = async (verdict) => {
      const target = (results || []).filter(r =>
        r.verdict === (verdict === "go" ? "GO" : "VERIFY FIRST")
      );
      if (!target.length) { showToast("No " + verdict.toUpperCase() + " sols", true); return; }

      setIntelRunning(verdict);
      setIntelProgress("Starting…");

      const PENDING_KEY = "scc_intel_pending_v1";
      const existing = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
      const existNames = new Set(existing.map(v => v.name.toUpperCase().trim()));
      // Also skip companies already in the dist DB
      const dbNames = new Set((window.SCC_DIST && window.SCC_DIST.DISTRIBUTORS || []).map(d => (d.name||"").toUpperCase().trim()));

      const found = new Map();

      for (let i = 0; i < target.length; i++) {
        const sol = target[i];
        const nsn = (sol.nsn || "").trim();
        const fsc = nsn ? nsn.replace(/\D/g,"").slice(0,4) : (sol.fsc || "").replace(/\D/g,"").slice(0,4);
        setIntelProgress("USASpending " + (i+1) + "/" + target.length + " · " + (nsn || fsc || sol.sol_number));

        let usaRows = nsn ? await _queryUSASpending("nsn", nsn) : [];
        if (!usaRows.length && fsc) usaRows = await _queryUSASpending("fsc", fsc);

        for (const v of usaRows) {
          const key = v.name.toUpperCase().trim();
          if (dbNames.has(key)) continue; // already in roster
          if (!found.has(key)) {
            found.set(key, { ...v, fscs: fsc ? [fsc] : [], nsns: nsn ? [nsn] : [] });
          } else {
            const e = found.get(key);
            e.total += v.total;
            e.count += v.count;
            if (v.minAward > 0 && (e.minAward === 0 || v.minAward < e.minAward)) e.minAward = v.minAward;
            if (fsc && !e.fscs.includes(fsc)) e.fscs.push(fsc);
            if (nsn && !e.nsns.includes(nsn)) e.nsns.push(nsn);
            v.descs.forEach(d => { if (!e.descs.includes(d) && e.descs.length < 3) e.descs.push(d); });
          }
        }
        await new Promise(r => setTimeout(r, 300));
      }

      const foundArr = [...found.values()].filter(v => !existNames.has(v.name.toUpperCase().trim()));
      const newVendors = [];

      for (let i = 0; i < foundArr.length; i++) {
        const v = foundArr[i];
        setIntelProgress("SAM.gov " + (i+1) + "/" + foundArr.length + " · " + v.name.slice(0,30));
        const sam = await _fetchSAM(v.name);
        const titleCase = v.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        newVendors.push({
          id: "intel-" + v.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""),
          name: (sam && sam.name) ? sam.name : titleCase,
          cage: (sam && sam.cage) || "",
          email: (sam && sam.email) || "",
          phone: (sam && sam.phone) || "",
          fsc: v.fscs,
          nsns: v.nsns,
          tags: ["usa-spending-verified", ...(sam ? [] : ["needs-contact"])],
          notes: "Intel · " + v.count + " awards · $" + Math.round(v.total).toLocaleString() + " total · Smallest: $" + Math.round(v.minAward).toLocaleString(),
          awards: v.count,
          totalValue: v.total,
          smallestAward: v.minAward,
          isPrime: _detectPrime(v.descs),
          pendingAt: new Date().toISOString(),
          sam: !!sam,
        });
        await new Promise(r => setTimeout(r, 200));
      }

      const updated = [...existing, ...newVendors];
      localStorage.setItem(PENDING_KEY, JSON.stringify(updated));
      setIntelRunning(null);
      setIntelProgress("");
      showToast("⚡ Intel done · " + newVendors.length + " new vendors queued → Source tab");
    };

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

    // ── AUTO-ANALYZE: trigger when fresh batch has no analysis ──────────
    useEffect(() => {
      if (mode !== "dibbs" || !dibbsBatch || results !== null || loading) return;
      // Dedup: only auto-analyze each batch date once
      const key = "scc_auto_analyzed";
      if (localStorage.getItem(key) === dibbsBatch.date) return;
      localStorage.setItem(key, dibbsBatch.date);
      // Request notification permission early (benign if already set)
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
      const t = setTimeout(() => analyzeDibbsBatch(), 800);
      return () => clearTimeout(t);
    }, [dibbsBatch, results, mode, loading]);

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
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const fetchChunk = async (payload) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await delay(2500);
          try {
            const res = await fetch(FUNC_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sols: payload }),
            });
            if (!res.ok) continue;
            const data = await res.json();
            if (!data.ok) continue;
            return data.results;
          } catch { /* retry */ }
        }
        return null;
      };
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
            amsc: s.amsc || "", supplier_list: s.supplier_list || "",
          }));
          const results = await fetchChunk(payload);
          if (results) { allResults.push(...results); } else { skipped += chunks[i].length; }
          if (i < chunks.length - 1) await delay(1200); // stay under Anthropic RPM cap
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
        try { localStorage.setItem("scc_screener_results_v1", JSON.stringify(merged)); } catch {}
        setProvider(`claude · ${dibbsBatch.date}`);
        const autoSel = new Set(merged.filter((r) => r.verdict === "GO").map((r) => r.sol_number));
        setSelected(autoSel);
        setDibbsProgress("");
        const goN      = autoSel.size;
        const verifyN  = merged.filter(r => r.verdict === "VERIFY FIRST").length;
        const rejectN  = merged.filter(r => r.verdict === "REJECT").length;
        showToast(`Analysis complete — ${goN} GO · ${verifyN} VERIFY · ${rejectN} REJECT` + (skipped > 0 ? ` · ${skipped} skipped (API error)` : ""));

        // ── AUTO-CHAIN → Intel tab ──────────────────────────────────────
        if (goN > 0 && typeof setTab === "function") {
          localStorage.setItem("scc_auto_chain", "nsn");
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("SCC: Analysis Done", {
              body: goN + " GO · " + verifyN + " Verify — running intel sweep now",
              icon: "/scc/favicon.ico",
            });
          }
          setTimeout(() => setTab("intel"), 500);
        }
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

        // ── Intel shortcut (DIBBS mode only) ──
        mode === "dibbs" && goCount > 0 && h("div", {
          style: { marginBottom: "14px" },
        },
          h("button", {
            onClick: () => {
              try { localStorage.setItem("scc_screener_results_v1", JSON.stringify(results)); } catch {}
              if (typeof setTab === "function") setTab("intel");
            },
            style: {
              fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".1em",
              padding: "5px 14px",
              background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.3)",
              color: "rgba(56,189,248,.85)", borderRadius: "4px", cursor: "pointer",
            },
          }, "⚡ Run Intel on " + goCount + " GO sols →"),
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
                    r.unit_price && ("$" + Number(r.unit_price).toLocaleString() + "/ea"),
                    r.ext_price && ("$" + Number(r.ext_price).toLocaleString() + " ext."),
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
            Object.entries(blastPlan)
              .sort(function(a, b){ return (a[1].dist.name||"").localeCompare(b[1].dist.name||""); })
              .map(function([distKey, entry]) {
                const dist = entry.dist;
                const distSols = entry.sols;
                const overflow = entry.overflow || [];
                const fscs = entry.fscs || [];
                const subject = "RFQ — FSC " + fscs.join("/") + " | Government Requirement | Imperio Federal Logistics";
                const body = buildRFQEmail(dist, distSols);
                return h("div", {
                  key: distKey,
                  style: { marginBottom: "16px", border: "1px solid rgba(255,255,255,.07)", borderRadius: "6px", padding: "14px" },
                },
                  h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "12px", color: "var(--gold-solid)", marginBottom: "4px" } },
                    dist.name,
                  ),
                  h("div", { style: { fontSize: "10px", color: "var(--text-muted)", marginBottom: "6px", display: "flex", gap: "10px", flexWrap: "wrap" } },
                    h("span", null, "FSC " + fscs.join(", ")),
                    h("span", null, "· " + distSols.length + " sol" + (distSols.length !== 1 ? "s" : "")),
                    overflow.length > 0 && h("span", { style: { color: "rgba(245,158,11,.7)" } }, "· +" + overflow.length + " queued"),
                    dist.email && h("span", { style: { color: "rgba(255,255,255,.35)" } }, "· " + dist.email),
                  ),
                  h("div", { style: { fontSize: "9px", color: "var(--text-muted)", marginBottom: "10px", lineHeight: "1.5" } },
                    distSols.map(function(s){ return s.sol_number; }).join("  ·  "),
                  ),
                  h("div", { style: { display: "flex", gap: "8px" } },
                    dist.email && h("button", {
                      onClick: function(){ openGmailCompose(dist.email, subject, body); },
                      style: {
                        fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".06em",
                        padding: "6px 14px", background: "rgba(201,168,76,.12)",
                        border: "1px solid rgba(201,168,76,.35)", color: "var(--gold-solid)",
                        cursor: "pointer", whiteSpace: "nowrap",
                      },
                    }, "Gmail Compose"),
                    h("button", {
                      onClick: function(){
                        navigator.clipboard.writeText(body).then(function(){ showToast("Email copied"); }).catch(function(){ showToast("Copy failed", true); });
                        const VQ = window.SCC_VENDOR_QUEUE;
                        if (VQ) VQ.markSent(distKey, distSols, overflow);
                      },
                      style: {
                        fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".06em",
                        padding: "6px 14px", background: "transparent",
                        border: "1px solid rgba(255,255,255,.15)", color: "var(--text-muted)",
                        cursor: "pointer",
                      },
                    }, "Copy"),
                  ),
                );
              }),
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
              // Group by distributor — each company gets one entry with all FSCs + combined sols
              const byDist = new Map();
              for (const s of goSols) {
                const fsc = s.fsc || "0000";
                const matched = SCC_DIST.getDistsByFSC(fsc).slice(0, 5);
                for (const dist of matched) {
                  const sNSN = (s.nsn || "").replace(/\D/g, "");
                  if (sNSN && (dist.known_nsns || []).some(function(n){ return n.replace(/\D/g,"") === sNSN; })) {
                    // NSN exact match — bypass keyword filter
                  } else if (dist.item_keywords && dist.item_keywords.length > 0) {
                    const iname = (s.item_name || "").toLowerCase();
                    if (!dist.item_keywords.some(function(kw){ return iname.includes(kw.toLowerCase()); })) continue;
                  }
                  const key = dist.id || dist.name;
                  if (!byDist.has(key)) byDist.set(key, { dist, sols: [], fscs: [] });
                  const entry = byDist.get(key);
                  if (!entry.fscs.includes(fsc)) entry.fscs.push(fsc);
                  const sid = s.sol_number || s.id;
                  if (!entry.sols.find(function(x){ return (x.sol_number || x.id) === sid; })) entry.sols.push(s);
                }
              }
              const VQ = window.SCC_VENDOR_QUEUE;
              const plan = {};
              for (const [key, entry] of byDist.entries()) {
                const vqr = VQ ? VQ.buildVendorBatch(key, entry.sols) : { batch: entry.sols, overflow: [] };
                plan[key] = { dist: entry.dist, sols: vqr.batch, overflow: vqr.overflow, fscs: entry.fscs.slice().sort() };
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
