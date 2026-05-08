// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — SUPPLIER ROLODEX TAB  v2
//  localStorage-backed. Fully editable: add, delete, edit, paste-parse.
//  Three sheets: HIGH-DOLLAR | COMMODITY | MARGIN LAYER (small TX)
//  Exports: window.SCC_TABS.SupplierRolodexTab
// ═══════════════════════════════════════════════════════════════════════

(function () {
  const { createElement: h, useState, useEffect, useRef, useCallback } = React;

  // ── STORAGE ────────────────────────────────────────────────────────────
  const LS_KEY = "scc-rolodex-v2";
  const LS_STATE = "scc-rolodex-state-v1";

  function loadSuppliers() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (saved && saved.hd && saved.ft && saved.ml) return saved;
    } catch {}
    return { hd: getDefaultHD(), ft: getDefaultFT(), ml: getDefaultML() };
  }

  function saveSuppliers(data) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {}
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(LS_STATE) || "{}");
    } catch {
      return {};
    }
  }

  function saveState(s) {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(s));
    } catch {}
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── PASTE PARSER ────────────────────────────────────────────────────────
  // Extracts: company, phone, website, fscs, notes, block, type from pasted text
  function parsePaste(text) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const result = {
      id: uid(),
      block: "MARGIN LAYER",
      company: "",
      type: "Distributor",
      best_use: "Sourcing",
      difficulty: "Low",
      fscs: "",
      website: "",
      phone: "",
      email: "",
      notes: "",
      contacted: "",
      responded: "",
      partnered: false,
      my_notes: "",
    };

    const phoneRe = /(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/;
    const websiteRe =
      /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/;
    const fscRe = /\b(\d{4})\s*[→\-–:]\s*([^\n•*]{0,60})/g;
    const emailRe = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;

    const noteLines = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];

      // Company name — first substantial line that isn't a bullet/icon/header
      if (
        !result.company &&
        l.length > 2 &&
        !/^[🟢🔥✅🎯👉📞🌐*•→\-#]/.test(l) &&
        !/^\d+\./.test(l)
      ) {
        // Skip lines that look like headers/labels
        if (
          !/^(WHY|FSC|TYPE|PHONE|WEBSITE|EMAIL|NOTES|CONTACT|LOCATION|DIRECT|BONUS|LAYER|MARGIN|GO CALL)/i.test(
            l,
          )
        ) {
          result.company = l.replace(/[🟢🔥✅🎯👉📞🌐]/g, "").trim();
        }
      }

      // Phone
      const phoneMatch = l.match(phoneRe);
      if (phoneMatch && !result.phone) {
        result.phone = phoneMatch[1];
      }

      // Website
      if (/website|🌐|http|www\.|\.com/i.test(l)) {
        const wm = l.match(websiteRe);
        if (wm && !result.website) {
          result.website = wm[0].startsWith("http")
            ? wm[0]
            : "https://" + wm[0];
        }
      }

      // Email
      const emailMatch = l.match(emailRe);
      if (emailMatch && !result.email) result.email = emailMatch[0];

      // Location — extract city/state into notes
      if (/\bTX\b|Texas/i.test(l) && l.length < 60) {
        noteLines.push(l.replace(/[🟢🔥✅🎯👉📞🌐*•→]/g, "").trim());
      }

      // FSC numbers
      const fscMatches = [...l.matchAll(fscRe)];
      if (fscMatches.length) {
        const found = fscMatches.map((m) => m[1]);
        const existing = result.fscs
          ? result.fscs.split(",").map((f) => f.trim())
          : [];
        const merged = [...new Set([...existing, ...found])];
        result.fscs = merged.join(", ");
      }

      // Why this is a go / notes
      if (
        /WHY|Flexible|margin|stock|inventory|Reman|oilfield|multi-brand|Cummins|CAT|Deere/i.test(
          l,
        )
      ) {
        noteLines.push(l.replace(/[✅🎯👉📞🌐*•→🟢🔥]/g, "").trim());
      }
    }

    if (noteLines.length) {
      result.notes = noteLines.slice(0, 4).join(" · ");
    }

    // Type inference
    if (/manufacturer|mfg|mfr|reman|fabricat/i.test(text))
      result.type = "Manufacturer";
    else if (/repair|service/i.test(text)) result.type = "Distributor";

    // Difficulty from context
    if (/flexible|easy|small|rural|local/i.test(text))
      result.difficulty = "Low";

    return result;
  }

  // ── DEFAULT DATA SEED ──────────────────────────────────────────────────
  function getDefaultML() {
    return [
      {
        id: "commercial-diesel-kingsbury",
        block: "MARGIN LAYER",
        company: "Commercial Diesel Parts & Service",
        type: "Distributor",
        best_use: "Sourcing",
        difficulty: "Low",
        fscs: "2910, 2940, 2990",
        website: "",
        phone: "(830) 372-1594",
        email: "",
        notes:
          "Kingsbury TX. Small-town operator, low competition. Sells parts + reman. Multi-brand: Cummins, CAT. Likely flexible on pricing. Facebook primary presence.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "novak-diesel-edna",
        block: "MARGIN LAYER",
        company: "Novak Diesel Service",
        type: "Distributor",
        best_use: "Sourcing",
        difficulty: "Low",
        fscs: "2910, 2930, 2990",
        website: "",
        phone: "(361) 782-5228",
        email: "",
        notes:
          "Edna TX. Mentions Cummins, CAT, Deere. Generator + fire pump work — inventory heavy. Rural = low bid competition.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "diesel-power-supply-waco",
        block: "MARGIN LAYER",
        company: "Diesel Power Supply Company",
        type: "Distributor",
        best_use: "Sourcing",
        difficulty: "Low",
        fscs: "2910, 2940, 4320",
        website: "https://dieselpowersupply.com",
        phone: "(254) 753-1587",
        email: "",
        notes:
          "Waco TX — 20min from Killeen. Carries stock (critical). Emergency service + parts + rebuilds. Multiple engine lines. HIGH PROBABILITY WIN on 2940.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "industrial-diesel-decatur",
        block: "MARGIN LAYER",
        company: "Industrial Diesel Inc.",
        type: "Manufacturer",
        best_use: "Sourcing",
        difficulty: "Low",
        fscs: "2815, 2910, 2990",
        website: "",
        phone: "(940) 627-3947",
        email: "",
        notes:
          "Decatur TX. Reman operation = parts pipeline access. Likely sitting inventory. Not e-commerce driven. Target parts only — NOT full engines.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "industrial-diesel-mfg-tx",
        block: "MARGIN LAYER",
        company: "Industrial Diesel Mfg & Service Ltd",
        type: "Manufacturer",
        best_use: "Sourcing",
        difficulty: "Low",
        fscs: "4320, 2910, 2990",
        website: "",
        phone: "",
        email: "",
        notes:
          "Texas oilfield lane. Fabrication + diesel systems. Oilfield = overstock + supplier network. Not indexed for gov — BLUE OCEAN. Pull phone from Google.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
    ];
  }

  function getDefaultHD() {
    return [
      {
        id: "generac-power-systems",
        block: "GENERATORS / POWER BLOCK",
        fscs: "6110, 6115, 6120",
        company: "Generac Power Systems",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Medium",
        website: "https://www.generac.com",
        phone: "(888) 436-3722",
        email: "",
        notes:
          "Industrial/commercial generator OEM. Strong DLA history in 6115. Ask for government/defense sales. Dealer program exists — push for authorized reseller agreement.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "cummins-power-generation",
        block: "GENERATORS / POWER BLOCK",
        fscs: "6110, 6115, 6120",
        company: "Cummins Power Generation",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Hard",
        website: "https://www.cummins.com",
        phone: "(800) 343-7357",
        email: "",
        notes:
          "Major diesel generator OEM. Heavy DLA presence. Large company — route to government channel or find regional distributor with DLA history.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "kohler-power-systems",
        block: "GENERATORS / POWER BLOCK",
        fscs: "6110, 6115, 6120",
        company: "Kohler Power Systems",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Medium",
        website: "https://www.kohlerpower.com",
        phone: "(800) 544-2444",
        email: "",
        notes:
          "Generator OEM. Dealer/distributor program active. Smaller gov sales team = more accessible than Cummins.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "eaton-corporation",
        block: "GENERATORS / POWER BLOCK",
        fscs: "6110, 6115, 6120",
        company: "Eaton Corporation",
        type: "Manufacturer",
        best_use: "Awareness",
        difficulty: "Hard",
        website: "https://www.eaton.com",
        phone: "(800) 386-1911",
        email: "",
        notes:
          "Power mgmt/UPS OEM. Very large — hard reseller path. Better as sourcing contact for specific NSN quotes.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "wesco-international",
        block: "GENERATORS / POWER BLOCK",
        fscs: "6110, 6115, 6120",
        company: "Wesco International",
        type: "Distributor",
        best_use: "Sourcing",
        difficulty: "Medium",
        website: "https://www.wesco.com",
        phone: "(866) 746-3519",
        email: "",
        notes:
          "Major electrical/power distributor. Government channel active. Good backup source on generator parts.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "graybar-electric",
        block: "GENERATORS / POWER BLOCK",
        fscs: "6110, 6115, 6120",
        company: "Graybar Electric",
        type: "Distributor",
        best_use: "Sourcing",
        difficulty: "Medium",
        website: "https://www.graybar.com",
        phone: "(800) 472-9227",
        email: "",
        notes:
          "Gov-aware electrical distributor. Route through local branch for better pricing on power equipment.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "trane-technologies",
        block: "HVAC / REFRIGERATION BLOCK",
        fscs: "4110, 4120, 4130",
        company: "Trane Technologies",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Hard",
        website: "https://www.trane.com",
        phone: "(800) 945-5884",
        email: "",
        notes:
          "HVAC OEM. Major DLA presence in 4120. Large company — find regional dealer/contractor who has DLA awards in this FSC.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "phoenix-products-llc",
        block: "LIGHTING BLOCK",
        fscs: "6230",
        company: "Phoenix Products LLC",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Low",
        website: "https://www.phoenixlighting.com",
        phone: "(414) 426-7589",
        email: "ppeczerski@phoenixlighting.com",
        notes:
          "CAGE 8T493. Military floodlights. Gov sales rep: Patrick Peczerski. Active sol in pipeline. Emailed 6 Apr. Very accessible.",
        contacted: "Emailed 6 Apr",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "gates-industrial",
        block: "BEARINGS / POWER TRANS BLOCK",
        fscs: "3030, 3110, 5330",
        company: "Gates Industrial",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Medium",
        website: "https://www.gates.com",
        phone: "(303) 744-1911",
        email: "",
        notes:
          "Belt OEM. KEY for vehicle belt crosses. Route to industrial/government sales.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "flowserve-corporation",
        block: "PUMPS / COMPRESSORS BLOCK",
        fscs: "4320, 4330",
        company: "Flowserve Corporation",
        type: "Manufacturer",
        best_use: "Reseller Target",
        difficulty: "Hard",
        website: "https://www.flowserve.com",
        phone: "(972) 443-6500",
        email: "",
        notes:
          "Pump/valve OEM. Defense and gov contracts active. Based in Irving TX — Dallas area, accessible.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
    ];
  }

  function getDefaultFT() {
    return [
      {
        id: "kd-fasteners-inc",
        block: "FASTENER SPECIALISTS",
        fscs: "5305, 5310, 5315, 5320",
        company: "KD Fasteners Inc",
        type: "Distributor",
        best_use: "SB, High-Margin",
        difficulty: "Low",
        website: "https://kdfasteners.com",
        phone: "(800) 736-5014",
        email: "sales@kdfasteners.com",
        notes: "Military/defense page. 100K+ SKUs. Just send PO for quote.",
        contacted: "Called 9 Apr",
        responded: "Just send PO for quote",
        partnered: false,
        my_notes: "",
      },
      {
        id: "msc-industrial",
        block: "FASTENER SPECIALISTS",
        fscs: "5110, 5120, 5305, 5340",
        company: "MSC Industrial",
        type: "Distributor",
        best_use: "SB, LHF",
        difficulty: "Medium",
        website: "https://mscdirect.com",
        phone: "(800) 645-7270",
        email: "publicsector@mscdirect.com",
        notes:
          "GSA contract active. DLA approved. 1.9M+ SKUs. Wait 24hrs for reseller pricing.",
        contacted: "Called 9 Apr",
        responded: "Wait 24hrs",
        partnered: false,
        my_notes: "",
      },
      {
        id: "all-pro-fasteners",
        block: "FASTENER SPECIALISTS",
        fscs: "5305-5340",
        company: "All-Pro Fasteners",
        type: "Manufacturer/Dist",
        best_use: "SB, LHF, High-Margin",
        difficulty: "Low",
        website: "https://apf.com",
        phone: "(254) 772-6017",
        email: "waco@apf.com",
        notes:
          "TEXAS — Waco 20min from Killeen. ISO certified, A2LA lab, $136M revenue.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "houston-precision-fasteners",
        block: "SMALL MANUFACTURERS",
        fscs: "5305-5320",
        company: "Houston Precision Fasteners",
        type: "Manufacturer",
        best_use: "High-Margin",
        difficulty: "Low",
        website: "https://hpfasteners.com",
        phone: "(713) 614-3889",
        email: "mhahn@houstonprecisionfasteners.com",
        notes:
          "CAGE 1VSL7. 500 NSNs on DLA. 31 employees. Boeing/Lockheed approved. Contact: Mark Hahn (owner). Reseller email sent 6 Apr.",
        contacted: "Emailed 6 Apr",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "fastenal",
        block: "GENERAL MRO / HARDWARE",
        fscs: "5305-5340, 4730, 4240, 7930",
        company: "Fastenal",
        type: "Distributor",
        best_use: "FAST, SB, LHF",
        difficulty: "Medium",
        website: "https://fastenal.com",
        phone: "(800) FASTENAL",
        email: "txgovsales@fastenal.com",
        notes:
          "Texas NASPO contract active. Temple TX: 2711 Airport Rd Ste B. Self-fund only on most awards.",
        contacted: "Emailed 6 Apr | Called 9 Apr",
        responded: "Filled out form — Waiting",
        partnered: false,
        my_notes: "",
      },
      {
        id: "global-industrial",
        block: "GENERAL MRO / HARDWARE",
        fscs: "3920, 4240, 5340",
        company: "Global Industrial",
        type: "Distributor",
        best_use: "FAST, LHF",
        difficulty: "Easy",
        website: "https://www.globalindustrial.com",
        phone: "(844) 671-1547",
        email: "resale@globalindustrial.com",
        notes:
          "Strong reseller lane. Broad warehouse/MRO/PPE overlap. Self-fund only.",
        contacted: "Called 9 Apr",
        responded: "Need Tax Exempt & Resale Cert",
        partnered: false,
        my_notes: "",
      },
      {
        id: "dxp-enterprises-mro",
        block: "GENERAL MRO / HARDWARE",
        fscs: "5305-5340, 4730, 4820, 6150",
        company: "DXP Enterprises",
        type: "Distributor",
        best_use: "SB, High-Margin",
        difficulty: "Medium",
        website: "https://dxpe.com",
        phone: "(713) 996-4700",
        email: "dxproundrock_tx@dxpe.com",
        notes:
          "TEXAS — Houston HQ. Round Rock Branch. Also on HIGH-DOLLAR list for pumps.",
        contacted: "Called 9 Apr",
        responded: "Round Rock Branch dxproundrock_tx@dxpe.com",
        partnered: false,
        my_notes: "says email quote",
      },
      {
        id: "motion-industries-bearings",
        block: "MECHANICAL / BEARINGS",
        fscs: "3030, 3110, 5330",
        company: "Motion Industries",
        type: "Distributor",
        best_use: "LHF, High-Margin",
        difficulty: "Medium",
        website: "https://www.motion.com",
        phone: "(800) 526-9328",
        email: "",
        notes: "Branch relationships matter. Good for mechanical MRO.",
        contacted: "He took my number for sales guy",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "cole-parmer",
        block: "LAB / SCIENTIFIC",
        fscs: "6640, 6630",
        company: "Cole-Parmer",
        type: "Distributor",
        best_use: "High-Margin, LHF",
        difficulty: "Easy",
        website: "https://www.coleparmer.com",
        phone: "(800) 323-4340",
        email: "sales@coleparmer.com",
        notes: "Strong niche for lab/scientific items buyers ignore.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
      {
        id: "triple-s-steel",
        block: "METALS / STEEL",
        fscs: "9510, 9520, 9535",
        company: "Triple-S Steel (Texas)",
        type: "Distributor",
        best_use: "Steel bar, plate, sheet",
        difficulty: "Low",
        website: "https://sss-steel.com",
        phone: "(800) 231-1034",
        email: "anthony.palazzo@sss-steel.com",
        notes:
          "TEXAS — Houston HQ. 600K+ tons/yr. Closest major service center to Killeen.",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      },
    ];
  }

  // ── DIFF COLORS ─────────────────────────────────────────────────────────
  function diffColor(d) {
    return (
      {
        Low: "#3dd68c",
        Easy: "#3dd68c",
        Medium: "#C9A84C",
        Hard: "#e87474",
        High: "#e87474",
      }[d] || "var(--body-dim)"
    );
  }

  // ── EDIT MODAL ──────────────────────────────────────────────────────────
  function EditModal({ supplier, onSave, onClose }) {
    const [form, setForm] = useState({ ...supplier });
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const field = (label, key, big) =>
      h(
        "div",
        { style: { marginBottom: "10px" } },
        h(
          "label",
          {
            style: {
              fontSize: "13px",
              color: "var(--body-faint)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              display: "block",
              marginBottom: "3px",
            },
          },
          label,
        ),
        big
          ? h("textarea", {
              value: form[key] || "",
              rows: 3,
              onChange: (e) => set(key, e.target.value),
              style: {
                width: "100%",
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.15)",
                borderRadius: "3px",
                padding: "6px 8px",
                color: "var(--body-bright)",
                fontSize: "15px",
                boxSizing: "border-box",
                resize: "vertical",
              },
            })
          : h("input", {
              value: form[key] || "",
              onChange: (e) => set(key, e.target.value),
              style: {
                width: "100%",
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.15)",
                borderRadius: "3px",
                padding: "6px 8px",
                color: "var(--body-bright)",
                fontSize: "15px",
                boxSizing: "border-box",
              },
            }),
      );

    return h(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.75)",
          backdropFilter: "blur(3px)",
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
        onClick: (e) => {
          if (e.target === e.currentTarget) onClose();
        },
      },
      h(
        "div",
        {
          style: {
            background: "var(--surface)",
            border: "1px solid rgba(201,168,76,.3)",
            borderRadius: "6px",
            padding: "24px",
            width: "min(640px, 94vw)",
            maxHeight: "88vh",
            overflowY: "auto",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "18px",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "16px",
                color: "var(--gold-solid)",
                letterSpacing: ".08em",
              },
            },
            "Edit Supplier",
          ),
          h(
            "button",
            {
              onClick: onClose,
              style: {
                background: "transparent",
                border: "none",
                color: "var(--body-dim)",
                fontSize: "22px",
                cursor: "pointer",
              },
            },
            "✕",
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0 16px",
            },
          },
          field("Company", "company"),
          field("Block / Category", "block"),
          field("FSCs", "fscs"),
          field("Type", "type"),
          field("Best Use", "best_use"),
          field("Difficulty", "difficulty"),
          field("Phone", "phone"),
          field("Email", "email"),
          field("Website", "website"),
          h("div", null),
        ),
        field("Notes", "notes", true),
        field("My Notes", "my_notes", true),
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "10px",
              marginTop: "16px",
              justifyContent: "flex-end",
            },
          },
          h(
            "button",
            {
              onClick: onClose,
              style: {
                padding: "8px 20px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,.2)",
                color: "var(--body-dim)",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "15px",
              },
            },
            "Cancel",
          ),
          h(
            "button",
            {
              onClick: () => {
                onSave(form);
                onClose();
              },
              style: {
                padding: "8px 20px",
                background: "rgba(201,168,76,.2)",
                border: "1px solid rgba(201,168,76,.4)",
                color: "var(--gold-solid)",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: 700,
              },
            },
            "Save",
          ),
        ),
      ),
    );
  }

  // ── PASTE PARSER MODAL ──────────────────────────────────────────────────
  function ParseModal({ onAdd, onClose }) {
    const [text, setText] = useState("");
    const [parsed, setParsed] = useState(null);

    function handleParse() {
      const result = parsePaste(text);
      setParsed(result);
    }

    return h(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.75)",
          backdropFilter: "blur(3px)",
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
        onClick: (e) => {
          if (e.target === e.currentTarget) onClose();
        },
      },
      h(
        "div",
        {
          style: {
            background: "var(--surface)",
            border: "1px solid rgba(201,168,76,.3)",
            borderRadius: "6px",
            padding: "24px",
            width: "min(700px, 94vw)",
            maxHeight: "90vh",
            overflowY: "auto",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "16px",
                color: "var(--gold-solid)",
                letterSpacing: ".08em",
              },
            },
            "Paste Parser — Add Supplier",
          ),
          h(
            "button",
            {
              onClick: onClose,
              style: {
                background: "transparent",
                border: "none",
                color: "var(--body-dim)",
                fontSize: "22px",
                cursor: "pointer",
              },
            },
            "✕",
          ),
        ),
        h(
          "div",
          {
            style: {
              fontSize: "14px",
              color: "var(--body-faint)",
              marginBottom: "10px",
            },
          },
          "Paste any sourcing notes — company info, phone, FSCs, location. Parser extracts what it can. You can edit after.",
        ),
        h("textarea", {
          value: text,
          rows: 8,
          onChange: (e) => setText(e.target.value),
          placeholder: "Paste supplier info here...",
          style: {
            width: "100%",
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.15)",
            borderRadius: "3px",
            padding: "8px 10px",
            color: "var(--body-bright)",
            fontSize: "15px",
            boxSizing: "border-box",
            resize: "vertical",
            marginBottom: "10px",
            fontFamily: "JetBrains Mono, monospace",
          },
        }),
        h(
          "button",
          {
            onClick: handleParse,
            disabled: !text.trim(),
            style: {
              padding: "8px 18px",
              background: "rgba(201,168,76,.12)",
              border: "1px solid rgba(201,168,76,.35)",
              color: "var(--gold-solid)",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "15px",
              marginBottom: "16px",
            },
          },
          "⚡ Parse",
        ),

        parsed &&
          h(
            "div",
            null,
            h(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "13px",
                  color: "#3dd68c",
                  letterSpacing: ".08em",
                  marginBottom: "10px",
                },
              },
              "PARSED — REVIEW & CONFIRM",
            ),
            h(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  marginBottom: "14px",
                },
              },
              ...[
                "company",
                "block",
                "fscs",
                "type",
                "phone",
                "email",
                "website",
                "difficulty",
                "best_use",
              ].map((k) =>
                h(
                  "div",
                  { key: k },
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "12px",
                        color: "var(--body-faint)",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        marginBottom: "2px",
                      },
                    },
                    k,
                  ),
                  h("input", {
                    value: parsed[k] || "",
                    onChange: (e) =>
                      setParsed((p) => ({ ...p, [k]: e.target.value })),
                    style: {
                      width: "100%",
                      background: "rgba(255,255,255,.05)",
                      border: "1px solid rgba(255,255,255,.12)",
                      borderRadius: "3px",
                      padding: "5px 8px",
                      color: "var(--body-bright)",
                      fontSize: "15px",
                      boxSizing: "border-box",
                    },
                  }),
                ),
              ),
            ),
            h(
              "div",
              { style: { marginBottom: "14px" } },
              h(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    color: "var(--body-faint)",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    marginBottom: "3px",
                  },
                },
                "Notes",
              ),
              h("textarea", {
                value: parsed.notes || "",
                rows: 3,
                onChange: (e) =>
                  setParsed((p) => ({ ...p, notes: e.target.value })),
                style: {
                  width: "100%",
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: "3px",
                  padding: "6px 8px",
                  color: "var(--body-bright)",
                  fontSize: "15px",
                  boxSizing: "border-box",
                  resize: "vertical",
                },
              }),
            ),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                },
              },
              h(
                "button",
                {
                  onClick: onClose,
                  style: {
                    padding: "8px 20px",
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,.2)",
                    color: "var(--body-dim)",
                    borderRadius: "3px",
                    cursor: "pointer",
                    fontSize: "15px",
                  },
                },
                "Cancel",
              ),
              h(
                "button",
                {
                  onClick: () => {
                    onAdd({ ...parsed, id: parsed.id || uid() });
                    onClose();
                  },
                  style: {
                    padding: "8px 20px",
                    background: "rgba(61,214,140,.15)",
                    border: "1px solid rgba(61,214,140,.4)",
                    color: "#3dd68c",
                    borderRadius: "3px",
                    cursor: "pointer",
                    fontSize: "15px",
                    fontWeight: 700,
                  },
                },
                "+ Add to Rolodex",
              ),
            ),
          ),
      ),
    );
  }

  // ── SUPPLIER ROW ────────────────────────────────────────────────────────
  function SupplierRow({ s, state, onUpdate, onEdit, onDelete }) {
    const [expanded, setExpanded] = useState(false);
    const notesTimer = useRef(null);
    const contactTimer = useRef(null);
    const respondTimer = useRef(null);

    const myNotes = state.my_notes ?? s.my_notes ?? "";
    const contacted = state.contacted ?? s.contacted ?? "";
    const responded = state.responded ?? s.responded ?? "";
    const partnered = state.partnered ?? s.partnered ?? false;

    const isDead = myNotes && /^FUCK|^N\/A$|^DEAD$/i.test(myNotes.trim());

    function debounce(timer, field, val) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onUpdate(s.id, { [field]: val }), 400);
    }

    return h(
      "div",
      {
        style: {
          borderBottom: "1px solid rgba(255,255,255,.05)",
          opacity: isDead ? 0.35 : 1,
          transition: "opacity .2s",
        },
      },
      // ── Collapsed row ──
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 90px 75px 100px 100px 85px 60px",
            gap: "8px",
            alignItems: "center",
            padding: "8px 10px",
            cursor: "pointer",
            background: expanded ? "rgba(201,168,76,.04)" : "transparent",
          },
          onClick: () => setExpanded((x) => !x),
        },
        // Company + type
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              minWidth: 0,
            },
          },
          h(
            "span",
            {
              style: {
                color: "var(--body-bright)",
                fontSize: "16px",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            s.company,
          ),
          h(
            "span",
            {
              style: {
                fontSize: "12px",
                padding: "2px 6px",
                borderRadius: "2px",
                flexShrink: 0,
                background:
                  s.type === "Manufacturer"
                    ? "rgba(61,214,140,.12)"
                    : "rgba(135,206,235,.1)",
                color: s.type === "Manufacturer" ? "#3dd68c" : "#87ceeb",
                border: "1px solid",
                borderColor:
                  s.type === "Manufacturer"
                    ? "rgba(61,214,140,.25)"
                    : "rgba(135,206,235,.2)",
              },
            },
            (s.type || "").toUpperCase().slice(0, 8),
          ),
        ),
        h(
          "span",
          {
            style: {
              fontSize: "14px",
              color: "var(--body-dim)",
              fontFamily: "monospace",
            },
          },
          s.fscs,
        ),
        h(
          "span",
          {
            style: {
              fontSize: "15px",
              color: diffColor(s.difficulty),
              fontWeight: 600,
            },
          },
          s.difficulty,
        ),
        h(
          "span",
          {
            style: {
              fontSize: "15px",
              color: contacted ? "#3dd68c" : "var(--body-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          contacted ? "✓ " + contacted : "—",
        ),
        h(
          "span",
          {
            style: {
              fontSize: "15px",
              color: responded ? "#C9A84C" : "var(--body-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          responded ? "✓ Responded" : "—",
        ),
        h(
          "span",
          {
            style: {
              fontSize: "15px",
              color: partnered ? "#3dd68c" : "var(--body-faint)",
              textAlign: "center",
            },
          },
          partnered ? "✦" : "",
        ),
        // Actions
        h(
          "div",
          {
            style: { display: "flex", gap: "4px", alignItems: "center" },
            onClick: (e) => e.stopPropagation(),
          },
          h(
            "button",
            {
              onClick: (e) => {
                e.stopPropagation();
                onEdit(s);
              },
              title: "Edit",
              style: {
                padding: "3px 7px",
                fontSize: "13px",
                background: "rgba(201,168,76,.1)",
                border: "1px solid rgba(201,168,76,.25)",
                color: "var(--gold-dim)",
                borderRadius: "2px",
                cursor: "pointer",
              },
            },
            "✏",
          ),
          h(SaveToDBBtn, { supplier: s, rowState: rowState[s.id] || {} }),
          h(
            "button",
            {
              onClick: (e) => {
                e.stopPropagation();
                if (confirm("Delete " + s.company + "?")) onDelete(s.id);
              },
              title: "Delete",
              style: {
                padding: "3px 7px",
                fontSize: "13px",
                background: "rgba(231,76,60,.08)",
                border: "1px solid rgba(231,76,60,.25)",
                color: "#e74c3c",
                borderRadius: "2px",
                cursor: "pointer",
              },
            },
            "✕",
          ),
          h(
            "span",
            {
              style: {
                fontSize: "13px",
                color: "var(--body-faint)",
                transform: expanded ? "rotate(90deg)" : "none",
                display: "inline-block",
                transition: "transform .15s",
              },
            },
            "▶",
          ),
        ),
      ),

      // ── Expanded detail ──
      expanded &&
        h(
          "div",
          {
            style: {
              padding: "12px 14px 16px",
              background: "rgba(0,0,0,.2)",
              borderTop: "1px solid rgba(255,255,255,.04)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "14px",
            },
          },
          // Left
          h(
            "div",
            null,
            h(
              "div",
              {
                style: {
                  fontSize: "15px",
                  color: "var(--body-dim)",
                  marginBottom: "8px",
                },
              },
              s.website &&
                h(
                  "a",
                  {
                    href: s.website,
                    target: "_blank",
                    style: {
                      color: "var(--accent-blue)",
                      marginRight: "12px",
                      fontSize: "16px",
                    },
                  },
                  s.website.replace("https://", ""),
                ),
              s.phone &&
                h(
                  "span",
                  { style: { marginRight: "12px", fontSize: "16px" } },
                  s.phone,
                ),
              s.email &&
                h(
                  "a",
                  {
                    href: "mailto:" + s.email,
                    style: { color: "var(--gold-dim)", fontSize: "15px" },
                  },
                  s.email,
                ),
            ),
            h(
              "div",
              {
                style: {
                  fontSize: "16px",
                  color: "var(--body-dim)",
                  lineHeight: 1.6,
                  marginBottom: "10px",
                },
              },
              s.notes,
            ),
            h(
              "div",
              {
                style: {
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "3px",
                },
              },
              "Best Use",
            ),
            h(
              "div",
              { style: { fontSize: "16px", color: "var(--body-bright)" } },
              s.best_use,
            ),
          ),
          // Right — status controls
          h(
            "div",
            null,
            h(
              "div",
              {
                style: {
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "6px",
                },
              },
              "Status",
            ),
            h(
              "div",
              { style: { marginBottom: "10px" } },
              h(
                "button",
                {
                  onClick: () => onUpdate(s.id, { partnered: !partnered }),
                  style: {
                    padding: "4px 12px",
                    borderRadius: "3px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor: partnered
                      ? "#3dd68c"
                      : "rgba(255,255,255,.12)",
                    background: partnered
                      ? "rgba(61,214,140,.15)"
                      : "transparent",
                    color: partnered ? "#3dd68c" : "var(--body-dim)",
                  },
                },
                "PARTNERED",
              ),
            ),
            h(
              "div",
              {
                style: {
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "3px",
                },
              },
              "Contacted",
            ),
            h("input", {
              defaultValue: contacted,
              onChange: (e) =>
                debounce(contactTimer, "contacted", e.target.value),
              onClick: (e) => e.stopPropagation(),
              placeholder: "Date / method",
              style: {
                width: "100%",
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: "3px",
                padding: "6px 9px",
                color: "var(--body-bright)",
                fontSize: "16px",
                marginBottom: "8px",
                boxSizing: "border-box",
              },
            }),
            h(
              "div",
              {
                style: {
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "3px",
                },
              },
              "Responded",
            ),
            h("input", {
              defaultValue: responded,
              onChange: (e) =>
                debounce(respondTimer, "responded", e.target.value),
              onClick: (e) => e.stopPropagation(),
              placeholder: "Response / notes",
              style: {
                width: "100%",
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: "3px",
                padding: "6px 9px",
                color: "var(--body-bright)",
                fontSize: "16px",
                marginBottom: "8px",
                boxSizing: "border-box",
              },
            }),
            h(
              "div",
              {
                style: {
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "3px",
                },
              },
              "My Notes",
            ),
            h("input", {
              defaultValue: myNotes,
              onChange: (e) => debounce(notesTimer, "my_notes", e.target.value),
              onClick: (e) => e.stopPropagation(),
              placeholder: "Internal notes...",
              style: {
                width: "100%",
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: "3px",
                padding: "6px 9px",
                color: "var(--body-bright)",
                fontSize: "16px",
                boxSizing: "border-box",
              },
            }),
          ),
        ),
    );
  }

  // ── SAVE TO DB BUTTON ───────────────────────────────────────────────────
  function SaveToDBBtn({ supplier, rowState }) {
    const [status, setStatus] = useState("idle"); // idle | saving | saved | err

    async function handleSave(e) {
      e.stopPropagation();
      if (status === "saving") return;
      setStatus("saving");
      try {
        const payload = {
          ...supplier,
          contacted: rowState.contacted || supplier.contacted || "",
          responded: rowState.responded || supplier.responded || "",
          partnered: rowState.partnered ?? supplier.partnered ?? false,
          my_notes: rowState.my_notes || supplier.my_notes || "",
          saved_at: new Date().toISOString(),
          source: "rolodex",
        };
        const res = await fetch("/.netlify/functions/scc-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "saveSupplier", supplier: payload }),
          signal: AbortSignal.timeout(12000),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "DB error");
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 3000);
      } catch (err) {
        console.error("[Rolodex] Save to DB failed:", err.message);
        setStatus("err");
        setTimeout(() => setStatus("idle"), 4000);
      }
    }

    const label =
      status === "saving"
        ? "…"
        : status === "saved"
          ? "✓"
          : status === "err"
            ? "!"
            : "↑";
    const title =
      status === "saving"
        ? "Saving…"
        : status === "saved"
          ? "Saved to MongoDB"
          : status === "err"
            ? "Save failed — check console"
            : "Save to MongoDB";
    const border =
      status === "saved"
        ? "rgba(46,204,113,.35)"
        : status === "err"
          ? "rgba(231,76,60,.35)"
          : "rgba(201,168,76,.2)";
    const bg =
      status === "saved"
        ? "rgba(46,204,113,.1)"
        : status === "err"
          ? "rgba(231,76,60,.1)"
          : "rgba(201,168,76,.06)";
    const color =
      status === "saved"
        ? "#2ecc71"
        : status === "err"
          ? "#e74c3c"
          : "var(--gold-dim)";

    return h(
      "button",
      {
        onClick: handleSave,
        title,
        style: {
          padding: "3px 7px",
          fontSize: "13px",
          background: bg,
          border: "1px solid " + border,
          color,
          borderRadius: "2px",
          cursor: status === "saving" ? "default" : "pointer",
          fontWeight: "700",
          minWidth: "22px",
          textAlign: "center",
          transition: "all .2s",
        },
      },
      label,
    );
  }

  // ── BLOCK GROUP ─────────────────────────────────────────────────────────
  function BlockGroup({
    block,
    rows,
    state,
    onUpdate,
    onEdit,
    onDelete,
    filter,
  }) {
    const [collapsed, setCollapsed] = useState(false);

    const visible = rows.filter((s) => {
      if (filter === "partnered") return state[s.id]?.partnered || s.partnered;
      if (filter === "contacted") return state[s.id]?.contacted || s.contacted;
      if (filter === "pending") return !(state[s.id]?.contacted || s.contacted);
      return true;
    });
    if (!visible.length) return null;

    const partCount = rows.filter(
      (s) => state[s.id]?.partnered || s.partnered,
    ).length;
    const contactCount = rows.filter(
      (s) => state[s.id]?.contacted || s.contacted,
    ).length;

    return h(
      "div",
      {
        style: {
          marginBottom: "8px",
          border: "1px solid rgba(255,255,255,.07)",
          borderRadius: "5px",
          overflow: "hidden",
        },
      },
      h(
        "div",
        {
          onClick: () => setCollapsed((x) => !x),
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            background: "rgba(201,168,76,.06)",
            cursor: "pointer",
            borderBottom: collapsed
              ? "none"
              : "1px solid rgba(255,255,255,.06)",
          },
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px" } },
          h(
            "span",
            {
              style: {
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--gold-dim)",
                letterSpacing: ".06em",
                textTransform: "uppercase",
              },
            },
            block,
          ),
          h(
            "span",
            { style: { fontSize: "14px", color: "var(--body-faint)" } },
            rows.length + " suppliers",
          ),
          contactCount > 0 &&
            h(
              "span",
              { style: { fontSize: "14px", color: "#3dd68c" } },
              contactCount + " contacted",
            ),
          partCount > 0 &&
            h(
              "span",
              { style: { fontSize: "14px", color: "#C9A84C" } },
              "✦ " + partCount + " partnered",
            ),
        ),
        h(
          "span",
          {
            style: {
              fontSize: "13px",
              color: "var(--body-faint)",
              transform: collapsed ? "rotate(-90deg)" : "none",
              display: "inline-block",
              transition: "transform .15s",
            },
          },
          "▼",
        ),
      ),
      !collapsed &&
        h(
          "div",
          null,
          // Column headers
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "1fr 90px 75px 100px 100px 85px 60px",
                gap: "8px",
                padding: "4px 10px",
                background: "rgba(0,0,0,.15)",
              },
            },
            ...[
              "Company",
              "FSCs",
              "Difficulty",
              "Contacted",
              "Responded",
              "Partner",
              "",
            ].map((lbl, i) =>
              h(
                "span",
                {
                  key: i,
                  style: {
                    fontSize: "13px",
                    color: "var(--body-faint)",
                    textTransform: "uppercase",
                    letterSpacing: ".07em",
                  },
                },
                lbl,
              ),
            ),
          ),
          visible.map((s) =>
            h(SupplierRow, {
              key: s.id,
              s,
              state: state[s.id] || {},
              onUpdate,
              onEdit,
              onDelete,
            }),
          ),
        ),
    );
  }

  // ── MAIN TAB ────────────────────────────────────────────────────────────
  function SupplierRolodexTab() {
    const [suppliers, setSuppliers] = useState(loadSuppliers);
    const [rowState, setRowState] = useState(loadState);
    const [sheet, setSheet] = useState("ml"); // start on Margin Layer — where the action is
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [showParser, setShowParser] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);

    const SHEET_KEY = { hd: "hd", ft: "ft", ml: "ml" };
    const data = suppliers[SHEET_KEY[sheet]] || [];

    // Persist suppliers on change
    useEffect(() => {
      saveSuppliers(suppliers);
    }, [suppliers]);
    useEffect(() => {
      saveState(rowState);
    }, [rowState]);

    function onUpdate(id, patch) {
      setRowState((prev) => ({
        ...prev,
        [id]: { ...(prev[id] || {}), ...patch },
      }));
    }

    function onEdit(s) {
      setEditingSupplier(s);
    }

    function onSaveEdit(updated) {
      setSuppliers((prev) => {
        const next = { ...prev };
        next[sheet] = next[sheet].map((s) =>
          s.id === updated.id ? updated : s,
        );
        return next;
      });
      setEditingSupplier(null);
    }

    function onDelete(id) {
      setSuppliers((prev) => {
        const next = { ...prev };
        next[sheet] = next[sheet].filter((s) => s.id !== id);
        return next;
      });
    }

    function onAdd(newSupplier) {
      setSuppliers((prev) => {
        const next = { ...prev };
        // Default to current sheet's first block if no block set
        if (!newSupplier.block) {
          if (sheet === "ml") newSupplier.block = "MARGIN LAYER";
          else if (sheet === "ft") newSupplier.block = "GENERAL MRO / HARDWARE";
          else newSupplier.block = "GENERATORS / POWER BLOCK";
        }
        next[sheet] = [...next[sheet], newSupplier];
        return next;
      });
    }

    function onAddBlank() {
      const blank = {
        id: uid(),
        block: sheet === "ml" ? "MARGIN LAYER" : "GENERAL MRO / HARDWARE",
        company: "New Supplier",
        type: "Distributor",
        best_use: "Sourcing",
        difficulty: "Low",
        fscs: "",
        website: "",
        phone: "",
        email: "",
        notes: "",
        contacted: "",
        responded: "",
        partnered: false,
        my_notes: "",
      };
      setEditingSupplier(blank);
      onAdd(blank);
    }

    // Grouped
    const blocks = [...new Set(data.map((s) => s.block))];
    function filterData(rows) {
      if (!search.trim()) return rows;
      const q = search.toLowerCase();
      return rows.filter(
        (s) =>
          (s.company || "").toLowerCase().includes(q) ||
          (s.fscs || "").toLowerCase().includes(q) ||
          (s.block || "").toLowerCase().includes(q) ||
          (s.notes || "").toLowerCase().includes(q) ||
          (s.phone || "").includes(q),
      );
    }

    // Stats across all sheets
    const allSuppliers = [
      ...(suppliers.hd || []),
      ...(suppliers.ft || []),
      ...(suppliers.ml || []),
    ];
    const totalContacted = allSuppliers.filter(
      (s) => rowState[s.id]?.contacted || s.contacted,
    ).length;
    const totalPartnered = allSuppliers.filter(
      (s) => rowState[s.id]?.partnered || s.partnered,
    ).length;

    return h(
      "div",
      { style: { animation: "fadeUp .4s ease both", paddingBottom: "40px" } },

      // ── HEADER ──
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "14px",
            flexWrap: "wrap",
          },
        },

        // Sheet selector
        h(
          "div",
          {
            style: {
              display: "flex",
              border: "1px solid rgba(201,168,76,.25)",
              borderRadius: "4px",
              overflow: "hidden",
            },
          },
          [
            { key: "ml", label: "🟢 Margin Layer" },
            { key: "hd", label: "High-Dollar" },
            { key: "ft", label: "Commodity" },
          ].map(({ key, label }, i) =>
            h(
              "button",
              {
                key,
                onClick: () => setSheet(key),
                style: {
                  padding: "7px 14px",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: "pointer",
                  background:
                    sheet === key ? "rgba(201,168,76,.18)" : "transparent",
                  color:
                    sheet === key ? "var(--gold-solid)" : "var(--body-dim)",
                  border: "none",
                  borderLeft: i > 0 ? "1px solid rgba(201,168,76,.2)" : "none",
                },
              },
              label,
            ),
          ),
        ),

        // Filters
        h(
          "div",
          { style: { display: "flex", gap: "5px" } },
          ["all", "contacted", "pending", "partnered"].map((f) =>
            h(
              "button",
              {
                key: f,
                onClick: () => setFilter(f),
                style: {
                  padding: "5px 10px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  borderRadius: "3px",
                  border: "1px solid",
                  borderColor:
                    filter === f
                      ? "rgba(201,168,76,.5)"
                      : "rgba(255,255,255,.1)",
                  background:
                    filter === f ? "rgba(201,168,76,.1)" : "transparent",
                  color: filter === f ? "var(--gold-dim)" : "var(--body-dim)",
                },
              },
              f.toUpperCase(),
            ),
          ),
        ),

        // Search
        h("input", {
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: "Search company, FSC, phone...",
          style: {
            flex: 1,
            minWidth: "150px",
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: "3px",
            padding: "6px 10px",
            color: "var(--body-bright)",
            fontSize: "15px",
          },
        }),

        // Action buttons
        h(
          "div",
          { style: { display: "flex", gap: "6px", marginLeft: "auto" } },
          h(
            "button",
            {
              onClick: () => setShowParser(true),
              style: {
                padding: "6px 14px",
                fontSize: "14px",
                background: "rgba(135,206,235,.1)",
                border: "1px solid rgba(135,206,235,.3)",
                color: "#87ceeb",
                borderRadius: "3px",
                cursor: "pointer",
                fontWeight: 600,
              },
            },
            "📋 Paste & Parse",
          ),
          h(
            "button",
            {
              onClick: onAddBlank,
              style: {
                padding: "6px 14px",
                fontSize: "14px",
                background: "rgba(61,214,140,.1)",
                border: "1px solid rgba(61,214,140,.3)",
                color: "#3dd68c",
                borderRadius: "3px",
                cursor: "pointer",
                fontWeight: 600,
              },
            },
            "+ Add Supplier",
          ),
        ),

        // Stats
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "12px",
              fontSize: "15px",
              color: "var(--body-dim)",
            },
          },
          h(
            "span",
            null,
            h(
              "span",
              { style: { color: "#3dd68c", fontWeight: 700 } },
              totalContacted,
            ),
            " contacted",
          ),
          h(
            "span",
            null,
            h(
              "span",
              { style: { color: "#C9A84C", fontWeight: 700 } },
              "✦ " + totalPartnered,
            ),
            " partnered",
          ),
        ),
      ),

      // ── BLOCKS ──
      blocks.map((block) => {
        const rows = filterData(data.filter((s) => s.block === block));
        return h(BlockGroup, {
          key: block,
          block,
          rows,
          state: rowState,
          onUpdate,
          onEdit,
          onDelete,
          filter,
        });
      }),

      // ── MODALS ──
      editingSupplier &&
        h(EditModal, {
          supplier: editingSupplier,
          onSave: onSaveEdit,
          onClose: () => setEditingSupplier(null),
        }),
      showParser &&
        h(ParseModal, { onAdd, onClose: () => setShowParser(false) }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SupplierRolodexTab = SupplierRolodexTab;
})();
