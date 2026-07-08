// netlify/functions/scc-fsc-scrub.js — FSC scrubber
// Parses a vendor no-bid reply email, finds the FSC codes for those solicitations,
// and removes them from that vendor's distributor record.
//
// Actions:
//   preview { email_text } → { vendor, refs_found, fsc_to_remove, fsc_names }
//   apply   { vendor_id, fsc_codes } → { removed, vendor_name }

const { MongoClient } = require("mongodb");

let _client = null;
async function getDb() {
  if (!_client) _client = new MongoClient(process.env.MONGODB_URI);
  await _client.connect();
  return _client.db();
}

const FSC_NAMES = {
  2510: "Vehicular Cab/Body/Frame", 2530: "Brake/Steering/Axle", 2540: "Vehicular Furniture",
  2910: "Engine Fuel System", 2940: "Engine Filters", 2990: "Engine Accessories",
  3020: "Gears/Pulleys/Sprockets", 3030: "Belting/Drive Belts", 3110: "Bearings",
  4110: "Refrigeration Equipment", 4210: "Fire Fighting Equipment", 4240: "Safety/PPE/Rescue Equipment",
  4320: "Power/Hand Pumps", 4330: "Filters/Separators", 4710: "Pipe/Tube",
  4730: "Hose/Pipe Fittings/Valves", 4820: "Valves", 4910: "Shop Equipment",
  4940: "Maintenance Equipment", 5110: "Hand Tools", 5120: "Power Tools",
  5305: "Screws", 5306: "Bolts", 5310: "Nuts/Washers", 5315: "Pins/Rivets",
  5320: "Rivets", 5330: "Packing/Gaskets", 5331: "Seals/O-Rings", 5340: "Commercial Hardware",
  5365: "Retaining Rings", 5920: "Fuses/Arrestors", 5925: "Circuit Breakers",
  5935: "Electrical Connectors", 5961: "Semiconductors", 5962: "Electronic Components",
  5975: "Electrical Hardware", 6110: "Electrical Control Equipment", 6120: "Power Distribution Equipment",
  6135: "Primary Batteries", 6140: "Secondary Batteries", 6145: "Wire/Cable",
  6150: "Electrical Wire/Cable", 6210: "Indoor/Outdoor Lighting Fixtures", 6230: "Portable/Hand Lighting",
  6240: "Electric Lamps", 6350: "Signal/Warning Devices", 6505: "Drugs/Biologicals",
  6530: "Medical/Dental Instruments", 6532: "Hospital/Surgical Equipment",
  6630: "Chemical Analysis Instruments", 6640: "Laboratory Equipment", 6810: "Chemicals",
  6840: "Pest Control", 6850: "Misc Chemical Specialties", 6910: "Training Aids",
  7110: "Office Furniture", 7125: "Containers/Bins", 7310: "Food Cooking Equipment",
  7320: "Kitchen Equipment", 7330: "Food Service Equipment", 7930: "Cleaning Compounds",
  8415: "Individual Equipment", 8430: "Footwear", 8455: "Badges/Insignia",
  8465: "Packs/Bags", 8470: "Armor/Body Protection", 9150: "Oils/Lubricants",
  9330: "Rubber Fabricated Materials", 9340: "Plastics Fabricated Materials",
  9510: "Ferrous Metal Bar/Sheet", 9520: "Nonferrous Metal Bar",
  9535: "Metal Plate/Sheet/Strip", 9540: "Structural Metal",
};

// Extract the first email address from a "From:" or "Email:" line in a reply email
function parseSenderEmail(text) {
  // "From: Mike Varga <mjvarga@jwwinco.com>" — look for From: lines in quoted block
  const fromMatch = text.match(/^From:\s+.*?<([^>@\s]+@[^>@\s]+)>/im);
  if (fromMatch) return fromMatch[1].toLowerCase();
  // Fallback: bare "From: email@domain.com"
  const bareFrom = text.match(/^From:\s+([^\s<@]+@[^\s>@,]+)/im);
  if (bareFrom) return bareFrom[1].toLowerCase();
  // Look for Email: field in signature block
  const emailField = text.match(/^Email:\s+([^\s<@]+@[^\s>@,\r\n]+)/im);
  if (emailField) return emailField[1].toLowerCase();
  return null;
}

// Extract all Ref # values from the quoted original email
function parseRefs(text) {
  const refs = [];
  // Match "Ref #:         IFL-260708-001" or "Ref #:         FCR2Y671G210X"
  const pattern = /Ref\s*#\s*:\s+([A-Z0-9\-]+)/gi;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const val = m[1].trim().toUpperCase();
    if (val && !refs.includes(val)) refs.push(val);
  }
  return refs;
}

// Look up FSC for a single ref (IFL ref or sol number)
async function fscForRef(db, ref) {
  // Try as IFL ref
  let doc = await db.collection("rfq_refs").findOne({ ref });
  // Try as sol_number
  if (!doc) doc = await db.collection("rfq_refs").findOne({ sol_number: ref });
  // Fall back to blast_log
  if (!doc) {
    const log = await db.collection("blast_log").findOne({ sol_number: ref });
    if (log) doc = { fsc: log.fsc, item_name: log.item_name, sol_number: ref };
  }
  if (!doc || !doc.fsc) return null;
  return { ref, fsc: String(doc.fsc), item_name: doc.item_name || "" };
}

// Find vendor in distributors by email (exact first, then domain)
async function findVendor(db, senderEmail) {
  const dist = db.collection("distributors");
  let vendor = await dist.findOne({ email: new RegExp("^" + senderEmail.replace(/[.+]/g, "\\$&") + "$", "i") });
  if (!vendor) {
    const domain = senderEmail.split("@")[1];
    if (domain) {
      const escaped = domain.replace(/\./g, "\\.");
      vendor = await dist.findOne({ email: new RegExp("@" + escaped, "i") });
    }
  }
  return vendor;
}

exports.handler = async (ev) => {
  const hdrs = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (ev.httpMethod === "OPTIONS") return { statusCode: 204, headers: hdrs, body: "" };
  if (ev.httpMethod !== "POST") return { statusCode: 405, headers: hdrs, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(ev.body || "{}"); } catch { return { statusCode: 400, headers: hdrs, body: "Bad JSON" }; }

  const { action } = body;

  try {
    const db = await getDb();

    // ── preview ──────────────────────────────────────────────────────────────
    if (action === "preview") {
      const { email_text } = body;
      if (!email_text) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: "email_text required" }) };

      const senderEmail = parseSenderEmail(email_text);
      if (!senderEmail) return { statusCode: 200, headers: hdrs, body: JSON.stringify({ ok: false, error: "Could not find a From: email address in the pasted text." }) };

      const refs = parseRefs(email_text);
      if (!refs.length) return { statusCode: 200, headers: hdrs, body: JSON.stringify({ ok: false, error: "No Ref #: lines found in the quoted email body.", sender_email: senderEmail }) };

      // Look up FSC for each ref
      const refResults = (await Promise.all(refs.map(r => fscForRef(db, r)))).filter(Boolean);
      const uniqueFsc = [...new Set(refResults.map(r => r.fsc))];

      // Find vendor
      const vendor = await findVendor(db, senderEmail);

      // Which FSCs the vendor currently has that overlap
      const vendorFsc = vendor ? (vendor.fsc || vendor.fsc_codes || []).map(String) : [];
      const toRemove = uniqueFsc.filter(f => vendorFsc.includes(f));

      const fscNames = {};
      uniqueFsc.forEach(f => { fscNames[f] = FSC_NAMES[Number(f)] || ("FSC " + f); });

      return {
        statusCode: 200, headers: hdrs,
        body: JSON.stringify({
          ok: true,
          sender_email: senderEmail,
          vendor: vendor ? { id: vendor.id, name: vendor.name || vendor.company_name, email: vendor.email, fsc_count: vendorFsc.length } : null,
          refs_found: refResults,
          fsc_from_refs: uniqueFsc,
          fsc_to_remove: toRemove,
          fsc_names: fscNames,
          warning: !vendor ? "Vendor not found in DB for domain: " + senderEmail.split("@")[1] : null,
        }),
      };
    }

    // ── apply ─────────────────────────────────────────────────────────────────
    if (action === "apply") {
      const { vendor_id, fsc_codes } = body;
      if (!vendor_id || !Array.isArray(fsc_codes) || !fsc_codes.length) {
        return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: "vendor_id and fsc_codes[] required" }) };
      }
      const dist = db.collection("distributors");
      const before = await dist.findOne({ id: vendor_id });
      if (!before) return { statusCode: 404, headers: hdrs, body: JSON.stringify({ error: "Vendor not found: " + vendor_id }) };

      // Pull from both fsc and fsc_codes fields
      await dist.updateOne(
        { id: vendor_id },
        { $pull: { fsc: { $in: fsc_codes }, fsc_codes: { $in: fsc_codes } } }
      );

      const after = await dist.findOne({ id: vendor_id });
      const afterFsc = (after.fsc || after.fsc_codes || []).map(String);

      return {
        statusCode: 200, headers: hdrs,
        body: JSON.stringify({
          ok: true,
          vendor_id,
          vendor_name: before.name || before.company_name,
          removed: fsc_codes,
          fsc_remaining: afterFsc.length,
        }),
      };
    }

    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: "Unknown action: " + action }) };

  } catch (e) {
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: e.message }) };
  }
};
