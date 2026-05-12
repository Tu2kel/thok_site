(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — BLAST TAB
  //  Pre-pipeline sourcing engine.
  //  Step 1: Paste sol lines → parse FSC lanes
  //  Step 2: Paste DIBBS listings → enrich sols with NSN, part#, qty, specs
  //  Step 3: Load distributors by FSC from MongoDB
  //  Step 4: Review enriched RFQ emails → fire blast → log → quote → pipeline
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.BlastTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useCallback, Fragment: Frag } = React;

  // ── FSC name map ────────────────────────────────────────────────────
  const FSC_NAMES = {
    2510: "Vehicular Cab/Body/Frame",
    2530: "Brake/Steering/Axle",
    2540: "Vehicular Furniture",
    2910: "Engine Fuel System",
    2940: "Engine Filters",
    2990: "Engine Accessories",
    3020: "Gears/Pulleys/Sprockets",
    3030: "Belting/Drive Belts",
    3110: "Bearings",
    4110: "Refrigeration Equipment",
    4210: "Fire Fighting Equipment",
    4240: "Safety/PPE/Rescue Equipment",
    4320: "Power/Hand Pumps",
    4330: "Filters/Separators",
    4710: "Pipe/Tube",
    4730: "Hose/Pipe Fittings/Valves",
    4820: "Valves",
    4910: "Shop Equipment",
    4940: "Maintenance Equipment",
    5110: "Hand Tools",
    5120: "Power Tools",
    5305: "Screws",
    5306: "Bolts",
    5310: "Nuts/Washers",
    5315: "Pins/Rivets",
    5320: "Rivets",
    5330: "Packing/Gaskets",
    5331: "Seals/O-Rings",
    5340: "Commercial Hardware",
    5365: "Bushings/Bearings/Mountings",
    5920: "Fuses/Arrestors",
    5925: "Circuit Breakers",
    5935: "Electrical Connectors",
    5961: "Semiconductors",
    5962: "Electronic Components",
    5975: "Electrical Hardware",
    6110: "Electrical Control Equipment",
    6120: "Power Distribution Equipment",
    6135: "Primary Batteries",
    6140: "Secondary Batteries",
    6145: "Wire/Cable",
    6150: "Electrical Wire/Cable",
    6210: "Indoor/Outdoor Lighting Fixtures",
    6230: "Portable/Hand Lighting",
    6240: "Electric Lamps",
    6350: "Signal/Warning Devices",
    6505: "Drugs/Biologicals",
    6530: "Medical/Dental Instruments",
    6532: "Hospital/Surgical Equipment",
    6630: "Chemical Analysis Instruments",
    6640: "Laboratory Equipment",
    6810: "Chemicals",
    6840: "Pest Control",
    6850: "Misc Chemical Specialties",
    6910: "Training Aids",
    7110: "Office Furniture",
    7125: "Containers/Bins",
    7310: "Food Cooking Equipment",
    7320: "Kitchen Equipment",
    7330: "Food Service Equipment",
    7930: "Cleaning Compounds",
    8415: "Individual Equipment",
    8430: "Footwear",
    8455: "Badges/Insignia",
    8465: "Packs/Bags",
    8470: "Armor/Body Protection",
    9150: "Oils/Lubricants",
    9510: "Ferrous Metal Bar/Sheet",
    9520: "Nonferrous Metal Bar",
    9535: "Metal Plate/Sheet/Strip",
    9540: "Structural Metal",
  };

  // ── API ──────────────────────────────────────────────────────────────
  async function apiCall(action, payload) {
    console.log("[Blast] ->", action, payload);
    const res = await fetch("/.netlify/functions/scc-distributors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload: payload || {} }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status + "");
      console.error("[Blast] HTTP", res.status, txt);
      throw new Error("API " + res.status);
    }
    const data = await res.json();
    console.log("[Blast] <-", action, JSON.stringify(data).slice(0, 200));
    return data;
  }

  // ── Sol line parser ──────────────────────────────────────────────────
  // Format: SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS
  function parseSolLines(raw) {
    const sols = [];
    for (const line of raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      if (line.startsWith("//") || line.startsWith("#")) continue;
      const p = line.split("|").map((x) => x.trim());
      if (p.length < 4) continue;
      const [id, nom, due, fsc, ext, status] = p;
      if (!id || !nom || !fsc) continue;
      sols.push({
        id: id.toUpperCase(),
        nom: nom.toUpperCase(),
        due: due || "",
        fsc: fsc.trim(),
        ext: parseFloat((ext || "0").replace(/[$,]/g, "")) || 0,
        status: (status || "GO").trim().toUpperCase(),
        // Enriched fields (filled in Step 2)
        nsn: "",
        part_number: "",
        qty: "",
        unit_of_issue: "",
        delivery_days: "",
        ship_to: "",
        specs: "",
      });
    }
    return sols;
  }

  function groupByFsc(sols) {
    const map = {};
    for (const s of sols) {
      if (!map[s.fsc]) map[s.fsc] = [];
      map[s.fsc].push(s);
    }
    return map;
  }

  // ── DIBBS enrichment parser ──────────────────────────────────────────
  // Uses the exact same dual-parser merge as Intake (app.js handleParse).
  // boxA = DIBBS listing text, boxB = Navigator row / AI column
  // parseListing wins; parseAIText fills only missing fields.
  function enrichSolsFromDibbs(sols, boxA, boxB) {
    const parser = window.SCC_PARSER;
    if (!parser) return sols;

    const { parseListing, parseAIText, isListing } = parser;

    // For each sol, run the same merge Intake uses
    return sols.map((s) => {
      // Determine which box is the listing and which is AI text
      let listingText = "",
        aiText = "";
      if (isListing(boxA)) {
        listingText = boxA;
        aiText = boxB;
      } else if (isListing(boxB)) {
        listingText = boxB;
        aiText = boxA;
      } else {
        listingText = boxA;
        aiText = boxB;
      }

      // Run parseListing first
      let data = listingText ? parseListing(listingText) : {};

      // parseAIText fills only missing fields (same as Intake merge)
      const aiSrc = aiText.trim() || listingText;
      if (aiSrc) {
        const ai = parseAIText(aiSrc);
        Object.entries(ai).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== "" && !data[k])
            data[k] = v;
        });
      }

      return mergeEnrichment(s, data);
    });
  }

  function mergeEnrichment(sol, parsed) {
    return {
      ...sol,
      nsn: parsed.nsn || sol.nsn || "",
      part_number: parsed.ref_part_number || sol.part_number || "",
      qty: parsed.quantity ? String(parsed.quantity) : sol.qty || "",
      unit_of_issue: parsed.unit_of_issue || sol.unit_of_issue || "",
      delivery_days: parsed.delivery_days
        ? String(parsed.delivery_days)
        : sol.delivery_days || "",
      ship_to: parsed.ship_to || sol.ship_to || "",
      nom: parsed.item_name || sol.nom,
      unit_price: parsed.unit_price ? String(parsed.unit_price) : "",
      quote_due: parsed.quote_due || "",
      fob: parsed.fob || "",
      set_aside: parsed.set_aside || "",
      ref_supplier: parsed.ref_supplier || "",
      ref_supplier_cage: parsed.ref_supplier_cage || "",
      all_suppliers: parsed.all_suppliers || "",
    };
  }

  // ── RFQ email (enriched with part data) ─────────────────────────────
  function buildRFQEmail(dist, sols) {
    const fscName = FSC_NAMES[sols[0].fsc] || "Industrial Supplies";

    const items = sols
      .map((s, i) => {
        const lines = [];
        lines.push("  " + (i + 1) + ". " + s.nom);
        if (s.nsn) lines.push("     NSN: " + s.nsn);
        if (s.part_number) lines.push("     Part Number: " + s.part_number);
        if (s.qty)
          lines.push(
            "     Quantity: " +
              s.qty +
              (s.unit_of_issue ? " " + s.unit_of_issue : ""),
          );
        if (s.delivery_days)
          lines.push(
            "     Required Delivery: " + s.delivery_days + " days ARO",
          );
        if (s.ext > 0)
          lines.push("     Est. Gov. Value: $" + s.ext.toLocaleString());
        return lines.join("\n");
      })
      .join("\n\n");

    return [
      "Subject: RFQ \u2013 " +
        fscName +
        " | Government Requirement | Imperio Federal Logistics",
      "",
      "Hi " + dist.name + ",",
      "",
      "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.",
      "",
      "I need pricing and availability on the following item" +
        (sols.length > 1 ? "s" : "") +
        ":",
      "",
      items,
      "",
      "Requirements:",
      "- Destination: Government delivery address (continental US)",
      "- Payment: Immediate PO upon award \u2014 we use third-party PO funding (Factoring Express). Supplier receives direct wire payment before shipment.",
      "- Compliance: BAA/TAA required \u2014 please confirm country of origin on all items",
      "- Shipping: FOB Destination required",
      "- Condition: New/unused only. No substitutions without prior approval.",
      "",
      "Please provide unit price, lead time, and confirm country of origin. We issue POs immediately upon award.",
      "",
      "Thank you,",
      "",
      /*"Anthony K Kelley | Founder & CEO",
      "Imperio Federal Logistics",
      "The House of Kel LLC \u00b7 CAGE 152U4",
      "SDVOSB | VetHUB",
      "anthony@ifedlog.com | ifedlog.com",
      "(254) 226-5216",*/
    ].join("\n");
  }

  // ── Blast log ────────────────────────────────────────────────────────
  const BLAST_LOG_KEY = "imperio_blast_log_v1";
  function loadBlastLog() {
    try {
      return JSON.parse(localStorage.getItem(BLAST_LOG_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveBlastLog(log) {
    localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(log));
  }
  function addBlastEntry(e) {
    const log = loadBlastLog();
    log.unshift({ ...e, id: Date.now(), sent_at: new Date().toISOString() });
    saveBlastLog(log.slice(0, 500));
  }
  function updateBlastEntry(id, updates) {
    const log = loadBlastLog();
    const i = log.findIndex((e) => e.id === id);
    if (i < 0) return;
    log[i] = { ...log[i], ...updates };
    saveBlastLog(log);
  }

  // ── Styles ───────────────────────────────────────────────────────────
  const S = {
    page: { animation: "fadeUp .5s ease both" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "20px",
      flexWrap: "wrap",
      gap: "12px",
    },
    title: {
      fontFamily: "Cinzel,serif",
      fontSize: "18px",
      letterSpacing: ".12em",
      color: "var(--gold-solid,#C9A84C)",
      textTransform: "uppercase",
    },
    sub: {
      fontFamily: "Cormorant Garamond,serif",
      fontSize: "13px",
      fontStyle: "italic",
      color: "var(--body-dim,rgba(245,240,232,.45))",
      marginTop: "4px",
    },
    card: {
      background: "var(--card-bg,rgba(42,0,10,.55))",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "4px",
      padding: "18px 20px",
      marginBottom: "14px",
    },
    cardTitle: {
      fontFamily: "Cinzel,serif",
      fontSize: "11px",
      letterSpacing: ".14em",
      color: "var(--gold-solid,#C9A84C)",
      textTransform: "uppercase",
      marginBottom: "10px",
    },
    textarea: {
      width: "100%",
      minHeight: "120px",
      background: "var(--inset-bg,rgba(0,0,0,.35))",
      border: "1px solid rgba(201,168,76,.2)",
      color: "var(--alabaster,#F5F0E8)",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "11px",
      padding: "10px 12px",
      borderRadius: "3px",
      outline: "none",
      resize: "vertical",
      boxSizing: "border-box",
    },
    btn: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      letterSpacing: ".08em",
      padding: "8px 18px",
      border: "1px solid rgba(201,168,76,.4)",
      background: "transparent",
      color: "var(--gold-solid,#C9A84C)",
      cursor: "pointer",
      borderRadius: "3px",
      textTransform: "uppercase",
    },
    btnPrimary: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      letterSpacing: ".08em",
      padding: "8px 18px",
      border: "none",
      background: "linear-gradient(135deg,#8a5c00,#c9930a,#7a5000)",
      color: "#111",
      cursor: "pointer",
      borderRadius: "3px",
      textTransform: "uppercase",
      fontWeight: "700",
    },
    btnDanger: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      padding: "6px 14px",
      border: "1px solid rgba(231,76,60,.3)",
      background: "transparent",
      color: "rgba(231,76,60,.7)",
      cursor: "pointer",
      borderRadius: "3px",
    },
    btnSm: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      padding: "4px 10px",
      border: "1px solid rgba(201,168,76,.25)",
      background: "transparent",
      color: "rgba(245,240,232,.6)",
      cursor: "pointer",
      borderRadius: "3px",
    },
    badge: (c) => ({
      display: "inline-block",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      padding: "2px 7px",
      borderRadius: "2px",
      background: c,
      color: "#111",
      fontWeight: "700",
    }),
    row: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
      flexWrap: "wrap",
    },
    dim: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      color: "var(--body-dim,rgba(245,240,232,.45))",
    },
    fscSection: {
      marginBottom: "20px",
      border: "1px solid rgba(201,168,76,.12)",
      borderRadius: "4px",
      overflow: "hidden",
    },
    fscHeader: {
      background: "rgba(201,168,76,.06)",
      padding: "10px 14px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid rgba(201,168,76,.1)",
      cursor: "pointer",
    },
    distCard: {
      padding: "12px 14px",
      borderBottom: "1px solid rgba(201,168,76,.07)",
      background: "var(--card-bg,rgba(42,0,10,.35))",
    },
    emailBox: {
      background: "rgba(0,0,0,.4)",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "3px",
      padding: "12px 14px",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      color: "rgba(245,240,232,.75)",
      whiteSpace: "pre-wrap",
      lineHeight: "1.65",
      maxHeight: "320px",
      overflowY: "auto",
      marginTop: "8px",
    },
  };

  // ── Quote Parser ─────────────────────────────────────────────────────
  function parseQuoteText(raw) {
    const t = raw.replace(/\r/g, "");
    const r = {
      part_number: null,
      qty: null,
      unit_price: null,
      lead_time: null,
      expires: null,
      coo: null,
      contact: null,
    };
    const pn = t.match(
      /part\s*(?:number|no\.?|#)?\s*[:\-|]?\s*([A-Z0-9][A-Z0-9\-\/\.]{2,})/i,
    );
    if (pn) r.part_number = pn[1].trim();
    const qty = t.match(
      /quant(?:ity)?\s*[:\-|]?\s*([\d,]+)\s*(ea|pcs?|each|units?|pc)?/i,
    );
    if (qty)
      r.qty =
        qty[1].replace(/,/g, "") + (qty[2] ? " " + qty[2].toUpperCase() : "");
    let price = t.match(
      /(?:price\s*(?:\(each\)|each|per\s*unit|unit)?|unit\s*price|each)\s*[:\-|]?\s*\$?\s*([\d,]+\.\d{2})/i,
    );
    if (!price) price = t.match(/\$\s*([\d,]+\.\d{2})/);
    if (price) r.unit_price = "$" + price[1].replace(/,/g, "");
    const lt = t.match(/lead\s*time\s*[:\-|]?\s*([^\n\r]{3,80})/i);
    if (lt) r.lead_time = lt[1].trim();
    const exp = t.match(
      /(?:expir(?:es?|ation)|valid(?:\s*until)?|quote\s*(?:expires?|valid))\s*[:\-|]?\s*([\d\/\-]{5,})/i,
    );
    if (exp) r.expires = exp[1].trim();
    const coo = t.match(
      /(?:country\s*of\s*origin|COO|made\s*in|origin)\s*[:\-|]?\s*([A-Za-z\s]{2,30})/i,
    );
    if (coo) r.coo = coo[1].trim();
    const con = t.match(
      /(?:contact|rep|from|sent\s*by|regards?|sincerely)[,:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/,
    );
    if (con) r.contact = con[1].trim();
    return r;
  }

  function QuoteParser({ entryId, savedNote, savedParsed, onUpdate }) {
    const [raw, setRaw] = useState(savedNote || "");
    const [parsed, setParsed] = useState(savedParsed || null);
    const [editing, setEditing] = useState(!savedParsed);

    function handleParse() {
      if (!raw.trim()) return;
      const result = parseQuoteText(raw);
      setParsed(result);
      setEditing(false);
      onUpdate(entryId, "quote_note", raw);
      onUpdate(entryId, "quote_parsed", result);
    }

    const lbl = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      color: "rgba(201,168,76,.6)",
      width: "110px",
      flexShrink: 0,
    };
    const val = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      color: "var(--alabaster,#F5F0E8)",
      flex: 1,
      borderBottom: "1px solid rgba(201,168,76,.07)",
      paddingBottom: "4px",
      marginBottom: "4px",
    };
    const miss = {
      ...val,
      color: "rgba(245,240,232,.25)",
      fontStyle: "italic",
    };

    function Field(label, value, warn) {
      return h(
        "div",
        {
          style: {
            display: "flex",
            gap: "8px",
            alignItems: "flex-start",
            marginBottom: "3px",
          },
        },
        h("span", { style: lbl }, label),
        value
          ? h(
              "span",
              { style: { ...val, ...(warn ? { color: "#e74c3c" } : {}) } },
              value,
            )
          : h("span", { style: miss }, "not found"),
      );
    }

    return h(
      "div",
      { style: { marginTop: "10px" } },
      editing &&
        h(
          "div",
          null,
          h("textarea", {
            style: { ...S.textarea, minHeight: "80px" },
            placeholder:
              "Paste supplier quote here \u2014 email, table, PDF text, any format...",
            value: raw,
            onChange: (e) => setRaw(e.target.value),
          }),
          h(
            "div",
            { style: { ...S.row, marginTop: "6px" } },
            h(
              "button",
              { style: S.btnPrimary, onClick: handleParse },
              "Parse Quote",
            ),
            parsed &&
              h(
                "button",
                { style: S.btnSm, onClick: () => setEditing(false) },
                "Cancel",
              ),
          ),
        ),
      !editing &&
        parsed &&
        h(
          "div",
          {
            style: {
              background: "rgba(0,0,0,.3)",
              border: "1px solid rgba(201,168,76,.15)",
              borderRadius: "3px",
              padding: "10px 14px",
              marginTop: "8px",
            },
          },
          h(
            "div",
            {
              style: {
                ...S.row,
                justifyContent: "space-between",
                marginBottom: "8px",
              },
            },
            h(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".12em",
                  color: "var(--gold-solid,#C9A84C)",
                  textTransform: "uppercase",
                },
              },
              "Quote Parsed",
            ),
            h(
              "button",
              { style: S.btnSm, onClick: () => setEditing(true) },
              "Edit",
            ),
          ),
          Field("Part #", parsed.part_number),
          Field("Qty", parsed.qty),
          Field("Unit Price", parsed.unit_price),
          Field("Lead Time", parsed.lead_time),
          Field("Expires", parsed.expires),
          Field(
            "COO",
            parsed.coo,
            parsed.coo &&
              (parsed.coo.toUpperCase().includes("CHINA") ||
                parsed.coo.toUpperCase().includes("TAIWAN")),
          ),
          Field("Contact", parsed.contact),
        ),
    );
  }

  // ── Push to Pipeline ─────────────────────────────────────────────────
  function PushToPipeline({ entry }) {
    const [dibbsRaw, setDibbsRaw] = useState("");
    const [preview, setPreview] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    function handlePreview() {
      setError("");
      if (!dibbsRaw.trim()) {
        setError("Paste the DIBBS listing first.");
        return;
      }
      const parser = window.SCC_PARSER;
      const math = window.SCC_MATH;
      if (!parser) {
        setError("Parser not loaded \u2014 refresh page.");
        return;
      }
      let parsed = parser.parseListing(dibbsRaw);
      if (parser.parseAIText) {
        const ai = parser.parseAIText(dibbsRaw);
        Object.entries(ai).forEach(([k, v]) => {
          if (v && !parsed[k]) parsed[k] = v;
        });
      }
      if (!parsed.sol_number && entry.sol_ids && entry.sol_ids[0])
        parsed.sol_number = entry.sol_ids[0];
      if (!parsed.item_name && entry.sol_noms && entry.sol_noms[0])
        parsed.item_name = entry.sol_noms[0];
      if (parsed.unit_price && parsed.quote_due && math) {
        const pricing = math.calcPricing(
          parsed.unit_price,
          parsed.quote_due,
          parsed.posted_date,
        );
        parsed = { ...parsed, ...pricing };
      }
      const qp = entry.quote_parsed || {};
      const merged = {
        ...parsed,
        status: "Sourced",
        date_added: new Date().toLocaleDateString(),
        notes: "Sourced via Blast Engine \u2014 " + (entry.dist_name || ""),
        supplier_poc: qp.contact || entry.dist_name || "",
        supplier_website: entry.dist_website || "",
        supplier_phone: entry.dist_phone || "",
        supplier_email: entry.dist_email || "",
        supplier_quote_price: qp.unit_price
          ? qp.unit_price.replace("$", "")
          : "",
        supplier_quote_date: new Date().toLocaleDateString(),
        supplier_quote_expires: qp.expires || "",
        supplier_lead_time: qp.lead_time || "",
        supplier_moq: "",
        ref_part_number: parsed.ref_part_number || qp.part_number || "",
      };
      setPreview(merged);
    }

    async function handleSave() {
      if (!preview) return;
      if (!preview.sol_number) {
        setError("Sol number missing.");
        return;
      }
      setSaving(true);
      try {
        await window.SCC_DB.dbSave(preview);
        setSaved(true);
        setPreview(null);
        setDibbsRaw("");
      } catch (e) {
        setError("Save failed: " + e.message);
      }
      setSaving(false);
    }

    const boxStyle = {
      marginTop: "14px",
      background: "rgba(0,0,0,.2)",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "3px",
      padding: "14px",
    };
    const lbl = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      color: "rgba(201,168,76,.6)",
      width: "130px",
      flexShrink: 0,
    };
    const val = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      color: "var(--alabaster,#F5F0E8)",
      flex: 1,
    };
    const miss = {
      ...val,
      color: "rgba(245,240,232,.25)",
      fontStyle: "italic",
    };

    function PField(label, value) {
      return h(
        "div",
        { style: { display: "flex", gap: "8px", marginBottom: "3px" } },
        h("span", { style: lbl }, label),
        value
          ? h("span", { style: val }, String(value))
          : h("span", { style: miss }, "not captured"),
      );
    }

    if (saved)
      return h(
        "div",
        {
          style: {
            marginTop: "12px",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "10px",
            color: "#2ecc71",
          },
        },
        "\u2713 Pushed to pipeline.",
      );

    return h(
      "div",
      { style: boxStyle },
      h(
        "div",
        {
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".12em",
            color: "var(--gold-solid,#C9A84C)",
            textTransform: "uppercase",
            marginBottom: "6px",
          },
        },
        "Complete & Push to Pipeline",
      ),
      h(
        "div",
        { style: { ...S.dim, marginBottom: "10px" } },
        "Paste DIBBS listing or Navigator row. Supplier quote data merges automatically.",
      ),
      !preview &&
        h(
          "div",
          null,
          h("textarea", {
            style: { ...S.textarea, minHeight: "80px" },
            placeholder: "Paste DIBBS listing or Navigator row...",
            value: dibbsRaw,
            onChange: (e) => setDibbsRaw(e.target.value),
          }),
          h(
            "div",
            { style: { ...S.row, marginTop: "8px" } },
            h(
              "button",
              { style: S.btnPrimary, onClick: handlePreview },
              "Preview Record",
            ),
          ),
          error &&
            h(
              "div",
              {
                style: {
                  color: "#e74c3c",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  marginTop: "6px",
                },
              },
              "\u26a0 " + error,
            ),
        ),
      preview &&
        h(
          "div",
          null,
          PField("Sol #", preview.sol_number),
          PField("Item", preview.item_name),
          PField("NSN", preview.nsn),
          PField("Part #", preview.ref_part_number),
          PField(
            "Qty",
            preview.quantity
              ? preview.quantity + " " + (preview.unit_of_issue || "")
              : null,
          ),
          PField(
            "Unit Price",
            preview.unit_price ? "$" + preview.unit_price : null,
          ),
          PField("Quote Due", preview.quote_due),
          PField("Ship To", preview.ship_to),
          h("div", {
            style: {
              height: "1px",
              background: "rgba(201,168,76,.1)",
              margin: "8px 0",
            },
          }),
          PField("Supplier", preview.supplier_poc),
          PField("Email", preview.supplier_email),
          PField(
            "Quote $",
            preview.supplier_quote_price
              ? "$" + preview.supplier_quote_price
              : null,
          ),
          PField("Lead Time", preview.supplier_lead_time),
          PField("Expires", preview.supplier_quote_expires),
          error &&
            h(
              "div",
              {
                style: {
                  color: "#e74c3c",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  marginBottom: "8px",
                },
              },
              "\u26a0 " + error,
            ),
          h(
            "div",
            { style: S.row },
            h(
              "button",
              {
                style: { ...S.btnPrimary, opacity: saving ? 0.6 : 1 },
                onClick: handleSave,
                disabled: saving,
              },
              saving ? "Saving..." : "\u2192 Push to Pipeline",
            ),
            h(
              "button",
              { style: S.btnSm, onClick: () => setPreview(null) },
              "Re-paste",
            ),
          ),
        ),
    );
  }

  // ── Blast session persistence ─────────────────────────────────────────
  const BLAST_SESSION_KEY = "imperio_blast_session_v1";
  function loadBlastSession() {
    try {
      return JSON.parse(localStorage.getItem(BLAST_SESSION_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveBlastSession(data) {
    try {
      localStorage.setItem(BLAST_SESSION_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  // ── Blast Tab ────────────────────────────────────────────────────────
  function BlastTab() {
    const _sess = loadBlastSession();
    const [solInput, setSolInput] = useState(_sess.solInput || "");
    const [dibbsInput, setDibbsInput] = useState(_sess.dibbsInput || "");
    const [dibbsInputB, setDibbsInputB] = useState(_sess.dibbsInputB || "");
    const [parsedSols, setParsedSols] = useState(_sess.parsedSols || []);
    const [parseError, setParseError] = useState("");
    const [enriched, setEnriched] = useState(_sess.enriched || false);
    const [fscGroups, setFscGroups] = useState({});
    const [loading, setLoading] = useState(false);
    const [loadingFsc, setLoadingFsc] = useState("");
    const [expandedFsc, setExpandedFsc] = useState({});
    const [expandedEmail, setExpandedEmail] = useState({});
    const [blastLog, setBlastLog] = useState(loadBlastLog());
    const [activeView, setActiveView] = useState("blast");
    const [copiedKey, setCopiedKey] = useState("");
    const [sentKeys, setSentKeys] = useState({});
    const [status, setStatus] = useState("");

    const refreshLog = () => setBlastLog(loadBlastLog());

    // Step 1: Parse sol lines
    const handleParse = useCallback(() => {
      setParseError("");
      const sols = parseSolLines(solInput);
      if (!sols.length) {
        setParseError(
          "No valid sol lines. Format: SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS",
        );
        return;
      }
      setParsedSols(sols);
      setEnriched(false);
      setFscGroups({});
      setStatus(
        sols.length +
          " sols parsed. " +
          Object.keys(groupByFsc(sols)).length +
          " lanes. Now paste DIBBS listings in Step 2.",
      );
      saveBlastSession({
        solInput,
        dibbsInput,
        dibbsInputB,
        parsedSols: sols,
        enriched: false,
      });
    }, [solInput]);

    // Step 2: Enrich sols from DIBBS paste
    const handleEnrich = useCallback(() => {
      if (!parsedSols.length) return;
      if (!dibbsInput.trim() && !dibbsInputB.trim()) {
        // Skip enrichment, proceed with base sol data
        setEnriched(true);
        setStatus(
          "Step 2 skipped \u2014 RFQ emails will not include part numbers. Proceed to Step 3.",
        );
        return;
      }
      const enrichedSols = enrichSolsFromDibbs(
        parsedSols,
        dibbsInput,
        dibbsInputB,
      );
      setParsedSols(enrichedSols);
      setEnriched(true);
      const enrichedCount = enrichedSols.filter(
        (s) => s.nsn || s.part_number,
      ).length;
      setStatus(
        "Enriched " +
          enrichedCount +
          " of " +
          enrichedSols.length +
          " sols with part data. Ready to load distributors.",
      );
      saveBlastSession({
        solInput,
        dibbsInput,
        dibbsInputB,
        parsedSols: enrichedSols,
        enriched: true,
      });
    }, [parsedSols, dibbsInput, dibbsInputB]);

    // Step 3: Load distributors by FSC
    const handleLoadDists = useCallback(async () => {
      if (!parsedSols.length) return;
      setLoading(true);
      setStatus("Loading distributors from DB...");
      const groups = groupByFsc(parsedSols);
      const result = {};
      for (const fsc of Object.keys(groups)) {
        setLoadingFsc(fsc);
        try {
          const raw = await apiCall("distGetByFSC", { fsc });
          const dists = Array.isArray(raw)
            ? raw
            : Array.isArray(raw.result)
              ? raw.result
              : [];
          result[fsc] = { sols: groups[fsc], dists };
        } catch (e) {
          result[fsc] = { sols: groups[fsc], dists: [], error: e.message };
        }
      }
      setFscGroups(result);
      setExpandedFsc(
        Object.fromEntries(Object.keys(result).map((f) => [f, true])),
      );
      setLoading(false);
      setLoadingFsc("");
      const total = Object.values(result).reduce(
        (s, g) => s + g.dists.length,
        0,
      );
      setStatus(
        "Loaded. " +
          Object.keys(result).length +
          " lanes \u00b7 " +
          total +
          " distributor contacts ready. Review emails in Step 4.",
      );
    }, [parsedSols]);

    const handleCopy = useCallback((key, text) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(""), 2000);
      });
    }, []);

    const handleMarkSent = useCallback((fsc, dist, sols) => {
      addBlastEntry({
        fsc,
        fsc_name: FSC_NAMES[fsc] || fsc,
        dist_id: dist.id,
        dist_name: dist.name,
        dist_email: dist.email || "",
        dist_website: dist.website || "",
        dist_phone: dist.phone || "",
        sol_ids: sols.map((s) => s.id),
        sol_noms: sols.map((s) => s.nom),
        email_body: buildRFQEmail(dist, sols),
        status: "sent",
        quoted: false,
        quote_note: "",
        quote_parsed: null,
      });
      refreshLog();
      setSentKeys((p) => ({
        ...p,
        [fsc + "-" + (dist.id || dist.name)]: true,
      }));
      setStatus(
        "Logged blast to " + dist.name + " \u00b7 " + sols.length + " sol(s).",
      );
    }, []);

    const handleLogUpdate = useCallback((id, field, value) => {
      updateBlastEntry(id, { [field]: value });
      refreshLog();
    }, []);

    const handleClearLog = useCallback(() => {
      if (!confirm("Clear entire blast log?")) return;
      saveBlastLog([]);
      refreshLog();
    }, []);

    return h(
      "div",
      { style: S.page },

      // Header
      h(
        "div",
        { style: S.header },
        h(
          "div",
          null,
          h("div", { style: S.title }, "\u26a1 Blast Engine"),
          h(
            "div",
            { style: S.sub },
            "Pre-pipeline sourcing \u00b7 FSC routing \u00b7 Distributor RFQ blast",
          ),
        ),
        h(
          "div",
          { style: S.row },
          h(
            "button",
            {
              style: {
                ...S.btn,
                ...(activeView === "blast"
                  ? {
                      borderColor: "rgba(201,168,76,.7)",
                      color: "var(--gold-solid,#C9A84C)",
                    }
                  : {}),
              },
              onClick: () => setActiveView("blast"),
            },
            "\u26a1 Blast",
          ),
          h(
            "button",
            {
              style: {
                ...S.btn,
                ...(activeView === "log"
                  ? {
                      borderColor: "rgba(201,168,76,.7)",
                      color: "var(--gold-solid,#C9A84C)",
                    }
                  : {}),
              },
              onClick: () => {
                setActiveView("log");
                refreshLog();
              },
            },
            "\ud83d\udccb Blast Log (" + blastLog.length + ")",
          ),
        ),
      ),

      // Status bar
      status &&
        h(
          "div",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: "#2ecc71",
              background: "rgba(46,204,113,.08)",
              border: "1px solid rgba(46,204,113,.2)",
              borderRadius: "3px",
              padding: "7px 12px",
              marginBottom: "14px",
            },
          },
          "\u25b6 " + status,
        ),

      // ── BLAST VIEW ──
      activeView === "blast" &&
        h(
          Frag,
          null,

          // ── STEP 1: Sol Lines ──
          h(
            "div",
            { style: S.card },
            h(
              "div",
              { style: S.cardTitle },
              "Step 1 \u2014 Paste Surviving Sols",
            ),
            h(
              "div",
              { style: { ...S.dim, marginBottom: "8px" } },
              "Format: SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS \u2014 one per line.",
            ),
            h("textarea", {
              style: S.textarea,
              value: solInput,
              onChange: (e) => setSolInput(e.target.value),
              placeholder:
                "SPE4A7-26-R-0001 | BACKSHELL ELECTRICAL | 2026-06-15 | 5935 | 44450.00 | GO",
            }),
            parseError &&
              h(
                "div",
                {
                  style: {
                    color: "#e74c3c",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "10px",
                    marginTop: "6px",
                  },
                },
                "\u26a0 " + parseError,
              ),
            h(
              "div",
              { style: { ...S.row, marginTop: "10px" } },
              h(
                "button",
                { style: S.btnPrimary, onClick: handleParse },
                "Parse Sols",
              ),
              parsedSols.length > 0 &&
                h(
                  "span",
                  { style: S.dim },
                  parsedSols.length +
                    " sols \u00b7 " +
                    Object.keys(groupByFsc(parsedSols)).length +
                    " lanes",
                ),
              parsedSols.length > 0 &&
                h(
                  "button",
                  {
                    style: S.btnDanger,
                    onClick: () => {
                      setParsedSols([]);
                      setFscGroups({});
                      setSolInput("");
                      setDibbsInput("");
                      setDibbsInputB("");
                      setEnriched(false);
                      setStatus("");
                      saveBlastSession({});
                    },
                  },
                  "Clear All",
                ),
            ),
          ),

          // ── STEP 2: DIBBS Paste — Box A + Box B (same as Intake) ──
          parsedSols.length > 0 &&
            h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.cardTitle },
                "Step 2 \u2014 Enrich with DIBBS Data",
              ),
              h(
                "div",
                { style: { ...S.dim, marginBottom: "12px" } },
                "Same as Intake: Box A = DIBBS PDF text, Box B = Navigator row. Use what you have. Both optional.",
              ),
              h(
                "div",
                {
                  style: {
                    ...S.dim,
                    marginBottom: "4px",
                    fontSize: "9px",
                    letterSpacing: ".06em",
                  },
                },
                "BOX A \u2014 DIBBS LISTING / PDF TEXT",
              ),
              h("textarea", {
                style: {
                  ...S.textarea,
                  minHeight: "100px",
                  marginBottom: "10px",
                },
                value: dibbsInput,
                onChange: (e) => setDibbsInput(e.target.value),
                placeholder: "Paste DIBBS PDF listing text here...",
              }),
              h(
                "div",
                {
                  style: {
                    ...S.dim,
                    marginBottom: "4px",
                    fontSize: "9px",
                    letterSpacing: ".06em",
                  },
                },
                "BOX B \u2014 NAVIGATOR ROW / AI COLUMN",
              ),
              h("textarea", {
                style: {
                  ...S.textarea,
                  minHeight: "60px",
                  marginBottom: "10px",
                },
                value: dibbsInputB,
                onChange: (e) => setDibbsInputB(e.target.value),
                placeholder: "JOSLYN SUNBANK COMPANY, LLC|07418|J1432|",
              }),
              h(
                "div",
                { style: { ...S.row, marginTop: "4px" } },
                h(
                  "button",
                  { style: S.btnPrimary, onClick: handleEnrich },
                  enriched ? "\u2713 Enriched \u2014 Re-run" : "Enrich Sols",
                ),
                enriched &&
                  h(
                    "span",
                    { style: { ...S.dim, color: "#2ecc71" } },
                    "\u2713 Part data loaded",
                  ),
                h(
                  "button",
                  {
                    style: { ...S.btnSm, opacity: enriched ? 1 : 0.5 },
                    onClick: () => {
                      setEnriched(true);
                      setStatus("Skipped enrichment.");
                      saveBlastSession({
                        solInput,
                        dibbsInput,
                        dibbsInputB,
                        parsedSols,
                        enriched: true,
                      });
                    },
                  },
                  "Skip \u2014 no part data",
                ),
              ),
            ),

          // ── STEP 3: Load Distributors ──
          parsedSols.length > 0 &&
            enriched &&
            h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.cardTitle },
                "Step 3 \u2014 Load Distributor Blast Groups",
              ),
              h(
                "div",
                { style: { ...S.dim, marginBottom: "10px" } },
                "Pulls every distributor mapped to each FSC lane from MongoDB.",
              ),
              h(
                "button",
                {
                  style: { ...S.btnPrimary, opacity: loading ? 0.6 : 1 },
                  onClick: handleLoadDists,
                  disabled: loading,
                },
                loading
                  ? "Loading " + loadingFsc + "..."
                  : "Load Distributors by FSC",
              ),
            ),

          // ── STEP 4: Review & Fire RFQs ──
          Object.keys(fscGroups).length > 0 &&
            h(
              "div",
              null,
              h(
                "div",
                { style: { ...S.cardTitle, marginBottom: "12px" } },
                "Step 4 \u2014 Review & Fire RFQs",
              ),

              Object.keys(fscGroups)
                .sort()
                .map((fsc) => {
                  const { sols, dists, error } = fscGroups[fsc];
                  const isOpen = expandedFsc[fsc] !== false;
                  const totalExt = sols.reduce((s, d) => s + d.ext, 0);

                  return h(
                    "div",
                    { key: fsc, style: S.fscSection },

                    h(
                      "div",
                      {
                        style: S.fscHeader,
                        onClick: () =>
                          setExpandedFsc((p) => ({ ...p, [fsc]: !isOpen })),
                      },
                      h(
                        "div",
                        { style: S.row },
                        h(
                          "span",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "11px",
                              color: "var(--gold-solid,#C9A84C)",
                              letterSpacing: ".1em",
                            },
                          },
                          "FSC " + fsc + " \u2014 " + (FSC_NAMES[fsc] || fsc),
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(201,168,76,.15)") },
                          sols.length + " sol" + (sols.length !== 1 ? "s" : ""),
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(46,204,113,.12)") },
                          "$" + totalExt.toLocaleString(),
                        ),
                        dists.length > 0 &&
                          h(
                            "span",
                            { style: S.badge("rgba(52,152,219,.15)") },
                            dists.length +
                              " dist" +
                              (dists.length !== 1 ? "s" : ""),
                          ),
                        error &&
                          h(
                            "span",
                            {
                              style: {
                                color: "#e74c3c",
                                fontSize: "10px",
                                fontFamily: "JetBrains Mono,monospace",
                              },
                            },
                            "\u26a0 " + error,
                          ),
                      ),
                      h(
                        "span",
                        { style: { color: "rgba(201,168,76,.5)" } },
                        isOpen ? "\u25b2" : "\u25bc",
                      ),
                    ),

                    isOpen &&
                      h(
                        "div",
                        null,

                        // Sol list with enriched data
                        h(
                          "div",
                          {
                            style: {
                              padding: "10px 14px",
                              background: "rgba(0,0,0,.2)",
                              borderBottom: "1px solid rgba(201,168,76,.07)",
                            },
                          },
                          h(
                            "div",
                            { style: { ...S.dim, marginBottom: "6px" } },
                            "SOLICITATIONS IN THIS LANE:",
                          ),
                          sols.map((sol) =>
                            h(
                              "div",
                              { key: sol.id, style: { marginBottom: "8px" } },
                              h(
                                "div",
                                { style: S.row },
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "var(--gold-solid,#C9A84C)",
                                      minWidth: "160px",
                                    },
                                  },
                                  sol.id,
                                ),
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(245,240,232,.75)",
                                      flex: 1,
                                    },
                                  },
                                  sol.nom,
                                ),
                                sol.ext > 0 &&
                                  h(
                                    "span",
                                    {
                                      style: {
                                        fontFamily: "JetBrains Mono,monospace",
                                        fontSize: "10px",
                                        color: "#2ecc71",
                                      },
                                    },
                                    "$" + sol.ext.toLocaleString(),
                                  ),
                              ),
                              (sol.nsn || sol.part_number || sol.qty) &&
                                h(
                                  "div",
                                  {
                                    style: {
                                      ...S.dim,
                                      paddingLeft: "160px",
                                      marginTop: "2px",
                                    },
                                  },
                                  [
                                    sol.nsn && "NSN: " + sol.nsn,
                                    sol.part_number &&
                                      "P/N: " + sol.part_number,
                                    sol.qty &&
                                      "Qty: " +
                                        sol.qty +
                                        (sol.unit_of_issue
                                          ? " " + sol.unit_of_issue
                                          : ""),
                                    sol.delivery_days &&
                                      "Del: " + sol.delivery_days + " days",
                                  ]
                                    .filter(Boolean)
                                    .join(" \u00b7 "),
                                ),
                            ),
                          ),
                        ),

                        dists.length === 0 &&
                          h(
                            "div",
                            {
                              style: {
                                padding: "16px 14px",
                                color: "rgba(231,76,60,.7)",
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "10px",
                              },
                            },
                            "\u26a0 No distributors loaded for FSC " +
                              fsc +
                              ".",
                          ),

                        dists.map((dist) => {
                          const ek = fsc + "-" + (dist.id || dist.name);
                          const emailText = buildRFQEmail(dist, sols);
                          const isEmailOpen = expandedEmail[ek];
                          const isCopied = copiedKey === ek;
                          const tierStr =
                            typeof dist.tier === "number"
                              ? "L" + dist.tier
                              : dist.tier || "L2";
                          const tierColor =
                            tierStr === "L1"
                              ? "rgba(201,168,76,.3)"
                              : tierStr === "L3"
                                ? "rgba(231,76,60,.2)"
                                : "rgba(52,152,219,.2)";
                          const website = dist.website || "";
                          const websiteHref = website.startsWith("http")
                            ? website
                            : website
                              ? "https://" + website
                              : "";

                          return h(
                            "div",
                            { key: ek, style: S.distCard },
                            h(
                              "div",
                              { style: { ...S.row, marginBottom: "8px" } },
                              h(
                                "span",
                                {
                                  style: {
                                    fontFamily: "JetBrains Mono,monospace",
                                    fontSize: "11px",
                                    color: "var(--alabaster,#F5F0E8)",
                                    fontWeight: "700",
                                    flex: 1,
                                  },
                                },
                                dist.name,
                              ),
                              h("span", { style: S.badge(tierColor) }, tierStr),
                            ),
                            h(
                              "div",
                              {
                                style: {
                                  ...S.row,
                                  marginBottom: "8px",
                                  gap: "16px",
                                },
                              },
                              website &&
                                h(
                                  "a",
                                  {
                                    href: websiteHref,
                                    target: "_blank",
                                    rel: "noopener",
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(52,152,219,.8)",
                                      textDecoration: "none",
                                    },
                                  },
                                  website
                                    .replace("https://", "")
                                    .replace("http://", ""),
                                ),
                              dist.email &&
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(245,240,232,.5)",
                                    },
                                  },
                                  dist.email,
                                ),
                              dist.phone &&
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(245,240,232,.5)",
                                    },
                                  },
                                  dist.phone,
                                ),
                            ),
                            dist.products &&
                              h(
                                "div",
                                {
                                  style: {
                                    ...S.dim,
                                    marginBottom: "8px",
                                    fontStyle: "italic",
                                  },
                                },
                                dist.products,
                              ),

                            h(
                              "div",
                              { style: S.row },
                              h(
                                "button",
                                {
                                  style: S.btnSm,
                                  onClick: () =>
                                    setExpandedEmail((p) => ({
                                      ...p,
                                      [ek]: !isEmailOpen,
                                    })),
                                },
                                isEmailOpen
                                  ? "Hide Email"
                                  : "Preview RFQ Email",
                              ),
                              dist.email &&
                                h(
                                  "a",
                                  {
                                    href:
                                      "https://mail.google.com/mail/?view=cm&to=" +
                                      encodeURIComponent(dist.email) +
                                      "&su=" +
                                      encodeURIComponent(
                                        "RFQ \u2013 " +
                                          (FSC_NAMES[fsc] || fsc) +
                                          " | Government Requirement | Imperio Federal Logistics",
                                      ) +
                                      "&body=" +
                                      encodeURIComponent(emailText),
                                    target: "_blank",
                                    rel: "noopener",
                                    style: {
                                      ...S.btn,
                                      textDecoration: "none",
                                      fontSize: "9px",
                                      padding: "4px 12px",
                                    },
                                  },
                                  "\u2709 Open in Gmail",
                                ),
                              h(
                                "button",
                                {
                                  style: {
                                    ...S.btnSm,
                                    ...(isCopied
                                      ? {
                                          color: "#2ecc71",
                                          borderColor: "rgba(46,204,113,.4)",
                                        }
                                      : {}),
                                  },
                                  onClick: () => handleCopy(ek, emailText),
                                },
                                isCopied ? "\u2713 Copied" : "Copy Email",
                              ),
                              h(
                                "button",
                                {
                                  style: {
                                    ...S.btnSm,
                                    ...(sentKeys[ek]
                                      ? {
                                          color: "#2ecc71",
                                          borderColor: "rgba(46,204,113,.5)",
                                          cursor: "default",
                                        }
                                      : {}),
                                  },
                                  onClick: () => {
                                    if (
                                      !sentKeys[ek] &&
                                      confirm(
                                        "Mark RFQ to " +
                                          dist.name +
                                          " as sent?",
                                      )
                                    )
                                      handleMarkSent(fsc, dist, sols);
                                  },
                                },
                                sentKeys[ek] ? "\u2713 Sent" : "Mark Sent",
                              ),
                            ),

                            isEmailOpen &&
                              h("div", { style: S.emailBox }, emailText),
                          );
                        }),
                      ),
                  );
                }),
            ),
        ),

      // ── BLAST LOG VIEW ──
      activeView === "log" &&
        h(
          "div",
          null,
          h(
            "div",
            { style: { ...S.row, marginBottom: "14px" } },
            h(
              "div",
              { style: { ...S.cardTitle, margin: 0 } },
              "Blast Log \u2014 " + blastLog.length + " entries",
            ),
            blastLog.length > 0 &&
              h(
                "button",
                { style: S.btnDanger, onClick: handleClearLog },
                "Clear Log",
              ),
          ),

          blastLog.length === 0 &&
            h(
              "div",
              { style: { ...S.dim, padding: "24px 0", textAlign: "center" } },
              "No blasts logged yet.",
            ),

          blastLog.map((entry) =>
            h(
              "div",
              { key: entry.id, style: { ...S.card, padding: "12px 16px" } },

              h(
                "div",
                { style: { ...S.row, marginBottom: "8px" } },
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "11px",
                      color: "var(--alabaster,#F5F0E8)",
                      fontWeight: "700",
                    },
                  },
                  entry.dist_name,
                ),
                h(
                  "span",
                  { style: S.badge("rgba(52,152,219,.2)") },
                  "FSC " + entry.fsc,
                ),
                h(
                  "span",
                  {
                    style: S.badge(
                      entry.quoted
                        ? "rgba(46,204,113,.25)"
                        : "rgba(201,168,76,.15)",
                    ),
                  },
                  entry.quoted ? "QUOTED \u2713" : "AWAITING",
                ),
                h(
                  "span",
                  { style: S.dim },
                  new Date(entry.sent_at).toLocaleDateString(),
                ),
              ),

              h(
                "div",
                { style: { ...S.dim, marginBottom: "6px" } },
                "Sols: " + (entry.sol_ids || []).join(", "),
              ),
              entry.dist_email &&
                h(
                  "div",
                  { style: { ...S.dim, marginBottom: "8px" } },
                  "\u2192 " + entry.dist_email,
                ),

              h(
                "div",
                { style: S.row },
                h(
                  "button",
                  {
                    style: {
                      ...S.btnSm,
                      ...(entry.quoted
                        ? {
                            color: "rgba(46,204,113,.8)",
                            borderColor: "rgba(46,204,113,.4)",
                          }
                        : {}),
                    },
                    onClick: () =>
                      handleLogUpdate(entry.id, "quoted", !entry.quoted),
                  },
                  entry.quoted ? "\u2713 Quoted" : "Mark Quoted",
                ),
              ),

              entry.quoted &&
                h(QuoteParser, {
                  entryId: entry.id,
                  savedNote: entry.quote_note || "",
                  savedParsed: entry.quote_parsed || null,
                  onUpdate: handleLogUpdate,
                }),

              entry.quoted && h(PushToPipeline, { entry: entry }),
            ),
          ),
        ),
    );
  }

  // ── Expose ───────────────────────────────────────────────────────────
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.BlastTab = BlastTab;
})();
