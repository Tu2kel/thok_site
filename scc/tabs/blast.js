(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — BLAST TAB
  //  Pre-pipeline sourcing engine.
  //  Flow: Paste sols → FSC auto-sort → pull distributors from MongoDB
  //        → RFQ drafts per distributor → send → track response
  //        → quote received → push to pipeline
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.BlastTab
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: h,
    useState,
    useEffect,
    useCallback,
    useRef,
    Fragment: Frag,
  } = React;

  // ── FSC name map (shared with rest of SCC) ──────────────────────────
  const FSC_NAMES = {
    2510: "Vehicular Cab/Body/Frame", 2530: "Brake/Steering/Axle",
    2540: "Vehicular Furniture", 2910: "Engine Fuel System",
    2940: "Engine Filters", 2990: "Engine Accessories",
    3020: "Gears/Pulleys/Sprockets", 3030: "Belting/Drive Belts",
    3110: "Bearings", 4110: "Refrigeration Equipment",
    4210: "Fire Fighting Equipment", 4240: "Safety/PPE/Rescue Equipment",
    4320: "Power/Hand Pumps", 4330: "Filters/Separators",
    4710: "Pipe/Tube", 4730: "Hose/Pipe Fittings/Valves",
    4820: "Valves", 4910: "Shop Equipment", 4940: "Maintenance Equipment",
    5110: "Hand Tools", 5120: "Power Tools",
    5305: "Screws", 5306: "Bolts", 5310: "Nuts/Washers",
    5315: "Pins/Rivets", 5320: "Rivets", 5330: "Packing/Gaskets",
    5331: "Seals/O-Rings", 5340: "Commercial Hardware",
    5365: "Bushings/Bearings/Mountings",
    5920: "Fuses/Arrestors", 5925: "Circuit Breakers",
    5935: "Electrical Connectors", 5961: "Semiconductors",
    5962: "Electronic Components", 5975: "Electrical Hardware",
    6110: "Electrical Control Equipment", 6120: "Power Distribution Equipment",
    6135: "Primary Batteries", 6140: "Secondary Batteries",
    6145: "Wire/Cable", 6150: "Electrical Wire/Cable",
    6210: "Indoor/Outdoor Lighting Fixtures", 6230: "Portable/Hand Lighting",
    6240: "Electric Lamps", 6350: "Signal/Warning Devices",
    6505: "Drugs/Biologicals", 6530: "Medical/Dental Instruments",
    6532: "Hospital/Surgical Equipment", 6630: "Chemical Analysis Instruments",
    6640: "Laboratory Equipment", 6810: "Chemicals",
    6840: "Pest Control", 6850: "Misc Chemical Specialties",
    6910: "Training Aids", 7110: "Office Furniture",
    7125: "Containers/Bins", 7310: "Food Cooking Equipment",
    7320: "Kitchen Equipment", 7330: "Food Service Equipment",
    7930: "Cleaning Compounds", 8415: "Individual Equipment",
    8430: "Footwear", 8455: "Badges/Insignia", 8465: "Packs/Bags",
    8470: "Armor/Body Protection", 9150: "Oils/Lubricants",
    9510: "Ferrous Metal Bar/Sheet", 9520: "Nonferrous Metal Bar",
    9535: "Metal Plate/Sheet/Strip", 9540: "Structural Metal",
  };

  // ── API call to SCC backend ─────────────────────────────────────────
  async function apiCall(action, payload = {}) {
    console.log("[Blast] →", action, JSON.stringify(payload));
    const res = await fetch("/.netlify/functions/scc-distributors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => String(res.status));
      console.error("[Blast] HTTP", res.status, txt);
      throw new Error("API " + res.status + ": " + txt);
    }
    const data = await res.json();
    console.log("[Blast] ←", action, JSON.stringify(data).slice(0,300));
    return data;
  }

  // ── Parse pasted sol lines ──────────────────────────────────────────
  // Accepts the standard SCC batch format:
  // SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS
  function parseSolLines(raw) {
    const sols = [];
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Skip comment/header lines
      if (line.startsWith("//") || line.startsWith("#")) continue;
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length < 4) continue;
      const [id, nom, due, fsc, ext, status] = parts;
      if (!id || !nom || !fsc) continue;
      sols.push({
        id: id.toUpperCase(),
        nom: nom.toUpperCase(),
        due: due || "",
        fsc: fsc.trim(),
        ext: parseFloat((ext || "0").replace(/[$,]/g, "")) || 0,
        status: (status || "GO").trim().toUpperCase(),
      });
    }
    return sols;
  }

  // ── Group sols by FSC ───────────────────────────────────────────────
  function groupByFsc(sols) {
    const map = {};
    for (const sol of sols) {
      if (!map[sol.fsc]) map[sol.fsc] = [];
      map[sol.fsc].push(sol);
    }
    return map;
  }

  // ── Build RFQ email body ────────────────────────────────────────────
  // One email per distributor covers ALL sols in their FSC lane.
  // No SOL numbers, no NSNs per protocol.
  function buildRFQEmail(dist, sols) {
    const fscName = FSC_NAMES[sols[0].fsc] || "Industrial Supplies";
    const itemLines = sols
      .map((s, i) => `  ${i + 1}. ${s.nom}${s.ext > 0 ? " — Est. Value $" + s.ext.toLocaleString() : ""}`)
      .join("\n");

    return `Subject: RFQ – ${fscName} | Government Requirement | Imperio Federal Logistics

Hi ${dist.name},

My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.

I need pricing and availability on the following items:

${itemLines}

Details:
- Destination: Government delivery address (continental US)
- Payment: Immediate PO upon award — we use third-party PO funding (Factoring Express) — supplier receives direct wire payment before shipment
- Delivery: Standard lead time acceptable; expedited preferred where available
- Compliance: BAA/TAA required — please confirm country of origin on all items
- Shipping: FOB Destination required

We are not looking for a one-time transaction. We are building a recurring government supplier relationship in this lane. We issue POs immediately upon award and have established government payment infrastructure.

Can you provide pricing on any or all of the above? If you need manufacturer part numbers or additional specs, I can provide those item by item.

Thank you,

Anthony K Kelley | Founder & CEO
Imperio Federal Logistics
The House of Kel LLC · CAGE 152U4
SDVOSB | VetHUB
anthony@ifedlog.com | ifedlog.com
(254) 226-5216`;
  }

  // ── BLAST LOG (localStorage) ────────────────────────────────────────
  const BLAST_LOG_KEY = "imperio_blast_log_v1";

  function loadBlastLog() {
    try { return JSON.parse(localStorage.getItem(BLAST_LOG_KEY) || "[]"); }
    catch { return []; }
  }
  function saveBlastLog(log) {
    localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(log));
  }
  function addBlastEntry(entry) {
    const log = loadBlastLog();
    log.unshift({ ...entry, id: Date.now(), sent_at: new Date().toISOString() });
    saveBlastLog(log.slice(0, 500)); // keep last 500
  }
  function updateBlastEntry(id, updates) {
    const log = loadBlastLog();
    const idx = log.findIndex((e) => e.id === id);
    if (idx === -1) return;
    log[idx] = { ...log[idx], ...updates };
    saveBlastLog(log);
  }

  // ── STYLES ──────────────────────────────────────────────────────────
  const S = {
    page: { animation: "fadeUp .5s ease both" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "12px" },
    title: { fontFamily: "Cinzel,serif", fontSize: "18px", letterSpacing: ".12em", color: "var(--gold-solid,#C9A84C)", textTransform: "uppercase" },
    sub: { fontFamily: "Cormorant Garamond,serif", fontSize: "13px", fontStyle: "italic", color: "var(--body-dim,rgba(245,240,232,.45))", marginTop: "4px" },
    card: { background: "var(--card-bg,rgba(42,0,10,.55))", border: "1px solid rgba(201,168,76,.15)", borderRadius: "4px", padding: "18px 20px", marginBottom: "14px" },
    cardTitle: { fontFamily: "Cinzel,serif", fontSize: "11px", letterSpacing: ".14em", color: "var(--gold-solid,#C9A84C)", textTransform: "uppercase", marginBottom: "10px" },
    textarea: { width: "100%", minHeight: "120px", background: "var(--inset-bg,rgba(0,0,0,.35))", border: "1px solid rgba(201,168,76,.2)", color: "var(--alabaster,#F5F0E8)", fontFamily: "JetBrains Mono,monospace", fontSize: "11px", padding: "10px 12px", borderRadius: "3px", outline: "none", resize: "vertical", boxSizing: "border-box", letterSpacing: ".03em" },
    btn: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", letterSpacing: ".08em", padding: "8px 18px", border: "1px solid rgba(201,168,76,.4)", background: "transparent", color: "var(--gold-solid,#C9A84C)", cursor: "pointer", borderRadius: "3px", textTransform: "uppercase", transition: "background .15s,color .15s" },
    btnPrimary: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", letterSpacing: ".08em", padding: "8px 18px", border: "none", background: "linear-gradient(135deg,#8a5c00,#c9930a,#7a5000)", color: "#111", cursor: "pointer", borderRadius: "3px", textTransform: "uppercase", fontWeight: "700" },
    btnDanger: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", letterSpacing: ".08em", padding: "6px 14px", border: "1px solid rgba(231,76,60,.3)", background: "transparent", color: "rgba(231,76,60,.7)", cursor: "pointer", borderRadius: "3px", textTransform: "uppercase" },
    btnSm: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", letterSpacing: ".06em", padding: "4px 10px", border: "1px solid rgba(201,168,76,.25)", background: "transparent", color: "rgba(245,240,232,.6)", cursor: "pointer", borderRadius: "3px" },
    badge: (color) => ({ display: "inline-block", fontFamily: "JetBrains Mono,monospace", fontSize: "9px", padding: "2px 7px", borderRadius: "2px", letterSpacing: ".06em", background: color, color: "#111", fontWeight: "700" }),
    row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
    mono: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: "var(--alabaster,#F5F0E8)" },
    dim: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", color: "var(--body-dim,rgba(245,240,232,.45))" },
    divider: { height: "1px", background: "rgba(201,168,76,.12)", margin: "14px 0" },
    fscSection: { marginBottom: "20px", border: "1px solid rgba(201,168,76,.12)", borderRadius: "4px", overflow: "hidden" },
    fscHeader: { background: "rgba(201,168,76,.06)", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(201,168,76,.1)" },
    distCard: { padding: "12px 14px", borderBottom: "1px solid rgba(201,168,76,.07)", background: "var(--card-bg,rgba(42,0,10,.35))" },
    emailBox: { background: "rgba(0,0,0,.4)", border: "1px solid rgba(201,168,76,.15)", borderRadius: "3px", padding: "12px 14px", fontFamily: "JetBrains Mono,monospace", fontSize: "10px", color: "rgba(245,240,232,.75)", whiteSpace: "pre-wrap", lineHeight: "1.65", maxHeight: "280px", overflowY: "auto", marginTop: "8px" },
    logRow: { padding: "10px 14px", borderBottom: "1px solid rgba(201,168,76,.07)", display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" },
  };


  // ── QUOTE PARSER COMPONENT ─────────────────────────────────────────
  // Accepts any supplier quote format -- email text, table paste, PDF copy.
  // Extracts: part number, qty, unit price, lead time, expiry, COO, contact.
  function parseQuoteText(raw) {
    const text = raw.replace(/\r/g, '');
    const result = {
      part_number: null,
      qty: null,
      unit_price: null,
      lead_time: null,
      expires: null,
      coo: null,
      contact: null,
      raw: raw,
    };

    // ── Part Number ──
    const pnMatch = text.match(/part\s*(?:number|no\.?|#)?\s*[:\-|]?\s*([A-Z0-9][A-Z0-9\-\/\.]{2,})/i);
    if (pnMatch) result.part_number = pnMatch[1].trim();

    // ── Quantity ──
    const qtyMatch = text.match(/quant(?:ity)?\s*[:\-|]?\s*([\d,]+)\s*(ea|pcs?|each|units?|pc)?/i);
    if (qtyMatch) result.qty = qtyMatch[1].replace(/,/g,'') + (qtyMatch[2] ? ' ' + qtyMatch[2].toUpperCase() : '');

    // ── Unit Price ──
    const priceMatch = text.match(/(?:price\s*(?:\(each\)|each|per\s*unit|unit)?|unit\s*price|each)\s*[:\-|]?\s*\