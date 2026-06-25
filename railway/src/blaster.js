// src/blaster.js — vendor selection + RFQ email blast
// Mirrors the browser blast logic: FSC-cap, tier-1 first, no OEM tags, $1k min
const { sendEmail, buildRFQBody } = require("./email");

const CAP = parseInt(process.env.BLAST_CAP_PER_FSC || "3");

function info(...a) { console.log("[blaster]", ...a); }

function detectPNPrefix(pn) {
  const p = (pn || "").trim().toUpperCase();
  if (/^AN[\d-]/.test(p)) return "AN";
  if (/^MS[\d-]/.test(p)) return "MS";
  if (/^NAS[\d-]/.test(p)) return "NAS";
  return null;
}

// Select vendors for a set of sols, respecting FSC cap + tier ordering
// dists = MongoDB distributors array
// sols  = array of screened, GO/VERIFY sol records
function buildBlastPlan(sols, dists) {
  const goFscs = new Set(sols.map(s => String(s.fsc || (s.nsn || "").slice(0, 4))).filter(Boolean));

  const fscVendorCount = {};
  const seenNames = new Set();

  // Eligible DB vendors: has email, not DNS, not approved-manufacturer, sorted tier-1 first
  const eligible = dists
    .filter(d => d.email && !d.is_dns && !(d.tags || []).includes("approved-manufacturer"))
    .sort((a, b) => (a.tier || 9) - (b.tier || 9));

  const vendorFscMap = []; // [{ vendor, matchedFscs }]

  for (const d of eligible) {
    const dFscs = (d.fsc || []).map(String).filter(f => goFscs.has(f));
    if (!dFscs.length) continue;
    const underCap = dFscs.some(f => (fscVendorCount[f] || 0) < CAP);
    if (!underCap) continue;
    const key = (d.name || "").toUpperCase().trim();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    dFscs.forEach(f => { fscVendorCount[f] = (fscVendorCount[f] || 0) + 1; });
    vendorFscMap.push({ vendor: d, fscs: dFscs });
  }

  // Build plan: each entry = one email to one vendor with all matching sols
  const plan = [];

  for (const { vendor, fscs } of vendorFscMap) {
    const vendorFscSet = new Set(fscs.map(String));
    const matchedSols = sols.filter(sol => {
      const solFsc = String(sol.fsc || (sol.nsn || "").slice(0, 4));
      const solNsn = (sol.nsn || "").replace(/\D/g, "");
      const vendorNsns = new Set((vendor.known_nsns || []).map(n => n.replace(/\D/g, "")));
      return vendorFscSet.has(solFsc) || (solNsn && vendorNsns.has(solNsn));
    });

    if (!matchedSols.length) continue;

    const totalExt = matchedSols.reduce((s, r) => {
      return s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || r.qty || 1) || parseFloat(r.ext_price || 0) || 0);
    }, 0);

    if (totalExt < 1000) continue;

    plan.push({ vendor, sols: matchedSols, totalExt, fscs });
  }

  // Sort by expected value descending
  plan.sort((a, b) => b.totalExt - a.totalExt);

  info("Blast plan: " + plan.length + " vendors, " + sols.length + " sols across " + goFscs.size + " FSC lanes");
  return plan;
}

// Execute blast: send one RFQ email per plan entry
// In test mode all emails go to FROM_ADDRESS instead
async function runBlast(plan, { isLive = false, fromAddress } = {}) {
  const results = { sent: 0, failed: 0, skipped: 0, log: [] };

  for (const entry of plan) {
    const { vendor, sols } = entry;
    const to = isLive ? vendor.email : fromAddress;

    // Build combined RFQ body (one email, all sols for this vendor)
    const firstSol = sols[0];
    const { subject } = buildRFQBody(vendor, firstSol);

    const dayBefore = (raw) => {
      if (!raw) return null;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return raw;
      d.setDate(d.getDate() - 1);
      return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0") + "/" + d.getFullYear();
    };

    const itemLines = sols.map((s, i) => [
      "Item " + (i + 1) + ": " + (s.item_name || "—"),
      s.ref_part_number ? "  Part Number:  " + s.ref_part_number : null,
      "  Quantity:     " + (s.quantity || s.qty || "—"),
      "  Need By:      " + (dayBefore(s.quote_due) || "—"),
      "  Solicitation: " + s.sol_number,
    ].filter(Boolean).join("\n")).join("\n\n");

    const body = [
      "Hi " + (vendor.name || vendor.company_name) + ",",
      "",
      "My name is Anthony Kelley — Founder & CEO of Imperio Federal Logistics (CAGE 152U4 · SDVOSB · VetHUB). Before I get into the ask, a quick heads-up: we recently went through a company restructuring and our new corporate email, anthony@ifedlog.com, is still building deliverability as a fresh domain — there's a chance it's landing in spam folders. I'm reaching out from my personal business Gmail in the meantime. Please add kelley.anthonyk@gmail.com to your safe senders list and feel free to reply to either address going forward.",
      "",
      "Now to the reason I'm reaching out — I have " + sols.length + " active DLA procurement need" + (sols.length > 1 ? "s" : "") + " in your lane and need pricing and availability on the following:",
      "",
      itemLines,
      "",
      "Requirements:",
      "- Destination: Government delivery address (continental US)",
      "- Payment: Immediate PO upon award. Supplier receives wire payment prior to shipment.",
      "- Compliance: BAA/TAA required — please confirm country of origin for each item",
      "- Shipping: FOB Destination required",
      "- Condition: New/unused only. No substitutions without prior approval.",
      "",
      "Please provide unit price, lead time, and country of origin. We issue POs immediately upon award and move fast.",
      "",
      "Thank you for your time,",
      "Anthony K Kelley | Founder & CEO",
      "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
      "SDVOSB | VetHUB | (254) 226-5216",
      "kelley.anthonyk@gmail.com | anthony@ifedlog.com | ifedlog.com",
    ].join("\n");

    try {
      await sendEmail({ to, subject: subject + (sols.length > 1 ? " +" + (sols.length - 1) + " more" : ""), body });
      results.sent++;
      results.log.push({ vendor: vendor.name, to, sols: sols.length, totalExt: entry.totalExt, status: "sent" });
      info("✓ RFQ → " + vendor.name + " (" + sols.length + " items, $" + Math.round(entry.totalExt).toLocaleString() + ")");
    } catch (e) {
      results.failed++;
      results.log.push({ vendor: vendor.name, to, sols: sols.length, status: "failed", error: e.message });
      info("✗ RFQ FAILED → " + vendor.name + ": " + e.message);
    }

    // Throttle to avoid Gmail rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  return results;
}

module.exports = { buildBlastPlan, runBlast };
