// src/scraper.js — Puppeteer DIBBS Navigator scraper
// Direct Puppeteer on Railway (no Browserless needed — no timeout, no cost per minute)
// Mirrors navigator-scraper.js v3.1 logic exactly.

const puppeteer = require("puppeteer-core");
const fs        = require("fs");

// Column indices are resolved at runtime from the live <th> header text.
// Navigator adds/drops columns without notice; a positional map silently
// misreads (e.g. Quote Due "08/06/26" parses as a $8 ext price, tripping the
// minPrice break and yielding 0 sols — a blast that quietly sends nothing).
// Header spellings, normalized: lowercased, non-alphanumerics stripped.
const HEADER_ALIASES = {
  sol_number:            ["solicitation"],
  nomenclature:          ["nomenclature"],
  qty:                   ["qty", "quantity"],
  unit_issue:            ["unitissue"],
  unit_price:            ["unitprice"],
  hist_price:            ["pricehist", "pricehistory"],
  ext_price:             ["extendedprice", "extprice"],
  quote_due:             ["quotedue"],
  delivery_days:         ["deldays", "deliverydays"],
  nsn:                   ["nsn"],
  piece_part_no:         ["piecepartno", "piecepartnumber"],
  repost:                ["repost", "reposted"],
  jcp:                   ["jcpreqd", "jcprequired", "jcp"],
  set_aside:             ["setaside"],
  part_char:             ["partchar"],
  supplier_restrictions: ["supplierrestrictions"],
  fob:                   ["fob"],
  naics:                 ["naics"],
  amsc:                  ["amsc"],
  supplier_list:         ["supplierlist"],
};

// A row cannot be identified or priced without these. Throwing beats scraping
// garbage — or worse, scraping nothing and reporting success.
const REQUIRED_COLS = ["sol_number", "ext_price", "unit_price", "nsn", "quote_due"];

async function resolveColumns(page) {
  const { colMap, header } = await page.evaluate((aliases) => {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const ths = Array.from(document.querySelectorAll("#Main_GridView1 tr th"))
      .map((th) => norm(th.textContent));
    const map = {};
    for (const [key, names] of Object.entries(aliases)) {
      for (const n of names) {
        const idx = ths.indexOf(n);
        if (idx !== -1) { map[key] = idx; break; }
      }
    }
    return { colMap: map, header: ths };
  }, HEADER_ALIASES);

  const missing = REQUIRED_COLS.filter((k) => colMap[k] === undefined);
  if (missing.length) {
    throw new Error(
      "Navigator table layout changed — missing required column(s): " +
        missing.join(", ") + ". Live headers: [" + header.join(", ") + "]. " +
        "Add the new spelling to HEADER_ALIASES in railway/src/scraper.js.",
    );
  }
  info("Column map resolved:", JSON.stringify(colMap));
  return colMap;
}

function info(...a)  { console.log("[scraper]", ...a); }
function fail(...a)  { console.error("[scraper] ❌", ...a); }

async function scrapePage(page, colMap, passNum, passLabel, fscHint, minPrice) {
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
        sol_number:           sol,
        item_name:            txt(cells, _COL.nomenclature),
        qty:                  num(cells, _COL.qty),
        unit_issue:           txt(cells, _COL.unit_issue),
        unit_price:           num(cells, _COL.unit_price),
        hist_price:           num(cells, _COL.hist_price),
        ext_price:            ext,
        quote_due:            txt(cells, _COL.quote_due),
        delivery_days:        num(cells, _COL.delivery_days),
        nsn,
        fsc:                  _fh || nsn.slice(0, 4) || "",
        ref_part_number:      txt(cells, _COL.piece_part_no),
        // Repost column is a per-row checkbox; checked = this sol was re-solicited
        // (first round drew no/weak bids → less competition, buyer still needs it).
        is_repost:            _COL.repost != null && !!(cells[_COL.repost] && cells[_COL.repost].querySelector("input") && cells[_COL.repost].querySelector("input").checked),
        jcp:                  txt(cells, _COL.jcp),
        set_aside:            txt(cells, _COL.set_aside),
        material:             "", // Navigator dropped the Material column; kept for schema parity
        part_char:            txt(cells, _COL.part_char),
        supplier_restrictions: txt(cells, _COL.supplier_restrictions),
        fob:                  txt(cells, _COL.fob),
        naics:                txt(cells, _COL.naics),
        supplier_list:        txt(cells, _COL.supplier_list),
        amsc:                 txt(cells, _COL.amsc),
        pass:                 _pn,
        pass_label:           _pl,
        scraped_at:           new Date().toISOString(),
      });
    }
    return results;
  }, colMap, minPrice, passNum, passLabel, fscHint || "");
}

async function sortDesc(page, colMap) {
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
  }, colMap.ext_price);
  if (firstPrice > 0 && firstPrice < 5000) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.evaluate('__doPostBack("ctl00$Main$GridView1", "Sort$Extended")'),
    ]);
  }
}

async function setCommonFilters(page) {
  await page.evaluate(() => { const el = document.querySelector("#Main_rbAwarded_2"); if (el) el.click(); });       // Not Already Awarded
  await page.evaluate(() => { const el = document.querySelector("#Main_chNotExpired"); if (el && !el.checked) el.click(); }); // Not Expired ✓
  await page.evaluate(() => { const el = document.querySelector("#Main_chExpired"); if (el && el.checked) el.click(); });     // Expired unchecked
  // NOTE: the Repost filter (#Main_chReposted) is NOT set here. It means "only
  // reposts", so setting it on every pass would drop all non-repost sols. The
  // repost flag is captured per-row (is_repost) and reposts get a dedicated
  // final sweep (repostSweep) instead.
  await page.evaluate(() => { const el = document.querySelector("#Main_chCPac"); if (el && !el.checked) el.click(); });
  await new Promise(r => setTimeout(r, 500));
}

async function goToSearch(page) {
  await page.goto("https://dibbsnavigator.com/dn.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#Main_btnApplySelections", { timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  try { await page.click("#Button111"); await new Promise(r => setTimeout(r, 1000)); } catch {}
  await page.keyboard.press("Escape");
  await new Promise(r => setTimeout(r, 500));
}

async function broadPass(page, passNum, dateId, label, minPrice) {
  info("Pass " + passNum + ": " + label);
  await goToSearch(page);
  await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
  const fscInput = await page.$("#Main_NSN_Search");
  if (fscInput) { await fscInput.click({ clickCount: 3 }); await page.keyboard.press("Backspace"); }
  await page.evaluate((id) => { const el = document.querySelector("#" + id); if (el) el.click(); }, dateId);
  await setCommonFilters(page);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.click("#Main_btnApplySelections"),
  ]);
  const colMap = await resolveColumns(page);
  await sortDesc(page, colMap);
  const sols = await scrapePage(page, colMap, passNum, label, "", minPrice);
  info("Pass " + passNum + " → " + sols.length + " sols");
  return sols;
}

// Reposts-only final sweep. #Main_chReposted filters the grid to solicitations
// that were re-issued (first round drew no/weak bids). These are lower-competition
// money, but in a broad pass they get buried under higher-$ non-reposts past the
// 200-row page cap — so they get their own top-200 budget here. Every row is a
// repost, so is_repost is forced true on the way out.
async function repostSweep(page, passNum, minPrice) {
  info("Pass " + passNum + ": Reposts-only (30-day sweep)");
  await goToSearch(page);
  await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
  const fscInput = await page.$("#Main_NSN_Search");
  if (fscInput) { await fscInput.click({ clickCount: 3 }); await page.keyboard.press("Backspace"); }
  await page.evaluate(() => { const el = document.querySelector("#Main_rbDateRange_3"); if (el) el.click(); }); // 30 days
  await setCommonFilters(page);
  await page.evaluate(() => { const el = document.querySelector("#Main_chReposted"); if (el && !el.checked) el.click(); }); // ONLY reposts
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.click("#Main_btnApplySelections"),
  ]);
  const colMap = await resolveColumns(page);
  await sortDesc(page, colMap);
  const sols = await scrapePage(page, colMap, passNum, "Reposts (30-day)", "", minPrice);
  sols.forEach(s => { s.is_repost = true; });
  info("Pass " + passNum + " → " + sols.length + " reposts");
  return sols;
}


async function scrape({ username, password, minPrice = 1000 }) {
  // Find Chromium — try candidates in order, pick first that actually exists on disk.
  // CHROMIUM_PATH env var is checked first but only used if the file is present.
  const _candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  const executablePath = _candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || _candidates[0];

  info("Launching Chromium at " + executablePath + "…");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-notifications", "--disable-infobars", "--disable-extensions",
      "--disable-popup-blocking", "--deny-permission-prompts",
      "--no-first-run", "--no-default-browser-check",
    ],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.setViewport({ width: 1920, height: 1080 });

    // Login
    info("Logging in to DIBBS Navigator…");
    await page.goto("https://dibbsnavigator.com/login.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#Main_Input_Customer_Name", { timeout: 30000 });
    await page.type("#Main_Input_Customer_Name", username, { delay: 60 });
    await page.type("#Main_Input_Password", password, { delay: 60 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.click("#Main_btnCustOK"),
    ]);
    if (page.url().includes("login.aspx")) throw new Error("Navigator login failed — check credentials");
    info("✅ Login successful");

    const pass1 = await broadPass(page, 1, "Main_rbDateRange_0", "Today (fresh)", minPrice);
    const pass2 = await broadPass(page, 2, "Main_rbDateRange_3", "Last 30 days (LHF)", minPrice);

    // Pass 3: last 30 days filtered to AN/MS/NAS piece part numbers — always runs.
    // Uses a lower floor ($1k) — these parts come in at small ext prices but route
    // to approved MFRs who can fulfill; the $10k gate in index.js is bypassed for them.
    // Canonical aerospace-hardware standards (mirror of blaster.js detectPNPrefix):
    // NAS/NASM · AN · MS · MIL · AS · BAC · NSA · DIN
    const AN_MS_NAS = /^(?:NASM|NAS|NSA|AN|MS|MIL|AS|DIN)[\d-]|^BAC[A-Z]?\d/i;
    const pass3Raw = await broadPass(page, 3, "Main_rbDateRange_3", "Aerospace-std 30-day", 1000);
    const seen12 = new Set([...pass1, ...pass2].map(s => s.sol_number));
    const pass3 = pass3Raw.filter(s => AN_MS_NAS.test((s.ref_part_number || "").trim().toUpperCase()) && !seen12.has(s.sol_number));
    info("Pass 3 → " + pass3.length + " aerospace-std sols (from " + pass3Raw.length + " on page)");

    // Pass 4: reposts-only final sweep. Rescues reposts the broad passes buried
    // past the 200-row cap. New-only (not already in P1–P3) since earlier passes
    // already carry is_repost from the column capture.
    const seen123 = new Set([...pass1, ...pass2, ...pass3].map(s => s.sol_number));
    const pass4Raw = await repostSweep(page, 4, minPrice);
    const pass4 = pass4Raw.filter(s => !seen123.has(s.sol_number));
    info("Pass 4 → " + pass4.length + " new reposts (from " + pass4Raw.length + " on page)");

    await browser.close();

    // Dedupe — pass1 wins
    const deduped = new Set();
    const all = [];
    for (const sol of [...pass1, ...pass2, ...pass3, ...pass4]) {
      if (!deduped.has(sol.sol_number)) { deduped.add(sol.sol_number); all.push(sol); }
    }

    const repostTotal = all.filter(s => s.is_repost).length;
    info("✅ Scrape complete — P1:" + pass1.length + " P2:" + pass2.length + " P3:" + pass3.length + " P4:" + pass4.length + " Total:" + all.length + " (" + repostTotal + " reposts)");
    return { ok: true, sols: all, counts: { pass1: pass1.length, pass2: pass2.length, pass3: pass3.length, pass4: pass4.length, reposts: repostTotal, total: all.length } };

  } catch (e) {
    fail("Scrape error:", e.message);
    try { await browser.close(); } catch {}
    return { ok: false, error: e.message, sols: [] };
  }
}

module.exports = { scrape };
