// netlify/functions/scc-sam-lookup.js
// SAM.gov POC enrichment for distributor DB — SBA DSBS fallback when SAM has no contact
// Actions: lookupPOC (single vendor) | enrichAll (bulk, batched)

const { MongoClient } = require("mongodb");

const SAM_KEY     = process.env.SAM_API_KEY;
const SAM_BASE    = "https://api.sam.gov/entity-information/v3/entities";
const SBA_SEARCH  = "https://search.certifications.sba.gov/search";
const SBA_PROFILE = "https://search.certifications.sba.gov/profile";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = "scc_db";

// ── NAICS → FSC crosswalk ────────────────────────────────────────────────────
// Key DLA supply categories. Map NAICS 6-digit → FSC 4-digit supply codes.
const NAICS_FSC = {
  // ── Chemicals, Rubber & Plastics ──
  "321113": ["3210"],
  "321114": ["3210"],
  "321211": ["3220"],
  "321212": ["3220"],
  "321215": ["3220"],
  "321219": ["3220"],
  "321911": ["3220"],
  "321912": ["3210","3220","3418","5510"],
  "321918": ["3220"],
  "321920": ["3220"],
  "321991": ["3220"],
  "321992": ["3220"],
  "321999": ["3220"],
  "322110": ["3615"],
  "322120": ["3615"],
  "322130": ["3615"],
  "322211": ["3615"],
  "322212": ["9310"],
  "322219": ["3615","8115"],
  "322220": ["3615"],
  "322230": ["3615"],
  "322291": ["3615"],
  "322299": ["3615"],
  "323111": ["3610"],
  "323113": ["3610"],
  "323117": ["3610"],
  "323120": ["3610"],
  "324110": ["3835"],
  "324121": ["3630"],
  "324122": ["3630"],
  "324191": ["3835","9150"],
  "324199": ["3422","3835","4430","9110","9640"],
  "325110": ["3650","6810","6830","6840","6850"],
  "325120": ["3650"],
  "325130": ["3650"],
  "325180": ["3610","3650","6810","6820","6850","9620"],
  "325193": ["3650"],
  "325194": ["3650"],
  "325199": ["3650","6810","6840","6850","8945"],
  "325211": ["3620"],
  "325212": ["3620","5330","5331"],
  "325220": ["3620"],
  "325311": ["8720"],
  "325312": ["8720"],
  "325314": ["8720"],
  "325315": ["8720"],
  "325411": ["3650"],
  "325412": ["3650"],
  "325413": ["3650"],
  "325414": ["3650"],
  "325510": ["8010","8020","8030"],
  "325520": ["8010","8020","8030"],
  "325610": ["6840","7930"],
  "325611": ["8520"],
  "325612": ["8520"],
  "325613": ["8520"],
  "325620": ["8510"],
  "325910": ["3610"],
  "325920": ["1105","1110","1115","1120","1125","1127","1145","1325","1330","1340","1345","1351","1353","1356","1361","1370","1375","1376","1377"],
  "325991": ["3620"],
  "325992": ["6770"],
  "325998": ["1370","3650","6810","6830","6840","6850","8020","9150","9620","9920"],
  "326111": ["3620"],
  "326112": ["3620"],
  "326113": ["3620"],
  "326121": ["3620"],
  "326122": ["1080","3620","4710","4730"],
  "326130": ["3620"],
  "326140": ["3620"],
  "326150": ["3620"],
  "326160": ["3620"],
  "326191": ["3620"],
  "326199": ["3620"],
  "326211": ["2610","2620","2630","2640"],
  "326220": ["3620","4710","4730"],
  "326291": ["3620","5330","5331"],
  "326299": ["3030","3620","4220","5330","5331","5430","7220","9320"],
  "327110": ["3630","5975","7290","7320","7350","9390"],
  "327120": ["3630"],
  "327211": ["3635"],
  "327212": ["3635"],
  "327213": ["3635"],
  "327215": ["3635"],
  "327310": ["3630"],
  "327320": ["3630"],
  "327331": ["3630"],
  "327332": ["3630"],
  "327390": ["3630"],
  "327410": ["3630"],
  "327420": ["3630"],
  "327999": ["3630","5610","9390"],

  // ── Manufacturing (Metals, Machinery, Electronics, Vehicles) ──
  "331110": ["4430","9510","9515","9520","9525","9530","9535","9540","9545","9610","9630","9640"],
  "331210": ["9510","9515","9520","9525","9530","9535","9640"],
  "331221": ["3422","9510","9515","9520","9640","9660"],
  "331222": ["3422"],
  "331312": ["9610","9615","9620","9625","9630"],
  "331313": ["9630"],
  "331314": ["9630","9640","9650","9660"],
  "331315": ["9630"],
  "331318": ["9630"],
  "331410": ["9650"],
  "331411": ["9710","9715","9720","9725","9730"],
  "331420": ["3422","4710","9640","9650","9660","9710","9715","9720","9725","9730"],
  "331491": ["3422","9530","9540"],
  "331492": ["9650"],
  "331511": ["3680"],
  "331512": ["3680"],
  "331513": ["3680"],
  "331523": ["3680"],
  "331524": ["3680"],
  "331529": ["3680"],
  "332111": ["3446"],
  "332112": ["3446"],
  "332114": ["3446"],
  "332117": ["3446"],
  "332119": ["3446","5340","5365"],
  "332215": ["7310","7320","7330","7340"],
  "332216": ["3405","3414","3455","3456","3750","3770","5110","5120","5130","5180","5210","6145","6670","9505"],
  "332311": ["5410","5440","5445","5450"],
  "332312": ["5410","5420","5445","5680","9510","9530","9535","9999"],
  "332313": ["2050","8115","9515","9535","9545"],
  "332321": ["9535"],
  "332322": ["9515","9535","9545"],
  "332323": ["5660","9520","9535","9540"],
  "332410": ["4410"],
  "332420": ["5430"],
  "332431": ["3685"],
  "332439": ["1740","2410","2420","2430","3685","5140","7125","7240","8110","8115","8145"],
  "332510": ["2040","4030","4220","5305","5306","5307","5310","5315","5320","5325","5340","7125"],
  "332613": ["5360","5365"],
  "332618": ["4010","5315","5335","5340","5360","5365","5660","7510","9505","9525","9999"],
  "332710": ["3470","5110","5120","5340"],
  "332720": ["5305","5306","5307","5308","5310","5315","5320","5325"],
  "332721": ["5320"],
  "332722": ["3448","5305","5306","5307","5308","5310","5315","5320","5325"],
  "332811": ["3424"],
  "332812": ["3426"],
  "332813": ["3415","7930","9545"],
  "332911": ["4810","4820","4840"],
  "332912": ["2895","4810","4820","4840"],
  "332913": ["4510","4540"],
  "332919": ["4510","4710","4720","4730","4740","4810","4820","4840","5630"],
  "332991": ["3110","3120","3130"],
  "332992": ["1305","1390"],
  "332993": ["1115","1310","1315","1320","1325","1340","1345","1350","1377","1395"],
  "332994": ["1005","1010","1015","1020","1025","1030","1035","1040","1045","1055","1090","1095","1140","1190","1195","1305"],
  "332995": ["1010","1015","1020","1025","1030","1040","1045"],
  "332996": ["4710","4730","5630"],
  "332999": ["1290","1740","2410","2420","2430","2510","3680","4510","4720","5305","5306","5307","5310","5315","5320","5325","5330","5335","5340","5345","5350","5365","5419","7240","7350","8140","9515","9640","9999"],
  "333111": ["3720"],
  "333112": ["3710","3720","3740","3750"],
  "333120": ["3805"],
  "333131": ["3820"],
  "333132": ["3820"],
  "333241": ["3230"],
  "333242": ["5961"],
  "333243": ["3220","3230","3615"],
  "333248": ["3408"],
  "333310": ["3408"],
  "333413": ["4460"],
  "333414": ["4520"],
  "333415": ["4110","4120","4130","6640","9515","9535","9545"],
  "333511": ["3422"],
  "333514": ["3410"],
  "333515": ["3414","3455","3456","3460","5133","5136","5210","5220","5280"],
  "333517": ["3412","3413","3414","3415","3416","3417","3419","3441","3442","3444","3445","3446","3448","3449","3455","3456"],
  "333519": ["3422"],
  "333611": ["2836"],
  "333612": ["3020","3030"],
  "333613": ["2520","3020","3030","3040","3110"],
  "333618": ["2805","2810","2815","2835","2845","2895","2930","2940","2990","6105"],
  "333911": ["4320","4330"],
  "333912": ["4310","4320","4330"],
  "333914": ["5210"],
  "333921": ["3910","3920","3930","3940","3950","3960"],
  "333922": ["3910","3920","3930","3940","3950"],
  "333923": ["3020","3810","3815","3920","3940","3950","3990"],
  "333924": ["1670","1740","2320","2410","2420","2430","3920","3990","9999"],
  "333991": ["5110","5120","5130","5136","5310"],
  "333992": ["3431","3432","3433","3436","3438","3439","5110","5120"],
  "333993": ["3540"],
  "333994": ["3424","4430","4440","6640"],
  "333995": ["4310","4820","4840"],
  "333996": ["4310","4820","4840"],
  "333998": ["3408"],
  "334111": ["5963","7021"],
  "334112": ["7025"],
  "334118": ["1220","7050","7420"],
  "334210": ["5805"],
  "334220": ["5820"],
  "334290": ["5810","5811","5815","5845","5850","5895","6940"],
  "334310": ["5820","5830","5831","5965","7730"],
  "334412": ["3670","5905","5910","5915","5925","5930","5935"],
  "334413": ["5961","5962","5963","5980"],
  "334414": ["5905","5910","5915","5925","5930","5935"],
  "334415": ["5905","5910","5915","5920","5925","5930"],
  "334416": ["5905","5910","5915","5920","5925","5930","5935","5945","5950"],
  "334417": ["5820","5825","5830","5835","5840","5845","5850","5855","5860","5865","5895","5935"],
  "334418": ["1220","1260","3670","5805","5905","5910","5935","5940","5945","5960","5961","5962","5963","7050"],
  "334419": ["1260","1270","1280","1285","4910","4920","4925","4931","4933","4935","4940","5905","5910","5915","5920","5925","5930","5935","5940","5945","5955","5960","5961","5962","5963","5975","5985","5999"],
  "334510": ["6525"],
  "334511": ["1270","1355","1430","5825","5826","5840","5841","5855","5860","6605","6610","6615","6620","6625","6630","6635","6640","6645","6650","6655","6660","6665"],
  "334512": ["6685"],
  "334513": ["6685","6695"],
  "334514": ["2590","4910","4920","4925","4931","4933","4935","4940","6620","6625","6680","7420"],
  "334515": ["6525","6610","6620","6625","6630","6635","6640","6645","6650","6655","6660","6665"],
  "334516": ["6630","6635"],
  "334517": ["6525"],
  "334519": ["5210","5360","6635","6645","6675","6680","6685","6695","7490","7520"],
  "334610": ["6650"],
  "334614": ["5905","5910","5920","5925","5930","5935","5945"],
  "335131": ["6212"],
  "335132": ["6213"],
  "335210": ["5963","7290","7910"],
  "335311": ["3431","5950","6110","6115","6120","6125","6130","6150","6160","6250","6310","6350"],
  "335312": ["5990","6105","6110","6115","6120","6125","6130","6620"],
  "335313": ["5925","5930","6110","6115","6120","6125","6130","9999"],
  "335314": ["5945","6110","6115","6120","6125","6130"],
  "335910": ["6135"],
  "335911": ["6135","6140"],
  "335912": ["6135"],
  "335921": ["6015","6145"],
  "335929": ["6145"],
  "335931": ["5920","5935","5940","5945","5970","5975","5995","6145"],
  "335932": ["5940","5945","5970","5975","9505","9525"],
  "335991": ["9530"],
  "335999": ["5905","5915","5920","5925","5930","5935","5940","5945","5975","6105","6110","6115","6125","6130","6145","6150","6210","6220","6230","6240","7050"],
  "336111": ["2310","2320","2510","2520","2530","2540","2590"],
  "336120": ["2510","2520","2530","2540","2590"],
  "336211": ["2310","2510","2520","2530","2540","2590"],
  "336310": ["2590","2805","2815","2820","2825","2830","2850","2895","2910","2920","2930","2940","2990","4810","4820"],
  "336320": ["2920","2925","6220"],
  "336330": ["2510","2520","2530","2540","2590"],
  "336340": ["2510","2520","2530","2540","2590"],
  "336350": ["2510","2520","2530","2540","2590","3020","3040"],
  "336360": ["2510","2540"],
  "336370": ["3442","3443","3444"],
  "336390": ["1290","2530","2540","2541","2590","2610","2620","2630","2640","2805","2815","2895","2915","2925","2935","2945","2950","2995","3010","3030","3110","3120","3130","3830","7240"],
  "336411": ["1510","1520","1540","1550"],
  "336412": ["1550","1560","1610","1615","1620","1630","1650","1660","1670","1680","2810","2840","2915","2935","2945","2950","2995"],
  "336413": ["1510","1520","1550","1560","1610","1615","1620","1630","1650","1660","1670","1680","1710","1720","1730","6340","6910","6920","6930","8115","8135","8145"],
  "336414": ["1336","1410","1427"],
  "336415": ["1337","1338","1440","2845"],
  "336419": ["1420","1425","1427","1430","1440","1450","1820"],
  "336510": ["2210","2220","2240","2250","4930"],
  "336611": ["1905","1915","1925","1930","1935","2090"],
  "336612": ["1940","1945","2010","2040"],
  "336991": ["2340"],
  "336992": ["1915","2305","2350"],
  "336999": ["2305"],
  "337110": ["7110","7125"],
  "337121": ["7105"],
  "337122": ["7105"],
  "337126": ["7105"],
  "337127": ["6640","7105","7110","7195"],
  "337211": ["7110"],
  "337214": ["7110"],
  "337215": ["7105","7110","7125","7195","7210","7220","7230"],
  "337910": ["7105"],
  "337920": ["7230"],
  "339112": ["6515","6516","6545"],
  "339113": ["4220","4240","6505","6510","6515","6516","6520","6525","6530","6532","6540","6545","6550","6640","8030"],
  "339114": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "339115": ["6540"],
  "339116": ["6520"],
  "339910": ["7350","8315"],
  "339920": ["7810"],
  "339930": ["3530","7820"],
  "339940": ["3611","6675","7195","7490","7510","7520","8020"],
  "339950": ["9905"],
  "339991": ["5330"],
  "339992": ["7710"],
  "339993": ["5315","5325","8315","8335"],
  "339994": ["7910","7920"],
  "339999": ["6515","7105","7290","7640","9999"],

  // ── Wholesale Distributors ──
  "423110": ["2310","2320","2510","2520","2530","2540","2590"],
  "423120": ["2910","2920","2930","2940","2990"],
  "423450": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "423460": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "423510": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","9510","9515","9520","9525"],
  "423520": ["9505","9510","9515","9520","9525","9530","9535","9540","9545"],
  "423610": ["6110","6115","6120","6125","6130","6135","6140","6145","6150"],
  "423620": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  "423690": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  "423710": ["4710","4720","4730","4740","4820","4840","5110","5120","5340"],
  "423720": ["4710","4720","4730","4740","4820","4840","5340"],
  "423730": ["4110","4120","4130","4140"],
  "423740": ["4110","4120","4130","4140"],
  "423810": ["3805","3810","3815","3820","3825","3830"],
  "423820": ["3720","3740","3750","3760"],
  "423830": ["3110","3120","3130","4320","4330"],
  "423840": ["4320","4330","4710","4720","4730","4820","5110","5120","5340"],
  "423850": ["5110","5120","5130","5133","5136","5140"],
  "423860": ["1550","1560","2510","2520","2530","2540","2550"],
  "423990": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","5360","5365"],
};

// Map a list of NAICS codes to FSC codes
function naicsToFsc(naicsList) {
  const fscSet = new Set();
  for (const raw of (naicsList || [])) {
    const code = String(raw).replace(/\D/g, "").slice(0, 6);
    if (NAICS_FSC[code]) {
      NAICS_FSC[code].forEach(f => fscSet.add(f));
    } else {
      // 4-digit subsector fallback: match any entry whose key starts with the first 4 digits
      const prefix4 = code.slice(0, 4);
      for (const [k, v] of Object.entries(NAICS_FSC)) {
        if (k.startsWith(prefix4)) v.forEach(f => fscSet.add(f));
      }
    }
  }
  return [...fscSet].sort();
}

// Fetch SBA DSBS profile page by UEI + CAGE and extract NAICS codes
async function sbaProfileNaics(uei, cage) {
  if (!uei || !cage) return null;
  try {
    const url = SBA_PROFILE + "/" + encodeURIComponent(uei) + "/" + encodeURIComponent(cage);
    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/html, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin:  "https://search.certifications.sba.gov",
        Referer: "https://search.certifications.sba.gov/",
      },
    });
    if (!res.ok) return null;

    const ct = res.headers.get("content-type") || "";
    const text = await res.text();

    if (ct.includes("json")) {
      // Parse JSON and walk for any naics-keyed fields
      const data = JSON.parse(text);
      const codes = [];
      function walk(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(walk); return; }
        for (const [k, v] of Object.entries(obj)) {
          if (/naics/i.test(k)) {
            if (typeof v === "string" && /^\d{4,6}$/.test(v)) codes.push(v);
            if (typeof v === "number") codes.push(String(v));
            if (Array.isArray(v)) v.forEach(item => {
              if (typeof item === "string" && /^\d{4,6}$/.test(item)) codes.push(item);
              if (item && typeof item === "object") {
                for (const [ik, iv] of Object.entries(item)) {
                  if (/code/i.test(ik) && /^\d{4,6}$/.test(String(iv || ""))) codes.push(String(iv));
                }
              }
            });
          }
          walk(v);
        }
      }
      walk(data);
      const unique = [...new Set(codes.filter(c => /^\d{6}$/.test(c)))];
      return unique.length ? unique : null;
    }

    // HTML response — extract 6-digit numbers in valid NAICS sector ranges
    const matches = text.match(/\b(?:11|21|22|23|31|32|33|42|44|45|48|49|51|52|53|54|55|56|61|62|71|72|81|92)\d{4}\b/g) || [];
    const unique = [...new Set(matches)];
    return unique.length ? unique : null;
  } catch {
    return null;
  }
}

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Search SAM.gov by legal business name or CAGE code
async function samLookup(name, cage) {
  const params = new URLSearchParams({
    api_key:          SAM_KEY,
    includeSections:  "entityRegistration,goodsAndServices,pointsOfContact",
    registrationStatus: "A",
  });

  // Try CAGE first (most precise), fall back to name
  if (cage) {
    params.set("cageCode", cage);
  } else {
    // Exact name first
    params.set("legalBusinessName", name);
  }

  let res  = await fetch(SAM_BASE + "?" + params.toString());
  let data = await res.json();

  // If no results with exact name, try first-word wildcard
  if (!cage && (!data.entityData || !data.entityData.length)) {
    const firstWord = name.split(/[\s,]/)[0];
    if (firstWord && firstWord.length >= 3) {
      params.set("legalBusinessName", firstWord + "%");
      res  = await fetch(SAM_BASE + "?" + params.toString());
      data = await res.json();
    }
  }

  if (!data.entityData || !data.entityData.length) return null;

  // Pick closest name match if multiple results
  const entities = data.entityData;
  const target   = name.toUpperCase();
  entities.sort((a, b) => {
    const na = (a.entityRegistration?.legalBusinessName || "").toUpperCase();
    const nb = (b.entityRegistration?.legalBusinessName || "").toUpperCase();
    const da = na === target ? 0 : na.startsWith(target.split(" ")[0]) ? 1 : 2;
    const db = nb === target ? 0 : nb.startsWith(target.split(" ")[0]) ? 1 : 2;
    return da - db;
  });

  const entity = entities[0];
  const reg    = entity.entityRegistration || {};
  const poc    = entity.pointsOfContact || {};
  const g_s    = entity.goodsAndServices || {};

  // PSC codes the vendor self-registered in SAM — filter to 4-digit numeric (supply FSCs only)
  const rawPscs = (g_s.pscCodes || []).map(p => (typeof p === "string" ? p : p.pscCode || "")).filter(Boolean);
  const fscFromSam = [...new Set(rawPscs.filter(p => /^\d{4}$/.test(p)))].sort();

  // Primary NAICS for reference
  const primaryNaics = g_s.primaryNaics || null;
  const naicsList    = (g_s.naicsList || []).map(n => (typeof n === "string" ? n : n.naicsCode || n.code || "")).filter(Boolean);

  // Prefer Government Business POC, fall back to Electronic Business POC
  const contact = poc.governmentBusinessPOC || poc.electronicBusinessPOC || poc.pastPerformancePOC || null;

  if (!contact) return {
    cage_code:      reg.cageCode || null,
    uei:            reg.ueiSAM   || null,
    sam_name:       reg.legalBusinessName || null,
    fsc_from_sam:   fscFromSam,
    primary_naics:  primaryNaics,
    naics_list:     naicsList,
  };

  const firstName = (contact.firstName || "").trim();
  const lastName  = (contact.lastName  || "").trim();
  const fullName  = [firstName, lastName].filter(Boolean).join(" ");

  return {
    poc_first:     firstName  || null,
    poc_last:      lastName   || null,
    poc_name:      fullName   || null,
    poc_title:     (contact.title || "").trim() || null,
    poc_email:     (contact.email || "").trim().toLowerCase() || null,
    poc_phone:     (contact.phoneNumber || "").trim() || null,
    cage_code:     reg.cageCode     || null,
    uei:           reg.ueiSAM       || null,
    sam_name:      reg.legalBusinessName || null,
    fsc_from_sam:  fscFromSam,
    primary_naics: primaryNaics,
    naics_list:    naicsList,
  };
}

// Title-case a string like "DWANE DUNGAN" → "Dwane Dungan"
function toTitleCase(str) {
  return (str || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// SBA DSBS fallback — POST to certifications search, no API key required
// Response shape confirmed: { status: 200, results: [ { contact_person, email, phone,
//   legal_business_name, cage_code, uei, current_principals: "Name - Title" } ] }
async function sbaLookup(name) {
  try {
    const body = {
      searchProfiles:          { searchTerm: name },
      annualRevenue:           { relationOperator: "at-least", annualGrossRevenue: "" },
      bondingLevels:           { constructionIndividual: "", constructionAggregate: "", serviceIndividual: "", serviceAggregate: "" },
      businessSize:            { relationOperator: "at-least", numberOfEmployees: "" },
      entityDetailId:          "",
      keywords:                { list: [], operatorType: "Or" },
      lastUpdated:             { date: { label: "Anytime", value: "anytime" } },
      location:                { states: [], zipCodes: [], counties: [], districts: [], msas: [] },
      naics:                   { codes: [], isPrimary: false, operatorType: "Or" },
      qualityAssuranceStandards: { qas: [] },
      samStatus:               { isActiveSAM: false },
      sbaCertifications:       { activeCerts: [], isPreviousCert: false, operatorType: "Or" },
      selfCertifications:      { certifications: [], operatorType: "Or" },
    };

    const res = await fetch(SBA_SEARCH, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      body:    JSON.stringify(body),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) return null;

    // Find closest legal_business_name match
    const target = name.toUpperCase();
    results.sort((a, b) => {
      const na = (a.legal_business_name || "").toUpperCase();
      const nb = (b.legal_business_name || "").toUpperCase();
      const score = n => n === target ? 0 : n.startsWith(target.split(" ")[0]) ? 1 : 2;
      return score(na) - score(nb);
    });

    const r = results[0];

    const rawName   = (r.contact_person || "").trim();
    const fullName  = toTitleCase(rawName);                        // "DWANE DUNGAN" → "Dwane Dungan"
    const nameParts = fullName.split(" ");
    const firstName = nameParts[0] || null;
    const lastName  = nameParts.slice(1).join(" ") || null;
    const email     = (r.email || "").trim().toLowerCase() || null;
    const phone     = (r.phone || "").trim() || null;

    // Extract title from "Dwane Dungan - Managing Partner"
    let title = null;
    if (r.current_principals) {
      const m = r.current_principals.match(/-\s*(.+)$/);
      if (m) title = m[1].trim();
    }

    if (!fullName && !email) return null;

    const website = (r.website || r.additional_website || "").trim() || null;

    // Capture NAICS codes from the search result — field names vary
    const naicsList = [];
    for (const key of ["naics_code","primary_naics","naics","naics_codes","all_naics"]) {
      const v = r[key];
      if (!v) continue;
      if (typeof v === "string" && /^\d{4,6}$/.test(v)) naicsList.push(v);
      if (Array.isArray(v)) v.forEach(n => {
        if (typeof n === "string" && /^\d{4,6}$/.test(n)) naicsList.push(n);
        if (n && typeof n === "object") {
          const c = n.code || n.naics_code || n.naicsCode || "";
          if (/^\d{4,6}$/.test(String(c))) naicsList.push(String(c));
        }
      });
    }
    // naics_descriptions is sometimes an array of { code, title } objects
    const nd = r.naics_descriptions || r.naics_list || [];
    if (Array.isArray(nd)) nd.forEach(n => {
      const c = typeof n === "string" ? n : (n.code || n.naics_code || "");
      if (/^\d{4,6}$/.test(String(c))) naicsList.push(String(c));
    });

    return {
      poc_first:    firstName,
      poc_last:     lastName,
      poc_name:     fullName  || null,
      poc_title:    title,
      poc_email:    email,
      poc_phone:    phone,
      sba_website:  website,
      cage_code:    r.cage_code || null,
      uei:          r.uei       || null,
      sam_name:     r.legal_business_name || null,
      poc_source:   "sba",
      naics_list:   [...new Set(naicsList)],
      primary_naics: naicsList[0] || null,
    };
  } catch {
    return null;
  }
}

// SBA search purely for NAICS codes — no contact info required
async function sbaSearchNaics(name) {
  try {
    const body = {
      searchProfiles:          { searchTerm: name },
      annualRevenue:           { relationOperator: "at-least", annualGrossRevenue: "" },
      bondingLevels:           { constructionIndividual: "", constructionAggregate: "", serviceIndividual: "", serviceAggregate: "" },
      businessSize:            { relationOperator: "at-least", numberOfEmployees: "" },
      entityDetailId:          "",
      keywords:                { list: [], operatorType: "Or" },
      lastUpdated:             { date: { label: "Anytime", value: "anytime" } },
      location:                { states: [], zipCodes: [], counties: [], districts: [], msas: [] },
      naics:                   { codes: [], isPrimary: false, operatorType: "Or" },
      qualityAssuranceStandards: { qas: [] },
      samStatus:               { isActiveSAM: false },
      sbaCertifications:       { activeCerts: [], isPreviousCert: false, operatorType: "Or" },
      selfCertifications:      { certifications: [], operatorType: "Or" },
    };
    const res = await fetch(SBA_SEARCH, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin:  "https://search.certifications.sba.gov",
        Referer: "https://search.certifications.sba.gov/",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const preview = (await res.text()).slice(0, 300);
      return { _err: true, status: res.status, preview };
    }

    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) {
      return { _err: true, status: 200, preview: "empty: " + JSON.stringify(data).slice(0, 200) };
    }

    // Closest name match
    const target = name.toUpperCase();
    results.sort((a, b) => {
      const na = (a.legal_business_name || "").toUpperCase();
      const nb = (b.legal_business_name || "").toUpperCase();
      const score = n => n === target ? 0 : n.startsWith(target.split(" ")[0]) ? 1 : 2;
      return score(na) - score(nb);
    });
    const r = results[0];

    // Collect NAICS codes from all plausible field names
    const naicsList = [];
    for (const key of ["naics_code","primary_naics","naics","naics_codes","all_naics"]) {
      const v = r[key];
      if (!v) continue;
      if (typeof v === "string" && /^\d{4,6}$/.test(v)) naicsList.push(v);
      if (Array.isArray(v)) v.forEach(n => {
        if (typeof n === "string" && /^\d{4,6}$/.test(n)) naicsList.push(n);
        if (n && typeof n === "object") {
          const c = n.code || n.naics_code || n.naicsCode || "";
          if (/^\d{4,6}$/.test(String(c))) naicsList.push(String(c));
        }
      });
    }
    const nd = r.naics_descriptions || r.naics_list || [];
    if (Array.isArray(nd)) nd.forEach(n => {
      const c = typeof n === "string" ? n : (n.code || n.naics_code || "");
      if (/^\d{4,6}$/.test(String(c))) naicsList.push(String(c));
    });

    return {
      uei:           r.uei       || null,
      cage_code:     r.cage_code || null,
      sam_name:      r.legal_business_name || null,
      naics_list:    [...new Set(naicsList)],
      primary_naics: naicsList[0] || null,
      raw_keys:      Object.keys(r).join(","),  // debug: see all field names on first run
    };
  } catch {
    return null;
  }
}

// SBA SBS /_api/v2/search — returns naics_primary + naics_all_codes in results
// Requires Referer: .../advanced to pass the nginx/backend gate
async function sbsSearch(name) {
  try {
    const body = {
      searchProfiles:          { searchTerm: name },
      annualRevenue:           { relationOperator: "at-least", annualGrossRevenue: "" },
      bondingLevels:           { constructionIndividual: "", constructionAggregate: "", serviceIndividual: "", serviceAggregate: "" },
      businessSize:            { relationOperator: "at-least", numberOfEmployees: "" },
      entityDetailId:          "",
      keywords:                { list: [], operatorType: "Or" },
      lastUpdated:             { date: { label: "Anytime", value: "anytime" } },
      location:                { states: [], zipCodes: [], counties: [], districts: [], msas: [] },
      naics:                   { codes: [], isPrimary: false, operatorType: "Or" },
      qualityAssuranceStandards: { qas: [] },
      samStatus:               { isActiveSAM: false },
      sbaCertifications:       { activeCerts: [], isPreviousCert: false, operatorType: "Or" },
      selfCertifications:      { certifications: [], operatorType: "Or" },
    };
    const res = await fetch("https://search.certifications.sba.gov/_api/v2/search", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin:         "https://search.certifications.sba.gov",
        Referer:        "https://search.certifications.sba.gov/advanced",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data?.results || []);
    if (!results.length) return null;

    const target = name.toUpperCase();
    results.sort((a, b) => {
      const score = n => {
        const u = (n || "").toUpperCase();
        return u === target ? 0 : u.startsWith(target.split(" ")[0]) ? 1 : 2;
      };
      return score(a.legal_business_name || a.contact_person) - score(b.legal_business_name || b.contact_person);
    });
    const r = results[0];
    const naicsAll = [...new Set([r.naics_primary, ...(r.naics_all_codes || [])].filter(Boolean).map(String))];
    return {
      uei:       r.uei       || null,
      cage_code: r.cage_code || null,
      sam_name:  r.legal_business_name || r.contact_person || null,
      naics_list:    naicsAll,
      primary_naics: r.naics_primary || naicsAll[0] || null,
    };
  } catch {
    return null;
  }
}

// Full lookup: SAM.gov first, SBA DSBS fallback if no contact found
async function lookupPOC(name, cage) {
  const samResult = await samLookup(name, cage);
  if (samResult && samResult.poc_name) return { ...samResult, poc_source: "sam" };

  // SAM found the entity but no POC, or nothing found — try SBA
  const sbaResult = await sbaLookup(name);

  if (sbaResult && (sbaResult.poc_name || sbaResult.poc_email)) {
    return {
      ...(samResult || {}),
      ...sbaResult,
    };
  }

  return samResult; // may be null or entity-only (no POC)
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { action } = payload;
  const ok   = (d) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true,  result: d }) });
  const fail = (m) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error:  m }) });

  if (!SAM_KEY) return fail("SAM_API_KEY not set in Netlify env vars");

  // ── Shared: build $set and conditionally auto-fill email ─────────────────
  async function applyPocToDb(db, distId, result, existing = {}, opts = {}) {
    const set = {
      poc_name:        result.poc_name   || null,
      poc_first:       result.poc_first  || null,
      poc_last:        result.poc_last   || null,
      poc_title:       result.poc_title  || null,
      poc_email:       result.poc_email  || null,
      poc_phone:       result.poc_phone  || null,
      poc_source:      result.poc_source || null,
      cage_code:       result.cage_code  || existing.cage_code || null,
      uei:             result.uei        || null,
      sam_name:        result.sam_name   || null,
      primary_naics:   result.primary_naics || existing.primary_naics || null,
      naics_list:      result.naics_list || existing.naics_list || [],
      sam_enriched_at: new Date().toISOString(),
    };
    // Update FSC from SAM PSC codes when found (and caller allows it)
    if (opts.updateFsc !== false && result.fsc_from_sam && result.fsc_from_sam.length > 0) {
      set.fsc = result.fsc_from_sam;
      set.fsc_source = "sam-psc";
    }
    // Auto-fill email if card has none
    if (result.poc_email && !existing.email) set.email = result.poc_email;
    // Auto-fill website if card has none
    if (result.sba_website && !existing.website) set.website = result.sba_website;
    await db.collection("distributors").updateOne({ id: distId }, { $set: set });
    return set;
  }

  // ── lookupPOC — single vendor ──────────────────────────────────────────
  if (action === "lookupPOC") {
    const { name, cage, distId } = payload;
    if (!name && !cage) return fail("name or cage required");

    try {
      const result = await lookupPOC(name, cage);
      if (!result) return ok({ found: false });

      if (distId) {
        const db = await getDb();
        // Fetch existing doc so we know what's already set
        const existing = await db.collection("distributors").findOne(
          { id: distId }, { projection: { email: 1, website: 1, cage_code: 1 } }
        );
        const saved = await applyPocToDb(db, distId, result, existing || {});
        return ok({ found: true, email_autofilled: !!saved.email, ...result });
      }

      return ok({ found: true, ...result });
    } catch (e) {
      return fail("SAM lookup failed: " + e.message);
    }
  }

  // ── enrichAll — batch enrich all distributors missing POC ──────────────
  if (action === "enrichAll") {
    const db    = await getDb();
    // Target vendors missing POC name OR missing website
    const dists = await db.collection("distributors")
      .find({
        is_dns: { $ne: true },
        $or: [
          { poc_name: { $in: [null, undefined, ""] } },
          { website:  { $in: [null, undefined, ""] } },
        ],
      })
      .project({ id: 1, name: 1, cage_code: 1, email: 1, website: 1 })
      .limit(payload.limit || 50)
      .toArray();

    const results = { enriched: 0, not_found: 0, failed: 0, total: dists.length, emails_filled: 0 };

    for (const d of dists) {
      try {
        const result = await lookupPOC(d.name, d.cage_code);
        if (result) {
          const saved = await applyPocToDb(db, d.id, result, d);
          results.enriched++;
          if (saved.email   && !d.email)   results.emails_filled++;
          if (saved.website && !d.website) results.websites_filled = (results.websites_filled || 0) + 1;
        } else {
          results.not_found++;
        }
      } catch {
        results.failed++;
      }
      await sleep(120);
    }

    return ok(results);
  }

  // ── enrichFsc — SAM (UEI/CAGE) → SBA SBS profile → NAICS → FSC ─────────
  // SBA SBS /_api/v2/profile/{uei}/{cage} returns naics_primary + naics_all_codes
  // publicly (no auth). Need UEI + CAGE — get from SAM if not already stored.
  // 10 vendors per call; frontend loops until total < 10.
  if (action === "enrichFsc") {
    try {
      const db    = await getDb();
      const dists = await db.collection("distributors")
        .find({ is_dns: { $ne: true } })
        .project({ id: 1, name: 1, cage_code: 1, uei: 1 })
        .limit(payload.limit || 10)
        .skip(payload.skip || 0)
        .toArray();

      const results = { updated: 0, no_naics: 0, not_found: 0, failed: 0, total: dists.length, details: [] };

      for (const d of dists) {
        try {
          let uei  = d.uei       || null;
          let cage = d.cage_code || null;

          // Get UEI + CAGE from SAM if either is missing
          if (!uei || !cage) {
            const samResult = await samLookup(d.name, cage);
            if (samResult) {
              uei  = samResult.uei       || uei;
              cage = samResult.cage_code || cage;
              if (uei || cage) {
                await db.collection("distributors").updateOne(
                  { id: d.id },
                  { $set: { uei: uei || null, cage_code: cage || null } }
                ).catch(() => {});
              }
            }
          }

          // SAM didn't return UEI/CAGE — fall back to SBA SBS search by name
          // SBS search returns naics_primary + naics_all_codes directly in results
          if (!uei || !cage) {
            const sbsResult = await sbsSearch(d.name);
            if (!sbsResult) {
              results.not_found++;
              results.details.push({ name: d.name, status: "not_found" });
              await sleep(120);
              continue;
            }
            uei  = sbsResult.uei       || uei;
            cage = sbsResult.cage_code || cage;
            // Save UEI/CAGE and use NAICS directly from search result
            const sbsNaics = sbsResult.naics_list || [];
            if (uei || cage) {
              await db.collection("distributors").updateOne(
                { id: d.id },
                { $set: { uei: uei || null, cage_code: cage || null } }
              ).catch(() => {});
            }
            if (sbsNaics.length) {
              const fsc = naicsToFsc(sbsNaics);
              await db.collection("distributors").updateOne(
                { id: d.id },
                { $set: {
                    naics_list:      sbsNaics,
                    primary_naics:   sbsResult.primary_naics || sbsNaics[0],
                    fsc_source:      "sbs-search",
                    sam_enriched_at: new Date().toISOString(),
                    ...(fsc.length ? { fsc } : {}),
                  }
                }
              );
              if (fsc.length) { results.updated++; results.details.push({ name: d.name, status: "updated", fsc, naics: sbsNaics, source: "sbs" }); }
              else             { results.no_naics++; results.details.push({ name: d.name, status: "no_fsc_match", naics: sbsNaics }); }
              await sleep(120);
              continue;
            }
            results.no_naics++;
            results.details.push({ name: d.name, status: "no_naics", source: "sbs" });
            await sleep(120);
            continue;
          }

          // Have UEI + CAGE — hit SBA SBS profile for full NAICS list
          const profRes = await fetch(
            "https://search.certifications.sba.gov/_api/v2/profile/" +
              encodeURIComponent(uei) + "/" + encodeURIComponent(cage),
            {
              headers: {
                Accept:       "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Referer:      "https://search.certifications.sba.gov/advanced",
              },
            }
          );

          if (!profRes.ok) {
            results.not_found++;
            results.details.push({ name: d.name, status: "sbs_" + profRes.status, uei, cage });
            await sleep(120);
            continue;
          }

          const profData  = await profRes.json();
          const entity    = profData?.entity || {};
          const primary   = entity.naics_primary   || null;
          const allCodes  = entity.naics_all_codes  || [];
          const allNaics  = [...new Set([primary, ...allCodes].filter(Boolean).map(String))];

          if (!allNaics.length) {
            results.no_naics++;
            results.details.push({ name: d.name, status: "no_naics", uei, cage });
            await sleep(120);
            continue;
          }

          const fsc = naicsToFsc(allNaics);
          await db.collection("distributors").updateOne(
            { id: d.id },
            { $set: {
                naics_list:      allNaics,
                primary_naics:   primary || allNaics[0],
                fsc_source:      "sbs-profile",
                sam_enriched_at: new Date().toISOString(),
                ...(fsc.length ? { fsc } : {}),
              }
            }
          );

          if (fsc.length) {
            results.updated++;
            results.details.push({ name: d.name, status: "updated", fsc, naics: allNaics });
          } else {
            results.no_naics++;
            results.details.push({ name: d.name, status: "no_fsc_match", naics: allNaics });
          }
        } catch (e) {
          results.failed++;
          results.details.push({ name: d.name, status: "failed", error: e.message });
        }
        await sleep(120);
      }

      return ok(results);
    } catch (e) {
      return fail("enrichFsc error: " + e.message);
    }
  }

  return fail("Unknown action: " + action);
};
