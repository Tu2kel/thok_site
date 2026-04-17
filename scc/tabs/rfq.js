(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — RFQ BLASTER TAB
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.RFQTab
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: h,
    useState,
    useEffect,
    useRef,
    Fragment: Frag,
  } = React;

  // ── VENDOR DATABASE ────────────────────────────────────────────────────
  const RFQ_VENDORS = [
    {
      id: "efi",
      name: "Electronic Fasteners Inc",
      email: "sales@electronicfasteners.com",
      fsc: ["5305", "5310", "5315", "5320"],
      tier: 1,
      prefixes: ["MS", "NAS", "AN"],
    },
    {
      id: "fastenal",
      name: "Fastenal",
      email: "quotes@fastenal.com",
      fsc: ["5305", "5306", "5310", "5315", "5320", "5340"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "grainger",
      name: "Grainger",
      email: "gsquotes@grainger.com",
      fsc: [
        "5305",
        "5310",
        "5340",
        "4240",
        "5110",
        "5120",
        "7930",
        "6150",
        "8030",
        "4910",
        "4940",
      ],
      tier: 1,
      prefixes: [],
    },
    {
      id: "msc",
      name: "MSC Industrial",
      email: "quotes@mscdirect.com",
      fsc: ["5110", "5120", "5305", "5340", "4910"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "mcmaster",
      name: "McMaster-Carr",
      email: "support@mcmaster.com",
      fsc: ["5305", "5310", "5340", "5365", "4730"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "mouser",
      name: "Mouser Electronics",
      email: "sales@mouser.com",
      fsc: ["5961", "5962", "5935", "5905", "5975"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "digikey",
      name: "DigiKey",
      email: "custserv@digikey.com",
      fsc: ["5961", "5962", "5935", "5905", "5975", "5998"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "arrow",
      name: "Arrow Electronics",
      email: "quotes@arrow.com",
      fsc: ["5961", "5962", "5935", "5905"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "medline",
      name: "Medline Industries",
      email: "govquotes@medline.com",
      fsc: ["6510", "6515", "6520", "6530", "8520"],
      tier: 1,
      prefixes: ["MDS"],
    },
    {
      id: "nar",
      name: "North American Rescue",
      email: "quotes@narescue.com",
      fsc: ["6515", "4240"],
      tier: 1,
      prefixes: ["NAR"],
    },
    {
      id: "hh_medical",
      name: "H&H Medical",
      email: "orders@hhmedical.com",
      fsc: ["6515", "4240"],
      tier: 1,
      prefixes: ["HH"],
    },
    {
      id: "tw_metals",
      name: "TW Metals",
      email: "quotes@twmetals.com",
      fsc: ["9510", "9520", "9535"],
      tier: 1,
      prefixes: [],
    },
    {
      id: "brighton",
      name: "Brighton Best International",
      email: "info@brightonbest.com",
      fsc: ["5305", "5310", "5315", "5320"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "bay_supply",
      name: "Bay Supply",
      email: "sales@baysupply.com",
      fsc: ["5305", "5310", "5315", "5320"],
      tier: 2,
      prefixes: ["MS", "NAS"],
    },
    {
      id: "advance_comp",
      name: "Advance Components",
      email: "quotes@advancecomponents.com",
      fsc: ["5305", "5310", "5315", "5935"],
      tier: 2,
      prefixes: ["MS"],
    },
    {
      id: "newark",
      name: "Newark",
      email: "quotes@newark.com",
      fsc: ["5961", "5935", "5905", "5975", "6150"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "heilind",
      name: "Heilind Electronics",
      email: "sales@heilind.com",
      fsc: ["5935", "5961"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "pei_genesis",
      name: "PEI-Genesis",
      email: "quotes@peigenesis.com",
      fsc: ["5935", "5975"],
      tier: 2,
      prefixes: ["MS", "MIL"],
    },
    {
      id: "zoro",
      name: "Zoro Tools",
      email: "quotes@zoro.com",
      fsc: ["5305", "5310", "5340", "4240", "7930"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "global_ind",
      name: "Global Industrial",
      email: "quotes@globalindustrial.com",
      fsc: ["7110", "7125", "4240", "5110"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "bound_tree",
      name: "Bound Tree Medical",
      email: "cs@boundtree.com",
      fsc: ["6515", "6510"],
      tier: 2,
      prefixes: ["BT"],
    },
    {
      id: "chinook_med",
      name: "Chinook Medical",
      email: "info@chinookmed.com",
      fsc: ["6515", "4240"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "hd_supply",
      name: "HD Supply",
      email: "quotes@hdsupply.com",
      fsc: ["7930", "7110", "4240"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "safety_kleen",
      name: "Safety-Kleen / Clean Harbors",
      email: "quotes@cleanharbors.com",
      fsc: ["9150", "6810", "6840"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "galls",
      name: "Galls",
      email: "govquotes@galls.com",
      fsc: ["6515", "4240", "8415", "8465"],
      tier: 2,
      prefixes: [],
    },
    {
      id: "safariland",
      name: "Safariland Group",
      email: "quotes@safariland.com",
      fsc: ["8415", "8465", "8470", "4240"],
      tier: 2,
      prefixes: [],
    },
  ];

  const FSC_NAMES = {
    5305: "Screws & Bolts",
    5306: "Bolts",
    5310: "Nuts & Washers",
    5315: "Pins & Rivets",
    5320: "Rivets",
    5340: "Hardware",
    5360: "Springs",
    5365: "Rings/Spacers",
    5935: "Connectors",
    5905: "Resistors",
    5961: "Semiconductors",
    5962: "Microelectronics",
    5975: "Elec Hardware",
    5998: "PCBs",
    6150: "Wire & Cable",
    6510: "Medical Supplies",
    6515: "EMS/Field Medical",
    6520: "Dental",
    6530: "Hospital Furn",
    6810: "Chemicals",
    6840: "Pest Control",
    7110: "Office Furniture",
    7125: "Shelving",
    7930: "Cleaning",
    8030: "Adhesives",
    8040: "Sealants",
    8115: "Boxes",
    8415: "Indiv Equip",
    8430: "Footwear",
    8465: "Carrying Equip",
    8470: "Armor",
    8520: "Toiletries",
    9150: "Oils & Greases",
    9510: "Iron & Steel",
    9520: "Steel Materials",
    9535: "Metal Bar/Sheet",
    4240: "Safety & PPE",
    4730: "Hose/Pipe/Fittings",
    5110: "Hand Tools",
    5120: "Power Tools",
    4910: "Shop Equipment",
    4940: "Maint Equip",
  };

  // ── NAVIGATOR PARSER ───────────────────────────────────────────────────
  // Handles the David's Navigator export format with pipe-delimited suppliers
  function parseNavigatorRows(rawText) {
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const results = [];
    const UNITS =
      "EA|LT|BX|DZ|PR|FT|GL|LB|PK|RL|SE|ST|PG|HD|SH|VI|CY|GR|MX|TH|YD";

    for (const line of lines) {
      const solMatch = line.match(/\b(SPE[A-Z0-9][A-Z0-9\-]*[A-Z0-9])\b/i);
      if (!solMatch) continue;
      const sol = solMatch[1];

      const qtyRx = new RegExp("\\b(\\d+)[ \\t]+(" + UNITS + ")\\b", "i");
      const qtyM = line.match(qtyRx);

      let itemName = "";
      if (qtyM) {
        const afterSave = line.match(/Save[ \t]+([\s\S]+)/i);
        if (afterSave) {
          const chunk = afterSave[1];
          const qIdx = chunk.indexOf(qtyM[0]);
          const raw =
            qIdx > 0
              ? chunk.substring(0, qIdx).trim()
              : chunk.split(/[\t]{2,}|\s{3,}/)[0].trim();
          itemName = raw.replace(/[\s\d]+$/, "").trim();
        }
      }

      const nsnM = line.match(/\b(\d{4}[\-]?\d{2}[\-]?\d{3}[\-]?\d{4})\b/);
      const nsn = nsnM
        ? nsnM[1]
            .replace(/[^0-9]/g, "")
            .replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4")
        : null;
      const fsc = nsn ? nsn.slice(0, 4) : null;

      const dateM = line.match(/(\d{2}\/\d{2}\/\d{2})/);
      const quoteDue = dateM ? dateM[1] : null;

      const delM = line.match(/\d{2}\/\d{2}\/\d{2}[ \t]+(\d{1,3})[ \t]+\d{13}/);
      const deliveryDays = delM ? delM[1] : null;

      const prices = [...line.matchAll(/\$([0-9,]+\.\d{2})/g)].map((m) =>
        parseFloat(m[1].replace(/,/g, "")),
      );
      const unitPrice = prices[0] ?? null;

      const supRx = /([A-Z][A-Z0-9 ,\.&\-]+?)\|([A-Z0-9]{5})\|([^|;\n\t]+)/g;
      const suppliers = [];
      let sm;
      while ((sm = supRx.exec(line)) !== null) {
        suppliers.push({
          name: sm[1].trim(),
          cage: sm[2].trim(),
          partNo: sm[3].trim(),
        });
      }

      results.push({
        sol,
        itemName,
        qty: qtyM ? qtyM[1] : null,
        uoi: qtyM ? qtyM[2].toUpperCase() : null,
        nsn,
        fsc,
        quoteDue,
        deliveryDays,
        unitPrice,
        suppliers,
      });
    }
    return results;
  }

  // ── SIMPLE SUPPLY LIST PARSER ──────────────────────────────────────────
  // Fallback for paste of NSN / P/N / Qty lines without Navigator format
  function parseSimpleList(rawText) {
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const results = [];
    for (const line of lines) {
      if (line.startsWith("#")) continue;
      const nsnDash = line.match(/\b(\d{4})-(\d{2})-(\d{3})-(\d{4})\b/);
      const nsnComp = line.match(/\b(\d{4})(\d{2})(\d{3})(\d{4})\b/);
      let nsn = null;
      if (nsnDash) nsn = nsnDash[0];
      else if (nsnComp)
        nsn = nsnComp[0].replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4");

      const pnLabel = line.match(
        /(?:p\/n|pn|part\s*#?|part\s*no\.?)\s*[:\-]?\s*([A-Z0-9][\w\-\.\/]{2,})/i,
      );
      const pnMil = line.match(
        /\b(MS|NAS|AN|BAC|PEM|MIL-|NAR|HH|BT|MDS)\w[\w\-\.]{2,}/i,
      );
      let pn = null;
      if (pnLabel) pn = pnLabel[1].trim();
      else if (pnMil && !nsn) pn = pnMil[0].trim();

      const qtyLabel = line.match(
        /(?:qty|quantity|ea|each|count|unit)[:\s]+(\d[\d,]*)/i,
      );
      let qty = null;
      if (qtyLabel) {
        qty = parseInt(qtyLabel[1].replace(/,/g, ""));
      } else {
        let scratch = line;
        if (nsn) scratch = scratch.replace(nsn, "");
        if (pn) scratch = scratch.replace(pn, "");
        const nums = scratch.match(/\b(\d[\d,]{0,8})\b/g);
        if (nums) {
          const cands = nums
            .map((n) => parseInt(n.replace(/,/g, "")))
            .filter((n) => n > 0 && n < 1000000);
          if (cands.length) qty = cands[cands.length - 1];
        }
      }

      let desc = line;
      if (nsn) desc = desc.replace(nsn, "");
      if (pn) desc = desc.replace(pn, "");
      desc = desc
        .replace(
          /(?:nsn|p\/n|pn|part\s*#?|part\s*no\.?|qty|quantity|ea|each|unit|count)[:\s]*/gi,
          "",
        )
        .replace(/[\d,]+/g, " ")
        .replace(/[\-_,;|\/\\]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const fsc = nsn ? nsn.substring(0, 4) : null;
      if (!nsn && !pn) continue;
      // Wrap as Navigator-compatible shape (no pipe suppliers)
      results.push({
        sol: null,
        itemName: desc,
        qty: qty ? String(qty) : null,
        uoi: null,
        nsn,
        fsc,
        quoteDue: null,
        deliveryDays: null,
        unitPrice: null,
        suppliers: [],
      });
    }
    return results;
  }

  // ── MANUFACTURER CLASSIFIER ────────────────────────────────────────────
  const MFR_HIGH = [
    "manufacturing",
    "manufacturer",
    "mfg",
    "fabricat",
    "forging",
    "casting",
    "machining",
    "precision parts",
    "stamping",
    "tooling",
    "technologies inc",
    "technology inc",
    "defense systems",
    "ordnance",
    "aerospace corp",
    "aviation corp",
    "industries inc",
    "armament",
    "dynamics",
    "propulsion",
    "electronics corp",
    "systems corp",
  ];
  const MFR_MED = [
    "industries",
    "systems",
    "technologies",
    "solutions",
    "engineering",
    "corp",
    "corporation",
    "works",
    "products",
    "design",
    "production",
    "assembly",
  ];
  const DIST_OK = [
    "supply",
    "supplies",
    "distributor",
    "distribution",
    "distrib",
    "dealers",
    "trading",
    "wholesale",
    "parts",
    "spares",
    "surplus",
    "depot",
    "source",
    "procurement",
    "international trading",
    "global supply",
    "direct supply",
    "fasteners",
  ];

  function classifySupplier(name) {
    const n = (name || "").toLowerCase();
    if (DIST_OK.some((k) => n.includes(k))) return { flag: false };
    const hiHit = MFR_HIGH.find((k) => n.includes(k));
    if (hiHit)
      return {
        flag: true,
        confidence: "high",
        reason:
          'Name contains "' +
          hiHit +
          '" — likely OEM/manufacturer. Verify before emailing; may need authorized distributor.',
      };
    const medHit = MFR_MED.find((k) => n.includes(k));
    if (medHit)
      return {
        flag: true,
        confidence: "medium",
        reason:
          'Name contains "' +
          medHit +
          '" — could be manufacturer or integrated distributor. Confirm before sending.',
      };
    return { flag: false };
  }

  // ── BUILD SUPPLIER MAP FROM NAVIGATOR ROWS ─────────────────────────────
  function buildSupplierMap(parsedRows) {
    const map = {};
    for (const row of parsedRows) {
      for (const sup of row.suppliers) {
        if (!map[sup.cage]) {
          const cls = classifySupplier(sup.name);
          map[sup.cage] = {
            name: sup.name,
            cage: sup.cage,
            sols: [],
            flag: cls.flag,
            confidence: cls.confidence || null,
            reason: cls.reason || null,
            source: "navigator",
          };
        }
        map[sup.cage].sols.push({
          sol: row.sol,
          itemName: row.itemName,
          qty: row.qty,
          uoi: row.uoi,
          nsn: row.nsn,
          fsc: row.fsc,
          partNo: sup.partNo,
          quoteDue: row.quoteDue,
          deliveryDays: row.deliveryDays,
          unitPrice: row.unitPrice,
        });
      }
    }
    return Object.values(map).sort((a, b) => {
      const rank = (s) => (s.flag ? (s.confidence === "high" ? 2 : 1) : 0);
      return rank(a) - rank(b) || b.sols.length - a.sols.length;
    });
  }

  // ── SCORE RFQ_VENDORS FOR SIMPLE LIST ─────────────────────────────────
  function matchVendorsForItems(items) {
    const vendorMap = {};
    for (const item of items) {
      const fsc = item.fsc;
      const pn = item.nsn || null;
      const prefix = pn ? pn.toUpperCase().match(/^([A-Z]+)/)?.[1] : null;
      RFQ_VENDORS.forEach((v) => {
        let score = 0;
        if (fsc && v.fsc.includes(fsc)) score += 80;
        if (
          prefix &&
          v.prefixes.some((p) => prefix === p || prefix.startsWith(p))
        )
          score += 120;
        if (v.tier === 1) score += 20;
        if (score === 0) return;
        if (!vendorMap[v.id])
          vendorMap[v.id] = { ...v, items: [], score: 0, source: "auto" };
        vendorMap[v.id].items.push(item);
        vendorMap[v.id].score = Math.max(vendorMap[v.id].score, score);
      });
    }
    return Object.values(vendorMap).sort(
      (a, b) => a.tier - b.tier || b.score - a.score,
    );
  }

  // ── EMAIL BUILDERS ─────────────────────────────────────────────────────
  function buildNavigatorEmail(supplier, solMeta) {
    const { name, sols } = supplier;
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const del = sols[0]?.deliveryDays || solMeta.delivDays || "30";
    const ship = solMeta.shipTo || "[SHIP-TO LOCATION]";

    let lines = "";
    sols.forEach((s, i) => {
      const idx = String(i + 1).padStart(2, "0");
      const id = s.nsn || s.partNo || "N/A";
      const qty = s.qty ? parseInt(s.qty).toLocaleString() : "TBD";
      const uoi = s.uoi || "EA";
      const desc = s.itemName || "See solicitation";
      const fscLbl = s.fsc
        ? " (FSC " +
          s.fsc +
          (FSC_NAMES[s.fsc] ? " · " + FSC_NAMES[s.fsc] + ")" : ")")
        : "";
      const pn = s.partNo ? "  Your P/N: " + s.partNo : "";
      const sol = s.sol ? "  Sol: " + s.sol : "";
      const due = s.quoteDue ? "  Due: " + s.quoteDue : "";
      const price = s.unitPrice ? "  Gov Ref: $" + s.unitPrice.toFixed(2) : "";
      lines +=
        "  ITEM " +
        idx +
        ": " +
        id +
        fscLbl +
        "\n  Desc: " +
        desc +
        "\n  Qty: " +
        qty +
        " " +
        uoi +
        pn +
        sol +
        due +
        price +
        "\n\n";
    });

    return (
      today +
      "\n\nTo the Government Sales / Quotes Team at " +
      name +
      ",\n\nMy name is Anthony Kel, and I represent The House of Kel LLC (DBA Imperio Talent Solutions) — a verified Service-Disabled Veteran-Owned Small Business (SDVOSB), CAGE Code 152U4, based in Killeen, Texas.\n\nWe are currently responding to one or more DLA/DoD solicitations and are requesting pricing and availability on the following " +
      sols.length +
      " line item" +
      (sols.length !== 1 ? "s" : "") +
      " for which your company (" +
      (supplier.cage || "—") +
      ") appears as a registered supplier:\n\n" +
      lines +
      "Delivery Requirement: " +
      del +
      " days ARO\nShip-to: " +
      ship +
      "\nDelivery Terms: FOB Destination preferred\nPackaging: MIL-SPEC / contractor-grade per solicitation requirements\n\nPlease provide your best government pricing, unit of issue confirmation, and estimated lead time for each line. We are a direct federal prime contractor — no broker markup on our end.\n\nPoint of Contact:\nAnthony Kel\nThe House of Kel LLC · Imperio Talent Solutions\nanthony@imperiovita.co  |  (254) 265-9335\nCAGE: 152U4  |  SDVOSB Verified  |  www.imperiovita.co\n\nWe appreciate your time and look forward to your quote.\n\nVery respectfully,\nAnthony Kel\nImperio Talent Solutions | Supply Chain Command"
    );
  }

  function buildSimpleEmail(vendor, items, solMeta) {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const sol = solMeta.solNum || "[SOLICITATION NUMBER]";
    const due = solMeta.dueDate || "[DUE DATE]";
    const del = solMeta.delivDays || "30";
    const ship = solMeta.shipTo || "[SHIP-TO LOCATION]";

    const fscs = [...new Set(items.map((i) => i.fsc).filter(Boolean))];
    const fscStr = fscs
      .map((f) => f + (FSC_NAMES[f] ? " (" + FSC_NAMES[f] + ")" : ""))
      .join(", ");

    let lines = "";
    items.forEach((item, i) => {
      const id = item.nsn || item.pn || "N/A";
      const qty = item.qty ? item.qty.toLocaleString() : "TBD";
      const desc = item.itemName || item.desc || "See NSN";
      const fscLbl = item.fsc
        ? " (FSC " +
          item.fsc +
          (FSC_NAMES[item.fsc] ? " · " + FSC_NAMES[item.fsc] + ")" : ")")
        : "";
      lines +=
        "  ITEM " +
        String(i + 1).padStart(2, "0") +
        ": " +
        id +
        fscLbl +
        "\n  Desc: " +
        desc +
        "\n  Qty: " +
        qty +
        "\n\n";
    });

    return (
      today +
      "\n\nTo the Government Sales / Quotes Team at " +
      vendor.name +
      ",\n\nMy name is Anthony Kel, and I represent The House of Kel LLC (DBA Imperio Talent Solutions) — a verified Service-Disabled Veteran-Owned Small Business (SDVOSB), CAGE Code 152U4, based in Killeen, Texas.\n\nWe are currently responding to DLA solicitation " +
      sol +
      " (quote deadline: " +
      due +
      ") and are requesting pricing and availability on the following " +
      items.length +
      " line item" +
      (items.length !== 1 ? "s" : "") +
      (fscStr ? " (" + fscStr + ")" : "") +
      " for which your company is a qualified source:\n\n" +
      lines +
      "Delivery Requirement: " +
      del +
      " days ARO\nShip-to: " +
      ship +
      "\nDelivery Terms: FOB Destination preferred\nPackaging: MIL-SPEC / contractor-grade per solicitation requirements\n\nPlease provide your best government pricing, unit of issue confirmation, and estimated lead time for each line. We are a direct federal prime contractor — no broker markup on our end.\n\nPoint of Contact:\nAnthony Kel\nThe House of Kel LLC · Imperio Talent Solutions\nanthony@imperiovita.co  |  (254) 265-9335\nCAGE: 152U4  |  SDVOSB Verified  |  www.imperiovita.co\n\nWe appreciate your time and look forward to your quote.\n\nVery respectfully,\nAnthony Kel\nImperio Talent Solutions | Supply Chain Command"
    );
  }

  function buildSubject(solMeta, count, isNavigator) {
    if (isNavigator)
      return (
        "RFQ – Government Solicitations – " +
        count +
        " Line Item" +
        (count !== 1 ? "s" : "") +
        " – CAGE 152U4"
      );
    const sol = solMeta.solNum || "[SOL]";
    return (
      "RFQ – " +
      sol +
      " – " +
      count +
      " NSN Line Item" +
      (count !== 1 ? "s" : "") +
      " – CAGE 152U4"
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  VENDOR CARD COMPONENT
  // ══════════════════════════════════════════════════════════════════════
  function VendorCard({
    entry,
    emailOverride,
    onEmailChange,
    solMeta,
    isNavigator,
    sentSet,
    onToggleSent,
    onDelete,
  }) {
    const [expanded, setExpanded] = useState(true);
    const [copied, setCopied] = useState(false);
    const textRef = useRef(null);

    const vendor = entry;
    const items = isNavigator ? entry.sols : entry.items;
    const cage = entry.cage || "—";
    const toEmail = emailOverride || entry.email || "";
    const isSent = sentSet.has(entry.id || entry.cage);

    const flagStyle = entry.flag
      ? entry.confidence === "high"
        ? { card: "mfr-hi", name: "mfr-hi", banner: "high", badgeCls: "high" }
        : { card: "mfr-med", name: "", banner: "", badgeCls: "" }
      : { card: "", name: "", banner: "", badgeCls: "" };

    const emailBody = isNavigator
      ? buildNavigatorEmail(entry, solMeta)
      : buildSimpleEmail(entry, items, solMeta);

    const subject = buildSubject(solMeta, items.length, isNavigator);

    const copyFull = () => {
      const full =
        "To: " + toEmail + "\nSubject: " + subject + "\n\n" + emailBody;
      navigator.clipboard.writeText(full).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      });
    };

    const tierBadgeStyle = {
      fontFamily: "Cinzel,serif",
      fontSize: "8px",
      letterSpacing: ".16em",
      textTransform: "uppercase",
      padding: "3px 9px",
      borderRadius: "2px",
      background:
        entry.tier === 1
          ? "rgba(61,214,140,.06)"
          : entry.confidence === "high"
            ? "rgba(231,76,60,.08)"
            : "rgba(201,168,76,.05)",
      border:
        entry.tier === 1
          ? "1px solid rgba(61,214,140,.3)"
          : entry.confidence === "high"
            ? "1px solid rgba(231,76,60,.3)"
            : "1px solid rgba(201,168,76,.2)",
      color:
        entry.tier === 1
          ? "rgba(61,214,140,.85)"
          : entry.confidence === "high"
            ? "#e74c3c"
            : "rgba(201,168,76,.7)",
      flexShrink: "0",
    };

    const linesBadgeStyle = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      padding: "3px 9px",
      borderRadius: "2px",
      background: "rgba(90,120,200,.06)",
      border: "1px solid rgba(90,120,200,.3)",
      color: "var(--accent-blue-bright)",
      flexShrink: "0",
    };

    const cardBorderLeft = isSent
      ? "#2ecc71"
      : entry.flag
        ? entry.confidence === "high"
          ? "#e74c3c"
          : "#f39c12"
        : "rgba(201,168,76,.4)";
    const cardBg = isSent
      ? "linear-gradient(160deg,#0d1f0d 0%,#0a1608 40%,#0f1d0f 100%)"
      : entry.flag && entry.confidence === "high"
        ? "linear-gradient(160deg,#1f0d0d 0%,#140808 40%,#1a0e0e 100%)"
        : "linear-gradient(160deg,#2e2b32 0%,#1a1820 18%,#0e0d10 40%,#161418 60%,#1f1d23 80%,#111012 100%)";

    return h(
      "div",
      {
        style: {
          background: cardBg,
          border: "1px solid rgba(201,168,76,.18)",
          borderLeft: "4px solid " + cardBorderLeft,
          marginBottom: "12px",
          overflow: "hidden",
          transition: "border-color .2s",
        },
      },

      // ── MFR warning banner ──
      entry.flag &&
        h(
          "div",
          {
            style: {
              padding: "8px 18px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              borderBottom:
                entry.confidence === "high"
                  ? "1px solid rgba(231,76,60,.3)"
                  : "1px solid rgba(243,156,18,.25)",
              background:
                entry.confidence === "high"
                  ? "rgba(231,76,60,.12)"
                  : "rgba(243,156,18,.1)",
            },
          },
          h(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: "2px",
                background:
                  entry.confidence === "high"
                    ? "rgba(231,76,60,.2)"
                    : "rgba(243,156,18,.15)",
                border:
                  entry.confidence === "high"
                    ? "1px solid rgba(231,76,60,.5)"
                    : "1px solid rgba(243,156,18,.4)",
                color: entry.confidence === "high" ? "#e74c3c" : "#f39c12",
                flexShrink: "0",
              },
            },
            entry.confidence === "high"
              ? "⚠ Likely Manufacturer"
              : "⚠ Verify First",
          ),
          h(
            "span",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "13px",
                color: "var(--body-muted)",
              },
            },
            entry.reason,
          ),
        ),

      // ── Card header ──
      h(
        "div",
        {
          onClick: () => setExpanded((e) => !e),
          style: {
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "14px 18px",
            cursor: "pointer",
            flexWrap: "wrap",
            transition: "background .15s",
          },
          onMouseEnter: (e) =>
            (e.currentTarget.style.background = "rgba(201,168,76,.04)"),
          onMouseLeave: (e) =>
            (e.currentTarget.style.background = "transparent"),
        },

        h(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "14px",
              letterSpacing: ".06em",
              color: isSent
                ? "#2ecc71"
                : entry.flag && entry.confidence === "high"
                  ? "#e87474"
                  : "var(--gold-solid)",
              minWidth: "200px",
              fontWeight: "700",
            },
          },
          vendor.name,
        ),

        entry.cage &&
          h(
            "span",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "11px",
                padding: "3px 9px",
                borderRadius: "2px",
                background: "rgba(201,168,76,.1)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--gold-mid)",
                flexShrink: "0",
              },
            },
            entry.cage,
          ),

        h(
          "span",
          tierBadgeStyle,
          entry.tier
            ? "Tier " + entry.tier
            : entry.confidence === "high"
              ? "HIGH RISK"
              : "VERIFY",
        ),
        h(
          "span",
          linesBadgeStyle,
          items.length + " line" + (items.length !== 1 ? "s" : ""),
        ),

        isSent &&
          h(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".12em",
                color: "var(--accent-green)",
              },
            },
            "✓ SENT",
          ),

        h(
          "span",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "11px",
              color: "var(--gold-dim)",
              marginLeft: "auto",
            },
          },
          expanded ? "▲ Collapse" : "▼ Expand",
        ),
      ),

      // ── Expanded body ──
      expanded &&
        h(
          "div",
          {
            style: {
              borderTop: "1px solid rgba(201,168,76,.1)",
              padding: "18px 20px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "20px",
            },
          },

          // Left: email fields + preview
          h(
            "div",
            null,

            // To / Subject
            h(
              "div",
              { style: { marginBottom: "10px" } },
              h(
                "label",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "10px",
                    color: "var(--gold-dim)",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    marginBottom: "4px",
                    display: "block",
                  },
                },
                "To",
              ),
              h("input", {
                value: toEmail,
                onChange: (e) => onEmailChange(e.target.value),
                style: {
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--inset-bg)",
                  border: "1px solid rgba(201,168,76,.22)",
                  color: "var(--alabaster)",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12px",
                  outline: "none",
                },
              }),
            ),
            h(
              "div",
              {
                style: {
                  padding: "6px 10px",
                  background: "var(--inset-bg)",
                  border: "1px solid rgba(201,168,76,.1)",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: "var(--body-dim)",
                  marginBottom: "10px",
                },
              },
              h("span", { style: { color: "var(--gold-dim)" } }, "Subj: "),
              subject,
            ),

            // Email body preview
            h("textarea", {
              ref: textRef,
              readOnly: true,
              value: emailBody,
              style: {
                width: "100%",
                height: "320px",
                resize: "vertical",
                background: "var(--inset-bg)",
                border: "1px solid rgba(201,168,76,.12)",
                borderRadius: "2px",
                color: "var(--body-mono)",
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "13.5px",
                lineHeight: "1.8",
                padding: "14px 16px",
                outline: "none",
              },
            }),

            // Action buttons
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "8px",
                  marginTop: "10px",
                  flexWrap: "wrap",
                  alignItems: "center",
                },
              },
              h(
                "button",
                {
                  onClick: copyFull,
                  style: {
                    background: copied
                      ? "linear-gradient(to bottom,#3dd68c,#2ab57a)"
                      : "var(--gold-gradient)",
                    color: copied ? "#001a0a" : "#1a0005",
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".2em",
                    textTransform: "uppercase",
                    fontWeight: "700",
                    padding: "10px 20px",
                    border: "none",
                    borderRadius: "2px",
                    cursor: "pointer",
                    transition: "all .2s",
                  },
                },
                copied ? "✓ Copied to Clipboard" : "⧉ Copy Full Email",
              ),

              h(
                "button",
                {
                  onClick: () => onToggleSent(entry.id || entry.cage),
                  style: {
                    background: "transparent",
                    border: isSent
                      ? "1px solid rgba(46,204,113,.4)"
                      : "1px solid rgba(46,204,113,.3)",
                    color: isSent ? "#2ecc71" : "rgba(46,204,113,.7)",
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    padding: "10px 16px",
                    cursor: "pointer",
                    transition: "all .2s",
                  },
                },
                isSent ? "✓ Marked Sent" : "Mark Sent",
              ),

              isSent &&
                h(
                  "button",
                  {
                    onClick: () => onDelete(entry.id || entry.cage),
                    title: "Remove this vendor from the blast list",
                    style: {
                      background: "transparent",
                      border: "1px solid rgba(231,76,60,.35)",
                      color: "var(--red)",
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      padding: "10px 14px",
                      cursor: "pointer",
                      transition: "all .2s",
                    },
                    onMouseEnter: (e) => {
                      e.target.style.background = "rgba(231,76,60,.1)";
                      e.target.style.color = "#e74c3c";
                      e.target.style.borderColor = "rgba(231,76,60,.6)";
                    },
                    onMouseLeave: (e) => {
                      e.target.style.background = "transparent";
                      e.target.style.color = "rgba(231,76,60,.7)";
                      e.target.style.borderColor = "rgba(231,76,60,.35)";
                    },
                  },
                  "✕ Delete",
                ),
            ),
          ),

          // Right: line items
          h(
            "div",
            null,
            h(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "10px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  marginBottom: "10px",
                },
              },
              "Line Items (" + items.length + ")",
            ),
            h(
              "div",
              { style: { maxHeight: "420px", overflowY: "auto" } },
              ...items.map((s, i) => {
                const id = isNavigator
                  ? s.nsn || s.partNo || "N/A"
                  : s.nsn || s.pn || "N/A";
                const desc = s.itemName || s.desc || "—";
                const qty = s.qty ? parseInt(s.qty).toLocaleString() : "—";
                const uoi = s.uoi || "EA";
                const fscLbl = s.fsc
                  ? s.fsc + (FSC_NAMES[s.fsc] ? " · " + FSC_NAMES[s.fsc] : "")
                  : "—";
                return h(
                  "div",
                  {
                    key: i,
                    style: {
                      padding: "10px 13px",
                      background: "var(--inset-bg)",
                      border: "1px solid rgba(201,168,76,.1)",
                      borderLeft: "3px solid rgba(201,168,76,.3)",
                      marginBottom: "8px",
                    },
                  },
                  h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "8px",
                        flexWrap: "wrap",
                      },
                    },
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "12px",
                          color: "var(--gold-solid)",
                          fontWeight: "700",
                        },
                      },
                      id,
                    ),
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "11px",
                          color: "var(--accent-blue-bright)",
                        },
                      },
                      qty + " " + uoi,
                    ),
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontSize: "14px",
                        color: "var(--alabaster)",
                        margin: "4px 0",
                      },
                    },
                    desc,
                  ),
                  h(
                    "div",
                    {
                      style: { display: "flex", gap: "8px", flexWrap: "wrap" },
                    },
                    s.fsc &&
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--gold-mid)",
                          },
                        },
                        fscLbl,
                      ),
                    isNavigator &&
                      s.sol &&
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                          },
                        },
                        s.sol,
                      ),
                    isNavigator &&
                      s.quoteDue &&
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                          },
                        },
                        "Due: " + s.quoteDue,
                      ),
                    isNavigator &&
                      s.unitPrice &&
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--amber)",
                          },
                        },
                        "$" + s.unitPrice.toFixed(2),
                      ),
                  ),
                );
              }),
            ),
          ),
        ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  RFQ TAB ROOT
  // ══════════════════════════════════════════════════════════════════════
  function RFQTab() {
    const [rawText, setRawText] = useState("");
    const [mode, setMode] = useState("navigator"); // 'navigator' | 'simple'
    const [solNum, setSolNum] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [delivDays, setDelivDays] = useState("30");
    const [shipTo, setShipTo] = useState("");
    const [entries, setEntries] = useState([]);
    const [emailOverrides, setEmailOverrides] = useState({});
    const [sentSet, setSentSet] = useState(new Set());
    const [parsed, setParsed] = useState(false);
    const [manualRFQEmail, setManualRFQEmail] = useState("");
    const [sellerName, setSellerName] = useState("");
    const [sellerStreet, setSellerStreet] = useState("");
    const [sellerCity, setSellerCity] = useState("");
    const [rfqSending, setRfqSending] = useState(false);
    const [rfqSendStatus, setRfqSendStatus] = useState(null); // null | 'ok' | 'err'alRFQEmail, setManualRFQEmail] = useState("");

    const sentCount = sentSet.size;
    const totalCount = entries.length;

    const handleGenerate = () => {
      if (!rawText.trim()) return;

      if (mode === "navigator") {
        const rows = parseNavigatorRows(rawText);
        if (!rows.length) {
          // Fall back to simple parse
          const items = parseSimpleList(rawText);
          if (!items.length) {
            alert("No parseable items found. Check format.");
            return;
          }
          const vendors = matchVendorsForItems(items);
          setEntries(vendors);
        } else {
          const sups = buildSupplierMap(rows);
          setEntries(sups);
        }
      } else {
        const items = parseSimpleList(rawText);
        if (!items.length) {
          alert("No parseable items found. Check format.");
          return;
        }
        const vendors = matchVendorsForItems(items);
        setEntries(vendors);
      }
      setParsed(true);
    };

    const handleClear = () => {
      setRawText("");
      setEntries([]);
      setEmailOverrides({});
      setSentSet(new Set());
      setParsed(false);
      setSolNum("");
      setDueDate("");
      setDelivDays("30");
      setShipTo("");
    };

    const toggleSent = (id) =>
      setSentSet((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });

    const deleteEntry = (id) => {
      setEntries((prev) => prev.filter((e) => (e.id || e.cage) !== id));
      setSentSet((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    };

    const solMeta = { solNum, dueDate, delivDays, shipTo };
    const isNavigator =
      mode === "navigator" &&
      entries.length > 0 &&
      entries[0].cage !== undefined;
    const cleanEntries = entries.filter(
      (e) => !e.flag || e.confidence !== "high",
    );
    const flaggedHigh = entries.filter(
      (e) => e.flag && e.confidence === "high",
    ).length;
    const flaggedMed = entries.filter(
      (e) => e.flag && e.confidence === "medium",
    ).length;

    // ── styles ──
    const sInput = {
      width: "100%",
      padding: "8px 10px",
      background: "var(--inset-bg)",
      border: "1px solid rgba(201,168,76,.22)",
      color: "var(--alabaster)",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "13px",
      outline: "none",
      transition: "border-color .2s",
    };
    const sLabel = {
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: ".2em",
      textTransform: "uppercase",
      color: "var(--gold-dim)",
      marginBottom: "5px",
      display: "block",
    };
    const sModeBtn = (active) => ({
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: ".18em",
      textTransform: "uppercase",
      padding: "8px 18px",
      cursor: "pointer",
      border:
        "1px solid " + (active ? "var(--gold-solid)" : "rgba(201,168,76,.2)"),
      background: active ? "rgba(201,168,76,.1)" : "transparent",
      color: active ? "var(--gold-solid)" : "rgba(201,168,76,.4)",
      transition: "all .2s",
    });

    return h(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },

      // ── Header ──
      h(
        "div",
        { className: "pipe-header" },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h("div", { className: "pipe-title" }, "RFQ Blaster"),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14px",
                fontStyle: "italic",
                color: "var(--body-faint)",
              },
            },
            "Bulk vendor outreach — paste Navigator export or supply list, fire RSQ emails in one pass",
          ),
        ),
        parsed &&
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "12px" } },
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12px",
                  color: "var(--gold-dim)",
                  display: "flex",
                  gap: "16px",
                },
              },
              h(
                "span",
                null,
                h("b", { style: { color: "var(--gold-solid)" } }, totalCount),
                " vendor" + (totalCount !== 1 ? "s" : ""),
              ),
              h(
                "span",
                null,
                h("b", { style: { color: "var(--accent-green)" } }, sentCount),
                " sent",
              ),
              flaggedHigh > 0 &&
                h(
                  "span",
                  null,
                  h("b", { style: { color: "var(--red)" } }, flaggedHigh),
                  " mfr flags",
                ),
            ),
            h(
              "button",
              {
                onClick: handleClear,
                style: {
                  background: "transparent",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--body-dim)",
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  padding: "7px 14px",
                  cursor: "pointer",
                },
              },
              "Clear All",
            ),
          ),
      ),

      // ── Input section ──
      !parsed &&
        h(
          "div",
          {
            style: {
              background:
                "linear-gradient(160deg,#2e2b32 0%,#1a1820 18%,#0e0d10 40%,#161418 60%,#1f1d23 80%,#111012 100%)",
              border: "1px solid rgba(201,168,76,.2)",
              borderTop: "2px solid rgba(201,168,76,.4)",
              padding: "24px",
              marginBottom: "20px",
              position: "relative",
            },
          },

          // Top-edge gloss line
          h("div", {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "1px",
              background:
                "linear-gradient(to right,transparent,rgba(201,168,76,.4),transparent)",
            },
          }),

          // Mode toggle
          h(
            "div",
            {
              style: {
                display: "flex",
                gap: "8px",
                marginBottom: "20px",
                alignItems: "center",
              },
            },
            h(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  marginRight: "4px",
                },
              },
              "Input Mode:",
            ),
            h(
              "button",
              {
                onClick: () => setMode("navigator"),
                style: sModeBtn(mode === "navigator"),
              },
              "◆ Navigator Export",
            ),
            h(
              "button",
              {
                onClick: () => setMode("simple"),
                style: sModeBtn(mode === "simple"),
              },
              "◇ Simple List (NSN/P/N)",
            ),
          ),

          // Meta row — shown only for simple mode
          mode === "simple" &&
            h(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 100px 1fr",
                  gap: "12px",
                  marginBottom: "16px",
                },
              },
              h(
                "div",
                null,
                h("label", { style: sLabel }, "Solicitation #"),
                h("input", {
                  style: sInput,
                  value: solNum,
                  onChange: (e) => setSolNum(e.target.value),
                  placeholder: "SPRRA1-25-Q-XXXX",
                }),
              ),
              h(
                "div",
                null,
                h("label", { style: sLabel }, "Quote Due"),
                h("input", {
                  style: sInput,
                  value: dueDate,
                  onChange: (e) => setDueDate(e.target.value),
                  placeholder: "mm/dd/yyyy hh:mm ET",
                }),
              ),
              h(
                "div",
                null,
                h("label", { style: sLabel }, "Del Days"),
                h("input", {
                  style: sInput,
                  value: delivDays,
                  onChange: (e) => setDelivDays(e.target.value),
                  placeholder: "30",
                }),
              ),
              h(
                "div",
                null,
                h("label", { style: sLabel }, "Ship-to"),
                h("input", {
                  style: sInput,
                  value: shipTo,
                  onChange: (e) => setShipTo(e.target.value),
                  placeholder: "DLA Richmond VA",
                }),
              ),
            ),

          // Textarea
          h(
            "div",
            { style: { marginBottom: "6px" } },
            h(
              "label",
              { style: sLabel },
              mode === "navigator"
                ? "Paste Navigator Export — Tab-delimited rows with SPE sol numbers"
                : "Paste Supply List — NSN / P/N / Description / Qty, one item per line",
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "13px",
                  color: "var(--body-faint)",
                  marginBottom: "8px",
                },
              },
              mode === "navigator"
                ? "Expected: rows with SPE… sol#, item name, qty, NSN, dates, $price, VENDOR|CAGE|PART pipe blocks"
                : "Any format: 5305-01-123-4567 · qty 144 · MS35206-242 · description lines",
            ),
          ),
          h("textarea", {
            value: rawText,
            onChange: (e) => setRawText(e.target.value),
            rows: 10,
            placeholder:
              mode === "navigator"
                ? "Save\tSPRRA1-25-Q-1234\t...\t144 EA\t5305-01-123-4567\t...\tACME SUPPLY|1A2B3|MS35206-242\n..."
                : "5305-01-123-4567  144  Bolt hex head\nMS35206-242  50  screw pan head\nNAS1352C3-8  24",
            style: {
              width: "100%",
              minHeight: "180px",
              resize: "vertical",
              background: "var(--inset-bg)",
              border: "1px solid rgba(201,168,76,.25)",
              color: "var(--alabaster)",
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "12.5px",
              padding: "14px 16px",
              outline: "none",
              lineHeight: "1.6",
            },
          }),

          // Generate button
          h(
            "div",
            {
              style: {
                marginTop: "14px",
                display: "flex",
                gap: "12px",
                alignItems: "center",
                flexWrap: "wrap",
              },
            },
            h(
              "button",
              {
                onClick: handleGenerate,
                style: {
                  background: "var(--gold-gradient)",
                  color: "var(--body-color)",
                  fontFamily: "Cinzel,serif",
                  fontSize: "11px",
                  letterSpacing: ".22em",
                  textTransform: "uppercase",
                  fontWeight: "700",
                  padding: "13px 36px",
                  border: "none",
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                  transition: "all .2s",
                },
                onMouseEnter: (e) => {
                  e.target.style.transform = "translateY(-1px)";
                  e.target.style.boxShadow = "0 6px 24px rgba(0,0,0,.4)";
                },
                onMouseLeave: (e) => {
                  e.target.style.transform = "";
                  e.target.style.boxShadow = "";
                },
              },
              "⚡ Generate RFQ Emails",
            ),
          ),

          // ── Manual email send row ──
          h(
            "div",
            {
              style: {
                marginTop: "18px",
                paddingTop: "16px",
                borderTop: "1px solid rgba(201,168,76,.12)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              },
            },

            // Row 1: email + seller name
            h(
              "div",
              { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
              h(
                "div",
                { style: { flex: "1", minWidth: "200px" } },
                h("label", { style: sLabel }, "Recipient Email"),
                h("input", {
                  type: "email",
                  value: manualRFQEmail,
                  onChange: (e) => setManualRFQEmail(e.target.value),
                  placeholder: "quotes@supplier.com",
                  style: sInput,
                }),
              ),
              h(
                "div",
                { style: { flex: "1", minWidth: "200px" } },
                h("label", { style: sLabel }, "Seller Name (Resale Cert)"),
                h("input", {
                  type: "text",
                  value: sellerName,
                  onChange: (e) => setSellerName(e.target.value),
                  placeholder: "Acme Supply Co.",
                  style: sInput,
                }),
              ),
            ),

            // Row 2: street + city/state/zip
            h(
              "div",
              { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
              h(
                "div",
                { style: { flex: "1", minWidth: "200px" } },
                h("label", { style: sLabel }, "Seller Street Address"),
                h("input", {
                  type: "text",
                  value: sellerStreet,
                  onChange: (e) => setSellerStreet(e.target.value),
                  placeholder: "123 Industrial Blvd",
                  style: sInput,
                }),
              ),
              h(
                "div",
                { style: { flex: "1", minWidth: "200px" } },
                h("label", { style: sLabel }, "Seller City, State, ZIP"),
                h("input", {
                  type: "text",
                  value: sellerCity,
                  onChange: (e) => setSellerCity(e.target.value),
                  placeholder: "Houston, TX 77001",
                  style: sInput,
                }),
              ),
            ),

            // Row 3: send button + status
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  flexWrap: "wrap",
                },
              },
              h(
                "button",
                {
                  disabled: rfqSending,
                  onClick: async () => {
                    const email = manualRFQEmail.trim();
                    if (!email || !email.includes("@")) {
                      alert("Enter a valid email address first.");
                      return;
                    }
                    const subject =
                      "RFQ \u2013 Government Solicitation \u2013 CAGE 152U4";
                    const emailBody =
                      "To the Quotes / Government Sales Team,\n\nMy name is Anthony Kelley Sr., and I represent The House of Kel LLC (DBA Imperio Talent Solutions) \u2014 a Service-Disabled Veteran-Owned Small Business (SDVOSB), CAGE 152U4, based in Killeen, Texas.\n\nI am requesting pricing and availability on a DLA solicitation requirement" +
                      (solNum ? " \u2014 Solicitation " + solNum : "") +
                      ".\n\nPlease reply with your best government pricing, unit of issue confirmation, and lead time.\n\nPoint of Contact:\nAnthony Kelley Sr.\nThe House of Kel LLC \u00b7 Imperio Talent Solutions\nanthony@imperiovita.co  |  (254) 265-9335\nCAGE: 152U4  |  SDVOSB Verified\n\nVery respectfully,\nAnthony Kelley Sr.\nImperio Talent Solutions";

                    setRfqSending(true);
                    setRfqSendStatus(null);
                    try {
                      const res = await fetch("/.netlify/functions/send-rfq", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          to: email,
                          subject,
                          emailBody,
                          attachCert: true,
                          sellerName: sellerName.trim(),
                          sellerStreet: sellerStreet.trim(),
                          sellerCity: sellerCity.trim(),
                        }),
                      });
                      const data = await res.json();
                      setRfqSendStatus(data.ok ? "ok" : "err");
                    } catch {
                      setRfqSendStatus("err");
                    } finally {
                      setRfqSending(false);
                    }
                  },
                  style: {
                    background: rfqSending
                      ? "rgba(201,168,76,.1)"
                      : "transparent",
                    border: "1px solid rgba(201,168,76,.4)",
                    color: "var(--gold-solid)",
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                    padding: "10px 20px",
                    cursor: rfqSending ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                    transition: "all .2s",
                    opacity: rfqSending ? 0.6 : 1,
                  },
                  onMouseEnter: (e) => {
                    if (!rfqSending) {
                      e.currentTarget.style.background = "rgba(201,168,76,.1)";
                      e.currentTarget.style.borderColor = "rgba(201,168,76,.7)";
                    }
                  },
                  onMouseLeave: (e) => {
                    if (!rfqSending) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "rgba(201,168,76,.4)";
                    }
                  },
                },
                rfqSending ? "Sending..." : "\u2709 Send + Attach Cert",
              ),
              rfqSendStatus === "ok" &&
                h(
                  "span",
                  {
                    style: {
                      color: "#2ecc71",
                      fontSize: "11px",
                      fontFamily: "Cinzel,serif",
                    },
                  },
                  "\u2713 Sent with resale cert attached",
                ),
              rfqSendStatus === "err" &&
                h(
                  "span",
                  {
                    style: {
                      color: "#e74c3c",
                      fontSize: "11px",
                      fontFamily: "Cinzel,serif",
                    },
                  },
                  "\u26a0 Send failed \u2014 check console",
                ),
            ),
          ),
        ),

      // ── Progress bar (after generation) ──
      parsed &&
        h(
          "div",
          {
            style: {
              marginBottom: "16px",
              padding: "12px 18px",
              background: "var(--inset-bg)",
              border: "1px solid rgba(201,168,76,.1)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                flexShrink: "0",
              },
            },
            "Outreach Progress",
          ),
          h(
            "div",
            {
              style: {
                flex: "1",
                height: "6px",
                background: "var(--surface-dim)",
                borderRadius: "3px",
                overflow: "hidden",
                minWidth: "80px",
              },
            },
            h("div", {
              style: {
                height: "100%",
                width:
                  (totalCount > 0
                    ? Math.round((sentCount / totalCount) * 100)
                    : 0) + "%",
                background: "linear-gradient(90deg,#1a9e52,#3ddc84)",
                borderRadius: "3px",
                transition: "width .4s ease",
              },
            }),
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                color: "var(--accent-green)",
                fontWeight: "700",
                flexShrink: "0",
              },
            },
            sentCount + " / " + totalCount,
          ),
          flaggedHigh + flaggedMed > 0 &&
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  flexShrink: "0",
                  padding: "5px 12px",
                  background: "rgba(243,156,18,.08)",
                  border: "1px solid rgba(243,156,18,.3)",
                  borderRadius: "2px",
                },
              },
              h(
                "span",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "var(--amber)",
                  },
                },
                "⚠ " + flaggedHigh + "+" + flaggedMed + " flagged",
              ),
              h(
                "span",
                {
                  style: {
                    fontFamily: "Cormorant Garamond,serif",
                    fontStyle: "italic",
                    fontSize: "12px",
                    color: "var(--body-faint)",
                  },
                },
                "verify before sending",
              ),
            ),
        ),

      // ── Vendor cards ──
      parsed &&
        h(
          "div",
          null,
          ...entries.map((entry, i) =>
            h(VendorCard, {
              key: entry.id || entry.cage || i,
              entry,
              emailOverride: emailOverrides[entry.id || entry.cage] || "",
              onEmailChange: (val) =>
                setEmailOverrides((prev) => ({
                  ...prev,
                  [entry.id || entry.cage]: val,
                })),
              solMeta,
              isNavigator,
              sentSet,
              onToggleSent: toggleSent,
              onDelete: deleteEntry,
            }),
          ),
        ),

      // ── Empty state ──
      !parsed &&
        h(
          "div",
          { style: { textAlign: "center", padding: "60px 24px" } },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "48px",
                opacity: ".06",
                color: "var(--accent-red-soft)",
                marginBottom: "16px",
              },
            },
            "RFQ",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "16px",
                color: "var(--gold-dim)",
                marginBottom: "8px",
              },
            },
            "Paste · Parse · Send",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "15px",
                color: "var(--body-faint)",
                maxWidth: "520px",
                margin: "0 auto",
                lineHeight: "1.7",
              },
            },
            "Paste a Navigator export or raw supply list above. The engine parses every line, groups by vendor, and generates ready-to-fire RSQ emails — one per vendor, all line items batched.",
          ),
        ),
    );
  }

  // ── EXPOSE ──
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.RFQTab = RFQTab;
})();
