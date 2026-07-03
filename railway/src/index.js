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
const { buildBlastPlan, runBlast } = require("./blaster");
const { checkWatchList, updateWatchHits } = require("./nsn-watch");
const { sendSummary }      = require("./notify");
const { getDb, getDistributors, getNsnWatchList, getAlreadyActedSols, saveSol, upsertNsnWatch, saveDailyBrief } = require("./db");
const { runHealthCheck } = require("./health-check");

// SOL_SOURCE=navigator (default, uses DIBBS Navigator scraper)
// SOL_SOURCE=email (switches to DLA Gmail after Navigator sub ends)
const SOL_SOURCE = process.env.SOL_SOURCE || "navigator";

const SCHEDULE  = process.env.CRON_SCHEDULE || "0 8,12,16,20 * * 1-5"; // 8 AM / noon / 4 PM / 8 PM CT Mon–Fri
const IS_LIVE   = process.env.BLAST_LIVE === "true"; // must be explicitly enabled
// Comma-separated FSC codes to skip entirely (over hist price, too competitive, etc.)
// Default: aerospace fasteners — AN/MS/NAS parts consistently beat hist price
const SKIP_FSCS = new Set(
  (process.env.SKIP_FSCS || "5305,5306,5307,5310,5315,5320,5325,5330").split(",").map(s => s.trim()).filter(Boolean)
);
// Minimum estimated order value — sols below this are skipped (0 = disabled).
// ext_price = hist_price × qty from PDF. If no price data, sol passes through.
const MIN_ORDER_VALUE = parseInt(process.env.MIN_ORDER_VALUE || "10000", 10) || 0;

// Fix #6: hoisted to module scope so runPipeline and blast-existing stay in sync
const SKIP_SET_ASIDES   = new Set(["HUBZone", "8(a)", "WOSB", "EDWOSB"]);
const SKIP_RESTRICTIONS = new Set(["Sole Source", "Source Control"]);

function log(...a)  { console.log("[scc-agent]", new Date().toISOString().slice(11, 19), ...a); }
function err(...a)  { console.error("[scc-agent] ❌", ...a); }

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────
async function runPipeline(liveModeOverride) {
  const effectiveLive = typeof liveModeOverride === "boolean" ? liveModeOverride : IS_LIVE;
  const runDate  = new Date().toISOString();
  const errors   = [];

  log("═".repeat(60));
  log("Daily pipeline starting — " + (effectiveLive ? "LIVE BLAST" : "TEST MODE (emails to anthony@ifedlog.com)"));
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

  // ── 3. Skip already-acted + DNS FSCs ─────────────────────────────────
  const alreadyActed = await getAlreadyActedSols(db);
  const dnsFscFiltered = rawSols.filter(s => {
    const fsc = String(s.fsc || (s.nsn || "").slice(0, 4));
    if (!SKIP_FSCS.has(fsc)) return true;
    // AN/MS/NAS parts are in fastener FSCs but route to approved-manufacturer vendors — keep them
    const pn = (s.ref_part_number || "").trim().toUpperCase();
    return /^(AN|MS|NAS)[\d-]/.test(pn);
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

  // Drop sub-minimum orders. AN/MS/NAS MIL-spec parts use a lower floor ($1k) —
  // they come in at small ext prices but route to approved MFRs via blaster.
  // If ext_price is null, let through — can't filter what we don't know.
  const AN_MS_NAS_PFX = /^(AN|MS|NAS)[\d-]/i;
  const AN_MS_NAS_MIN = 1000;
  const valuedSols = MIN_ORDER_VALUE > 0 ? freshSols.filter(s => {
    if (s.ext_price == null) return true;
    if (AN_MS_NAS_PFX.test(s.ref_part_number || "")) return s.ext_price >= AN_MS_NAS_MIN;
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
        unit_price:            sol.unit_price || sol.hist_price || null,
        hist_price:            sol.hist_price || null,
        ext_price:             sol.ext_price || (sol.unit_price || sol.hist_price ? (sol.unit_price || sol.hist_price) * parseFloat(sol.qty || sol.quantity || 1) : null) || null,
        quote_due:             sol.quote_due || "",
        delivery_days:         String(sol.delivery_days || ""),
        set_aside:             sol.set_aside || "",
        fob:                   sol.fob || "",
        supplier_restrictions: sol.supplier_restrictions || "",
        supplier_list:         sol.supplier_list || "",
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
  const blastSols = allScreened.filter(s => s.verdict !== "REJECT" && s.winProbabilityPct >= 50);
  log("Blast-eligible (pre-gate): " + blastSols.length + " sols");

  // Quality gate: block any sol missing the minimum data vendors need to quote.
  // Hard blocks: item_name (they must know WHAT to price) + quote_due (they must know the deadline).
  // Quantity is NOT a hard block — SAM API never provides it and ~60% of sols have no PDF attachment.
  // Missing quantity shows as "Per RFQ" in the vendor email body, which is professional and actionable.
  const heldSols  = [];
  const readySols = blastSols.filter(s => {
    const missing = [];
    if (!s.quote_due) missing.push("quote_due");
    if (!s.item_name) missing.push("item_name");
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
      blastResult = await runBlast(plan, { isLive: effectiveLive, fromAddress: "kelley.anthonyk@gmail.com" }, db);
      log("Blast complete: " + blastResult.sent + " sent, " + blastResult.failed + " failed");

      // Only mark sols whose emails were actually confirmed sent
      const sentSolNums = new Set(
        blastResult.log.filter(e => e.status === "sent").flatMap(e => e.sol_numbers || [])
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
// Refresh every 30 seconds
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
          const result = await runBlast(plan, { isLive: IS_LIVE, fromAddress: "kelley.anthonyk@gmail.com" }, db);
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
      schedule: SCHEDULE,
      blast_live: effectiveLive,
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
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.live === "boolean") {
          overrideLive = parsed.live;
          log("UI live override: " + (overrideLive ? "LIVE" : "TEST ONLY") + " (env BLAST_LIVE=" + IS_LIVE + ")");
        }
      } catch {}
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Pipeline triggered", live: overrideLive }));
      log("Manual trigger via HTTP /trigger (" + (overrideLive ? "LIVE" : "TEST") + ")");
      runPipelineTracked(overrideLive).catch(e => err("Triggered pipeline error:", e.message));
    });
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
async function runPipelineTracked(liveModeOverride) {
  pipelineRunning = true;
  try {
    await _runPipeline(liveModeOverride);
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

if (runNow) {
  log("--run-now flag detected — firing immediately");
  runPipelineTracked().catch(e => { err("Fatal:", e.message); process.exit(1); });
} else {
  log("SCC Agent online. Cron: \"" + SCHEDULE + "\" (" + (IS_LIVE ? "LIVE" : "TEST") + " mode)");
  log("Set BLAST_LIVE=true in Railway env vars to enable real vendor emails.");

  cron.schedule(SCHEDULE, () => {
    log("Cron fired — starting pipeline…");
    runPipelineTracked().catch(e => err("Pipeline error:", e.message));
  }, { timezone: "America/Chicago" });

  // Health check every 6 hours — emails anthony@ifedlog.com if anything is red
  cron.schedule("0 6,12,18,0 * * *", () => {
    log("Health check cron firing…");
    getDb().then(db => runHealthCheck(db, { emailOnFailure: true })).catch(e => err("Health check failed:", e.message));
  }, { timezone: "America/Chicago" });

  // Keep process alive
  process.on("SIGTERM", () => { log("SIGTERM — shutting down"); process.exit(0); });
  process.on("SIGINT",  () => { log("SIGINT — shutting down");  process.exit(0); });
}
