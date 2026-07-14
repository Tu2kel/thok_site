// netlify/functions/navigator-ingest.js
// Imperio SCC — Server-side DIBBS Navigator scraper + full pipeline
// Computer off, browser closed — doesn't matter. Runs on Netlify + Browserless.io.
//
// Env vars required (Netlify → Site → Environment Variables):
//   BROWSERLESS_API_KEY     — already set if browserless-scrape is working
//   NAVIGATOR_USERNAME      — your dibbsnavigator.com login
//   NAVIGATOR_PASSWORD      — your dibbsnavigator.com password
//   NAVIGATOR_FSC_LANES     — comma-separated FSCs to scrape (keep to ≤10 for speed)
//   NAVIGATOR_MIN_EXT_PRICE — min extended price filter (default: 1000)
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   ANTHROPIC_API_KEY
//   MONGODB_URI
//   URL  — auto-set by Netlify

const { MongoClient } = require("mongodb");

const FROM_ADDRESS   = "anthony@ifedlog.com";
const FROM_NAME      = "Anthony K Kelley | Imperio Federal Logistics";
const TOKEN_URL      = "https://oauth2.googleapis.com/token";
const GMAIL_BASE     = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SEND_URL = GMAIL_BASE + "/messages/send";
const SITE_URL       = "https://thehouseofkel.com/scc/";

// ── PUPPETEER SCRIPT — runs inside Browserless cloud ─────────────────────
// Defined as a real function so the source is valid JS with no string-escape issues.
// navigator-ingest serializes it with .toString() and sends to Browserless /function.
// IMPORTANT: nothing outside this function is accessible — it must be self-contained.
const scraperFn = async ({ page, context }) => {
  const { username, password, fscLanes, minExtPrice } = context;

  // Column positions verified against live DIBBS Navigator table
  const COL = {
    sol_number: 0, nomenclature: 5, qty: 6, unit_issue: 7,
    unit_price: 8, hist_price: 9, ext_price: 10, quote_due: 11,
    delivery_days: 12, nsn: 13, piece_part_no: 14, set_aside: 15,
    material: 16, part_char: 17, supplier_restrictions: 18,
    fob: 22, naics: 24, supplier_list: 28,
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  async function scrapePage(passNum, passLabel, fscHint) {
    return page.evaluate((_COL, _min, _pn, _pl, _fh) => {
      const rows = Array.from(document.querySelectorAll("#Main_GridView1 tbody tr"));
      const results = [];
      const txt = (cells, i) => (cells[i] ? cells[i].textContent : "").replace(/\s+/g, " ").trim();
      const num = (cells, i) => parseFloat(txt(cells, i).replace(/[$,]/g, "")) || 0;
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 20) continue;
        const ext = num(cells, _COL.ext_price);
        if (ext > 0 && ext < _min) break;
        if (ext === 0 && num(cells, _COL.unit_price) === 0) continue;
        const sol = txt(cells, _COL.sol_number);
        if (!sol || sol.length < 8) continue;
        const nsn = txt(cells, _COL.nsn).replace(/[^0-9]/g, "");
        results.push({
          sol_number: sol,
          item_name: txt(cells, _COL.nomenclature),
          qty: num(cells, _COL.qty),
          unit_issue: txt(cells, _COL.unit_issue),
          unit_price: num(cells, _COL.unit_price),
          hist_price: num(cells, _COL.hist_price),
          ext_price: ext,
          quote_due: txt(cells, _COL.quote_due),
          delivery_days: num(cells, _COL.delivery_days),
          nsn,
          fsc: _fh || nsn.slice(0, 4) || "",
          ref_part_number: txt(cells, _COL.piece_part_no),
          set_aside: txt(cells, _COL.set_aside),
          material: txt(cells, _COL.material),
          part_char: txt(cells, _COL.part_char),
          supplier_restrictions: txt(cells, _COL.supplier_restrictions),
          fob: txt(cells, _COL.fob),
          naics: txt(cells, _COL.naics),
          supplier_list: txt(cells, _COL.supplier_list),
          pass: _pn,
          pass_label: _pl,
          scraped_at: new Date().toISOString(),
        });
      }
      return results;
    }, COL, minExtPrice, passNum, passLabel, fscHint || "");
  }

  async function sortDescByExtPrice() {
    // String-form evaluate avoids strict-mode .caller/.arguments issue (same as local agent)
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.evaluate('__doPostBack("ctl00$Main$GridView1", "Sort$Extended")'),
    ]);
    const firstPrice = await page.evaluate((idx) => {
      const rows = document.querySelectorAll("#Main_GridView1 tbody tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 20) continue;
        const v = parseFloat((cells[idx] ? cells[idx].textContent : "0").replace(/[$,]/g, ""));
        if (!isNaN(v) && v > 0) return v;
      }
      return 0;
    }, COL.ext_price);
    if (firstPrice > 0 && firstPrice < 5000) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
        page.evaluate('__doPostBack("ctl00$Main$GridView1", "Sort$Extended")'),
      ]);
    }
  }

  async function setCommonFilters() {
    await page.evaluate(() => { const el = document.querySelector("#Main_rbAwarded_2"); if (el) el.click(); });
    await page.evaluate(() => { const el = document.querySelector("#Main_chNotExpired"); if (el && !el.checked) el.click(); });
    await page.evaluate(() => { const el = document.querySelector("#Main_chExpired"); if (el && el.checked) el.click(); });
    await page.evaluate(() => { const el = document.querySelector("#Main_chCPac"); if (el && !el.checked) el.click(); });
    await new Promise((r) => setTimeout(r, 500));
  }

  async function goToSearchPage() {
    await page.goto("https://dibbsnavigator.com/dn.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#Main_btnApplySelections", { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
    try { await page.click("#Button111"); await new Promise((r) => setTimeout(r, 1000)); } catch (e) {}
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
  }

  async function runBroadPass(passNum, dateRadioId, dateLabel) {
    await goToSearchPage();
    await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
    const fscInput = await page.$("#Main_NSN_Search");
    if (fscInput) { await fscInput.click({ clickCount: 3 }); await page.keyboard.press("Backspace"); }
    await page.evaluate((id) => { const el = document.querySelector("#" + id); if (el) el.click(); }, dateRadioId);
    await setCommonFilters();
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.click("#Main_btnApplySelections"),
    ]);
    await sortDescByExtPrice();
    return scrapePage(passNum, dateLabel, "");
  }

  async function runFscPass(fsc, seen) {
    await goToSearchPage();
    await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
    await page.evaluate(() => { const el = document.querySelector("#Main_rbDateRange_3"); if (el) el.click(); });
    await setCommonFilters();
    const fscInput = await page.$("#Main_NSN_Search");
    if (fscInput) {
      await fscInput.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type("#Main_NSN_Search", fsc, { delay: 50 });
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.click("#Main_btnApplySelections"),
    ]);
    await sortDescByExtPrice();
    const all = await scrapePage(3, "Pass3-FSC-" + fsc, fsc);
    return all.filter((s) => { if (seen.has(s.sol_number)) return false; seen.add(s.sol_number); return true; });
  }

  // ── Login ──────────────────────────────────────────────────────────────
  await page.goto("https://dibbsnavigator.com/login.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#Main_Input_Customer_Name", { timeout: 30000 });
  await page.type("#Main_Input_Customer_Name", username, { delay: 60 });
  await page.type("#Main_Input_Password", password, { delay: 60 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.click("#Main_btnCustOK"),
  ]);
  if (page.url().includes("login.aspx")) {
    throw new Error("Navigator login failed — check NAVIGATOR_USERNAME / NAVIGATOR_PASSWORD");
  }

  // ── Pass 1: Today broad ────────────────────────────────────────────────
  const pass1 = await runBroadPass(1, "Main_rbDateRange_0", "Selected (today)");

  // ── Pass 2: Last 30 days broad (LHF pool) ─────────────────────────────
  const pass2 = await runBroadPass(2, "Main_rbDateRange_3", "Last 30 days (LHF)");

  // ── Pass 3: Per-FSC (catches rows past page cap) ───────────────────────
  const seen = new Set([...pass1, ...pass2].map((s) => s.sol_number));
  const pass3Sols = [];
  for (const fsc of fscLanes) {
    try {
      const newSols = await runFscPass(fsc, seen);
      pass3Sols.push(...newSols);
    } catch (e) {
      // Non-fatal — skip this FSC lane
    }
  }

  // ── Dedupe (pass1 wins on conflict) ───────────────────────────────────
  const deduped = new Set();
  const allSols = [];
  for (const sol of [...pass1, ...pass2, ...pass3Sols]) {
    if (!deduped.has(sol.sol_number)) { deduped.add(sol.sol_number); allSols.push(sol); }
  }

  return {
    data: {
      ok: true,
      count: allSols.length,
      pass1: pass1.length,
      pass2: pass2.length,
      pass3: pass3Sols.length,
      sols: allSols,
    },
  };
};

// ── GOOGLE AUTH ───────────────────────────────────────────────────────────
async function getGoogleToken() {
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  const res  = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token refresh failed: " + JSON.stringify(data));
  return data.access_token;
}

// ── GMAIL SEND ────────────────────────────────────────────────────────────
function buildMimeRaw(to, subject, body) {
  const CRLF = "\r\n";
  const msg  = [
    "From: " + FROM_NAME + " <" + FROM_ADDRESS + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join(CRLF);
  return Buffer.from(msg).toString("base64url");
}

async function gmailSend(token, to, subject, body) {
  const res = await fetch(GMAIL_SEND_URL, {
    method:  "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body:    JSON.stringify({ raw: buildMimeRaw(to, subject, body) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gmail send failed: " + JSON.stringify(data));
  return data;
}

// ── VENDOR SELECTION (mirrors gmail-ingest) ───────────────────────────────
function detectPNPrefix(pn) {
  const p = (pn || "").trim().toUpperCase();
  if (/^AN[\d-]/.test(p)) return "AN";
  if (/^MS[\d-]/.test(p)) return "MS";
  if (/^NAS[\d-]/.test(p)) return "NAS";
  return null;
}

function selectVendors(record, dists) {
  const fsc      = (record.fsc || "").slice(0, 4);
  const pnPrefix = detectPNPrefix(record.ref_part_number);
  const selected = [];
  const seenIds  = new Set();

  const add = (d, reason) => {
    if (!d || seenIds.has(d._id?.toString() || d.name)) return;
    if (!d.email) return;
    seenIds.add(d._id?.toString() || d.name);
    selected.push({ dist: d, reason });
  };

  // G-Fast dropped 2026-07-14 — 19 RFQs sent, 0 replies. Deleted from DB.
  for (const d of dists) if (d.is_manufacturer && d.has_jcp)  add(d, "MFR · JCP");
  for (const d of dists) if (d.is_manufacturer && !d.has_jcp) add(d, "MFR");
  for (const d of dists) {
    const tags = (d.tags || []).map((t) => t.toLowerCase());
    if (tags.includes("fsc-" + fsc) || (d.fsc_specialties || []).includes(fsc)) add(d, "FSC " + fsc);
  }
  for (const d of dists) {
    if (d.is_starred || (d.tags || []).includes("preferred")) add(d, "Preferred");
  }
  return selected;
}

// ── RFQ EMAIL ─────────────────────────────────────────────────────────────
function buildRFQEmail(dist, record) {
  const item = record.item_name || record.item_description || "—";
  const qty  = record.quantity   || record.qty || "—";
  const del  = record.delivery_days ? record.delivery_days + " days ARO" : "—";
  const gov  = record.unit_price ? "$" + Number(record.unit_price).toLocaleString() + " est." : "—";
  const subject = "RFQ – " + item + " | " + record.sol_number + " | Imperio Federal Logistics";
  const body = [
    "Hi " + (dist.name || dist.company_name) + ",",
    "",
    "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.",
    "",
    "I need pricing and availability on the following item:",
    "",
    "  Item:            " + item,
    record.nsn             ? "  NSN:             " + record.nsn             : null,
    record.ref_part_number ? "  Part Number:     " + record.ref_part_number : null,
    "  Quantity:        " + qty,
    "  Required Del.:   " + del,
    "  Est. Gov. Value: " + gov,
    "  Solicitation:    " + record.sol_number,
    "",
    "Requirements:",
    "- Destination: Government delivery address (continental US)",
    "- Payment: Immediate PO upon award — we use third-party PO funding (Factoring Express). Supplier receives direct wire payment before shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin",
    "- Shipping: FOB Destination required",
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and confirm country of origin. We issue POs immediately upon award.",
    "",
    "Thank you,",
    "Anthony K Kelley | Founder & CEO",
    "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
    "SDVOSB | VetHUB",
    FROM_ADDRESS + " | ifedlog.com | (254) 226-5216",
  ].filter((l) => l !== null).join("\n");
  return { subject, body };
}

// ── CLAUDE SCREEN ─────────────────────────────────────────────────────────
async function claudeScreen(record) {
  const url  = process.env.URL + "/.netlify/functions/analyze-sols";
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sols: [record] }),
  });
  const data = await res.json();
  if (!data.ok || !data.results || !data.results[0]) throw new Error("analyze-sols error");
  return data.results[0];
}

// ── MONGODB HELPERS ───────────────────────────────────────────────────────
async function getDistributors(db) {
  return db.collection("distributors").find({}).toArray();
}

async function saveSolToMongo(db, record) {
  await db.collection("solicitations").updateOne(
    { sol_number: record.sol_number },
    { $set: record },
    { upsert: true },
  );
}

async function getAlreadyActedSols(db) {
  const acted = await db.collection("solicitations").find(
    { status: { $in: ["Awaiting Quotes", "Bid Submitted", "Awarded", "Lost"] } },
    { projection: { sol_number: 1 } },
  ).toArray();
  return new Set(acted.map((s) => s.sol_number));
}

// ── BROWSERLESS NAVIGATOR SCRAPE ──────────────────────────────────────────
async function scrapeNavigator() {
  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey) throw new Error("BROWSERLESS_API_KEY not set");

  const username = process.env.NAVIGATOR_USERNAME;
  const password = process.env.NAVIGATOR_PASSWORD;
  if (!username || !password) throw new Error("NAVIGATOR_USERNAME or NAVIGATOR_PASSWORD not set");

  const fscLanes = (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320")
    .split(",").map((f) => f.trim()).filter(Boolean);
  const minExtPrice = parseFloat(process.env.NAVIGATOR_MIN_EXT_PRICE || "1000");

  // Serialize the scraper function and wrap as a CommonJS module
  const code = "module.exports = " + scraperFn.toString() + ";";

  const res = await fetch(
    "https://production-sfo.browserless.io/function?token=" + apiKey + "&timeout=540000",
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code, context: { username, password, fscLanes, minExtPrice } }),
      signal:  AbortSignal.timeout(570000), // 9.5 min — slightly over Browserless timeout so we get the error back
    },
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error("Browserless /function error " + res.status + ": " + txt.slice(0, 300));
  }

  const result = await res.json();
  if (!result.ok) throw new Error("Navigator scrape returned error: " + (result.error || JSON.stringify(result)));
  return result;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
exports.handler = async () => {
  const log = [];
  const addLog = (msg) => { log.push(msg); console.log("[navigator-ingest]", msg); };

  addLog("Navigator ingest started — " + new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT");

  // MongoDB
  let db;
  try {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db("scc_db");
  } catch (e) {
    return { statusCode: 500, body: "MongoDB connection failed: " + e.message };
  }

  // Google token
  let token;
  try {
    token = await getGoogleToken();
    addLog("Google token acquired");
  } catch (e) {
    return { statusCode: 500, body: "Google auth failed: " + e.message };
  }

  // Browserless scrape
  let scrapeResult;
  try {
    addLog("Launching Browserless Navigator scrape…");
    scrapeResult = await scrapeNavigator();
    addLog("Scrape complete — " + scrapeResult.count + " sols (P1:" + scrapeResult.pass1 + " P2:" + scrapeResult.pass2 + " P3:" + scrapeResult.pass3 + ")");
  } catch (e) {
    addLog("Scrape FAILED: " + e.message);
    await gmailSend(token, FROM_ADDRESS, "SCC Navigator Ingest — SCRAPE FAILED", [
      "Navigator Ingest failed during Browserless scrape.",
      "",
      "Error: " + e.message,
      "",
      "Time: " + new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT",
      SITE_URL,
    ].join("\n")).catch(() => {});
    return { statusCode: 500, body: e.message };
  }

  const sols = scrapeResult.sols || [];
  if (sols.length === 0) {
    addLog("No sols found — sending empty summary");
    await gmailSend(token, FROM_ADDRESS, "SCC Navigator Ingest: No sols today",
      "Navigator scrape returned 0 solicitations.\n\n" + new Date().toLocaleString() + "\n" + SITE_URL,
    );
    return { statusCode: 200, body: "No sols" };
  }

  const dists        = await getDistributors(db);
  const alreadyActed = await getAlreadyActedSols(db);
  const results      = { go: [], verifyFirst: [], rejected: [], errors: [], skipped: [] };

  for (const raw of sols) {
    const sol = raw.sol_number;

    // Skip if already acted upon (RFQ sent, bid submitted, won, lost)
    if (alreadyActed.has(sol)) {
      results.skipped.push(sol);
      addLog("Skip (already acted): " + sol);
      continue;
    }

    try {
      // Normalize Navigator record to standard pipeline format
      const record = {
        sol_number:       sol,
        nsn:              raw.nsn || "",
        fsc:              raw.fsc || (raw.nsn || "").slice(0, 4),
        item_name:        raw.item_name || "",
        ref_part_number:  raw.ref_part_number || "",
        quantity:         raw.qty || "",
        unit_of_issue:    raw.unit_issue || "",
        unit_price:       raw.hist_price || raw.unit_price || "",
        delivery_days:    raw.delivery_days || "",
        set_aside:        raw.set_aside || "",
        fob:              raw.fob || "",
        quote_due:        raw.quote_due || "",
        ext_price:        raw.ext_price || "",
        material:         raw.material || "",
        part_char:        raw.part_char || "",
        supplier_restrictions: raw.supplier_restrictions || "",
        naics:            raw.naics || "",
        supplier_list:    raw.supplier_list || "",
        status:           "New",
        date_added:       new Date().toLocaleDateString(),
        notes:            "Auto-ingested via Navigator · " + (raw.pass_label || ""),
        source:           "navigator-ingest",
      };

      // Claude screen
      addLog("Screening " + sol + "…");
      let analysis;
      try {
        analysis = await claudeScreen(record);
        addLog(sol + " → " + analysis.verdict + ": " + analysis.reason);
      } catch (e) {
        addLog("Claude failed for " + sol + ": " + e.message + " — defaulting GO");
        analysis = { verdict: "GO", reason: "Claude unavailable — manual review recommended" };
      }

      if (analysis.verdict === "REJECT") {
        results.rejected.push({ sol, reason: analysis.reason });
        record.status = "No Source";
        record.notes  = "Auto-rejected: " + analysis.reason;
        await saveSolToMongo(db, record);
        continue;
      }

      // GO or VERIFY FIRST — fire RFQs either way.
      // Requesting a quote commits nothing. You decide at bid time.
      const isFlag  = analysis.verdict === "VERIFY FIRST";
      const vendors = selectVendors(record, dists);
      let sent = 0;
      for (const { dist, reason } of vendors) {
        try {
          const { subject, body: emailBody } = buildRFQEmail(dist, record);
          await gmailSend(token, dist.email, subject, emailBody);
          addLog((isFlag ? "⚠ " : "✓ ") + "RFQ → " + (dist.name || dist.company_name) + " [" + reason + "]");
          sent++;
        } catch (e) {
          addLog("✗ RFQ failed → " + (dist.name || dist.company_name) + ": " + e.message);
        }
      }

      record.status = sent > 0 ? "Awaiting Quotes" : "Sourcing";
      record.notes  = [
        record.notes,
        isFlag ? "⚠ VERIFY FIRST — review before bidding: " + analysis.reason : "Claude: " + analysis.reason,
        analysis.sourcing_path ? "Path: " + analysis.sourcing_path : null,
        analysis.winProbabilityPct != null ? "Win prob: " + analysis.winProbabilityPct + "%" : null,
        "Auto-RFQ: " + sent + "/" + vendors.length + " sent",
      ].filter(Boolean).join("\n");
      await saveSolToMongo(db, record);

      if (isFlag) {
        results.verifyFirst.push({ sol, sent, total: vendors.length, reason: analysis.reason, path: analysis.sourcing_path });
      } else {
        results.go.push({ sol, sent, total: vendors.length, reason: analysis.reason });
      }

    } catch (e) {
      addLog("Error on " + sol + ": " + e.message);
      results.errors.push({ sol, error: e.message });
    }
  }

  // Summary email
  const total = results.go.length + results.verifyFirst.length + results.rejected.length + results.errors.length;
  const summaryLines = [
    "SCC Navigator Ingest Summary",
    new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT",
    "Scraped: " + sols.length + " sols (P1:" + scrapeResult.pass1 + " P2:" + scrapeResult.pass2 + " P3:" + scrapeResult.pass3 + " | skipped:" + results.skipped.length + ")",
    "─".repeat(44),
    "",
    "✅ GO — RFQs Sent (" + results.go.length + ")",
    ...results.go.map((r) => "  • " + r.sol + " → " + r.sent + "/" + r.total + " vendor(s)  " + r.reason),
    results.go.length === 0 ? "  (none)" : "",
    "",
    "⚠ FLAGGED — RFQ Sent, Review Before Bidding (" + results.verifyFirst.length + ")",
    ...results.verifyFirst.map((r) => "  • " + r.sol + " → " + r.sent + "/" + r.total + " vendor(s)  " + r.reason + (r.path ? "\n    " + r.path : "")),
    results.verifyFirst.length === 0 ? "  (none)" : "",
    "",
    "🔒 REJECTED — No Source (" + results.rejected.length + ")",
    ...results.rejected.map((r) => "  • " + r.sol + " — " + r.reason),
    results.rejected.length === 0 ? "  (none)" : "",
    results.errors.length > 0 ? "\n✗ ERRORS (" + results.errors.length + ")" : "",
    ...results.errors.map((r) => "  • " + r.sol + " — " + r.error),
    "",
    "─".repeat(44),
    "Processed " + total + " solicitation(s)",
    "View Pipeline → " + SITE_URL,
  ].filter((l) => l !== "").join("\n");

  const summarySubject = total === 0
    ? "SCC Navigator Ingest: Nothing new today"
    : "SCC Nav: " + (results.go.length + results.verifyFirst.length) + " RFQs fired · " + results.verifyFirst.length + " flagged · " + results.rejected.length + " rejected";

  try {
    await gmailSend(token, FROM_ADDRESS, summarySubject, summaryLines);
    addLog("Summary email sent");
  } catch (e) {
    addLog("Summary email failed: " + e.message);
  }

  return {
    statusCode: 200,
    headers:    { "Content-Type": "application/json" },
    body:       JSON.stringify({ ok: true, results, log }),
  };
};
