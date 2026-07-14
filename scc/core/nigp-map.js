(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — NIGP ROUTING BRAIN
  //  ESBD solicitations carry NIGP class/item codes; our distributors are keyed
  //  by FSC. This module (a) filters product buys from the sea of service/road
  //  solicitations, and (b) crosswalks the product NIGP *class* (first 3 digits)
  //  to the FSC lanes we route to distributors on.
  //
  //  We resell goods — we cannot bid road maintenance, construction, janitorial,
  //  consulting, etc. Heuristic: NIGP class >= 900 is a service; < 900 is a good.
  //  (Verified against a full ESBD export: 91x construction, 92x IT/eng, 93x-96x
  //   professional, 99x security are all services; goods cluster below 900.)
  //
  //  Exposes: window.SCC_NIGP = { classify, parseCodes, isServiceClass,
  //                               NIGP_CLASS_TO_FSC, CLASS_LABEL }
  // ═══════════════════════════════════════════════════════════════════════

  // Product NIGP class (3-digit) → FSC lanes we can route to distributors on.
  // Seeded from a real ESBD export; extend as new product lanes appear.
  const NIGP_CLASS_TO_FSC = {
    "020": ["3740", "3750", "3770", "4210"],          // agri/mowers/chippers
    "031": ["4120", "4130", "4110", "4140"],          // air conditioning / HVAC units
    "070": ["2310"],                                  // automobiles/passenger
    "071": ["2310", "2320"],                          // specialty vehicles
    "072": ["2320"],                                  // trucks
    "073": ["2330"],                                  // trailers
    "100": ["8145", "5975", "8140"],                  // freight/cargo containers
    "165": ["7310", "7320", "7360"],                  // cafeteria/kitchen equipment
    "175": ["6810", "6505", "6550", "6640"],          // chemicals / reagents
    "185": ["6810"],                                  // surfactants/chemicals
    "193": ["6550", "6810"],                          // test kits / reagents
    "200": ["8405", "8415"],                          // clothing/uniforms
    "201": ["8405"],                                  // uniforms
    "204": ["8405", "8455"],                          // uniform accessories/emblems
    "205": ["8305", "8315"],                          // textile fibers/piece goods
    "255": ["7690"],                                  // decals/stamps
    "285": ["6135", "6140"],                          // high-voltage cable/wire
    "300": ["6675"],                                  // maps / survey instruments
    "330": ["6810", "6840"],                          // fertilizer
    "335": ["6810", "6840"],                          // liquid fertilizer
    "340": ["6810"],                                  // chemicals bulk
    "375": ["8940"],                                  // subsistence / bread
    "379": ["8945"],                                  // soy/food products
    "380": ["8910", "8940"],                          // dairy/eggs/frozen foods
    "383": ["8905", "8940"],                          // meat entrees
    "385": ["8940", "8945"],                          // frozen/specialty entrees
    "390": ["8925"],                                  // margarine/oils
    "393": ["8945", "8950", "8960"],                  // staple grocery / jams / sweeteners
    "410": ["6530", "7105"],                          // medical/health furniture
    "420": ["7105", "7110", "7125"],                  // general furniture
    "425": ["7110", "7125", "7195"],                  // office furniture
    "445": ["5340", "5310"],                          // hardware & related
    "450": ["5340", "5310", "5305", "5306"],          // hardware / fasteners
    "465": ["5340"],                                  // misc hardware
    "475": ["6515", "8415", "5340"],                  // gloves / medical / hardware
    "490": ["6640", "6630", "6665", "6515"],          // lab equipment/supplies
    "495": ["6665"],                                  // nuclear / radiation
    "510": ["3411", "3413"],                          // lawn mowers (riding)
    "520": ["8330", "8335"],                          // shoe stitching/insole materials
    "525": ["8330"],                                  // shoe materials
    "540": ["3411", "3413", "3417", "3441"],          // metalworking machines
    "545": ["3411", "3417", "3441", "5130"],          // metalworking machines/tools
    "550": ["5805", "5810", "9905"],                  // vehicle detectors / signs
    "555": ["7690", "9905"],                          // stencils / signage
    "565": ["9905"],                                  // signage
    "570": ["9515", "9520", "9525", "9530"],          // metals: aluminum/steel bar/sheet
    "575": ["9515", "9520", "9530", "9540"],          // structural steel shapes
    "578": ["9905"],                                  // cemetery equip
    "620": ["7530", "7510"],                          // office paper/supplies
    "630": ["8010"],                                  // paint / coatings
    "640": ["7510", "7530"],                          // office supplies
    "650": ["6540"],                                  // eyeglasses/optics
    "655": ["6508", "7510"],                          // toothbrushes / misc
    "670": ["4510", "4520", "4720", "4730"],          // plumbing fixtures/fittings
    "671": ["4510", "4520"],                          // plumbing equipment
    "672": ["4510", "4520"],                          // plumbing trim
    "673": ["4520"],                                  // drains/grease traps (goods)
    "674": ["4510", "7240"],                          // water filters/coolers
    "675": ["4520"],                                  // water heaters
    "680": ["1005", "1095", "1305", "6920"],          // guns / ammunition
    "710": ["7610", "7690"],                          // books / publications
    "730": ["6625"],                                  // oscilloscopes/test instruments
    "740": ["7420"],                                  // office machines
    "760": ["3805", "3810"],                          // shovels/excavating/cranes
    "800": ["8430", "8435"],                          // shoes
    "805": ["5965", "5836"],                          // sound/AV
    "840": ["5836", "5820"],                          // television/AV equipment
    "845": ["6350"],                                  // signal/warning devices
    "850": ["8340", "7350"],                          // hot pads / soft goods
    "855": ["8345", "8455"],                          // flags / badges
    "880": ["5836", "6730"],                          // AV equipment
    "890": ["4610", "4630", "6630"],                  // water treatment/filtration equip
    // ── expansion from live ESBD export (unmapped product classes) ──
    "035": ["1560", "1680", "1730"],                  // aircraft/airport equipment
    "055": ["2540", "2590"],                          // automotive accessories
    "060": ["1650", "4320"],                          // hydraulic system components
    "065": ["3950", "3990", "2590"],                  // winches / automotive cranes
    "075": ["4940", "3610"],                          // vehicle washing systems
    "155": ["5410", "5411"],                          // modular/portable buildings
    "180": ["6810"],                                  // surfactants/chemicals
    "206": ["5895", "7025", "5985"],                  // network components (IT hardware)
    "269": ["6505"],                                  // drugs/pharma
    "280": ["6145", "6150"],                          // high-voltage cable & wire
    "287": ["6665", "5855"],                          // detectors
    "305": ["6675"],                                  // survey/GIS instruments
    "325": ["8710"],                                  // animal feed
    "470": ["6530"],                                  // wheelchairs/mobility
    "485": ["7920", "7930"],                          // brushes
    "493": ["6665", "6640"],                          // water-quality lab equipment
    "515": ["3750"],                                  // riding lawn mowers
    "557": ["9905", "8345"],                          // signage
    "560": ["3930"],                                  // forklifts / lift trucks
    "600": ["7530"],                                  // envelopes
    "645": ["7530"],                                  // copy paper
    "652": ["6508"],                                  // toothbrushes
    "658": ["4710"],                                  // brass/copper tubing
    "715": ["7690", "9905"],                          // promotional/souvenirs
    "037": ["7690", "9905"],                          // promotional
    "720": ["4320"],                                  // well pumps
    "726": ["5825", "5826"],                          // wildlife tracking equipment
    "765": ["2410", "3805"],                          // crawler tractors
    "785": ["6910"],                                  // teaching/electronic kits
    "790": ["8710"],                                  // seeds
    "801": ["7290", "7690"],                          // picture frames/framing
    "838": ["5895", "6145"],                          // comms networking/cabling
    "839": ["6145", "5895"],                          // copper cat5/6 cable
    "885": ["6810"],                                  // water treatment chemicals
  };

  const CLASS_LABEL = {
    "020": "Agri / Mowers", "031": "HVAC / A/C Units", "070": "Automobiles",
    "071": "Specialty Vehicles", "072": "Trucks", "073": "Trailers",
    "100": "Containers", "165": "Cafeteria/Kitchen Equip", "175": "Chemicals/Reagents",
    "185": "Chemicals", "193": "Test Kits/Reagents", "200": "Clothing/Uniforms",
    "201": "Uniforms", "204": "Uniform Accessories", "205": "Textiles/Fibers",
    "255": "Decals/Stamps", "285": "Cable/Wire", "300": "Survey Instruments",
    "330": "Fertilizer", "335": "Liquid Fertilizer", "340": "Bulk Chemicals",
    "375": "Bakery/Subsistence", "379": "Soy/Food", "380": "Dairy/Frozen Foods",
    "383": "Meat Entrees", "385": "Frozen/Specialty Foods", "390": "Margarine/Oils",
    "393": "Grocery/Jams/Sweeteners", "410": "Medical Furniture", "420": "General Furniture",
    "425": "Office Furniture", "445": "Hardware", "450": "Hardware/Fasteners",
    "465": "Misc Hardware", "475": "Gloves/Medical/Hardware", "490": "Lab Equip/Supplies",
    "495": "Nuclear/Radiation", "510": "Riding Mowers", "520": "Shoe Materials",
    "525": "Shoe Materials", "540": "Metalworking Machines", "545": "Metalworking Machines/Tools",
    "550": "Detectors/Signs", "555": "Stencils/Signage", "565": "Signage",
    "570": "Metals: Aluminum/Steel", "575": "Structural Steel", "578": "Cemetery Equip",
    "620": "Office Paper/Supplies", "630": "Paint/Coatings", "640": "Office Supplies",
    "650": "Eyeglasses/Optics", "655": "Misc Goods", "670": "Plumbing Fixtures",
    "671": "Plumbing Equipment", "672": "Plumbing Trim", "673": "Drains/Grease Traps",
    "674": "Water Filters/Coolers", "675": "Water Heaters", "680": "Guns/Ammo",
    "710": "Books/Publications", "730": "Test Instruments", "740": "Office Machines",
    "760": "Excavating/Cranes", "800": "Shoes", "805": "Sound/AV", "840": "AV Equipment",
    "845": "Signal/Warning", "850": "Soft Goods", "855": "Flags/Badges",
    "880": "AV Equipment", "890": "Water Treatment Equip",
    "035": "Aircraft/Airport Equip", "055": "Automotive Accessories", "060": "Hydraulic Components",
    "065": "Winches/Cranes", "075": "Vehicle Wash Systems", "155": "Modular Buildings",
    "180": "Surfactants", "206": "Network Components", "269": "Pharma/Drugs",
    "280": "HV Cable & Wire", "287": "Detectors", "305": "Survey/GIS Instruments",
    "325": "Animal Feed", "470": "Wheelchairs/Mobility", "485": "Brushes",
    "493": "Water-Quality Lab Equip", "515": "Riding Mowers", "557": "Signage",
    "560": "Forklifts", "600": "Envelopes", "645": "Copy Paper", "652": "Toothbrushes",
    "658": "Brass/Copper Tubing", "715": "Promotional", "037": "Promotional",
    "720": "Well Pumps", "726": "Wildlife Tracking Equip", "765": "Crawler Tractors",
    "785": "Teaching/Electronic Kits", "790": "Seeds", "801": "Picture Frames",
    "838": "Comms Networking", "839": "Copper Cable", "885": "Water Treatment Chemicals",
  };

  // NIGP class >= 900 is a service (construction, maintenance, IT, professional,
  // security). A handful of <900 classes are also service-like; list explicitly.
  const SERVICE_UNDER_900 = new Set([]);

  function classNumOf(cls) { return parseInt(cls, 10); }
  function isServiceClass(cls) {
    const n = classNumOf(cls);
    if (isNaN(n)) return false;
    return n >= 900 || SERVICE_UNDER_900.has(cls);
  }

  // Split an ESBD "NIGP Codes" field into individual {code, cls, label}.
  // Field looks like "91082-Wiring...;91438-Electrical;" or a single "95345-Flood".
  function parseCodes(nigpString) {
    if (!nigpString) return [];
    return String(nigpString)
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((chunk) => {
        const m = chunk.match(/^(\d{4,5})\s*-?\s*(.*)$/);
        if (!m) return null;
        const code = m[1];
        const cls = code.slice(0, 3);
        return { code, cls, label: (m[2] || "").trim() };
      })
      .filter(Boolean);
  }

  // Classify a whole solicitation from its NIGP Codes field.
  //   verdict: PRODUCT (primary code is a good) | MIXED (some goods, primary is
  //            a service) | SERVICE (no goods — not our lane)
  function classify(nigpString) {
    const codes = parseCodes(nigpString);
    if (!codes.length) return { verdict: "UNKNOWN", codes: [], fscLanes: [], productClasses: [], label: "" };

    const productCodes = codes.filter((c) => !isServiceClass(c.cls));
    const fscSet = new Set();
    const classSet = new Set();
    for (const c of productCodes) {
      classSet.add(c.cls);
      (NIGP_CLASS_TO_FSC[c.cls] || []).forEach((f) => fscSet.add(f));
    }
    const primaryIsProduct = codes.length && !isServiceClass(codes[0].cls);
    const verdict = !productCodes.length ? "SERVICE" : primaryIsProduct ? "PRODUCT" : "MIXED";
    const primary = productCodes[0] || codes[0];

    return {
      verdict,
      codes,
      productClasses: [...classSet],
      fscLanes: [...fscSet],
      unmappedClasses: [...classSet].filter((cl) => !NIGP_CLASS_TO_FSC[cl]),
      label: primary ? (CLASS_LABEL[primary.cls] || primary.label || ("NIGP " + primary.cls)) : "",
    };
  }

  var API = { classify, parseCodes, isServiceClass, NIGP_CLASS_TO_FSC, CLASS_LABEL };
  // Dual export: browser (window.SCC_NIGP) + Node (require) so the Netlify
  // ingestion function and the frontend share ONE crosswalk — never drift.
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SCC_NIGP = API;
})();
