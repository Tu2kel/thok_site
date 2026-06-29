// netlify/functions/scc-sba-import.js
// Parse SBA DSBS (search.certifications.sba.gov) CSV exports and bulk-import
// into the distributors collection.
// Actions: preview | import | getStatus

const { MongoClient } = require("mongodb");
const crypto = require("crypto");

const URI = process.env.MONGODB_URI;
const DB  = "scc_db";

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  return client.db(DB);
}

// ── NAICS → FSC crosswalk (mirrors scc-sam-lookup.js) ─────────────────────
const NAICS_FSC = {
  "332510": ["5305","5306","5307","5310","5315","5320","5325","5340"],
  "332720": ["5305","5306","5307","5308","5310","5315","5320","5325"],
  "332722": ["5305","5306","5307","5308","5310","5315","5320","5325"],
  "332613": ["5360","5365"],
  "332618": ["5340","5360","5365"],
  "332119": ["5340","5365"],
  "332710": ["5110","5120","5340"],
  "332911": ["4820","4840"],
  "332912": ["4820","4840"],
  "332919": ["4710","4720","4730","4740","4820","4840"],
  "332991": ["3110"],
  "332993": ["1310","1315","1320","1325","1340","1345","1377"],
  "332994": ["1305"],
  "332995": ["1010","1015","1020","1025","1030","1040","1045"],
  "332999": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","5365"],
  "326220": ["4710","4730"],
  "326291": ["5330","5331"],
  "326299": ["5330","5331"],
  "325212": ["5330","5331"],
  "334413": ["5961","5962"],
  "334412": ["5905","5910","5915","5925","5930","5935"],
  "334414": ["5905","5910","5915","5925","5930","5935"],
  "334415": ["5905","5910","5915","5920","5925","5930"],
  "334416": ["5905","5910","5915","5920","5925","5930","5935","5945"],
  "334417": ["5820","5825","5830","5835","5840","5845","5850","5855","5860","5865","5895"],
  "334418": ["5905","5910","5935","5940","5945","5960","5961","5962","5963"],
  "334419": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  "334511": ["6605","6610","6615","6620","6625","6630","6635","6640","6645","6650","6660"],
  "334515": ["6610","6620","6625","6630","6635","6640","6645","6650","6655","6660","6665"],
  "334614": ["5905","5910","5920","5925","5930","5935","5945"],
  "335311": ["6110","6115","6120","6125","6130"],
  "335312": ["6110","6115","6120","6125","6130"],
  "335313": ["6110","6115","6120","6125","6130"],
  "335314": ["6110","6115","6120","6125","6130"],
  "335911": ["6135","6140"],
  "335912": ["6135"],
  "335921": ["6145"],
  "335929": ["6145"],
  "335931": ["5940","5945","5970","5975"],
  "335932": ["5940","5945","5970","5975"],
  "335999": ["5905","5915","5920","5925","5930","5935","5940","5945","5975"],
  "336411": ["1510","1520","1540","1550"],
  "336412": ["1550","1560","1610","1615","1620","1630","1650","1660","1670","1680"],
  "336413": ["1550","1560","1610","1615","1620","1630","1650","1660","1670","1680","1710"],
  "336111": ["2310","2320","2510","2520","2530","2540","2590"],
  "336120": ["2510","2520","2530","2540","2590"],
  "336211": ["2510","2520","2530","2540","2590"],
  "336310": ["2910","2920","2930","2940","2990"],
  "336330": ["2510","2520","2530","2540","2590"],
  "336340": ["2510","2520","2530","2540","2590"],
  "336350": ["2510","2520","2530","2540","2590"],
  "333911": ["4320","4330"],
  "333912": ["4320","4330"],
  "333996": ["4820","4840"],
  "333991": ["5110","5120","5130","5136"],
  "333992": ["5110","5120"],
  "333612": ["3020","3030"],
  "333613": ["3020","3030","3110"],
  "333995": ["4820","4840"],
  "333921": ["3910","3920","3930","3940","3950"],
  "333922": ["3910","3920","3930","3940","3950"],
  "324191": ["9150"],
  "325110": ["6810","6830","6840","6850"],
  "325199": ["6810","6840","6850"],
  "325510": ["8010","8020","8030"],
  "325520": ["8010","8020","8030"],
  "325610": ["7930","6840"],
  "325920": ["1370","1375"],
  "325998": ["6810","6830","6840","6850","9150"],
  "331110": ["9510","9515","9520","9525","9530","9535","9540","9545"],
  "331210": ["9510","9515","9520","9525","9530","9535"],
  "331312": ["9610","9615","9620","9625","9630"],
  "331411": ["9710","9715","9720","9725","9730"],
  "331420": ["9710","9715","9720","9725","9730"],
  "339113": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "339114": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "423710": ["4710","4720","4730","4740","4820","4840","5110","5120","5340"],
  "423720": ["4710","4720","4730","4740","4820","4840","5340"],
  "423730": ["4110","4120","4130","4140"],
  "423740": ["4110","4120","4130","4140"],
  "423810": ["3805","3810","3815","3820","3825","3830"],
  "423820": ["3720","3740","3750","3760"],
  "423830": ["3110","3120","3130","4320","4330"],
  "423840": ["4320","4330","4710","4720","4730","4820","5110","5120","5340"],
  "423850": ["5110","5120","5130","5133","5136","5140"],
  "423510": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","9510","9515","9520","9525"],
  "423520": ["9505","9510","9515","9520","9525","9530","9535","9540","9545"],
  "423610": ["6110","6115","6120","6125","6130","6135","6140","6145","6150"],
  "423620": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  "423690": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  "423860": ["1550","1560","2510","2520","2530","2540","2550"],
  "423110": ["2310","2320","2510","2520","2530","2540","2590"],
  "423120": ["2910","2920","2930","2940","2990"],
  "423450": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "423460": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "423990": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","5360","5365"],
};

function naicsToFsc(naicsList) {
  const fscSet = new Set();
  for (const raw of (naicsList || [])) {
    const code = String(raw).replace(/\D/g, "").slice(0, 6);
    if (NAICS_FSC[code]) {
      NAICS_FSC[code].forEach(f => fscSet.add(f));
    } else {
      const prefix4 = code.slice(0, 4);
      for (const [k, v] of Object.entries(NAICS_FSC)) {
        if (k.startsWith(prefix4)) v.forEach(f => fscSet.add(f));
      }
    }
  }
  return [...fscSet].sort();
}

// ── CSV Parser ─────────────────────────────────────────────────────────────
// Handles quoted fields, doubled quotes inside quoted fields, \r\n and \n.
function parseCSV(text) {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const row = [];

    while (i < n && src[i] !== "\n") {
      let field = "";

      if (src[i] === '"') {
        i++; // skip opening quote
        while (i < n) {
          if (src[i] === '"' && src[i + 1] === '"') {
            field += '"';
            i += 2;
          } else if (src[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            field += src[i++];
          }
        }
      } else {
        while (i < n && src[i] !== "," && src[i] !== "\n") {
          field += src[i++];
        }
        field = field.trim();
      }

      row.push(field);
      if (i < n && src[i] === ",") i++;
    }

    if (i < n && src[i] === "\n") i++;
    if (row.length > 1 || (row.length === 1 && row[0])) rows.push(row);
  }

  return rows;
}

// ── Row parser ─────────────────────────────────────────────────────────────
// CSV columns: Business name | Contact name | Email | UEI | Phone | Website | CAGE | Business type | All NAICS
const HIDDEN_MSG = "The business owner has hidden this information from public searches";

function extractHyperlink(val) {
  // =HYPERLINK( "url", "COMPANY NAME, INC." ) → "COMPANY NAME, INC."
  if (!val || !val.startsWith("=HYPERLINK")) return val;
  const m = val.match(/,\s*"(.*?)"\s*\)\s*$/);
  return m ? m[1] : val;
}

function parseRow(cols) {
  if (!cols || cols.length < 8) return null;

  const name = extractHyperlink(cols[0]).trim();
  if (!name || name.startsWith("=HYPERLINK")) return null; // failed extraction

  const poc_name  = cols[1] ? cols[1].trim() || null : null;
  const email     = cols[2] && cols[2].trim() && cols[2].trim() !== HIDDEN_MSG ? cols[2].trim() : null;
  const uei       = cols[3] ? cols[3].trim() || null : null;
  const phone     = cols[4] && cols[4].trim() && cols[4].trim() !== HIDDEN_MSG ? cols[4].trim() : null;
  const website   = cols[5] ? cols[5].trim() || null : null;
  const cage_code = cols[6] ? cols[6].trim() || null : null;
  // cols[7] = business type — stored but not used for routing
  const naicsRaw  = cols[8] ? cols[8].trim() : (cols[7] ? cols[7].trim() : "");

  const naics = naicsRaw
    .split(",")
    .map(s => s.trim().replace(/\D/g, "").slice(0, 6))
    .filter(s => s.length >= 4);

  const fsc = naicsToFsc(naics);

  return { name, poc_name, email, uei, phone, website, cage_code, naics, fsc };
}

// ── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { action, csv } = body;

  try {
    const db   = await getDb();
    const dist = db.collection("distributors");

    // ── getStatus ────────────────────────────────────────────────────────
    if (action === "getStatus") {
      const count = await dist.countDocuments({});
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result: { count } }) };
    }

    if (action !== "preview" && action !== "import") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }

    if (!csv) return { statusCode: 400, headers, body: JSON.stringify({ error: "csv required" }) };

    // ── Parse CSV ────────────────────────────────────────────────────────
    const rows = parseCSV(csv);
    if (rows.length < 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No data rows found — check CSV format" }) };
    }

    // Detect header row (first col should NOT start with =HYPERLINK)
    const startIdx = rows[0][0].startsWith("=HYPERLINK") ? 0 : 1;
    const dataRows = rows.slice(startIdx);

    const parsed = dataRows.map(parseRow).filter(r => r !== null);

    // ── Load existing keys for dedup ──────────────────────────────────────
    const existing = await dist
      .find({}, { projection: { uei: 1, cage_code: 1, _id: 0 } })
      .toArray();
    const existingUEIs  = new Set(existing.map(e => e.uei).filter(Boolean));
    const existingCAGEs = new Set(existing.map(e => e.cage_code).filter(Boolean));

    // ── Classify rows ─────────────────────────────────────────────────────
    const stats = {
      total_rows:       dataRows.length,
      parsed:           parsed.length,
      no_fsc:           0,
      no_contact:       0,
      dup_uei:          0,
      dup_cage:         0,
      new_vendors:      0,
    };

    const seenUEIs  = new Set(existingUEIs);
    const seenCAGEs = new Set(existingCAGEs);
    const toImport  = [];

    for (const r of parsed) {
      if (r.fsc.length === 0) { stats.no_fsc++; continue; }
      if (!r.email && !r.phone) { stats.no_contact++; continue; }

      if (r.uei && seenUEIs.has(r.uei)) { stats.dup_uei++; continue; }
      if (!r.uei && r.cage_code && seenCAGEs.has(r.cage_code)) { stats.dup_cage++; continue; }

      // Track within this batch to avoid duplicate imports from the same CSV
      if (r.uei) seenUEIs.add(r.uei);
      if (r.cage_code) seenCAGEs.add(r.cage_code);

      toImport.push(r);
      stats.new_vendors++;
    }

    if (action === "preview") {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result: stats }) };
    }

    // ── Import ────────────────────────────────────────────────────────────
    const records = toImport.map(r => ({
      id:         r.uei || crypto.createHash("md5").update((r.name + (r.cage_code || "")).toLowerCase()).digest("hex").slice(0, 16),
      name:       r.name,
      poc_name:   r.poc_name,
      email:      r.email,
      phone:      r.phone,
      website:    r.website,
      cage_code:  r.cage_code,
      uei:        r.uei,
      fsc:        r.fsc,
      naics:      r.naics,
      tier:       2,
      source:     "sba_sbs",
      is_dns:     false,
      known_nsns:    [],
      part_prefixes: [],
      tags:          [],
    }));

    let inserted = 0;
    const importErrors = [];

    if (records.length > 0) {
      try {
        const result = await dist.insertMany(records, { ordered: false });
        inserted = result.insertedCount;
      } catch (e) {
        if (e.code === 11000 || e.code === 65) {
          // Partial insert — some _id conflicts (shouldn't happen but handle gracefully)
          inserted = e.result?.insertedCount || 0;
          importErrors.push(`${records.length - inserted} skipped due to conflicts`);
        } else {
          throw e;
        }
      }
    }

    const finalCount = await dist.countDocuments({});

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        result: { ...stats, inserted, final_count: finalCount, errors: importErrors },
      }),
    };
  } catch (err) {
    console.error("scc-sba-import error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
