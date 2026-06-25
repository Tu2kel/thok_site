// src/index.js — Imperio SCC Autonomous Agent
// Runs on Railway 24/7. Cron fires daily, scrapes DIBBS Navigator,
// screens with Claude, checks NSN watchlist, blasts vendors, emails summary.
//
// Pass --run-now as CLI arg to fire immediately (for testing / manual trigger).

const cron = require("node-cron");
const { scrape }           = require("./scraper");
const { screenBatch }      = require("./screener");
const { buildBlastPlan, runBlast } = require("./blaster");
const { checkWatchList, updateWatchHits } = require("./nsn-watch");
const { sendSummary }      = require("./notify");
const { getDb, getDistributors, getNsnWatchList, getAlreadyActedSols, saveSol, upsertNsnWatch } = require("./db");

const SCHEDULE  = process.env.CRON_SCHEDULE || "0 12 * * 1-5"; // 6 AM CT Mon–Fri
const IS_LIVE   = process.env.BLAST_LIVE === "true"; // must be explicitly enabled

function log(...a)  { console.log("[scc-agent]", new Date().toISOString().slice(11, 19), ...a); }
function err(...a)  { console.error("[scc-agent] ❌", ...a); }

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────
async function runPipeline() {
  const runDate  = new Date().toISOString();
  const errors   = [];

  log("═".repeat(60));
  log("Daily pipeline starting — " + (IS_LIVE ? "LIVE BLAST" : "TEST MODE (emails to anthony@ifedlog.com)"));
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

  // ── 2. Scrape ─────────────────────────────────────────────────────────
  const username  = process.env.NAVIGATOR_USERNAME;
  const password  = process.env.NAVIGATOR_PASSWORD;
  const fscLanes  = (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320,5340,4730,4940,2540,5360,5306").split(",").map(f => f.trim());
  const minPrice  = parseFloat(process.env.NAVIGATOR_MIN_EXT_PRICE || "1000");

  log("Scraping DIBBS Navigator…");
  const scrapeResult = await scrape({ username, password, fscLanes, minPrice });

  if (!scrapeResult.ok || !scrapeResult.sols.length) {
    err("Scrape failed or no sols:", scrapeResult.error || "0 results");
    errors.push("Scrape: " + (scrapeResult.error || "0 sols returned"));
    try {
      await sendSummary({
        scrape:    { counts: { total: 0, pass1: 0, pass2: 0, pass3: 0 } },
        screen:    [],
        blast:     { sent: 0, failed: 0 },
        watchHits: [],
        errors,
        runDate,
      });
    } catch {}
    return;
  }

  const rawSols = scrapeResult.sols;
  log("Scraped " + rawSols.length + " sols");

  // ── 3. Skip already-acted sols ────────────────────────────────────────
  const alreadyActed = await getAlreadyActedSols(db);
  const freshSols    = rawSols.filter(s => !alreadyActed.has(s.sol_number));
  const skipped      = rawSols.length - freshSols.length;
  if (skipped) log("Skipped " + skipped + " already-acted sols");

  if (!freshSols.length) {
    log("No new sols — sending summary");
    await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, errors, runDate });
    return;
  }

  // ── 4. NSN Watch check ────────────────────────────────────────────────
  log("Checking NSN watch list…");
  const watchList = await getNsnWatchList(db);
  log("Watch list: " + watchList.length + " NSNs");
  const { watchHits, unwatched } = checkWatchList(freshSols, watchList);

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
        quantity:              String(sol.qty || sol.quantity || ""),
        unit_price:            String(sol.hist_price || sol.unit_price || ""),
        ext_price:             String(sol.ext_price || ""),
        quote_due:             sol.quote_due || "",
        delivery_days:         String(sol.delivery_days || ""),
        set_aside:             sol.set_aside || "",
        fob:                   sol.fob || "",
        supplier_restrictions: sol.supplier_restrictions || "",
        supplier_list:         sol.supplier_list || "",
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
  log("Blast-eligible: " + blastSols.length + " sols");

  let blastResult = { sent: 0, failed: 0, log: [] };

  if (blastSols.length) {
    const dists = await getDistributors(db);
    log("Distributor DB: " + dists.length + " vendors");

    const plan = buildBlastPlan(blastSols, dists);

    if (plan.length) {
      log("Firing blast: " + plan.length + " vendor emails (" + (IS_LIVE ? "LIVE" : "TEST") + ")…");
      blastResult = await runBlast(plan, { isLive: IS_LIVE, fromAddress: "anthony@ifedlog.com" });
      log("Blast complete: " + blastResult.sent + " sent, " + blastResult.failed + " failed");

      // Update sol statuses in MongoDB
      for (const entry of plan) {
        for (const sol of entry.sols) {
          await saveSol(db, { sol_number: sol.sol_number, status: "Awaiting Quotes" }).catch(() => {});
        }
      }
    } else {
      log("No vendors matched — check distributor DB FSC assignments");
    }
  }

  // ── 8. Update NSN watch records with latest pricing ───────────────────
  if (watchHits.length) {
    await updateWatchHits(db, watchHits).catch(e => err("updateWatchHits:", e.message));

    // Also register any new NSNs from GO sols into the watch list
    const newWatches = blastSols
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
    });
  } catch (e) {
    err("Summary email failed:", e.message);
  }

  log("Pipeline complete ✅");
  log("═".repeat(60));
}

// ── CRON SCHEDULE ────────────────────────────────────────────────────────
const runNow = process.argv.includes("--run-now");

if (runNow) {
  log("--run-now flag detected — firing immediately");
  runPipeline().catch(e => { err("Fatal:", e.message); process.exit(1); });
} else {
  log("SCC Agent online. Cron: \"" + SCHEDULE + "\" (" + (IS_LIVE ? "LIVE" : "TEST") + " mode)");
  log("Set BLAST_LIVE=true in Railway env vars to enable real vendor emails.");

  cron.schedule(SCHEDULE, () => {
    log("Cron fired — starting pipeline…");
    runPipeline().catch(e => err("Pipeline error:", e.message));
  });

  // Keep process alive
  process.on("SIGTERM", () => { log("SIGTERM — shutting down"); process.exit(0); });
  process.on("SIGINT",  () => { log("SIGINT — shutting down");  process.exit(0); });
}
