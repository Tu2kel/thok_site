// src/blaster.js — vendor selection + RFQ email blast
// Gmail SMTP is blocked on Railway (port 587/465 firewalled) — all sends go through Resend.
// Resend free plan: 100/day, 3,000/month.
const { sendEmailGmail, sendEmailResend, buildBodyForSender, buildRFQBody } = require("./email");

const CAP              = parseInt(process.env.BLAST_CAP_PER_FSC   || "100");
const ITEMS_PER_EMAIL  = parseInt(process.env.BLAST_ITEMS_PER_EMAIL || "0"); // 0 = no limit
const GMAIL_LIMIT      = parseInt(process.env.GMAIL_DAILY_LIMIT   || "0");   // effectively 0 — Railway blocks SMTP
const RESEND_LIMIT     = parseInt(process.env.RESEND_DAILY_LIMIT  || "100"); // Resend free plan: 100/day
const SEND_DELAY_MS    = parseInt(process.env.BLAST_DELAY_MS      || "2000");

function info(...a) { console.log("[blaster]", ...a); }

// Network errors that indicate Railway's SMTP path is blocked (not an auth/address problem).
// On these, fall back to Resend (HTTP/443) immediately without consuming Gmail quota.
const SMTP_NETWORK_ERR = /timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|ESOCKET/i;

async function sendWithFallback(sender, { to, subject, body }) {
  if (sender === "gmail") {
    try {
      await sendEmailGmail({ to, subject, body });
      return "gmail";
    } catch (e) {
      if (SMTP_NETWORK_ERR.test(e.message)) {
        info("⚡ Gmail SMTP unreachable (" + e.message.slice(0, 60) + ") — Resend fallback");
        // fall through to Resend
      } else {
        throw e; // auth/credential errors — don't mask with Resend, surface immediately
      }
    }
  }
  await sendEmailResend({ to, subject, body });
  return "resend";
}

function detectPNPrefix(pn) {
  const p = (pn || "").trim().toUpperCase();
  if (/^AN[\d-]/.test(p)) return "AN";
  if (/^MS[\d-]/.test(p)) return "MS";
  if (/^NAS[\d-]/.test(p)) return "NAS";
  return null;
}

// Select vendors for a set of sols, respecting FSC cap + tier ordering
function buildBlastPlan(sols, dists) {
  const goFscs = new Set(sols.map(s => String(s.fsc || (s.nsn || "").slice(0, 4))).filter(Boolean));

  const fscVendorCount = {};
  const seenNames = new Set();

  const eligible = dists
    .filter(d => d.email && !d.is_dns && !d.email_invalid && !d.is_manufacturer)
    .sort((a, b) => (a.tier || 9) - (b.tier || 9));

  const vendorFscMap = [];

  for (const d of eligible) {
    const assignedFscs = (d.fsc || []).map(String).filter(Boolean);
    const isMissingFsc = !assignedFscs.length;
    const dFscs = isMissingFsc
      ? [...goFscs] // no FSC set → match all active lanes
      : assignedFscs.filter(f => goFscs.has(f));
    if (!dFscs.length) continue;

    // Fix #5: no-FSC vendors use their own cap bucket so they don't consume
    // lane-specific slots and block FSC-assigned vendors from entering.
    if (isMissingFsc) {
      const nofscCount = fscVendorCount["__NOFSC__"] || 0;
      if (nofscCount >= CAP) continue;
      fscVendorCount["__NOFSC__"] = nofscCount + 1;
    } else {
      const underCap = dFscs.some(f => (fscVendorCount[f] || 0) < CAP);
      if (!underCap) continue;
      dFscs.forEach(f => { fscVendorCount[f] = (fscVendorCount[f] || 0) + 1; });
    }

    const key = (d.name || "").toUpperCase().trim();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    vendorFscMap.push({ vendor: d, fscs: dFscs });
  }

  const plan = [];

  for (const { vendor, fscs } of vendorFscMap) {
    const vendorFscSet = new Set(fscs.map(String));
    const matchedSols = sols.filter(sol => {
      const solFsc  = String(sol.fsc || (sol.nsn || "").slice(0, 4));
      const solNsn  = (sol.nsn || "").replace(/\D/g, "");
      const vendorNsns = new Set((vendor.known_nsns || []).map(n => n.replace(/\D/g, "")));
      return vendorFscSet.has(solFsc) || (solNsn && vendorNsns.has(solNsn));
    });

    if (!matchedSols.length) continue;

    // Cap items per email if configured
    const cappedSols = ITEMS_PER_EMAIL > 0 ? matchedSols.slice(0, ITEMS_PER_EMAIL) : matchedSols;

    const totalExt = cappedSols.reduce((s, r) => {
      return s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || r.qty || 1) || parseFloat(r.ext_price || 0) || 0);
    }, 0);

    // Fix #7: use != null so price=0 is treated as "known" (not as missing)
    const priceKnown = cappedSols.some(r => r.unit_price != null || r.ext_price != null || r.hist_price != null);
    if (priceKnown && totalExt < 1000) continue;

    plan.push({ vendor, sols: cappedSols, totalExt, fscs });
  }

  // Approved-manufacturer vendors: receive ALL AN/MS/NAS sols regardless of FSC lane
  const anmsNasSols = sols.filter(s => {
    const prefix = detectPNPrefix(s.ref_part_number);
    return prefix === "AN" || prefix === "MS" || prefix === "NAS";
  });
  if (anmsNasSols.length) {
    const approvedMfrs = dists.filter(d =>
      d.is_manufacturer &&
      d.email && !d.is_dns && !d.email_invalid,
    );
    for (const mfr of approvedMfrs) {
      const key = (mfr.name || "").toUpperCase().trim();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const totalExt = anmsNasSols.reduce((s, r) => {
        return s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || r.qty || 1) || parseFloat(r.ext_price || 0) || 0);
      }, 0);
      if (totalExt >= 1000) {
        plan.push({ vendor: mfr, sols: anmsNasSols, totalExt, fscs: [...goFscs] });
        info(mfr.name + " (approved-mfr) → " + anmsNasSols.length + " AN/MS/NAS sol(s) queued");
      }
    }
  }

  const PERSONAL_DOMAINS = /gmail\.com|yahoo\.com|aol\.com|hotmail\.com|outlook\.com|icloud\.com/i;
  const hasCage = d => !!(d.cage_code || d.cage);
  const hasCorp = d => !PERSONAL_DOMAINS.test(d.email || "");

  plan.sort((a, b) => {
    if (b.totalExt !== a.totalExt) return b.totalExt - a.totalExt;
    if (b.sols.length !== a.sols.length) return b.sols.length - a.sols.length;
    const cageA = hasCage(a.vendor) ? 1 : 0, cageB = hasCage(b.vendor) ? 1 : 0;
    if (cageB !== cageA) return cageB - cageA;
    const corpA = hasCorp(a.vendor) ? 1 : 0, corpB = hasCorp(b.vendor) ? 1 : 0;
    return corpB - corpA;
  });

  info("Blast plan: " + plan.length + " vendors, " + sols.length + " sols across " + goFscs.size + " FSC lanes");
  return plan;
}

// ── Sender routing ────────────────────────────────────────────────────────────
// Returns: "gmail" | "resend" | "paused" | "limit"
async function pickSender(db) {
  if (!db) return "gmail";

  const today = new Date().toISOString().slice(0, 10);
  const [ctrl, gmailDoc, resendDoc] = await Promise.all([
    db.collection("_meta").findOne({ _id: "blast_control" }),
    db.collection("_meta").findOne({ _id: "gmail_daily"  }),
    db.collection("_meta").findOne({ _id: "resend_daily" }),
  ]);

  if (ctrl && ctrl.paused) return "paused";

  const gmailCount  = (gmailDoc  && gmailDoc.date  === today) ? (gmailDoc.count  || 0) : 0;
  const resendCount = (resendDoc && resendDoc.date === today) ? (resendDoc.count || 0) : 0;

  if (gmailCount  < GMAIL_LIMIT)  return "gmail";
  if (resendCount < RESEND_LIMIT) return "resend";
  return "limit";
}

async function incrementSenderCount(db, sender) {
  if (!db) return;
  const today = new Date().toISOString().slice(0, 10);
  const id    = sender === "gmail" ? "gmail_daily" : "resend_daily";
  await db.collection("_meta").updateOne(
    { _id: id },
    { $inc: { count: 1 }, $set: { date: today }, $setOnInsert: { _id: id } },
    { upsert: true },
  ).catch(() => {});
}

// ── Blast runner ──────────────────────────────────────────────────────────────
async function runBlast(plan, { isLive = false, fromAddress } = {}, db = null) {
  const results = { sent: 0, failed: 0, skipped: 0, paused: false, daily_limit: false, log: [] };

  // Round-robin rotation across all vendors in the blast plan.
  // Stores last sent vendor in _meta.blast_cursor so each run picks up where
  // yesterday stopped. 100/day (Resend free) across 2,481 vendors = 25-day cycle.
  // BLAST_START_INDEX env var sets the initial offset when no cursor exists yet.
  const START_INDEX = parseInt(process.env.BLAST_START_INDEX || "0");
  let rotatedPlan = plan;
  if (db && plan.length > 1) {
    const cursorDoc = await db.collection("_meta").findOne({ _id: "blast_cursor" }).catch(() => null);
    const lastId = cursorDoc && cursorDoc.last_vendor_id;
    if (lastId) {
      const idx = plan.findIndex(e => (e.vendor.id || e.vendor.name) === lastId);
      if (idx >= 0 && idx < plan.length - 1) {
        rotatedPlan = [...plan.slice(idx + 1), ...plan.slice(0, idx + 1)];
        info("Round-robin: resuming after \"" + plan[idx].vendor.name + "\" (pos " + (idx + 1) + "/" + plan.length + ")");
      } else {
        info("Round-robin: full cycle complete — wrapping to start");
      }
    } else if (START_INDEX > 0) {
      const offset = Math.min(START_INDEX, plan.length - 1);
      rotatedPlan = [...plan.slice(offset), ...plan.slice(0, offset)];
      info("Round-robin: cold start at position " + offset + " (BLAST_START_INDEX=" + START_INDEX + ")");
    }
  }

  let lastSentVendorId = null;

  for (const entry of rotatedPlan) {
    const { vendor, sols: allSols } = entry;

    // Pick sender before each email (auto-switches when Gmail cap is hit)
    const sender = await pickSender(db);

    if (sender === "paused") {
      info("⏸ Blast paused via kill switch — stopping");
      results.paused = true;
      results.log.push({ status: "paused", reason: "kill switch" });
      break;
    }
    if (sender === "limit") {
      info("🛑 Both senders at daily limit (Gmail " + GMAIL_LIMIT + " + Resend " + RESEND_LIMIT + ") — stopping. Resume tomorrow.");
      results.daily_limit = true;
      results.log.push({ status: "stopped", reason: "daily_limit", gmail_limit: GMAIL_LIMIT, resend_limit: RESEND_LIMIT });
      break;
    }

    const to = isLive ? vendor.email : fromAddress;

    // Dedup: skip sols already sent to this vendor
    let sols = allSols;
    if (db && isLive) {
      const alreadySent = await db.collection("blast_log").find({
        vendor_email: (vendor.email || "").toLowerCase(),
        sol_number:   { $in: allSols.map(s => s.sol_number) },
        status:       "sent",
      }).toArray().then(rows => new Set(rows.map(r => r.sol_number))).catch(() => new Set());

      sols = allSols.filter(s => !alreadySent.has(s.sol_number));
      if (!sols.length) {
        info("⏭ " + vendor.name + " — all sols already sent, skipping");
        results.skipped++;
        results.log.push({ vendor: vendor.name, to, sols: 0, status: "skipped", reason: "all already sent" });
        continue;
      }
      if (sols.length < allSols.length) {
        info("⚡ " + vendor.name + ": " + (allSols.length - sols.length) + " already sent, sending " + sols.length + " new");
      }
    }

    // Build subject + body for chosen sender
    const firstSol = sols[0];
    const { subject: baseSubject } = buildRFQBody(vendor, firstSol);
    const subject = baseSubject + (sols.length > 1 ? " +" + (sols.length - 1) + " more" : "");
    const body    = buildBodyForSender(vendor, sols, sender);

    try {
      // sendWithFallback: if Gmail SMTP is blocked at the network level, Resend
      // is used immediately without consuming Gmail quota or incrementing fail count.
      const effectiveSender = await sendWithFallback(sender, { to, subject, body });

      results.sent++;
      lastSentVendorId = vendor.id || vendor.name;
      results.log.push({ vendor: vendor.name, vendor_email: vendor.email, to, sender: effectiveSender, sols: sols.length, sol_numbers: sols.map(s => s.sol_number), totalExt: entry.totalExt, status: "sent" });
      info("✓ [" + effectiveSender.toUpperCase() + "] RFQ → " + vendor.name + " (" + sols.length + " items)");
      await incrementSenderCount(db, effectiveSender);

      if (db) {
        for (const sol of sols) {
          await db.collection("blast_log").updateOne(
            { sol_number: sol.sol_number, vendor_email: (vendor.email || "").toLowerCase() },
            { $set: { sol_number: sol.sol_number, item_name: sol.item_name || "", fsc: sol.fsc || "", quote_due: sol.quote_due || "", vendor_name: vendor.name, vendor_email: (vendor.email || "").toLowerCase(), vendor_id: vendor.id || null, sender: effectiveSender, status: "sent", sent_at: new Date().toISOString() } },
            { upsert: true },
          ).catch(e => info("blast_log save err:", e.message));
        }
      }
    } catch (e) {
      results.failed++;
      results.log.push({ vendor: vendor.name, vendor_email: vendor.email, to, sender, sols: sols.length, sol_numbers: sols.map(s => s.sol_number), status: "failed", error: e.message });
      info("✗ [" + sender.toUpperCase() + "] RFQ FAILED → " + vendor.name + ": " + e.message);

      if (db) {
        for (const sol of sols) {
          await db.collection("blast_log").updateOne(
            { sol_number: sol.sol_number, vendor_email: (vendor.email || "").toLowerCase() },
            { $set: { sol_number: sol.sol_number, vendor_name: vendor.name, vendor_email: (vendor.email || "").toLowerCase(), sender, status: "failed", error: e.message, sent_at: new Date().toISOString() } },
            { upsert: true },
          ).catch(() => {});
        }
      }
    }

    await new Promise(r => setTimeout(r, SEND_DELAY_MS));
  }

  // Save round-robin cursor so tomorrow picks up where today stopped
  if (db && lastSentVendorId) {
    await db.collection("_meta").updateOne(
      { _id: "blast_cursor" },
      { $set: { last_vendor_id: lastSentVendorId, updated_at: new Date().toISOString() } },
      { upsert: true },
    ).catch(() => {});
    info("Round-robin cursor saved: \"" + lastSentVendorId + "\"");
  }

  return results;
}

module.exports = { buildBlastPlan, runBlast };
