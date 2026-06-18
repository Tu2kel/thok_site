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
  const FSC_NAMES = window.SCC_CONSTANTS.FSC_NAMES;

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
        const rawDue = s.quote_due || "";
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
      "Quick Note: I sent you an email from anthony@ifedlog.com — we went through a company restructure and transitioned to a new email. If you didn't see it, it may be in your spam folder.",
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
      "Anthony K Kelley | Founder & CEO",
      "Imperio Federal Logistics",
      "The House of Kel LLC \u00b7 CAGE 152U4",
      "SDVOSB | VetHUB",
      "anthony@ifedlog.com | ifedlog.com",
      "(254) 226-5216",
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
  function deleteBlastEntry(id) {
    const log = loadBlastLog();
    saveBlastLog(log.filter((e) => e.id !== id));
  }

  // ── Blast state persistence ─────────────────────────────────────────
  const BLAST_STATE_KEY = "imperio_blast_state_v1";
  function loadBlastState() {
    try {
      return JSON.parse(localStorage.getItem(BLAST_STATE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function saveBlastState(state) {
    try {
      localStorage.setItem(BLAST_STATE_KEY, JSON.stringify(state));
    } catch (e) {}
  }
  function clearBlastState() {
    localStorage.removeItem(BLAST_STATE_KEY);
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

  // ── Blast Tab ────────────────────────────────────────────────────────
  function BlastTab() {
    const _s = loadBlastState() || {};
    const [solInput, setSolInput] = useState(_s.solInput || "");
    const [dibbsInput, setDibbsInput] = useState(_s.dibbsInput || "");
    const [dibbsInputB, setDibbsInputB] = useState(_s.dibbsInputB || "");
    const [parsedSols, setParsedSols] = useState(_s.parsedSols || []);
    const [parseError, setParseError] = useState("");
    const [enriched, setEnriched] = useState(_s.enriched || false);
    const [fscGroups, setFscGroups] = useState(_s.fscGroups || {});
    const [loading, setLoading] = useState(false);
    const [loadingFsc, setLoadingFsc] = useState("");
    const [expandedFsc, setExpandedFsc] = useState(_s.expandedFsc || {});
    const [expandedEmail, setExpandedEmail] = useState({});
    const [blastLog, setBlastLog] = useState(loadBlastLog());
    const [activeView, setActiveView] = useState("blast");
    const [logSearch, setLogSearch] = useState("");
    const [copiedKey, setCopiedKey] = useState("");
    const [status, setStatus] = useState(_s.status || "");
    const [emailOverrides, setEmailOverrides] = useState({});
    const [editingEmailKey, setEditingEmailKey] = useState("");
    const [editingLogId, setEditingLogId] = useState(null);
    const [editDraft, setEditDraft] = useState({});

    // Persist blast state on every meaningful change
    const { useEffect, useRef } = React;
    const _persistTimer = useRef(null);
    useEffect(() => {
      if (_persistTimer.current) clearTimeout(_persistTimer.current);
      _persistTimer.current = setTimeout(() => {
        saveBlastState({
          solInput,
          dibbsInput,
          dibbsInputB,
          parsedSols,
          enriched,
          fscGroups,
          expandedFsc,
          status,
        });
      }, 300);
    });

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
        sol_pns: sols.map((s) => s.part_number || s.ref_part_number || ""),
        email_body: buildRFQEmail(dist, sols),
        status: "sent",
        quoted: false,
        quote_note: "",
        quote_parsed: null,
      });
      refreshLog();
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

    const handleDeleteEntry = useCallback((id, label) => {
      if (!confirm('Remove "' + label + '" from blast log?')) return;
      deleteBlastEntry(id);
      refreshLog();
    }, []);

    const handleEditOpen = useCallback((entry) => {
      setEditDraft({
        sol_ids: (entry.sol_ids || []).join(", "),
        sol_noms: (entry.sol_noms || []).join(", "),
        sol_pns: (entry.sol_pns || []).join(", "),
        dist_name: entry.dist_name || "",
        dist_email: entry.dist_email || "",
        dist_phone: entry.dist_phone || "",
        fsc: entry.fsc || "",
      });
      setEditingLogId(entry.id);
    }, []);

    const handleEditSave = useCallback(() => {
      if (!editingLogId) return;
      updateBlastEntry(editingLogId, {
        sol_ids: editDraft.sol_ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        sol_noms: editDraft.sol_noms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        sol_pns: editDraft.sol_pns
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        dist_name: editDraft.dist_name.trim(),
        dist_email: editDraft.dist_email.trim(),
        dist_phone: editDraft.dist_phone.trim(),
        fsc: editDraft.fsc.trim(),
      });
      refreshLog();
      setEditingLogId(null);
      setEditDraft({});
    }, [editingLogId, editDraft]);

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
                      clearBlastState();
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

              (() => {
                // Pivot fscGroups → distMap: one entry per company, all FSCs + sols combined
                const distMap = new Map();
                for (const fsc of Object.keys(fscGroups)) {
                  const { sols, dists } = fscGroups[fsc];
                  for (const d of (dists || [])) {
                    const key = d.id || d.name;
                    if (!distMap.has(key)) distMap.set(key, { dist: d, sols: [], fscs: [] });
                    const entry = distMap.get(key);
                    if (!entry.fscs.includes(fsc)) entry.fscs.push(fsc);
                    for (const sol of sols) {
                      const sid = sol.id || sol.sol_number;
                      if (!entry.sols.find(function(s){ return (s.id || s.sol_number) === sid; }))
                        entry.sols.push(sol);
                    }
                  }
                }
                return Array.from(distMap.values())
                  .sort(function(a,b){ return (a.dist.name||"").localeCompare(b.dist.name||""); })
                  .map(function(entry) {
                  const dist = entry.dist;
                  const sols = entry.sols;
                  const fscs = entry.fscs.slice().sort();
                  const fsc  = fscs[0] || "";
                  const isOpen = expandedFsc[dist.id || dist.name] !== false;
                  const totalExt = sols.reduce((s, d) => s + d.ext, 0);

                  const distCardKey = dist.id || dist.name;
                  return h(
                    "div",
                    { key: distCardKey, style: S.fscSection },

                    h(
                      "div",
                      {
                        style: S.fscHeader,
                        onClick: () =>
                          setExpandedFsc((p) => ({ ...p, [distCardKey]: !isOpen })),
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
                          dist.name,
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(201,168,76,.15)") },
                          "FSC " + fscs.join(", "),
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(46,204,113,.12)") },
                          sols.length + " sol" + (sols.length !== 1 ? "s" : ""),
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(46,204,113,.12)") },
                          "$" + totalExt.toLocaleString(),
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

                        (() => {
                          const ek = fscs.join("-") + "-" + distCardKey;
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
                              (() => {
                                const displayEmail =
                                  emailOverrides[ek] !== undefined
                                    ? emailOverrides[ek]
                                    : dist.email || "";
                                return displayEmail
                                  ? h(
                                      "span",
                                      {
                                        style: {
                                          fontFamily:
                                            "JetBrains Mono,monospace",
                                          fontSize: "10px",
                                          color:
                                            emailOverrides[ek] !== undefined
                                              ? "#1eb4ff"
                                              : "rgba(245,240,232,.5)",
                                        },
                                      },
                                      displayEmail,
                                    )
                                  : null;
                              })(),
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

                            editingEmailKey === ek &&
                              h(
                                "div",
                                { style: { ...S.row, marginBottom: "8px" } },
                                h("input", {
                                  id: "email-edit-" + ek,
                                  defaultValue:
                                    emailOverrides[ek] !== undefined
                                      ? emailOverrides[ek]
                                      : dist.email || "",
                                  placeholder: "enter email address...",
                                  style: {
                                    flex: 1,
                                    background:
                                      "var(--inset-bg,rgba(0,0,0,.35))",
                                    border: "1px solid rgba(201,168,76,.4)",
                                    color: "var(--alabaster,#F5F0E8)",
                                    fontFamily: "JetBrains Mono,monospace",
                                    fontSize: "11px",
                                    outline: "none",
                                    padding: "5px 10px",
                                    borderRadius: "3px",
                                  },
                                }),
                                h(
                                  "button",
                                  {
                                    style: {
                                      ...S.btnSm,
                                      color: "#2ecc71",
                                      borderColor: "rgba(46,204,113,.4)",
                                    },
                                    onClick: () => {
                                      const val = document
                                        .getElementById("email-edit-" + ek)
                                        .value.trim();
                                      setEmailOverrides((p) => ({
                                        ...p,
                                        [ek]: val,
                                      }));
                                      setEditingEmailKey("");
                                    },
                                  },
                                  "Save",
                                ),
                                h(
                                  "button",
                                  {
                                    style: S.btnSm,
                                    onClick: () => setEditingEmailKey(""),
                                  },
                                  "Cancel",
                                ),
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
                              h(
                                "button",
                                {
                                  style: {
                                    ...S.btnSm,
                                    ...(editingEmailKey === ek
                                      ? {
                                          color: "#c9a84c",
                                          borderColor: "rgba(201,168,76,.5)",
                                        }
                                      : {}),
                                  },
                                  onClick: () =>
                                    setEditingEmailKey((p) =>
                                      p === ek ? "" : ek,
                                    ),
                                },
                                "Edit Email",
                              ),
                              (() => {
                                const effectiveEmail =
                                  emailOverrides[ek] !== undefined
                                    ? emailOverrides[ek]
                                    : dist.email || "";
                                return effectiveEmail
                                  ? h(
                                      "a",
                                      {
                                        href:
                                          "https://mail.google.com/mail/?view=cm&to=" +
                                          encodeURIComponent(effectiveEmail) +
                                          "&su=" +
                                          encodeURIComponent(
                                            "RFQ \u2013 FSC " +
                                              fscs.join("/") +
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
                                    )
                                  : null;
                              })(),
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
                                  style: S.btnSm,
                                  onClick: () => {
                                    const effectiveEmail =
                                      emailOverrides[ek] !== undefined
                                        ? emailOverrides[ek]
                                        : dist.email || "";
                                    const distWithEmail = {
                                      ...dist,
                                      email: effectiveEmail,
                                    };
                                    if (
                                      confirm(
                                        "Mark RFQ to " +
                                          dist.name +
                                          " as sent?",
                                      )
                                    )
                                      handleMarkSent(fscs.join(","), distWithEmail, sols);
                                  },
                                },
                                "Mark Sent",
                              ),
                            ),

                            isEmailOpen &&
                              h("div", { style: S.emailBox }, emailText),
                          );
                        })(),
                      ),
                  );
                });
              })(),
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

          blastLog.length > 0 &&
            h("input", {
              value: logSearch,
              onChange: (e) => setLogSearch(e.target.value),
              placeholder: "Search distributor, P/N, or item name\u2026",
              style: {
                width: "100%",
                padding: "7px 12px",
                marginBottom: "14px",
                background: "var(--inset-bg,rgba(0,0,0,.35))",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--alabaster,#F5F0E8)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "11px",
                outline: "none",
                borderRadius: "3px",
                boxSizing: "border-box",
              },
            }),

          blastLog.length === 0 &&
            h(
              "div",
              { style: { ...S.dim, padding: "24px 0", textAlign: "center" } },
              "No blasts logged yet.",
            ),

          blastLog
            .filter((entry) => {
              if (!logSearch.trim()) return true;
              const q = logSearch.toLowerCase();
              return (
                (entry.dist_name || "").toLowerCase().includes(q) ||
                (entry.sol_pns || []).some((p) =>
                  p.toLowerCase().includes(q),
                ) ||
                (entry.sol_noms || []).some((n) => n.toLowerCase().includes(q))
              );
            })
            .map((entry) =>
              h(
                "div",
                { key: entry.id, style: { ...S.card, padding: "12px 16px" } },

                // ── Edit modal (inline, shown when this entry is being edited) ──
                editingLogId === entry.id &&
                  h(
                    "div",
                    {
                      style: {
                        background: "rgba(0,0,0,.45)",
                        border: "1px solid rgba(201,168,76,.35)",
                        borderRadius: "4px",
                        padding: "14px",
                        marginBottom: "12px",
                      },
                    },
                    h(
                      "div",
                      {
                        style: {
                          ...S.cardTitle,
                          marginBottom: "10px",
                          color: "var(--gold-solid,#C9A84C)",
                        },
                      },
                      "Edit Entry",
                    ),
                    ...[
                      ["Sol IDs (comma-separated)", "sol_ids"],
                      ["Item Names (comma-separated)", "sol_noms"],
                      ["Part Numbers (comma-separated)", "sol_pns"],
                      ["Distributor Name", "dist_name"],
                      ["Distributor Email", "dist_email"],
                      ["Distributor Phone", "dist_phone"],
                      ["FSC", "fsc"],
                    ].map(([label, field]) =>
                      h(
                        "div",
                        {
                          key: field,
                          style: { marginBottom: "8px" },
                        },
                        h(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "9px",
                              color: "rgba(201,168,76,.6)",
                              marginBottom: "3px",
                            },
                          },
                          label,
                        ),
                        h("input", {
                          value: editDraft[field] || "",
                          onChange: (e) =>
                            setEditDraft((d) => ({
                              ...d,
                              [field]: e.target.value,
                            })),
                          style: {
                            width: "100%",
                            background: "rgba(0,0,0,.3)",
                            border: "1px solid rgba(201,168,76,.2)",
                            color: "var(--alabaster,#F5F0E8)",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            padding: "5px 8px",
                            borderRadius: "3px",
                            outline: "none",
                            boxSizing: "border-box",
                          },
                        }),
                      ),
                    ),
                    h(
                      "div",
                      { style: { ...S.row, marginTop: "10px" } },
                      h(
                        "button",
                        { style: S.btnPrimary, onClick: handleEditSave },
                        "Save Changes",
                      ),
                      h(
                        "button",
                        {
                          style: S.btnSm,
                          onClick: () => {
                            setEditingLogId(null);
                            setEditDraft({});
                          },
                        },
                        "Cancel",
                      ),
                    ),
                  ),

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
                  // ── Edit button ──
                  h(
                    "button",
                    {
                      title: "Edit entry",
                      style: {
                        ...S.btnSm,
                        padding: "2px 8px",
                        fontSize: "10px",
                        color: "rgba(201,168,76,.8)",
                        borderColor: "rgba(201,168,76,.3)",
                        marginLeft: "4px",
                      },
                      onClick: () =>
                        editingLogId === entry.id
                          ? (setEditingLogId(null), setEditDraft({}))
                          : handleEditOpen(entry),
                    },
                    editingLogId === entry.id ? "✕ Cancel" : "✎ Edit",
                  ),
                  // ── Delete X button ──
                  h(
                    "button",
                    {
                      title: "Delete entry",
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "12px",
                        lineHeight: "1",
                        padding: "2px 7px",
                        border: "1px solid rgba(231,76,60,.3)",
                        background: "transparent",
                        color: "rgba(231,76,60,.7)",
                        cursor: "pointer",
                        borderRadius: "3px",
                        marginLeft: "2px",
                      },
                      onClick: () =>
                        handleDeleteEntry(entry.id, entry.dist_name),
                    },
                    "\u2715",
                  ),
                ),

                (entry.sol_noms || []).length > 0 &&
                  h(
                    "div",
                    { style: { ...S.dim, marginBottom: "3px" } },
                    (entry.sol_noms || []).join(" \u00b7 "),
                  ),
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      marginBottom: "3px",
                    },
                  },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: "var(--gold-dim,rgba(201,168,76,.55))",
                        letterSpacing: ".04em",
                        flexShrink: 0,
                      },
                    },
                    "P/N:",
                  ),
                  h("input", {
                    defaultValue: (entry.sol_pns || [])
                      .filter(Boolean)
                      .join(" \u00b7 "),
                    placeholder: "enter p/n\u2026",
                    onBlur: (e) => {
                      const val = e.target.value.trim();
                      handleLogUpdate(entry.id, "sol_pns", val ? [val] : []);
                    },
                    style: {
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid rgba(201,168,76,.15)",
                      color: "var(--gold-dim,rgba(201,168,76,.7))",
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "10px",
                      outline: "none",
                      padding: "1px 4px",
                      letterSpacing: ".03em",
                    },
                  }),
                ),
                (entry.sol_ids || []).length > 0 &&
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: "#65e10a",
                        marginBottom: "6px",
                        letterSpacing: ".04em",
                      },
                    },
                    "SOL: " + (entry.sol_ids || []).join(" \u00b7 "),
                  ),
                entry.dist_email &&
                  h(
                    "div",
                    {
                      style: {
                        ...S.dim,
                        marginBottom: "8px",
                        color: "#1eb4ff",
                      },
                    },
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
