// src/index.js — Imperio SCC Autonomous Agent
// Runs on Railway 24/7. Cron fires daily, scrapes DIBBS Navigator,
// screens with Claude, checks NSN watchlist, blasts vendors, emails summary.
//
// Pass --run-now as CLI arg to fire immediately (for testing / manual trigger).

const cron = require("node-cron");
const { fetchDibbsSols }   = require("./gmail-watcher");
const { fetchAllSolDetails } = require("./dibbs-fetcher");
const { fetchSamSols }     = require("./sam-fetcher");
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

  // ── 2. Get solicitations ──────────────────────────────────────────────
  let rawSols = [];
  let scrapeResult = { counts: { total: 0, pass1: 0, pass2: 0, pass3: 0 } };

  if (SOL_SOURCE === "sam") {
    // SAM.gov Opportunities API → DLA RFQ sol list → DIBBS PDF parse
    log("Fetching DLA solicitations from SAM.gov API…");
    const fscLanes = (process.env.NAVIGATOR_FSC_LANES || process.env.SAM_FSC_LANES || "").split(",").map(s => s.trim()).filter(Boolean);
    let samSols = [];
    try {
      samSols = await fetchSamSols({ lookbackDays: 3, fscLanes });
    } catch (e) {
      err("SAM fetch failed:", e.message);
      errors.push("SAM: " + e.message);
    }
    if (!samSols.length) {
      log("No DLA solicitations from SAM — sending summary");
      await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: 0, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "No SAM results", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
      await sendSummary({ scrape: scrapeResult, screen: [], blast: { sent: 0, failed: 0 }, watchHits: [], errors, runDate });
      return;
    }
    log("SAM returned " + samSols.length + " sols — fetching DIBBS PDFs…");
    rawSols = await fetchAllSolDetails(samSols);
    log("PDF fetch complete — " + rawSols.filter(s => s.pdf_parsed).length + "/" + rawSols.length + " parsed");
    scrapeResult = { counts: { total: rawSols.length, pass1: samSols.length, pass2: 0, pass3: 0 } };

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
    scrapeResult = { counts: { total: rawSols.length, pass1: emailSols.length, pass2: 0, pass3: 0 } };

  } else {
    // Navigator scraper (active until Navigator sub ends)
    log("Scraping DIBBS Navigator…");
    const { scrape } = require("./scraper");
    const fscLanes = (process.env.NAVIGATOR_FSC_LANES || "").split(",").map(s => s.trim()).filter(Boolean);
    const result = await scrape({
      username:  process.env.NAVIGATOR_USERNAME,
      password:  process.env.NAVIGATOR_PASSWORD,
      fscLanes,
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
  const SKIP_SET_ASIDES    = new Set(["HUBZone", "8(a)", "WOSB", "EDWOSB"]);
  const SKIP_RESTRICTIONS  = new Set(["Sole Source", "Source Control"]);
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

  if (!freshSols.length) {
    log("No new sols — sending summary");
    await saveDailyBrief(db, { run_date: new Date().toLocaleDateString("en-US"), total_sols: rawSols.length, fresh_sols: 0, go_count: 0, verify_count: 0, reject_count: 0, watch_hits: 0, blast_sent: 0, blast_failed: 0, error_count: errors.length, notes: "All sols already acted on", sols: [], blast_log: [] }).catch(e => err("saveDailyBrief:", e.message));
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
  log("Blast-eligible: " + blastSols.length + " sols");

  let blastResult = { sent: 0, failed: 0, log: [] };

  if (blastSols.length) {
    const dists = await getDistributors(db);
    log("Distributor DB: " + dists.length + " vendors");

    const plan = buildBlastPlan(blastSols, dists);

    if (plan.length) {
      log("Firing blast: " + plan.length + " vendor emails (" + (IS_LIVE ? "LIVE" : "TEST") + ")…");
      blastResult = await runBlast(plan, { isLive: IS_LIVE, fromAddress: "kelley.anthonyk@gmail.com" }, db);
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

  // ── 9. Save daily brief to MongoDB ───────────────────────────────────
  await saveDailyBrief(db, {
    run_date:     new Date().toLocaleDateString("en-US"),
    total_sols:   rawSols.length,
    fresh_sols:   freshSols.length,
    go_count:     allScreened.filter(s => s.verdict === "GO").length,
    verify_count: allScreened.filter(s => s.verdict === "VERIFY FIRST").length,
    reject_count: allScreened.filter(s => s.verdict === "REJECT").length,
    watch_hits:   watchHits.length,
    blast_sent:   blastResult.sent,
    blast_failed: blastResult.failed,
    error_count:  errors.length,
    sols: allScreened.map(s => ({
      sol_number:      s.sol_number,
      item_name:       s.item_name || "",
      fsc:             s.fsc || "",
      nsn:             s.nsn || "",
      verdict:         s.verdict || "GO",
      win_pct:         s.winProbabilityPct || 0,
      quote_due:       s.quote_due || "",
      quantity:        String(s.quantity || s.qty || ""),
      ref_part_number: s.ref_part_number || "",
      is_watched:      !!s.is_watched,
      reason:          s.reason || s.claudeReason || "",
    })),
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
        const SKIP_SET_ASIDES   = new Set(["HUBZone", "8(a)", "WOSB", "EDWOSB"]);
        const SKIP_RESTRICTIONS = new Set(["Sole Source", "Source Control"]);
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
          for (const entry of plan) {
            for (const sol of entry.sols) {
              await saveSol(db, { sol_number: sol.sol_number, status: "Awaiting Quotes" }).catch(() => {});
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

  if (u === "/trigger" && req.method === "POST") {
    if (pipelineRunning) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Pipeline already running" }));
      return;
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Pipeline triggered" }));
    log("Manual trigger via HTTP /trigger");
    runPipelineTracked().catch(e => err("Triggered pipeline error:", e.message));
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
async function runPipelineTracked() {
  pipelineRunning = true;
  try {
    await _runPipeline();
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
