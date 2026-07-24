// src/index.js — Imperio SCC Autonomous Agent
// Runs on Railway 24/7. Cron fires daily, scrapes DIBBS Navigator,
// screens with Claude, checks NSN watchlist, blasts vendors, emails summary.
//
// Pass --run-now as CLI arg to fire immediately (for testing / manual trigger).

const cron = require("node-cron");
const { fetchDibbsSols }       = require("./gmail-watcher");
const { fetchAllSolDetails }   = require("./dibbs-fetcher");
const { fetchSamSols }         = require("./sam-fetcher");
const { fetchDibbsDailySols }  = require("./dibbs-daily-fetcher");
const { fetchDibbsDailySols: fetchDibbsPuppet } = require("./dibbs-puppet-fetcher");
const { screenBatch }      = require("./screener");
const { buildBlastPlan, runBlast, isAerospacePN, isMedicalFSC, isMedicalVendor, isAerospaceVendor } = require("./blaster");
const { runEsbdSync } = require("./esbd-scraper");
let esbdRunning = false;
const ESBD_CRON = process.env.ESBD_CRON || "0 5 * * *"; // 5 AM CT daily — ESBD scrape
const { checkWatchList, updateWatchHits } = require("./nsn-watch");
const { sendSummary }      = require("./notify");
const { getDb, getDistributors, getNsnWatchList, getAlreadyActedSols, saveSol, upsertNsnWatch, saveDailyBrief } = require("./db");
const { runHealthCheck } = require("./health-check");

// SOL_SOURCE=navigator (default, uses DIBBS Navigator scraper)
// SOL_SOURCE=email (switches to DLA Gmail after Navigator sub ends)
const SOL_SOURCE = process.env.SOL_SOURCE || "navigator";

const SCHEDULE  = process.env.CRON_SCHEDULE || "0 2 * * 1-5"; // 2 AM CT Mon–Fri — DIBBS scrape + vendor blast
const IS_LIVE   = process.env.BLAST_LIVE === "true"; // must be explicitly enabled
// AN/MS/NAS aerospace lane — decoupled from the retired FSC mass-blast 2026-07-18.
// Gates ONLY the aerospace path in blaster.js (approved-mfr + aerospace vendors);
// FEDERAL_BLAST_ENABLED stays off. Reported in /health as aerospace_blast_enabled.
const AEROSPACE_BLAST_ENABLED = process.env.AEROSPACE_BLAST_ENABLED === "true";
// Medical lane — 65xx FSC sols → name-matched medical distributors (~57). Parallel
// to aerospace, independently gated. Reported in /health as medical_blast_enabled.
const MEDICAL_BLAST_ENABLED = process.env.MEDICAL_BLAST_ENABLED === "true";
// Daily scrape+blast cron. STOPPED 2026-07-16 — off unless explicitly re-enabled.
const DAILY_CRON_ENABLED = process.env.DAILY_CRON_ENABLED === "true";
// Health-check alert cron. STOPPED 2026-07-16 — it was the last scheduled emailer.
const HEALTH_CHECK_ENABLED = process.env.HEALTH_CHECK_ENABLED === "true";
// FSC Updater cron. STOPPED 2026-07-16 — hard-off, deliberately NOT env-gated.
// FSC_UPDATER_ENABLED=true is still set in Railway, which silently overrode the
// "PAUSED 2026-07-15" comment and kept the 5 PM auto-apply running for a day.
// To resume: unset that Railway env var FIRST, then restore the env check here.
const FSC_UPDATER_ENABLED = false;
// Where TEST-mode blasts are delivered instead of the vendor. This is the same
// mailbox SCRUBBER scans, so a test RFQ is visible where the real ones land.
const TEST_RECIPIENT = process.env.TEST_RECIPIENT || "anthony@ifedlog.com";
// Comma-separated FSC codes to skip entirely (over hist price, too competitive, etc.)
// Default: aerospace fasteners — AN/MS/NAS parts consistently beat hist price
const SKIP_FSCS = new Set(
  (process.env.SKIP_FSCS || "5305,5306,5307,5310,5315,5320,5325,5330").split(",").map(s => s.trim()).filter(Boolean)
);
// Minimum estimated order value — sols below this are skipped (0 = disabled).
// ext_price = hist_price × qty from PDF. If no price data, sol passes through.
const MIN_ORDER_VALUE = parseInt(process.env.MIN_ORDER_VALUE || "1000", 10) || 0;

// Fix #6: hoisted to module scope so runPipeline and blast-existing stay in sync
const SKIP_SET_ASIDES   = new Set(["HUBZone", "8(a)", "WOSB", "EDWOSB"]);
const SKIP_RESTRICTIONS = new Set(["Sole Source", "Source Control"]);

function log(...a)  { console.log("[scc-agent]", new Date().toISOString().slice(11, 19), ...a); }
function err(...a)  { console.error("[scc-agent] ❌", ...a); }

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────
async function runPipeline(liveModeOverride, maxVendors = 0) {
  const effectiveLive = typeof liveModeOverride === "boolean" ? liveModeOverride : IS_LIVE;
  const runDate  = new Date().toISOString();
  const errors   = [];

  log("═".repeat(60));
  log("Daily pipeline starting — " + (effectiveLive ? "LIVE BLAST" : "TEST MODE (emails to " + TEST_RECIPIENT + ")"));
  if (maxVendors > 0) log("Vendor cap: " + maxVendors + " email(s) max this run");
  log("═".repeat(60));

  // ── 1. MongoDB ────────────────────────────────────────────────────────
  let db;
  try {
    db = await getDb();
    log("MongoDB connected");
  } catch (e) {
    err("MongoDB connection failed:", e.message);
    return;
  }

  // ── 2. Get solicitations ──────────────────────────────────────────────
  let rawSols = [];
  let scrapeResult = { counts: { total: 0, pass1: 0, pass2: 0, pass3: 0 } };

  if (SOL_SOURCE === "dibbs-puppet") {
    // Puppeteer-based DIBBS scraper — real Chrome browser to bypass WAF TLS/JS blocks
    log("Fetching DLA solicitations via Puppeteer (Chrome) from DIBBS daily listing…");
    try {
      rawSols = await fetchDibbsPuppet({ lookbackDays: 1 });
    } catch (e) {
      err("Puppeteer DIBBS fetch failed:", e.message);
      errors.push("DIBBS puppet: " + e.message);
    }
    if (!rawSols.length) {
      log("No sols from Puppeteer DIBBS — sending summary");
      await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: 0, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "No Puppeteer DIBBS results", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
      await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, watchHits: [], errors, runDate });
      return;
    }
    const pdfOk = rawSols.filter(s => s.pdf_parsed).length;
    scrapeResult = { counts: { total: rawSols.length, pass1: rawSols.length, pass2: pdfOk, pass3: 0 } };

  } else if (SOL_SOURCE === "dibbs") {
    // DIBBS daily listing — scrapes www.dibbs.bsm.dla.mil/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=MM-DD-YYYY
    // Each row has a direct href to the dibbs2 PDF — no URL guessing, no SAM API dependency.
    log("Fetching DLA solicitations from DIBBS daily listing…");
    let dibbsDailySols = [];
    try {
      dibbsDailySols = await fetchDibbsDailySols({ lookbackDays: 1 });
    } catch (e) {
      err("DIBBS daily fetch failed:", e.message);
      errors.push("DIBBS daily: " + e.message);
    }
    if (!dibbsDailySols.length) {
      log("No solicitations from DIBBS daily listing — sending summary");
      await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: 0, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "No DIBBS daily results", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
      await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, watchHits: [], errors, runDate });
      return;
    }
    log("DIBBS daily: " + dibbsDailySols.length + " sols — fetching PDFs…");
    rawSols = await fetchAllSolDetails(dibbsDailySols);
    const pdfOk = rawSols.filter(s => s.pdf_parsed).length;
    log("PDF fetch complete — " + pdfOk + "/" + rawSols.length + " parsed");
    scrapeResult = { counts: { total: rawSols.length, pass1: dibbsDailySols.length, pass2: pdfOk, pass3: 0 } };

  } else if (SOL_SOURCE === "sam") {
    // SAM.gov Opportunities API → DLA RFQ sol list
    // PDF enrichment is intentionally deferred — runs in background after blast
    // so DIBBS2 latency/banner issues never block vendor emails from going out.
    log("Fetching DLA solicitations from SAM.gov API…");
    const fscLanes = (process.env.NAVIGATOR_FSC_LANES || process.env.SAM_FSC_LANES || "").split(",").map(s => s.trim()).filter(Boolean);
    let samSols = [];
    // Retry up to 3 times — SAM.gov can be slow under load
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        samSols = await fetchSamSols({ lookbackDays: 3, fscLanes });
        break;
      } catch (e) {
        err("SAM fetch attempt " + attempt + "/3:", e.message);
        if (attempt === 3) { errors.push("SAM: " + e.message); }
        else { await new Promise(r => setTimeout(r, 10000 * attempt)); }
      }
    }
    if (!samSols.length) {
      log("No DLA solicitations from SAM — sending summary");
      await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: 0, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "No SAM results", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
      await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, watchHits: [], errors, runDate });
      return;
    }
    log("SAM returned " + samSols.length + " sols — fetching DIBBS PDFs (ship-to, pricing, packaging)…");
    rawSols = await fetchAllSolDetails(samSols);
    const pdfOk = rawSols.filter(s => s.pdf_parsed).length;
    log("PDF fetch complete — " + pdfOk + "/" + rawSols.length + " parsed");
    scrapeResult = { counts: { total: rawSols.length, pass1: samSols.length, pass2: pdfOk, pass3: 0 } };

  } else if (SOL_SOURCE === "email") {
    // DLA emails → Gmail → PDF parse
    log("Checking Gmail for DLA solicitation emails…");
    let emailSols = [];
    try {
      emailSols = await fetchDibbsSols({ lookbackHours: 26 });
    } catch (e) {
      err("Gmail fetch failed:", e.message);
      errors.push("Gmail: " + e.message);
    }
    if (!emailSols.length) {
      log("No DLA solicitation emails found in last 26h — sending summary");
      await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: 0, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "No DLA emails found", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
      await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, watchHits: [], errors, runDate });
      return;
    }
    log("Found " + emailSols.length + " sols from email — fetching PDFs…");
    rawSols = await fetchAllSolDetails(emailSols);
    log("PDF fetch complete — " + rawSols.filter(s => s.pdf_parsed).length + "/" + rawSols.length + " PDFs parsed");
    scrapeResult = { counts: { total: rawSols.length, pass1: emailSols.length, pass2: 0 } };

  } else {
    // Navigator scraper (active until Navigator sub ends)
    log("Scraping DIBBS Navigator…");
    const { scrape } = require("./scraper");
    const result = await scrape({
      username:  process.env.NAVIGATOR_USERNAME,
      password:  process.env.NAVIGATOR_PASSWORD,
      minPrice:  1000,
    });
    if (!result.ok || !result.sols.length) {
      err("Navigator scrape failed or returned 0 sols:", result.error || "no sols");
      errors.push("Scraper: " + (result.error || "0 sols"));
      await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: 0, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: result.error || "Scrape returned 0 sols", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
      await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, watchHits: [], errors, runDate });
      return;
    }
    rawSols = result.sols;
    scrapeResult = { counts: result.counts };
    log("Scrape complete — " + rawSols.length + " sols");
  }

  // ── 2b. Lean AN/MS/NAS sweep ──────────────────────────────────────────
  // When aerospace is the only live blast lane (aerospace ON + federal OFF),
  // there is no reason to Claude-screen + save ~480 non-aerospace sols just to
  // blast ~5. Filter to AN/MS/NAS right after scrape so screening/save/ingest
  // only touch the sweep set. The State side needs vendors, not these sols.
  const FEDERAL_ON = process.env.FEDERAL_BLAST_ENABLED === "true";
  const KEEP_AERO = AEROSPACE_BLAST_ENABLED && !FEDERAL_ON;
  const KEEP_MED  = MEDICAL_BLAST_ENABLED && !FEDERAL_ON;
  if ((KEEP_AERO || KEEP_MED) && !FEDERAL_ON) {
    const before = rawSols.length;
    rawSols = rawSols.filter(s =>
      (KEEP_AERO && isAerospacePN(s.ref_part_number)) ||
      (KEEP_MED && isMedicalFSC(s.fsc || (s.nsn || "").slice(0, 4))),
    );
    log("Lean sweep (aero=" + KEEP_AERO + " med=" + KEEP_MED + "): " + rawSols.length + "/" + before + " sols kept — screening only these");
  }

  // ── 3. Skip already-acted + DNS FSCs ─────────────────────────────────
  const alreadyActed = await getAlreadyActedSols(db);
  const dnsFscFiltered = rawSols.filter(s => {
    const fsc = String(s.fsc || (s.nsn || "").slice(0, 4));
    if (!SKIP_FSCS.has(fsc)) return true;
    // Aerospace-standard parts are in fastener FSCs but route to approved-mfr vendors — keep them
    return isAerospacePN(s.ref_part_number);
  });
  const dnsDrop = rawSols.length - dnsFscFiltered.length;
  if (dnsDrop) log("Dropped " + dnsDrop + " sols in DNS FSC lanes (" + [...SKIP_FSCS].join(",") + ")");

  // Hard-skip: set-aside categories IFL can't bid on, and locked supplier restrictions
  const bidableFiltered = dnsFscFiltered.filter(s => {
    if (s.set_aside        && SKIP_SET_ASIDES.has(s.set_aside))        return false;
    if (s.supplier_restrictions && SKIP_RESTRICTIONS.has(s.supplier_restrictions)) return false;
    return true;
  });
  const setAsideDrop = dnsFscFiltered.length - bidableFiltered.length;
  if (setAsideDrop) log("Dropped " + setAsideDrop + " sols — restricted set-aside or locked supplier");

  const freshSols = bidableFiltered.filter(s => !alreadyActed.has(s.sol_number));
  const skipped   = dnsFscFiltered.length - freshSols.length;
  if (skipped) log("Skipped " + skipped + " already-acted sols");

  // Drop sub-minimum orders. Aerospace-standard MIL-spec parts use a lower floor
  // ($1k) — they come in at small ext prices but route to approved MFRs via blaster.
  // If ext_price is null, let through — can't filter what we don't know.
  // Single high floor across ALL lanes ($20k default) — Anthony only wants to sort/bid
  // high-dollar sols, not wade through 200 low-$ items. The old $1k aero/medical
  // carve-outs are gone. Unknown ext_price still passes (can't filter what we don't know).
  const valuedSols = MIN_ORDER_VALUE > 0 ? freshSols.filter(s => {
    if (s.ext_price == null) return true;
    return s.ext_price >= MIN_ORDER_VALUE;
  }) : freshSols;
  const valueDrop = freshSols.length - valuedSols.length;
  if (valueDrop) log("Dropped " + valueDrop + " sols under $" + MIN_ORDER_VALUE.toLocaleString() + " (ext_price)");

  if (!valuedSols.length) {
    log("No new sols — sending summary");
    await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: rawSols.length, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "All sols already acted on or below min value", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
    await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, errors, runDate });
    return;
  }

  // ── 4. NSN Watch check ────────────────────────────────────────────────
  log("Checking NSN watch list…");
  const watchList = await getNsnWatchList(db);
  log("Watch list: " + watchList.length + " NSNs");
  const { watchHits, unwatched } = checkWatchList(valuedSols, watchList);

  // ── 5. Claude screening (only unwatched sols) ─────────────────────────
  let screenResults = [];
  if (unwatched.length) {
    log("Screening " + unwatched.length + " sols with Claude…");
    try {
      screenResults = await screenBatch(unwatched);
    } catch (e) {
      err("Screener failed:", e.message);
      errors.push("Screener: " + e.message);
      // Fall back to GO for everything — better to blast and miss than miss and not blast
      screenResults = unwatched.map(s => ({
        sol_number: s.sol_number, verdict: "GO", reason: "Claude unavailable", winProbabilityPct: 50,
      }));
    }
  }

  // Merge watch hits (pre-approved GO) with screened results
  const allScreened = [
    ...watchHits,
    ...screenResults.map(r => ({ ...unwatched.find(s => s.sol_number === r.sol_number), ...r })),
  ];

  // ── 6. Save all to MongoDB solicitations ──────────────────────────────
  for (const sol of allScreened) {
    try {
      await saveSol(db, {
        sol_number:            sol.sol_number,
        nsn:                   sol.nsn || "",
        fsc:                   sol.fsc || "",
        item_name:             sol.item_name || "",
        ref_part_number:       sol.ref_part_number || sol.piece_part_no || "",
        manufacturer_cage:     sol.manufacturer_cage || "",
        quantity:              String(sol.qty || sol.quantity || ""),
        unit_of_issue:         sol.unit_issue || sol.unit_of_issue || "", // e.g. HD (hundred) — vendors mis-quote as EA without it
        unit_price:            sol.unit_price || sol.hist_price || null,
        hist_price:            sol.hist_price || null,
        ext_price:             sol.ext_price || (sol.unit_price || sol.hist_price ? (sol.unit_price || sol.hist_price) * parseFloat(sol.qty || sol.quantity || 1) : null) || null,
        quote_due:             sol.quote_due || "",
        delivery_days:         String(sol.delivery_days || ""),
        set_aside:             sol.set_aside || "",
        fob:                   sol.fob || "",
        supplier_restrictions: sol.supplier_restrictions || "",
        amsc:                  sol.amsc || "",
        supplier_list:         sol.supplier_list || "",
        is_repost:             !!sol.is_repost,
        buyer_email:           sol.buyer_email || "",
        buyer_name:            sol.buyer_name || "",
        ship_to_dodaac:          sol.ship_to_dodaac || "",
        ship_to_name:            sol.ship_to_name || "",
        ship_to_street:          sol.ship_to_street || "",
        ship_to_csz:             sol.ship_to_csz || "",
        need_ship_date:          sol.need_ship_date || "",
        required_delivery_date:  sol.required_delivery_date || "",
        packaging_spec:          sol.packaging_spec || "",
        packaging_type:          sol.packaging_type || "",
        packaging_label:         sol.packaging_label || "",
        packaging_qup:           sol.packaging_qup || "",
        requires_nist_assessment: sol.requires_nist_assessment || false,
        status:                sol.verdict === "REJECT" ? "No Source" : "New",
        verdict:               sol.verdict || "GO",
        win_probability:       sol.winProbabilityPct || 0,
        notes:                 [
          "Auto-ingested via Railway agent",
          sol.is_watched ? "⭐ Watched NSN" : null,
          sol.claudeReason || sol.reason || null,
          sol.sourcing_path || null,
        ].filter(Boolean).join(" · "),
        source:    "railway-agent",
        date_added: new Date().toLocaleDateString(),
      });
    } catch (e) {
      err("saveSol failed for " + sol.sol_number + ":", e.message);
      errors.push("saveSol " + sol.sol_number + ": " + e.message);
    }
  }

  // ── 7. Blast — only GO + VERIFY sols ─────────────────────────────────
  let blastSols = allScreened.filter(s => s.verdict !== "REJECT" && s.winProbabilityPct >= 50);
  log("Blast-eligible (pre-gate): " + blastSols.length + " sols");

  // Quality gate: block any sol missing the minimum data vendors need to quote.
  // Hard blocks: item_name (they must know WHAT to price) + quote_due (they must know the deadline).
  // Quantity is NOT a hard block — SAM API never provides it and ~60% of sols have no PDF attachment.
  // Missing quantity shows as "Per RFQ" in the vendor email body, which is professional and actionable.
  // Drop sols where vendor's displayed response due (= DLA quote_due minus 1 day) is today or already past.
  // Raw quote_due must be at least 2 days out so the vendor has a real day to respond.
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const cutoffMs = todayMs + 2 * 86400000; // today + 2 days
  // Reposts are exempt: DIBBS reposts show a past/near "Quote Due" but are still
  // open to quote (they get re-solicited). Gating them on the raw date drops the
  // whole repost lane. Non-reposts still need 2 days for the vendor to respond.
  const expiredSols = blastSols.filter(s => {
    if (s.is_repost) return false;
    if (!s.quote_due) return false;
    const d = new Date(s.quote_due);
    return !isNaN(d.getTime()) && d.getTime() < cutoffMs;
  });
  if (expiredSols.length) log("Dropped " + expiredSols.length + " non-repost sol(s) — quote due today or tomorrow (too late to blast)");
  blastSols = blastSols.filter(s => {
    if (s.is_repost) return true; // still quotable despite past/near due date
    if (!s.quote_due) return true;
    const d = new Date(s.quote_due);
    return isNaN(d.getTime()) || d.getTime() >= cutoffMs;
  });

  const heldSols  = [];
  const readySols = blastSols.filter(s => {
    const missing = [];
    if (!s.quote_due) missing.push("quote_due");
    if (!s.item_name) missing.push("item_name");
    // HARD GATE: no part number, no blast. A vendor can't quote "HOSE, qty 235"
    // without a P/N — that's what put 1,528 junk RFQs out. Held here until enriched.
    if (!s.ref_part_number || s.ref_part_number === "N/A") missing.push("part_number");
    // Track missing quantity as advisory only — does not block blast
    if (!s.quantity && !s.qty) s._missing_qty = true;
    if (missing.length) {
      log("⛔ " + s.sol_number + " held — missing: " + missing.join(", "));
      heldSols.push({ ...s, _missing: missing });
      return false;
    }
    return true;
  });
  if (heldSols.length) log("Held " + heldSols.length + " sol(s) from blast — incomplete data");
  log("Blast-ready: " + readySols.length + " sols");

  let blastResult = { sent: 0, failed: 0, log: [] };

  if (readySols.length) {
    const dists = await getDistributors(db);
    log("Distributor DB: " + dists.length + " vendors");

    const plan = buildBlastPlan(readySols, dists);

    if (plan.length) {
      log("Firing blast: " + plan.length + " vendor emails (" + (effectiveLive ? "LIVE" : "TEST") + ")…");
      blastResult = await runBlast(plan, { isLive: effectiveLive, fromAddress: TEST_RECIPIENT, maxVendors }, db);
      log("Blast complete: " + blastResult.sent + " sent, " + blastResult.failed + " failed");

      // Only mark sols whose emails were actually confirmed sent — and ONLY on a
      // LIVE run. A test run (isLive:false) mails to TEST_RECIPIENT, not the vendor;
      // marking those "Awaiting Quotes" made getAlreadyActedSols skip them on the
      // next real blast, so today's sweep silently sent 0. Test = no status change.
      const sentSolNums = new Set(
        effectiveLive ? blastResult.log.filter(e => e.status === "sent").flatMap(e => e.sol_numbers || []) : []
      );
      for (const entry of plan) {
        for (const sol of entry.sols) {
          if (sentSolNums.has(sol.sol_number)) {
            await saveSol(db, { sol_number: sol.sol_number, status: "Awaiting Quotes" }).catch(() => {});
          }
        }
      }
    } else {
      log("No vendors matched — check distributor DB FSC assignments");
    }
  }

  // ── 7b. Background PDF retry (SAM mode, failed PDFs only) ────────────
  // PDFs already fetched above — only retry the ones that failed banner/parse.
  // Runs after blast so DIBBS2 latency doesn't delay vendor emails.
  if (SOL_SOURCE === "sam" && allScreened.length) {
    const toEnrich = allScreened.filter(s => !s.pdf_parsed);
    if (toEnrich.length) {
      setImmediate(async () => {
        log("Background PDF enrichment: " + toEnrich.length + " sols…");
        try {
          const enriched = await fetchAllSolDetails(toEnrich);
          let updated = 0;
          for (const sol of enriched.filter(s => s.pdf_parsed)) {
            await saveSol(db, {
              sol_number:            sol.sol_number,
              item_name:             sol.item_name || "",
              ref_part_number:       sol.ref_part_number || "",
              manufacturer_cage:     sol.manufacturer_cage || "",
              quantity:              String(sol.quantity || ""),
              unit_price:            sol.unit_price || null,
              hist_price:            sol.hist_price || null,
              ext_price:             sol.ext_price || null,
              quote_due:             sol.quote_due || "",
              delivery_days:         String(sol.delivery_days || ""),
              set_aside:             sol.set_aside || "",
              fob:                   sol.fob || "",
              supplier_restrictions: sol.supplier_restrictions || "",
        amsc:                  sol.amsc || "",
              buyer_email:           sol.buyer_email || "",
              buyer_name:            sol.buyer_name || "",
              ship_to_dodaac:        sol.ship_to_dodaac || "",
              ship_to_name:          sol.ship_to_name || "",
              ship_to_street:        sol.ship_to_street || "",
              ship_to_csz:           sol.ship_to_csz || "",
              need_ship_date:        sol.need_ship_date || "",
              required_delivery_date: sol.required_delivery_date || "",
              packaging_spec:        sol.packaging_spec || "",
              packaging_type:        sol.packaging_type || "",
              packaging_label:       sol.packaging_label || "",
              packaging_qup:         sol.packaging_qup || "",
              requires_nist_assessment: sol.requires_nist_assessment || false,
              pdf_parsed:            true,
            }).catch(e => err("PDF enrichment saveSol " + sol.sol_number + ":", e.message));
            updated++;
          }
          log("Background PDF enrichment done: " + updated + "/" + toEnrich.length + " PDFs parsed");
        } catch (e) {
          err("Background PDF enrichment failed:", e.message);
        }
      });
    }
  }

  // ── 8. Update NSN watch records with latest pricing ───────────────────
  if (watchHits.length) {
    await updateWatchHits(db, watchHits).catch(e => err("updateWatchHits:", e.message));

    // Also register any new NSNs from GO sols into the watch list
    const newWatches = readySols
      .filter(s => s.nsn && !watchList.find(w => w.nsn === s.nsn))
      .map(s => ({
        nsn:            s.nsn,
        fsc:            s.fsc,
        item_name:      s.item_name,
        sol_number:     s.sol_number,
        last_unit_price: parseFloat(s.hist_price || s.unit_price || 0) || null,
        date_added:     new Date().toISOString().slice(0, 10),
      }));
    if (newWatches.length) {
      await upsertNsnWatch(db, newWatches).catch(e => err("upsertNsnWatch:", e.message));
      log("Added " + newWatches.length + " new NSNs to watch list");
    }
  }

  // ── 9. Save daily brief to MongoDB ───────────────────────────────────
  await saveDailyBrief(db, {
    run_date:     new Date().toLocaleDateString("en-US"),
    total_sols:   rawSols.length,
    fresh_sols:   valuedSols.length,
    go_count:     allScreened.filter(s => s.verdict === "GO").length,
    verify_count: allScreened.filter(s => s.verdict === "VERIFY FIRST").length,
    reject_count: allScreened.filter(s => s.verdict === "REJECT").length,
    watch_hits:   watchHits.length,
    blast_sent:   blastResult.sent,
    blast_failed: blastResult.failed,
    error_count:  errors.length,
    sols: allScreened.map(s => {
      const qty       = parseFloat(String(s.quantity || s.qty || "0").replace(/,/g, "")) || 0;
      const unitPrice = s.unit_price || s.hist_price || null;
      const extPrice  = (unitPrice && qty) ? Math.round(unitPrice * qty * 100) / 100 : null;
      return {
        sol_number:      s.sol_number,
        item_name:       s.item_name || "",
        fsc:             s.fsc || "",
        nsn:             s.nsn || "",
        verdict:         s.verdict || "GO",
        win_pct:         s.winProbabilityPct || 0,
        quote_due:       s.quote_due || "",
        quantity:        String(s.quantity || s.qty || ""),
        unit_price:      unitPrice,
        ext_price:       extPrice,
        set_aside:       s.set_aside || "",
        ref_part_number: s.ref_part_number || "",
        sourcing_path:   s.sourcing_path || "",
        is_watched:      !!s.is_watched,
        is_repost:       !!s.is_repost,
        // Approved-source companies (scraped Supplier List column) — persist so
        // "who can supply this" is queryable. AIDC tagged from the sol-number
        // type char (…U#### = AIDC) since the scrape doesn't capture Sol Type.
        supplier_list:   s.supplier_list || "",
        amsc:            s.amsc || "",
        is_aidc:         ((s.sol_number || "")[8] || "").toUpperCase() === "U",
        reason:          s.reason || s.claudeReason || "",
        sol_url:         s.sol_url || "",
      };
    }),
    blast_log: blastResult.log || [],
  }).catch(e => err("saveDailyBrief:", e.message));

  // ── 9. Summary email ─────────────────────────────────────────────────
  log("Sending summary email…");
  try {
    await sendSummary({
      scrape:    scrapeResult,
      screen:    allScreened,
      blast:     blastResult,
      watchHits,
      errors,
      runDate,
      heldSols,
    });
  } catch (e) {
    err("Summary email failed:", e.message);
  }

  log("Pipeline complete ✅");
  log("═".repeat(60));
}

// ── HTTP SERVER (health + manual trigger) ────────────────────────────────
const http = require("http");

let lastRunAt       = null;
let lastRunOk       = null;
let pipelineRunning = false;

// Cached blast state — refreshed every 30s so health checks don't open new DB connections
let _blastState = { paused: false, daily_sent: 0, daily_limit: parseInt(process.env.BLAST_DAILY_LIMIT || "400"), cached_at: 0 };
async function refreshBlastState() {
  try {
    const db    = await getDb();
    const today = new Date().toISOString().slice(0, 10);
    const [ctrl, daily] = await Promise.all([
      db.collection("_meta").findOne({ _id: "blast_control" }),
      db.collection("_meta").findOne({ _id: "blast_daily" }),
    ]);
    _blastState.paused     = !!(ctrl && ctrl.paused);
    _blastState.daily_sent = (daily && daily.date === today) ? (daily.count || 0) : 0;
    _blastState.cached_at  = Date.now();
  } catch {}
}
// Prime at boot, then refresh every 30 seconds. Without the priming call, /health
// serves the paused:false initializer for the first 30s after every deploy — which
// reads as "the kill switch came unset on restart" when nothing actually changed.
refreshBlastState().catch(() => {});
setInterval(() => refreshBlastState().catch(() => {}), 30000);

const PORT = process.env.PORT || 3100;

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const u = req.url.split("?")[0];

  // Blast sols already in MongoDB — bypasses SAM fetch + PDF parse entirely.
  // Use when sols are already stored but haven't been emailed yet.
  if (u === "/blast-existing" && req.method === "POST") {
    if (pipelineRunning) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Pipeline already running" }));
      return;
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Blast-existing triggered" }));
    log("Blast-existing triggered via HTTP");

    (async () => {
      pipelineRunning = true;
      try {
        const db   = await getDb();
        const dists = await getDistributors(db);
        log("Blast-existing: distributor DB — " + dists.length + " vendors");

        // Pull GO/VERIFY sols not yet blasted (status = New or screened but unsent)
        const existing = await db.collection("solicitations").find({
          status:  { $nin: ["Awaiting Quotes", "Bid Submitted", "Awarded", "Lost", "Outreach"] },
          verdict: { $in: ["GO", "VERIFY FIRST", null, ""] },
        }).toArray();

        const blastSols = existing.filter(s => {
          if (s.set_aside        && SKIP_SET_ASIDES.has(s.set_aside))        return false;
          if (s.supplier_restrictions && SKIP_RESTRICTIONS.has(s.supplier_restrictions)) return false;
          return true;
        });

        log("Blast-existing: " + blastSols.length + " eligible sols from MongoDB");

        if (!blastSols.length) {
          log("Blast-existing: nothing to send");
          lastRunOk = true;
          return;
        }

        const plan = buildBlastPlan(blastSols, dists);
        log("Blast-existing: plan = " + plan.length + " vendors");

        if (plan.length) {
          const result = await runBlast(plan, { isLive: IS_LIVE, fromAddress: TEST_RECIPIENT }, db);
          log("Blast-existing complete: " + result.sent + " sent, " + result.failed + " failed");
          // Fix #2: only mark sols whose emails were actually sent — don't blackhole
          // unsent sols when runBlast stopped early at the daily limit
          const sentSolNums = new Set(
            result.log.filter(e => e.status === "sent").flatMap(e => e.sol_numbers || [])
          );
          for (const entry of plan) {
            for (const sol of entry.sols) {
              if (sentSolNums.has(sol.sol_number)) {
                await saveSol(db, { sol_number: sol.sol_number, status: "Awaiting Quotes" }).catch(() => {});
              }
            }
          }
        }
        lastRunOk = true;
      } catch (e) {
        err("Blast-existing error:", e.message);
        lastRunOk = false;
      } finally {
        lastRunAt = Date.now();
        pipelineRunning = false;
      }
    })();
    return;
  }

  // Manually fetch + parse PDFs for stored sols that haven't been enriched yet.
  // Called from SCC UI or after a SAM run to backfill PDF data.
  if (u === "/enrich-pdfs" && req.method === "POST") {
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "PDF enrichment triggered" }));
    log("PDF enrichment triggered via HTTP");

    (async () => {
      try {
        const db = await getDb();
        const unenriched = await db.collection("solicitations").find({
          pdf_parsed: { $ne: true },
          source:     "railway-agent",
          status:     { $nin: ["Lost", "Awarded", "No Source"] },
        }).limit(50).toArray();

        if (!unenriched.length) {
          log("Enrich-PDFs: no un-enriched sols found");
          return;
        }

        log("Enrich-PDFs: fetching " + unenriched.length + " PDFs…");
        const enriched = await fetchAllSolDetails(unenriched);
        let updated = 0;
        for (const sol of enriched.filter(s => s.pdf_parsed)) {
          await saveSol(db, {
            sol_number:            sol.sol_number,
            item_name:             sol.item_name || "",
            ref_part_number:       sol.ref_part_number || "",
            manufacturer_cage:     sol.manufacturer_cage || "",
            quantity:              String(sol.quantity || ""),
            unit_price:            sol.unit_price || null,
            hist_price:            sol.hist_price || null,
            ext_price:             sol.ext_price || null,
            quote_due:             sol.quote_due || "",
            delivery_days:         String(sol.delivery_days || ""),
            set_aside:             sol.set_aside || "",
            fob:                   sol.fob || "",
            supplier_restrictions: sol.supplier_restrictions || "",
        amsc:                  sol.amsc || "",
            buyer_email:           sol.buyer_email || "",
            buyer_name:            sol.buyer_name || "",
            ship_to_dodaac:        sol.ship_to_dodaac || "",
            ship_to_name:          sol.ship_to_name || "",
            ship_to_street:        sol.ship_to_street || "",
            ship_to_csz:           sol.ship_to_csz || "",
            need_ship_date:        sol.need_ship_date || "",
            required_delivery_date: sol.required_delivery_date || "",
            packaging_spec:        sol.packaging_spec || "",
            packaging_type:        sol.packaging_type || "",
            packaging_label:       sol.packaging_label || "",
            packaging_qup:         sol.packaging_qup || "",
            requires_nist_assessment: sol.requires_nist_assessment || false,
            pdf_parsed:            true,
          }).catch(() => {});
          updated++;
        }
        log("Enrich-PDFs complete: " + updated + "/" + unenriched.length + " PDFs parsed");
      } catch (e) {
        err("Enrich-PDFs error:", e.message);
      }
    })();
    return;
  }

  if (u === "/health-check" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const result = await runHealthCheck(mdb, { emailOnFailure: false });
      res.writeHead(result.ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  if (u === "/health" && req.method === "GET") {
    const now = Date.now();
    const msAgo = lastRunAt ? now - lastRunAt : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      mode: "railway",
      // schedule is the configured string; daily_cron_registered is whether it is
      // actually armed. They disagree when the cron is stopped — report both, or
      // /health reads "0 7 * * 1-5" and looks live when nothing is scheduled.
      schedule: SCHEDULE,
      daily_cron_registered: DAILY_CRON_ENABLED,
      health_check_cron_registered: HEALTH_CHECK_ENABLED,
      fsc_updater_cron_registered: FSC_UPDATER_ENABLED,
      federal_blast_enabled: process.env.FEDERAL_BLAST_ENABLED === "true",
      aerospace_blast_enabled: AEROSPACE_BLAST_ENABLED,
      medical_blast_enabled: MEDICAL_BLAST_ENABLED,
      blast_live: IS_LIVE,
      blast_paused:  _blastState.paused,
      daily_sent:    _blastState.daily_sent,
      daily_limit:   _blastState.daily_limit,
      last_run: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      last_run_ok: lastRunOk,
      last_run_ago_min: msAgo ? Math.round(msAgo / 60000) : null,
      running: pipelineRunning,
    }));
    return;
  }

  if ((u === "/pause-blast" || u === "/resume-blast") && req.method === "POST") {
    const paused = u === "/pause-blast";
    getDb().then(async (mdb) => {
      await mdb.collection("_meta").updateOne(
        { _id: "blast_control" },
        { $set: { paused, updated_at: new Date().toISOString() } },
        { upsert: true },
      );
      _blastState.paused = paused;
      log("Blast " + (paused ? "PAUSED" : "RESUMED") + " via HTTP");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, paused }));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  if (u === "/reset-daily-counts" && req.method === "POST") {
    getDb().then(async (mdb) => {
      const today = new Date().toISOString().slice(0, 10);
      await Promise.all([
        mdb.collection("_meta").updateOne({ _id: "gmail_daily"  }, { $set: { count: 0, date: today } }, { upsert: true }),
        mdb.collection("_meta").updateOne({ _id: "resend_daily" }, { $set: { count: 0, date: today } }, { upsert: true }),
      ]);
      log("Daily send counts reset to 0 for " + today);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, date: today, gmail: 0, resend: 0 }));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Un-stick sols falsely marked "Awaiting Quotes" by a TEST run. A real send writes
  // a blast_log {status:"sent"} row; a test send does not. Any "Awaiting Quotes" sol
  // with no such row was never emailed to a vendor — reset it to "New" so it blasts.
  if (u === "/reset-unsent" && req.method === "POST") {
    getDb().then(async (mdb) => {
      const stuck = await mdb.collection("solicitations")
        .find({ status: "Awaiting Quotes" }).project({ sol_number: 1 }).toArray();
      const sentRows = await mdb.collection("blast_log")
        .find({ status: "sent" }).project({ sol_number: 1 }).toArray();
      const sent = new Set(sentRows.map(r => r.sol_number));
      const toReset = stuck.filter(s => !sent.has(s.sol_number));
      for (const s of toReset) {
        await mdb.collection("solicitations").updateOne(
          { sol_number: s.sol_number }, { $set: { status: "New" } },
        ).catch(() => {});
      }
      log("reset-unsent: " + toReset.length + " reset to New (of " + stuck.length + " Awaiting Quotes)");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, awaiting: stuck.length, reset: toReset.length, sols: toReset.map(s => s.sol_number) }));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Read what actually went out recently — /blast-existing writes no daily brief,
  // so this reads blast_log directly. ?mins=N sets the window (default 20).
  if (u === "/recent-blasts" && req.method === "GET") {
    const mins = parseInt(new URLSearchParams(req.url.split("?")[1] || "").get("mins") || "20", 10) || 20;
    getDb().then(async (mdb) => {
      const since = new Date(Date.now() - mins * 60000).toISOString();
      const rows = await mdb.collection("blast_log")
        .find({ status: "sent", sent_at: { $gte: since } })
        .project({ sol_number: 1, vendor_name: 1, vendor_email: 1, sent_at: 1 }).toArray();
      const sols = [...new Set(rows.map(r => r.sol_number))];
      const vendors = [...new Set(rows.map(r => (r.vendor_email || "").toLowerCase()))];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, window_min: mins, sent_rows: rows.length, unique_sols: sols.length, unique_vendors: vendors.length, sols: sols.sort() }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Targeted single-vendor send of the current AN/MS/NAS sweep. Body:
  //   { "name":"G-Fast", "localpart":"info" }  → resolves the domain from this
  //     vendor's historical blast_log email and swaps the local part (info@<domain>).
  //   { "email":"info@foo.com", "name":"G-Fast" } → explicit address.
  //   add "send":true to actually send; without it, dry-run (resolved email + sol list).
  // Routes through the aerospace lane only, so ONLY AN/MS/NAS sols go. Deduped.
  if (u === "/blast-one" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const db = await getDb();
        let email = (p.email || "").toLowerCase(), resolvedFrom = "provided";
        if (!email) {
          if (!p.name) throw new Error("name or email required");
          const rx = new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]?"), "i");
          const hist = await db.collection("blast_log").findOne({ vendor_name: rx, vendor_email: { $nin: ["", null] } });
          if (!hist) throw new Error("no historical blast_log email found for '" + p.name + "'");
          const dom = (hist.vendor_email || "").split("@")[1];
          if (!dom) throw new Error("historical email has no domain: " + hist.vendor_email);
          email = (p.localpart || "info") + "@" + dom;
          resolvedFrom = "blast_log:" + hist.vendor_email;
        }
        // Do-not-contact guard — honor blocked vendors even on a manual one-off send.
        const targetDom = email.split("@")[1] || "";
        const blockHit = await db.collection("distributors").findOne({
          is_dns: true, $or: [{ email: email }, { blocked_domain: targetDom }],
        });
        if (blockHit) throw new Error("BLOCKED — " + email + " is on the do-not-contact list (" + (blockHit.dns_reason || "blocked") + ")");
        const sols = await db.collection("solicitations")
          .find({ status: { $in: ["New", "Awaiting Quotes"] } }).toArray();
        const dists = [{ name: p.name || email, email, is_manufacturer: true, id: "oneoff:" + email }];
        const plan = buildBlastPlan(sols, dists);
        const aeroSols = plan[0] ? plan[0].sols.map(s => s.sol_number) : [];
        if (p.send !== true) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, dryRun: true, email, resolvedFrom, anmsnas_sols: aeroSols.length, sols: aeroSols }, null, 2));
          return;
        }
        const result = await runBlast(plan, { isLive: true, fromAddress: TEST_RECIPIENT }, db);
        log("blast-one → " + email + ": " + result.sent + " sent, " + result.failed + " failed (" + aeroSols.length + " AN/MS/NAS sols)");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sent: result.sent, failed: result.failed, email, anmsnas_sols: aeroSols.length, sols: aeroSols }, null, 2));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Permanently block a vendor / domain from all blasts. Body:
  //   { "name":"G-Fast", "domain":"g-fast.com", "emails":["steve@g-fast.com","info@g-fast.com"], "reason":"..." }
  // Upserts is_dns:true records so buildBlastPlan (auto sweep) AND /blast-one skip them.
  if (u === "/block-vendor" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const reason = p.reason || "Do-not-contact (manual block)";
        const db = await getDb();
        const emails = (p.emails || []).map(e => String(e).toLowerCase());
        let n = 0;
        const setDead = { is_dns: true, is_portal: false, email_invalid: false, dns_reason: reason, blocked_at: new Date().toISOString() };
        for (const em of emails) {
          // Case-insensitive match so an UPPERCASE stored email isn't silently missed
          // (which upserts a dupe and leaves the original live).
          const esc = em.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const found = await db.collection("distributors").findOne({ email: { $regex: "^" + esc + "$", $options: "i" } });
          if (found) {
            await db.collection("distributors").updateOne({ _id: found._id }, { $set: setDead });
          } else {
            await db.collection("distributors").updateOne({ email: em }, { $set: { name: p.name || em, email: em, ...setDead } }, { upsert: true });
          }
          n++;
        }
        if (p.domain) {
          await db.collection("distributors").updateOne(
            { blocked_domain: String(p.domain).toLowerCase() },
            { $set: { blocked_domain: String(p.domain).toLowerCase(), name: p.name || p.domain, is_dns: true, is_portal: false, dns_reason: reason, blocked_at: new Date().toISOString() } },
            { upsert: true },
          );
          n++;
        }
        // Also flag any existing distributor rows on that domain (clear portal too —
        // a blocked competitor is neither an email nor a portal source).
        if (p.domain) {
          await db.collection("distributors").updateMany(
            { email: { $regex: "@" + String(p.domain).replace(/\./g, "\\.") + "$", $options: "i" } },
            { $set: { is_dns: true, is_portal: false, dns_reason: reason, blocked_at: new Date().toISOString() } },
          ).catch(() => {});
        }
        log("block-vendor: " + (p.name || p.domain || "?") + " blocked (" + n + " record(s))");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, blocked: n, name: p.name, domain: p.domain || null, emails, reason }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Re-card a vendor: set their FSC lanes to what they ACTUALLY carry (per their line
  // card), fixing over-broad NAICS-driven mismatches so they get the right RFQs and stop
  // the wrong ones. Also un-blocks (is_dns/is_portal cleared) — a mis-carded vendor isn't
  // dead, just wrongly tagged. Body: { name|email|domain, fscs:["4810",...], note }
  if (u === "/set-vendor-fsc" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const fscs = (p.fscs || []).map(String).map(s => s.trim()).filter(Boolean);
        if (!fscs.length) throw new Error("fscs[] required");
        const db = await getDb();
        let filter;
        if (p.email)       filter = { email: { $regex: "^" + String(p.email).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", $options: "i" } };
        else if (p.domain) filter = { email: { $regex: "@" + String(p.domain).replace(/\./g, "\\.") + "$", $options: "i" } };
        else if (p.name)   filter = { name: new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]?"), "i") };
        else throw new Error("name, email, or domain required");
        const set = { fsc: fscs, is_dns: false, is_portal: false, fsc_recarded_at: new Date().toISOString() };
        if (p.note) set.fsc_note = p.note;
        const r = await db.collection("distributors").updateMany(filter, { $set: set, $unset: { dns_reason: "", blocked_domain: "" } });
        log("set-vendor-fsc: " + (p.name || p.email || p.domain) + " → " + fscs.join(",") + " (" + r.modifiedCount + " rows)");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, matched: r.matchedCount, updated: r.modifiedCount, fscs }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // NAICS coverage — reads OUR DB (no SAM call), so it's accurate even when SAM is capped.
  if (u === "/naics-coverage" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const active = { email: { $nin: ["", null] }, is_dns: { $ne: true } };
      const total = await mdb.collection("distributors").countDocuments(active);
      const withNaics = await mdb.collection("distributors").countDocuments({ ...active, primary_naics: { $nin: ["", null] } });
      const pending = await mdb.collection("distributors").countDocuments({ ...active, naics_enriched_at: { $exists: false } });
      const sample = await mdb.collection("distributors").find({ ...active, primary_naics: { $nin: ["", null] } })
        .project({ name: 1, primary_naics: 1, naics: 1, cage: 1 }).limit(12).toArray();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, active_total: total, with_primary_naics: withNaics, still_pending: pending,
        sample: sample.map(s => ({ name: s.name, primary: s.primary_naics, all: s.naics, cage: s.cage })) }, null, 2));
    }).catch(e => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }

  // Batch NAICS enrichment — populate each vendor's PRIMARY NAICS (+ full list, CAGE)
  // from SAM.gov so we route by their real line of business. Resumable (skips already
  // enriched), rate-limited. Body: { limit:50, activeOnly:true }. Loop until done.
  if (u === "/enrich-naics" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const db = await getDb();
        // Reset false-notfounds (SAM daily-cap artifacts) so they retry after quota reset.
        if (p.reset) {
          const rr = await db.collection("distributors").updateMany(
            { naics_status: { $ne: "ok" } }, { $unset: { naics_enriched_at: "", naics_status: "" } });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, reset: rr.modifiedCount }));
          return;
        }
        const limit = Math.min(parseInt(p.limit, 10) || 50, 200);
        const key = process.env.SAM_API_KEY;
        if (!key) throw new Error("SAM_API_KEY not set");
        const filter = { naics_enriched_at: { $exists: false } };
        if (p.activeOnly !== false) { filter.email = { $nin: ["", null] }; filter.is_dns = { $ne: true }; }
        const vendors = await db.collection("distributors").find(filter)
          .project({ name: 1, email: 1, cage: 1, cage_code: 1 }).limit(limit).toArray();
        const norm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        let enriched = 0, notfound = 0, throttled = 0;
        for (const v of vendors) {
          const cage = v.cage || v.cage_code;
          const params = new URLSearchParams({ api_key: key, includeSections: "entityRegistration,assertions" });
          if (cage) params.set("cageCode", cage); else params.set("legalBusinessName", v.name || "");
          const set = { naics_enriched_at: new Date().toISOString() };
          let httpStatus = 0;
          try {
            const r = await fetch("https://api.sam.gov/entity-information/v3/entities?" + params.toString());
            httpStatus = r.status;
            // Non-200 = SAM throttle/daily cap. Do NOT mark done — leave for retry.
            if (httpStatus !== 200) { throttled++; if (throttled >= 3) break; await new Promise(rr => setTimeout(rr, 180)); continue; }
            const data = await r.json();
            const list = data.entityData || [];
            let ent = null;
            if (cage) ent = list[0];
            else ent = list.find(e => norm(e.entityRegistration?.legalBusinessName) === norm(v.name)) || (list.length === 1 ? list[0] : null);
            if (ent) {
              const gs = ent.assertions?.goodsAndServices || {};
              set.primary_naics = String(gs.primaryNaics || "");
              set.naics = (gs.naicsList || []).map(n => String(n.naicsCode));
              set.cage = ent.entityRegistration?.cageCode || cage || "";
              set.uei = ent.entityRegistration?.ueiSAM || "";
              if (set.primary_naics) enriched++; else notfound++;
              set.naics_status = set.primary_naics ? "ok" : "no-naics";
            } else { set.naics_status = list.length ? "ambiguous" : "notfound"; notfound++; }
          } catch (e) { set.naics_status = "error:" + e.message.slice(0, 40); notfound++; }
          await db.collection("distributors").updateOne({ _id: v._id }, { $set: set });
          await new Promise(r => setTimeout(r, 180)); // SAM rate limit
        }
        const remaining = await db.collection("distributors").countDocuments(filter);
        log("enrich-naics: +" + enriched + " enriched, " + notfound + " notfound, " + throttled + " throttled, " + remaining + " remaining");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, processed: vendors.length, enriched, notfound, throttled, remaining }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // NAICS probe — look up a vendor's PRIMARY NAICS from SAM.gov entity API, so we can
  // route by their real line of business instead of over-registered secondary NAICS.
  if (u === "/naics-probe" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const key = process.env.SAM_API_KEY;
        if (!key) throw new Error("SAM_API_KEY not set");
        const params = new URLSearchParams({ api_key: key, includeSections: "entityRegistration,assertions" });
        if (p.cage)      params.set("cageCode", p.cage);
        else if (p.uei)  params.set("ueiSAM", p.uei);
        else if (p.name) params.set("legalBusinessName", p.name);
        else throw new Error("cage, uei, or name required");
        const r = await fetch("https://api.sam.gov/entity-information/v3/entities?" + params.toString());
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = null; }
        if (!data) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, http: r.status, note: "non-JSON (key scope?)", body: text.slice(0, 300) })); return; }
        const ents = (data.entityData || []).slice(0, 3).map(e => {
          const gs = e.assertions?.goodsAndServices || {};
          const prim = gs.primaryNaics || "";
          return {
            name: e.entityRegistration?.legalBusinessName,
            cage: e.entityRegistration?.cageCode,
            uei: e.entityRegistration?.ueiSAM,
            primaryNaics: prim,
            allNaics: (gs.naicsList || []).map(n => n.naicsCode + (String(n.naicsCode) === String(prim) ? " (PRIMARY)" : "")),
          };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, http: r.status, totalRecords: data.totalRecords, entities: ents }, null, 2));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // P/N to-do queue — high-$ sols held from blast because they have no part number.
  // Each carries the DIBBS NSN lookup link so you (or enrichment) can grab the P/N.
  if (u === "/pn-queue" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const sols = await mdb.collection("solicitations").find({
        status: { $in: ["New", "Awaiting Quotes"] },
        $or: [{ ref_part_number: { $in: ["", null] } }, { ref_part_number: "N/A" }],
      }).project({ sol_number: 1, item_name: 1, nsn: 1, fsc: 1, quantity: 1, unit_of_issue: 1, ext_price: 1, quote_due: 1 }).toArray();
      const hi = sols.filter(s => s.ext_price == null || s.ext_price >= MIN_ORDER_VALUE);
      hi.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true, total_no_pn: sols.length, high_value_no_pn: hi.length, floor: MIN_ORDER_VALUE,
        queue: hi.slice(0, 100).map(s => ({
          sol: s.sol_number, item: s.item_name, nsn: s.nsn, qty: s.quantity, ui: s.unit_of_issue,
          ext: s.ext_price, due: s.quote_due,
          lookup: "https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx?value=" + String(s.nsn || "").replace(/\D/g, "") + "&category=sol&Scope=open",
        })),
      }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Purge out-of-scope sols — keep ONLY AN/MS/NAS (aerospace-standard P/N). Everything
  // else (general FSC, no-PN valves/hoses, 65xx) is noise that shouldn't be in the DB.
  // Dry-run by default (shows counts + sample); {confirm:true} deletes.
  if (u === "/purge-sols" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const db = await getDb();
        const AERO = /^(NASM[\d-]|NAS[\d-]|NSA[\d-]|AN[\d-]|MS[\d-]|MIL[\d-]|AS[\d-]|BAC[A-Z]?\d|DIN[\d-])/i;
        const all = await db.collection("solicitations").find({})
          .project({ sol_number: 1, ref_part_number: 1, item_name: 1, fsc: 1, is_repost: 1 }).toArray();
        // KEEP: AN/MS/NAS parts OR reposts (reposts are in-scope even when not AN/MS/NAS).
        const keepSol = s => AERO.test(String(s.ref_part_number || "").trim()) || s.is_repost === true;
        const purge = all.filter(s => !keepSol(s));
        const aeroKept = all.filter(s => AERO.test(String(s.ref_part_number || "").trim())).length;
        const repostKept = all.filter(s => s.is_repost === true).length;
        if (!p.confirm) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, dryRun: true, total_sols: all.length,
            would_keep: all.length - purge.length, keep_ANMSNAS: aeroKept, keep_reposts: repostKept,
            would_delete: purge.length,
            sample_to_delete: purge.slice(0, 10).map(s => ({ sol: s.sol_number, pn: s.ref_part_number || "(none)", item: s.item_name, fsc: s.fsc, repost: !!s.is_repost })) }, null, 2));
          return;
        }
        const r = await db.collection("solicitations").deleteMany({ _id: { $in: purge.map(s => s._id) } });
        log("purge-sols: deleted " + r.deletedCount + " out-of-scope sols, kept " + (all.length - r.deletedCount) + " AN/MS/NAS");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, deleted: r.deletedCount, kept_ANMSNAS: all.length - r.deletedCount }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Blast PREVIEW — dry run. Shows exactly what WOULD send (vendors, sols, a real
  // sample email) after the PN gate + lane gate, and sends NOTHING. Review before live.
  if (u === "/blast-preview" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const { buildBodyForSender } = require("./email");
      const dists = await getDistributors(mdb);
      const existing = await mdb.collection("solicitations").find({
        status: { $nin: ["Awaiting Quotes", "Bid Submitted", "Awarded", "Lost", "Outreach"] },
        verdict: { $in: ["GO", "VERIFY FIRST", null, ""] },
      }).toArray();
      const blastSols = existing.filter(s => {
        if (s.set_aside && SKIP_SET_ASIDES.has(s.set_aside)) return false;
        if (s.supplier_restrictions && SKIP_RESTRICTIONS.has(s.supplier_restrictions)) return false;
        return true;
      });
      const plan = buildBlastPlan(blastSols, dists); // PN gate applied inside
      const fscOn = process.env.FEDERAL_BLAST_ENABLED === "true";
      const aeroOn = process.env.AEROSPACE_BLAST_ENABLED === "true";
      const medOn = process.env.MEDICAL_BLAST_ENABLED === "true";
      const live = plan.filter(e => e.lane === "aerospace" ? aeroOn : e.lane === "medical" ? medOn : fscOn);
      const sols = new Set(); live.forEach(e => (e.sols || []).forEach(s => sols.add(s.sol_number)));
      const missingPN = [...sols].length ? live.flatMap(e => e.sols).filter(s => !s.ref_part_number).length : 0;
      const sample = live[0] ? buildBodyForSender(live[0].vendor, live[0].sols.slice(0, 10), "resend") : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true, would_send_to_vendors: live.length, unique_sols: sols.size,
        any_missing_PN: missingPN, lanes: { federal: fscOn, aerospace: aeroOn, medical: medOn },
        by_lane: ["fsc", "aerospace", "medical"].map(l => ({ lane: l, vendors: live.filter(e => e.lane === l).length })),
        sample_vendor: live[0] ? live[0].vendor.name : null,
        sample_email: sample,
      }, null, 2));
    }).catch(e => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }

  // Full exclusion list — every distributor pulled from the blast (is_dns / bounced),
  // with the reason. Shows who was killed and why, across the whole DB (not just aero).
  if (u === "/excluded" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const ex = await mdb.collection("distributors")
        .find({ $or: [{ is_dns: true }, { email_invalid: true }] })
        .project({ name: 1, email: 1, dns_reason: 1, email_invalid: 1, email_bounced_at: 1, is_manufacturer: 1, tags: 1 }).toArray();
      const rows = ex.map(d => ({
        name: d.name, email: d.email || "(none)",
        reason: d.dns_reason || (d.email_invalid ? "email bounced/invalid" : "dns"),
        aero: /aero/i.test(d.name || "") || (d.tags || []).some(t => /aero/i.test(t)) || !!d.is_manufacturer,
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: rows.length, aero_excluded: rows.filter(r => r.aero).length, excluded: rows }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Mark a vendor as PORTAL (orders go through their website, not email). Body:
  //   { "name":"CIA Medical", "url":"https://...", "email":"..." }
  // Sets is_portal:true so every blast lane skips it; it surfaces in /portal-queue
  // instead as a manual to-do list of matching sols to key into the site.
  if (u === "/mark-portal" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body || "{}");
        const db = await getDb();
        // Portal = reachable via website, NOT dead — so also clear is_dns.
        const set = { is_portal: true, is_dns: false, portal_marked_at: new Date().toISOString() };
        if (p.url) set.portal_url = p.url;
        let filter;
        if (p.email) filter = { email: String(p.email).toLowerCase() };
        else if (p.name) filter = { name: new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]?"), "i") };
        else throw new Error("name or email required");
        const r = await db.collection("distributors").updateMany(filter, { $set: set });
        log("mark-portal: " + (p.name || p.email) + " → " + r.modifiedCount + " marked portal");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, matched: r.matchedCount, marked: r.modifiedCount, url: p.url || null }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Convert vendors that were DNS'd for being website/portal-order into proper portal
  // vendors (is_portal:true, is_dns:false) so they surface in /portal-queue instead of
  // the dead pile. Matches the dns_reason for portal/website wording; derives a URL
  // from the email domain when none is set.
  if (u === "/convert-portal-excluded" && req.method === "POST") {
    getDb().then(async (mdb) => {
      const rx = /portal|website|web\s?site|order(ed|s)?\s+(online|via|thru|through)|\bonline\b|their\s+site/i;
      const cands = await mdb.collection("distributors")
        .find({ is_dns: true, dns_reason: { $regex: rx } }).project({ name: 1, email: 1, dns_reason: 1 }).toArray();
      const converted = [];
      for (const c of cands) {
        const dom = (c.email || "").split("@")[1];
        const set = { is_portal: true, is_dns: false, portal_marked_at: new Date().toISOString() };
        if (dom) set.portal_url = "https://www." + dom;
        await mdb.collection("distributors").updateOne({ _id: c._id }, { $set: set }).catch(() => {});
        converted.push({ name: c.name, email: c.email, was: c.dns_reason, url: set.portal_url || null });
      }
      log("convert-portal-excluded: " + converted.length + " moved to portal queue");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, converted: converted.length, vendors: converted }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Portal to-do list — for each portal vendor, the active sols it could quote, so you
  // can key them into that vendor's website (they don't take email RFQs).
  if (u === "/portal-queue" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const portals = await mdb.collection("distributors").find({ is_portal: true })
        .project({ name: 1, email: 1, portal_url: 1, fsc: 1, tags: 1, is_manufacturer: 1 }).toArray();
      const sols = await mdb.collection("solicitations")
        .find({ status: { $in: ["New", "Awaiting Quotes"] } })
        .project({ sol_number: 1, item_name: 1, nsn: 1, fsc: 1, ref_part_number: 1, quantity: 1, unit_of_issue: 1, quote_due: 1 }).toArray();
      const solFsc = s => String(s.fsc || (s.nsn || "").slice(0, 4));
      const queue = portals.map(pv => {
        const matched = sols.filter(s => {
          const f = solFsc(s);
          if (isMedicalVendor(pv) && isMedicalFSC(f)) return true;
          if ((pv.is_manufacturer || isAerospaceVendor(pv)) && isAerospacePN(s.ref_part_number)) return true;
          if ((pv.fsc || []).map(String).includes(f)) return true;
          return false;
        });
        return {
          vendor: pv.name, portal_url: pv.portal_url || "", matched: matched.length,
          sols: matched.map(s => ({ sol: s.sol_number, item: s.item_name, pn: s.ref_part_number, qty: s.quantity, ui: s.unit_of_issue, nsn: s.nsn, due: s.quote_due })),
        };
      }).filter(q => q.matched > 0);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, portal_vendors: portals.length, with_matches: queue.length, queue }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Medical roster assessment — how many medical distributors we have and whether
  // they're deliverable. Gates whether a medical blast lane has anyone to email.
  if (u === "/medical-roster" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const all = await mdb.collection("distributors")
        .find({}).project({ name: 1, email: 1, fsc: 1, tags: 1, is_dns: 1, email_invalid: 1 }).toArray();
      // Real medical distributors are NAME/TAG matched. "Has a 65xx FSC lane" is NOT
      // reliable — the old mass-blast blanket-assigned all medical lanes to the whole
      // federal pool (fasteners, electronics, industrial), so FSC alone over-counts.
      const MED = /\b(medical|health\s?care|healthcare|pharma|pharmac|surgical|surgic|dental|biomed|medtech|meditech|hospital|clinic|med[\s-]?supply|medsupply|wellness|therapeutic|diagnostic|nursing|scientific|meditek|healthcare)\b/i;
      const medFsc = f => /^65\d\d$/.test(String(f || ""));
      const nameMatch = d => MED.test(d.name || "") || (d.tags || []).some(t => /med|health|pharma|dental|surg|scientific/i.test(t));
      const PERSONAL = /gmail\.com|yahoo\.com|aol\.com|hotmail\.com|outlook\.com|icloud\.com/i;
      const named   = all.filter(nameMatch);
      const fscOnly = all.filter(d => !nameMatch(d) && (d.fsc || []).some(medFsc));
      const namedLive = named.filter(d => d.email && !d.is_dns && !d.email_invalid);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        name_or_tag_matched: named.length,          // real medical distributors
        name_matched_live_email: namedLive.length,
        name_matched_corporate: namedLive.filter(d => !PERSONAL.test(d.email || "")).length,
        fsc_lane_only_noise: fscOnly.length,        // blanket-assigned, NOT actually medical
        named_live_list: namedLive.map(d => ({ name: d.name, email: d.email })).slice(0, 80),
      }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Aero roster health — who the aerospace lane actually emails, and whether those
  // addresses are deliverable. Helps explain low response (bounces / personal inboxes).
  if (u === "/aero-roster" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const all = await mdb.collection("distributors")
        .find({}).project({ name: 1, email: 1, is_manufacturer: 1, tags: 1, is_dns: 1, email_invalid: 1, dns_reason: 1, has_jcp: 1 }).toArray();
      const isAero = d => /aero/i.test(d.name || "") || (d.tags || []).some(t => /aero/i.test(t));
      const roster = all.filter(d => d.is_manufacturer || isAero(d));
      const withEmail = roster.filter(d => d.email);
      const live = withEmail.filter(d => !d.is_dns && !d.email_invalid);
      const bounced = withEmail.filter(d => d.is_dns || d.email_invalid);
      const PERSONAL = /gmail\.com|yahoo\.com|aol\.com|hotmail\.com|outlook\.com|icloud\.com/i;
      const personal = live.filter(d => PERSONAL.test(d.email || ""));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        total_roster: roster.length,
        no_email: roster.length - withEmail.length,
        live_email: live.length,
        bounced_or_dns: bounced.length,
        personal_domain: personal.length,
        corporate_domain: live.length - personal.length,
        bounced_list: bounced.map(d => ({ name: d.name, email: d.email, reason: d.dns_reason || "dns/invalid" })),
        personal_list: personal.map(d => ({ name: d.name, email: d.email })),
      }, null, 2));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // Ingest a hand-curated sol list into the solicitations collection so the blast
  // engine (and its dedup) can send it. Body: { "sols": [ {sol_number, ref_part_number,
  // nsn, item_name, quantity, ...}, ... ] }. Upserts each as status:New verdict:GO.
  // Use for lists built outside the scrape (e.g. the browser ISO tool), then POST
  // /blast-existing to send them — blast_log dedup skips anything already emailed.
  if (u === "/ingest-sols" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      let sols = [];
      try { sols = (JSON.parse(body).sols) || []; } catch {}
      if (!Array.isArray(sols) || !sols.length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "body must be { sols: [...] } with at least one sol" }));
        return;
      }
      getDb().then(async (mdb) => {
        let n = 0;
        for (const s of sols) {
          if (!s.sol_number) continue;
          const nsn = s.nsn || "";
          await saveSol(mdb, {
            sol_number:      s.sol_number,
            nsn:             nsn,
            fsc:             s.fsc || nsn.slice(0, 4),
            item_name:       s.item_name || "",
            ref_part_number: s.ref_part_number || "",
            quantity:        String(s.quantity || ""),
            unit_of_issue:   s.unit_of_issue || "",
            unit_price:      s.unit_price != null ? s.unit_price : null,
            ext_price:       s.ext_price != null ? s.ext_price : (s.ext != null ? s.ext : null),
            quote_due:       s.quote_due || "",
            delivery_days:   String(s.delivery_days || ""),
            is_repost:       !!s.is_repost,
            status:          "New",
            verdict:         "GO",
            win_probability: 100,
            source:          "manual-ingest",
            date_added:      new Date().toLocaleDateString(),
          }).then(() => n++).catch(() => {});
        }
        log("ingest-sols: " + n + "/" + sols.length + " upserted");
      }).catch(e => err("ingest-sols:", e.message));
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "ingesting " + sols.length + " sol(s)" }));
    });
    return;
  }

  if (u === "/daily-brief" && req.method === "GET") {
    getDb().then(async (mdb) => {
      const brief = await mdb.collection("blast_briefs").findOne({}, { sort: { created_at: -1 } });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, brief: brief || null }));
    }).catch(e => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // ── /navigator/scrape — scrape-only, no screen/blast, SSE streaming ────
  if (u === "/navigator/scrape" && req.method === "POST") {
    if (pipelineRunning) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Pipeline already running" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");
    const sseLog = (msg, level) => { send({ type: "log", msg, level: level || "info" }); log(msg); };

    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", async () => {
      let maxSols = 0;
      try { const p = JSON.parse(body); maxSols = parseInt(p.maxSols) || 0; } catch {}

      pipelineRunning = true;
      try {
        const { scrape } = require("./scraper");
        sseLog("Navigator scrape starting (Pass 1: Today · Pass 2: Last 30 · Pass 3: AN/MS/NAS)…");
        const result = await scrape({
          username: process.env.NAVIGATOR_USERNAME,
          password: process.env.NAVIGATOR_PASSWORD,
          minPrice: 1000,
        });

        if (!result.ok) {
          send({ type: "result", ok: false, error: result.error || "Scrape failed" });
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const counts = result.counts;
        sseLog("✅ P1:" + counts.pass1 + " P2:" + counts.pass2 + " P3:" + counts.pass3 + " → " + counts.total + " total", "ok");

        let sols = result.sols;
        if (maxSols > 0 && sols.length > maxSols) {
          sseLog("Capped to " + maxSols + " sols (maxSols param)");
          sols = sols.slice(0, maxSols);
        }

        // Apply DNS FSC filter so screener gets clean data
        const dnsSols = sols.filter(s => {
          const fsc = String(s.fsc || (s.nsn || "").slice(0, 4));
          return !SKIP_FSCS.has(fsc);
        });
        if (dnsSols.length < sols.length) sseLog("Dropped " + (sols.length - dnsSols.length) + " DNS-FSC sols");

        send({ type: "result", ok: true, sols: dnsSols, counts });
        res.write("data: [DONE]\n\n");
      } catch (e) {
        err("Navigator scrape endpoint error:", e.message);
        send({ type: "result", ok: false, error: e.message });
        res.write("data: [DONE]\n\n");
      } finally {
        pipelineRunning = false;
        lastRunAt = Date.now();
        res.end();
      }
    });
    return;
  }

  if (u === "/trigger" && req.method === "POST") {
    if (pipelineRunning) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Pipeline already running" }));
      return;
    }
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      let overrideLive = IS_LIVE;
      let maxVendors   = 0;
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.live === "boolean") {
          overrideLive = parsed.live;
          log("UI live override: " + (overrideLive ? "LIVE" : "TEST ONLY") + " (env BLAST_LIVE=" + IS_LIVE + ")");
        }
        // limit: cap vendor emails this run. A TEST run without a cap still
        // sends one email per matched vendor (~2,400) to TEST_RECIPIENT.
        const lim = parseInt(parsed.limit ?? parsed.maxVendors, 10);
        if (Number.isFinite(lim) && lim > 0) maxVendors = lim;
      } catch {}
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Pipeline triggered", live: overrideLive, maxVendors: maxVendors || null }));
      log("Manual trigger via HTTP /trigger (" + (overrideLive ? "LIVE" : "TEST") + (maxVendors ? ", limit " + maxVendors : "") + ")");
      runPipelineTracked(overrideLive, maxVendors).catch(e => err("Triggered pipeline error:", e.message));
    });
    return;
  }

  // ── ESBD scrape trigger (manual "Run ESBD Sync Now") ──────────────────────
  // Admin-only: requires x-esbd-secret == ESBD_SYNC_SECRET. Fails closed if the
  // secret isn't configured, so the public can never trigger Chromium jobs.
  if (u === "/esbd-sync" && req.method === "POST") {
    const secret = process.env.ESBD_SYNC_SECRET;
    if (!secret) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "ESBD sync disabled — set ESBD_SYNC_SECRET in Railway env" }));
      return;
    }
    const qsecret = new URLSearchParams(req.url.split("?")[1] || "").get("secret") || "";
    const provided = req.headers["x-esbd-secret"] || qsecret || "";
    if (provided !== secret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
    if (esbdRunning) {  // job lock — no overlapping runs
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "ESBD sync already running" }));
      return;
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "ESBD sync triggered" }));
    log("Manual ESBD sync via HTTP /esbd-sync (authorized)");
    esbdRunning = true;
    runEsbdSync().catch(e => err("ESBD sync error:", e.message)).finally(() => { esbdRunning = false; });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

httpServer.listen(PORT, () => {
  log("HTTP server listening on port " + PORT + " — /health and /trigger available");
});

// Wrap runPipeline to track state
const _runPipeline = runPipeline;
async function runPipelineTracked(liveModeOverride, maxVendors = 0) {
  pipelineRunning = true;
  try {
    await _runPipeline(liveModeOverride, maxVendors);
    lastRunOk = true;
  } catch (e) {
    lastRunOk = false;
    err("Pipeline error:", e.message);
  } finally {
    lastRunAt = Date.now();
    pipelineRunning = false;
  }
}

// ── CRON SCHEDULE ────────────────────────────────────────────────────────
const runNow = process.argv.includes("--run-now");
const esbdNow = process.argv.includes("--esbd-now");

if (esbdNow) {
  log("--esbd-now flag detected — running ESBD sync only");
  runEsbdSync().then(r => { log("ESBD sync result:", JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }).catch(e => { err("Fatal ESBD:", e.message); process.exit(1); });
} else if (runNow) {
  log("--run-now flag detected — firing immediately");
  runPipelineTracked().catch(e => { err("Fatal:", e.message); process.exit(1); });
} else {
  log("SCC Agent online. Cron: \"" + SCHEDULE + "\" (" + (IS_LIVE ? "LIVE" : "TEST") + " mode)");
  log("Set BLAST_LIVE=true in Railway env vars to enable real vendor emails.");

  // STOPPED 2026-07-16. The daily scrape+blast cron is not registered at all — the
  // pipeline only runs on an explicit POST /trigger. Set DAILY_CRON_ENABLED=true to resume.
  if (DAILY_CRON_ENABLED) {
    cron.schedule(SCHEDULE, () => {
      log("Cron fired — starting pipeline…");
      runPipelineTracked().catch(e => err("Pipeline error:", e.message));
    }, { timezone: "America/Chicago" });
  } else {
    log("Daily pipeline cron NOT registered — stopped (set DAILY_CRON_ENABLED=true to resume)");
  }

  // ESBD scrape — unattended daily pull → scc-esbd ingest
  cron.schedule(ESBD_CRON, () => {
    if (esbdRunning) { log("ESBD cron skipped — already running"); return; }
    log("ESBD cron fired — starting ESBD sync…");
    esbdRunning = true;
    runEsbdSync().catch(e => err("ESBD sync error:", e.message)).finally(() => { esbdRunning = false; });
  }, { timezone: "America/Chicago" });
  log("ESBD sync cron: \"" + ESBD_CRON + "\" (America/Chicago)");

  // Health check — STOPPED 2026-07-16. Was every 6 hours, emailing on any red
  // component. Not registered; GET /health-check still runs it on demand without
  // emailing. Set HEALTH_CHECK_ENABLED=true to resume the scheduled alerts.
  if (HEALTH_CHECK_ENABLED) {
    cron.schedule("0 6,12,18,0 * * *", () => {
      log("Health check cron firing…");
      getDb().then(db => runHealthCheck(db, { emailOnFailure: true })).catch(e => err("Health check failed:", e.message));
    }, { timezone: "America/Chicago" });
  } else {
    log("Health check cron NOT registered — stopped (set HEALTH_CHECK_ENABLED=true to resume)");
  }

  // FSC Updater — was 5 PM Central daily. Read the "Change FSC to meet Customer" label
  // and applied lane removals to vendor cards (remove-only), then emailed a summary.
  // STOPPED 2026-07-16 — not registered at all. Manual POSTs to the Netlify function
  // (preview/apply) still work; this only stops the unattended scheduled apply.
  if (FSC_UPDATER_ENABLED) {
    cron.schedule("0 17 * * *", () => {
      log("FSC Updater cron firing (5 PM CT)…");
      fetch("https://thehouseofkel.com/.netlify/functions/scc-fsc-updater", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      })
        .then(r => r.json())
        .then(d => log("FSC Updater: " + (d.ok ? ((d.result.changes || []).length + " applied, " + (d.result.skipped || []).length + " skipped") : ("error: " + d.error))))
        .catch(e => err("FSC Updater cron failed:", e.message));
    }, { timezone: "America/Chicago" });
  } else {
    log("FSC Updater cron NOT registered — stopped");
  }

  // Keep process alive
  process.on("SIGTERM", () => { log("SIGTERM — shutting down"); process.exit(0); });
  process.on("SIGINT",  () => { log("SIGINT — shutting down");  process.exit(0); });
}
