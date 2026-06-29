#!/usr/bin/env node
// scripts/gen-naics-fsc.js
// Reads naics_psc_map.csv (FPDS government source), extracts numeric 4-digit
// PSC codes (= FSC codes for supply items), groups by NAICS, merges with
// hand-mapped wholesale (42xxxx) entries, and prints the final NAICS_FSC object
// ready to paste into scc-sam-lookup.js and scc-sba-import.js.
//
// Usage: node scripts/gen-naics-fsc.js /path/to/naics_psc_map.csv

const fs = require("fs");

const csvPath = process.argv[2] || "/mnt/c/Users/tu2ke/Downloads/naics_psc_map.csv";
const text = fs.readFileSync(csvPath, "utf8");
const lines = text.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim());

// Build NAICS → FSC map from CSV (manufacturer side only)
// Key rule: only 4-digit all-numeric PSC codes are FSC supply codes.
// Alphanumeric codes (L059, R425, C123, etc.) are service/schedule codes — skip.
const fromCsv = {};

for (const line of lines.slice(1)) {
  // Columns: psc_code, naics_code, naics_description, naics_extended_description
  // No quoted commas in the first two columns, safe to split on first two commas.
  const parts = line.split(",");
  if (parts.length < 2) continue;

  const psc   = parts[0].trim();
  const naics = parts[1].trim();

  // FSC supply code = exactly 4 numeric digits
  if (!/^\d{4}$/.test(psc)) continue;

  // Only manufacturing / chemicals / rubber / metals NAICS ranges relevant to DIBBS
  const prefix2 = naics.slice(0, 2);
  if (!["32", "33"].includes(prefix2)) continue;

  if (!fromCsv[naics]) fromCsv[naics] = new Set();
  fromCsv[naics].add(psc);
}

// ── Existing hand-mapped entries — union-merged with CSV so we never lose
//    coverage (CSV may omit some valid FSC codes from sparse FPDS data).
const EXISTING = {
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
};

// ── Wholesale (42xxxx) mappings — CSV only shows L-codes for these, so we
//    keep the hand-mapped FSC entries that reflect what those distributors
//    actually carry on DLA DIBBS.
const WHOLESALE = {
  // Metal / fastener distributors
  "423510": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","9510","9515","9520","9525"],
  "423520": ["9505","9510","9515","9520","9525","9530","9535","9540","9545"],
  // Electrical / electronic distributors
  "423610": ["6110","6115","6120","6125","6130","6135","6140","6145","6150"],
  "423620": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  "423690": ["5905","5910","5915","5920","5925","5930","5935","5940","5945","5960","5961","5962","5963","5975"],
  // Hardware / plumbing / HVAC distributors
  "423710": ["4710","4720","4730","4740","4820","4840","5110","5120","5340"],
  "423720": ["4710","4720","4730","4740","4820","4840","5340"],
  "423730": ["4110","4120","4130","4140"],
  "423740": ["4110","4120","4130","4140"],
  // Industrial machinery / supplies distributors
  "423810": ["3805","3810","3815","3820","3825","3830"],
  "423820": ["3720","3740","3750","3760"],
  "423830": ["3110","3120","3130","4320","4330"],
  "423840": ["4320","4330","4710","4720","4730","4820","5110","5120","5340"],
  "423850": ["5110","5120","5130","5133","5136","5140"],
  // Transportation equipment distributors (aircraft/vehicle parts)
  "423110": ["2310","2320","2510","2520","2530","2540","2590"],
  "423120": ["2910","2920","2930","2940","2990"],
  "423860": ["1550","1560","2510","2520","2530","2540","2550"],
  // Medical / ophthalmic distributors
  "423450": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  "423460": ["6505","6510","6515","6520","6525","6530","6540","6545","6550"],
  // Catch-all miscellaneous durable goods
  "423990": ["5305","5306","5307","5310","5315","5320","5325","5330","5340","5360","5365"],
};

// ── Merge: union CSV + existing hand-mapped + wholesale ───────────────────
// For each NAICS: union all known FSC codes so we never lose coverage.
const merged = {};

// Start with CSV data
for (const [naics, fscSet] of Object.entries(fromCsv)) {
  merged[naics] = new Set(fscSet);
}

// Union with existing hand-mapped entries (catches any FSC codes CSV missed)
for (const [naics, fscs] of Object.entries(EXISTING)) {
  if (!merged[naics]) merged[naics] = new Set();
  fscs.forEach(f => merged[naics].add(f));
}

// Convert sets to sorted arrays
for (const naics of Object.keys(merged)) {
  merged[naics] = [...merged[naics]].sort();
}

// Wholesale entries override with authoritative hand-mapped values
for (const [naics, fscs] of Object.entries(WHOLESALE)) {
  merged[naics] = fscs;
}

// Sort by NAICS key
const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));

// ── Print stats ────────────────────────────────────────────────────────────
const fromCsvCount = Object.keys(fromCsv).length;
const totalFscMappings = Object.values(sorted).reduce((s, v) => s + v.length, 0);
process.stderr.write(`\nFrom CSV (manufacturer 32/33xxxx): ${fromCsvCount} NAICS codes\n`);
process.stderr.write(`Wholesale (hand-mapped 42xxxx):   ${Object.keys(WHOLESALE).length} NAICS codes\n`);
process.stderr.write(`Total NAICS entries:              ${Object.keys(sorted).length}\n`);
process.stderr.write(`Total FSC mappings:               ${totalFscMappings}\n\n`);

// ── Output JS object literal ───────────────────────────────────────────────
let out = "const NAICS_FSC = {\n";
let prevPrefix = null;
const SECTION_LABELS = {
  "32": "Chemicals, Rubber & Plastics",
  "33": "Manufacturing (Metals, Machinery, Electronics, Vehicles)",
  "42": "Wholesale Distributors",
};
for (const [naics, fscs] of Object.entries(sorted)) {
  const prefix = naics.slice(0, 2);
  if (prefix !== prevPrefix) {
    if (prevPrefix !== null) out += "\n";
    out += `  // ── ${SECTION_LABELS[prefix] || prefix + "xxxx"} ──\n`;
    prevPrefix = prefix;
  }
  out += `  "${naics}": ${JSON.stringify(fscs)},\n`;
}
out += "};\n";

process.stdout.write(out);
