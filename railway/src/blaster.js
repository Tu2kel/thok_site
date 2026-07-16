// src/blaster.js — vendor selection + RFQ email blast
// Resend (HTTP/443) is the sole sender. The old Gmail-SMTP-first path timed out
// ~60s per email on Railway's firewalled SMTP ports before falling back, which
// throttled the whole blast to ~1 email/minute — removed 2026-07-10.
const { sendEmailResend, buildBodyForSender, buildRFQBody } = require("./email");

const CAP              = parseInt(process.env.BLAST_CAP_PER_FSC   || "5000");
const ITEMS_PER_EMAIL  = 10; // hard cap — never more than 10 items per vendor email
const RESEND_LIMIT     = parseInt(process.env.RESEND_DAILY_LIMIT  || "5000"); // Resend Pro: 50k/month
const SEND_DELAY_MS    = parseInt(process.env.BLAST_DELAY_MS      || "2000");

function info(...a) { console.log("[blaster]", ...a); }

// ── IFL Reference Store ───────────────────────────────────────────────────────
async function saveRefMap(db, entries) {
  if (!db || !entries.length) return;
  await Promise.all(entries.map(e =>
    db.collection("rfq_refs").updateOne(
      { sol_number: e.sol_number },
      {
        // A sol's ref is permanent once minted — $setOnInsert so a later run can
        // never rewrite it (that overwrite was the ref/sol mismatch bug).
        $setOnInsert: { ref: e.ref },
        $set: {
          item_name:       e.item_name,
          fsc:             e.fsc,
          nsn:             e.nsn,
          ref_part_number: e.ref_part_number,
          blast_date:      e.blast_date,
        },
      },
      { upsert: true },
    ).catch(() => {})
  ));
}

// Atomic, day-scoped ref counter. It never resets per run, so same-day re-blasts
// keep minting fresh sequence numbers instead of re-issuing IFL-<date>-001 to a
// different sol. Seed with $max (below) before first use so it clears any refs
// already minted for the day.
async function nextRefSeq(db, blastDate) {
  const res = await db.collection("_meta").findOneAndUpdate(
    { _id: "rfq_ref_seq_" + blastDate },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const doc = res && res.value !== undefined ? res.value : res;
  return doc && doc.seq ? doc.seq : 1;
}

// Canonical aerospace-hardware part-number standards. A P/N with one of these
// prefixes routes to aerospace vendors regardless of FSC lane. Keep this list
// as the single source of truth — scraper.js mirrors the same regex.
//   NAS/NASM (Nat'l Aerospace Std) · AN (Army-Navy) · MS (Mil Std) · MIL (Mil-spec)
//   AS (SAE Aerospace Std) · BAC (Boeing) · NSA · DIN
function detectPNPrefix(pn) {
  const p = (pn || "").trim().toUpperCase();
  if (/^NASM[\d-]/.test(p)) return "NASM";
  if (/^NAS[\d-]/.test(p))  return "NAS";
  if (/^NSA[\d-]/.test(p))  return "NSA";
  if (/^AN[\d-]/.test(p))   return "AN";
  if (/^MS[\d-]/.test(p))   return "MS";
  if (/^MIL[\d-]/.test(p))  return "MIL";
  if (/^AS[\d-]/.test(p))   return "AS";
  if (/^BAC[A-Z]?\d/.test(p)) return "BAC";
  if (/^DIN[\d-]/.test(p))  return "DIN";
  return null;
}
function isAerospacePN(pn) { return detectPNPrefix(pn) !== null; }

// An "aerospace company" — identified by name (Aero*, *Aerospace*) or an aero tag.
// The `aerospace` tag is barely applied in the rolodex (~4 vendors), so name is the
// primary signal (~29). These vendors ALSO receive aerospace-standard parts on top
// of their FSC lanes.
function isAerospaceVendor(d) {
  if (!d) return false;
  if (/aero/i.test(d.name || d.company_name || "")) return true;
  return (d.tags || []).some(t => /aero/i.test(t));
}

// Select vendors for a set of sols, respecting FSC cap + tier ordering
function buildBlastPlan(sols, dists) {
  const goFscs = new Set(sols.map(s => String(s.fsc || (s.nsn || "").slice(0, 4))).filter(Boolean));

  const fscVendorCount = {};
  const seenNames = new Set();

  // Exclude manufacturers AND aerospace companies from FSC-lane routing — both get
  // their own part-number-based path below and receive ONLY those sols.
  const eligible = dists
    .filter(d => d.email && !d.is_dns && !d.email_invalid && !d.is_manufacturer && !isAerospaceVendor(d))
    .sort((a, b) => (a.tier || 9) - (b.tier || 9));

  const vendorFscMap = [];

  for (const d of eligible) {
    const assignedFscs = (d.fsc || []).map(String).filter(Boolean);
    // No FSC lanes assigned → DO NOT BLAST. (Previously this matched ALL active
    // lanes, so blanking a vendor's FSC — meant to stop their RFQs — instead sent
    // them every sol. Blank now means "hold until lanes are assigned".)
    if (!assignedFscs.length) continue;
    const dFscs = assignedFscs.filter(f => goFscs.has(f));
    if (!dFscs.length) continue;

    const underCap = dFscs.some(f => (fscVendorCount[f] || 0) < CAP);
    if (!underCap) continue;
    dFscs.forEach(f => { fscVendorCount[f] = (fscVendorCount[f] || 0) + 1; });

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

    // Rank by extended order value (unit_price × qty, falling back to ext_price)
    // so the per-email cap keeps a vendor's HIGHEST-dollar sols, not whatever
    // happened to come first in scrape order.
    const solExt = (r) =>
      (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || r.qty || 1)) ||
      parseFloat(r.ext_price || 0) || 0;
    matchedSols.sort((a, b) => solExt(b) - solExt(a));

    // Cap items per email if configured (top-N by value after the sort above)
    const cappedSols = ITEMS_PER_EMAIL > 0 ? matchedSols.slice(0, ITEMS_PER_EMAIL) : matchedSols;

    const totalExt = cappedSols.reduce((s, r) => {
      return s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || r.qty || 1) || parseFloat(r.ext_price || 0) || 0);
    }, 0);

    // Fix #7: use != null so price=0 is treated as "known" (not as missing)
    const priceKnown = cappedSols.some(r => r.unit_price != null || r.ext_price != null || r.hist_price != null);
    if (priceKnown && totalExt < 1000) continue;

    plan.push({ vendor, sols: cappedSols, totalExt, fscs });
  }

  // Aerospace path: approved manufacturers AND aerospace companies receive ALL
  // aerospace-standard sols (NAS/NASM/AN/MS/MIL/AS/BAC/NSA/DIN) regardless of FSC
  // lane — and NOTHING else. Both were excluded from the FSC-lane loop above, so
  // this is the only path they appear in.
  const anmsNasSols = sols.filter(s => isAerospacePN(s.ref_part_number));
  if (anmsNasSols.length) {
    const aeroRecipients = dists.filter(d =>
      (d.is_manufacturer || isAerospaceVendor(d)) &&
      d.email && !d.is_dns && !d.email_invalid,
    );
    for (const av of aeroRecipients) {
      const key = (av.name || "").toUpperCase().trim();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const totalExt = anmsNasSols.reduce((s, r) => {
        return s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || r.qty || 1) || parseFloat(r.ext_price || 0) || 0);
      }, 0);
      if (totalExt >= 1000) {
        plan.push({ vendor: av, sols: anmsNasSols, totalExt, fscs: [...goFscs] });
        info(av.name + (av.is_manufacturer ? " (approved-mfr)" : " (aerospace)") + " → " + anmsNasSols.length + " aerospace-std sol(s) queued");
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
// Reads state once at blast start, tracks counts in memory — no MongoDB per email.
function makeSenderCache(db) {
  let paused      = false;
  let resendCount = 0;
  let loaded      = false;

  async function load() {
    if (!db || loaded) return;
    loaded = true;
    const today = new Date().toISOString().slice(0, 10);
    const [ctrl, resendDoc] = await Promise.all([
      db.collection("_meta").findOne({ _id: "blast_control" }),
      db.collection("_meta").findOne({ _id: "resend_daily" }),
    ]);
    paused      = !!(ctrl && ctrl.paused);
    resendCount = (resendDoc && resendDoc.date === today) ? (resendDoc.count || 0) : 0;
  }

  return {
    async pick() {
      await load();
      if (paused)                      return "paused";
      if (resendCount < RESEND_LIMIT)  return "resend";
      return "limit";
    },
    increment() {
      resendCount++;
      // Write in-memory count (not $inc) so the DB value always matches what we track.
      // $inc accumulates across day boundaries because the first write of a new day
      // sets date:today while still incrementing the stale previous-day total.
      if (db) {
        const today = new Date().toISOString().slice(0, 10);
        db.collection("_meta").updateOne(
          { _id: "resend_daily" },
          { $set: { count: resendCount, date: today } },
          { upsert: true },
        ).catch(() => {});
      }
    },
  };
}

// ── Blast runner ──────────────────────────────────────────────────────────────
// maxVendors: cap the number of vendor emails this run may send. Intended for
// test runs — a full plan is one email per matched vendor (~2,400), which is
// not something you want landing in your own inbox to "see what it looks like".
async function runBlast(plan, { isLive = false, fromAddress, maxVendors = 0 } = {}, db = null) {
  const results = { sent: 0, failed: 0, skipped: 0, paused: false, daily_limit: false, log: [] };

  // ── FEDERAL BLAST KILL SWITCH ──────────────────────────────────────────────
  // The ~2,500-vendor DIBBS mass-blast was RETIRED 2026-07-15 (blast-and-pray POC
  // failed). This vendor DB is being repurposed for the State/ESBD side, which
  // uses per-sol matched targeting, not a spray.
  //
  // This guard covers the RAILWAY paths only: the daily cron, /blast-existing, and
  // the UI live override. It does NOT cover netlify/functions/send-rfq.js, nor the
  // gmail-ingest / navigator-ingest Netlify crons — those email vendors over the
  // Gmail API and are gated separately in their own files. Scrape / screen /
  // sol-ingest keep running (they still feed FSC matching and the DB).
  // Default OFF. To resume during the revamp, set FEDERAL_BLAST_ENABLED=true.
  if (process.env.FEDERAL_BLAST_ENABLED !== "true") {
    results.skipped = plan.length;
    results.paused  = true;
    results.log.push({ note: "Federal blast disabled (retired 2026-07-15) — 0 vendor emails sent; " + plan.length + " skipped." });
    return results;
  }

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

  if (maxVendors > 0 && rotatedPlan.length > maxVendors) {
    info("Capped to first " + maxVendors + " of " + rotatedPlan.length + " vendors (maxVendors)");
    rotatedPlan = rotatedPlan.slice(0, maxVendors);
  }

  // Build global sol → IFL ref map ONCE before vendor loop.
  // A ref belongs to a sol permanently: the same sol always keeps the same ref
  // (this run, later same-day re-blasts, or weeks later), and a ref string is
  // never reused for a different sol. That eliminates the ref/sol mismatch where
  // a rotated re-run re-minted IFL-<date>-006 onto a different sol.
  const blastDate = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const blastDay  = new Date().toISOString().slice(0, 10);
  const solRefMap = new Map(); // sol_number → IFL ref

  if (db) {
    // Unique sols in this plan (in plan order)
    const planSolNums = [];
    for (const entry of rotatedPlan)
      for (const s of entry.sols)
        if (!planSolNums.includes(s.sol_number)) planSolNums.push(s.sol_number);

    // Reuse any ref these sols already own.
    const existing = await db.collection("rfq_refs")
      .find({ sol_number: { $in: planSolNums } }).project({ sol_number: 1, ref: 1 }).toArray();
    const refBySol = new Map(existing.map(d => [d.sol_number, d.ref]));

    // Seed the day counter past any IFL-<date>-NNN already on record (incl. those
    // minted before this counter existed) so we can never re-issue an old number.
    const dayRefs = await db.collection("rfq_refs")
      .find({ ref: { $regex: "^IFL-" + blastDate + "-" } }).project({ ref: 1 }).toArray();
    let maxSeq = 0;
    for (const d of dayRefs) {
      const n = parseInt((d.ref.split("-")[2] || "0"), 10);
      if (n > maxSeq) maxSeq = n;
    }
    await db.collection("_meta").updateOne(
      { _id: "rfq_ref_seq_" + blastDate }, { $max: { seq: maxSeq } }, { upsert: true },
    );

    const newRefEntries = [];
    for (const entry of rotatedPlan) {
      for (const s of entry.sols) {
        if (solRefMap.has(s.sol_number)) continue;
        let ref = refBySol.get(s.sol_number);
        if (!ref) {
          const seq = await nextRefSeq(db, blastDate);
          ref = "IFL-" + blastDate + "-" + String(seq).padStart(3, "0");
          refBySol.set(s.sol_number, ref);
          newRefEntries.push({ ref, sol_number: s.sol_number, item_name: s.item_name || "", fsc: s.fsc || "", nsn: s.nsn || "", ref_part_number: s.ref_part_number || "", blast_date: blastDay });
        }
        solRefMap.set(s.sol_number, ref);
      }
    }
    await saveRefMap(db, newRefEntries);
    info("IFL refs: " + solRefMap.size + " sols mapped (" + newRefEntries.length + " newly minted) for " + blastDate);
  } else {
    // Dry run / no DB — nothing to persist or collide with; simple in-memory seq.
    let refSeq = 0;
    for (const entry of rotatedPlan)
      for (const s of entry.sols)
        if (!solRefMap.has(s.sol_number))
          solRefMap.set(s.sol_number, "IFL-" + blastDate + "-" + String(++refSeq).padStart(3, "0"));
  }

  let lastSentVendorId = null;
  const senderCache = makeSenderCache(db);

  for (const entry of rotatedPlan) {
    const { vendor, sols: allSols } = entry;

    const sender = await senderCache.pick();

    if (sender === "paused") {
      info("⏸ Blast paused via kill switch — stopping");
      results.paused = true;
      results.log.push({ status: "paused", reason: "kill switch" });
      break;
    }
    if (sender === "limit") {
      info("🛑 Resend daily limit reached (" + RESEND_LIMIT + ") — stopping. Resume tomorrow.");
      results.daily_limit = true;
      results.log.push({ status: "stopped", reason: "daily_limit", resend_limit: RESEND_LIMIT });
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

    // Attach pre-assigned global IFL refs — same sol = same ref across all vendors
    const solsWithRefs = sols.map(s => ({ ...s, ref_code: solRefMap.get(s.sol_number) || s.sol_number }));

    // Build subject + body
    const firstSol = solsWithRefs[0];
    const { subject: baseSubject } = buildRFQBody(vendor, firstSol);
    const subject = baseSubject;
    const body    = buildBodyForSender(vendor, solsWithRefs, sender);

    try {
      await sendEmailResend({ to, subject, body });
      const effectiveSender = "resend";

      results.sent++;
      lastSentVendorId = vendor.id || vendor.name;
      results.log.push({ vendor: vendor.name, vendor_email: vendor.email, to, sender: effectiveSender, sols: sols.length, sol_numbers: sols.map(s => s.sol_number), totalExt: entry.totalExt, status: "sent" });
      info("✓ [" + effectiveSender.toUpperCase() + "] RFQ → " + vendor.name + " (" + sols.length + " items)");
      senderCache.increment();

      // Only a real send may be recorded. A test run addresses the mail to us,
      // not the vendor — logging it as "sent" against vendor_email would make
      // the isLive dedup below skip those sols on the next real blast.
      if (db && isLive) {
        const sentAt = new Date().toISOString();
        Promise.all(sols.map(sol =>
          db.collection("blast_log").updateOne(
            { sol_number: sol.sol_number, vendor_email: (vendor.email || "").toLowerCase() },
            { $set: { sol_number: sol.sol_number, ref_code: solRefMap.get(sol.sol_number) || null, item_name: sol.item_name || "", fsc: sol.fsc || "", quote_due: sol.quote_due || "", vendor_name: vendor.name, vendor_email: (vendor.email || "").toLowerCase(), vendor_id: vendor.id || null, sender: effectiveSender, status: "sent", sent_at: sentAt } },
            { upsert: true },
          )
        )).catch(e => info("blast_log save err:", e.message));
      }
    } catch (e) {
      results.failed++;
      results.log.push({ vendor: vendor.name, vendor_email: vendor.email, to, sender, sols: sols.length, sol_numbers: sols.map(s => s.sol_number), status: "failed", error: e.message });
      info("✗ [" + sender.toUpperCase() + "] RFQ FAILED → " + vendor.name + ": " + e.message);

      if (db && isLive) {
        const failAt = new Date().toISOString();
        Promise.all(sols.map(sol =>
          db.collection("blast_log").updateOne(
            { sol_number: sol.sol_number, vendor_email: (vendor.email || "").toLowerCase() },
            { $set: { sol_number: sol.sol_number, vendor_name: vendor.name, vendor_email: (vendor.email || "").toLowerCase(), sender, status: "failed", error: e.message, sent_at: failAt } },
            { upsert: true },
          )
        )).catch(() => {});
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

module.exports = { buildBlastPlan, runBlast, detectPNPrefix, isAerospacePN };
