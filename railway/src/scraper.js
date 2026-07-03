// src/scraper.js — Puppeteer DIBBS Navigator scraper
// Direct Puppeteer on Railway (no Browserless needed — no timeout, no cost per minute)
// Mirrors navigator-scraper.js v3.1 logic exactly.

const puppeteer = require("puppeteer-core");

// Column indices verified against DibbsNavigator layout (screenshot 2026-07-03):
// 0:Solicitation 1:AI 2:Sol.Type 3:Send 4:Nomenclature 5:Repost 6:QTY
// 7:Sol.Issue 8:Unit Price 9:Price Hist. 10:Extended Price 11:Quote Due
// 12:Del(days) 13:NSN 14:Piece Part No. 15:JCP 16:Set Aside
// 17:Material 18:Part Char. 19:Supplier Restrictions 20:Quote 21:Basic Drawing
// 22:Insp. 23:FOB 24:Com.Pack 25:NAICS 26:Suppliers 27:NSN Info
// 28:Resell Opp. 29:SA 30:AMSC 31:Complete Materials 32:Buyer Info 33:CMMC
const COL = {
  sol_number: 0, nomenclature: 4, qty: 6, unit_issue: 7,
  unit_price: 8, hist_price: 9, ext_price: 10, quote_due: 11,
  delivery_days: 12, nsn: 13, piece_part_no: 14, jcp: 15, set_aside: 16,
  material: 17, part_char: 18, supplier_restrictions: 19,
  fob: 23, naics: 25, supplier_list: 26, amsc: 30,
};

function info(...a)  { console.log("[scraper]", ...a); }
function fail(...a)  { console.error("[scraper] ❌", ...a); }

async function scrapePage(page, passNum, passLabel, fscHint, minPrice) {
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
        jcp:                  txt(cells, _COL.jcp),
        set_aside:            txt(cells, _COL.set_aside),
        material:             txt(cells, _COL.material),
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
  }, COL, minPrice, passNum, passLabel, fscHint || "");
}

async function sortDesc(page) {
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

async function setCommonFilters(page) {
  await page.evaluate(() => { const el = document.querySelector("#Main_rbAwarded_2"); if (el) el.click(); });       // Not Already Awarded
  await page.evaluate(() => { const el = document.querySelector("#Main_chNotExpired"); if (el && !el.checked) el.click(); }); // Not Expired ✓
  await page.evaluate(() => { const el = document.querySelector("#Main_chExpired"); if (el && el.checked) el.click(); });     // Expired unchecked
  await page.evaluate(() => { const el = document.querySelector("#Main_chRepost"); if (el && !el.checked) el.click(); });     // Repost ✓
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
  await sortDesc(page);
  const sols = await scrapePage(page, passNum, label, "", minPrice);
  info("Pass " + passNum + " → " + sols.length + " sols");
  return sols;
}


async function scrape({ username, password, minPrice = 1000 }) {
  // System Chromium installed by nixpacks — puppeteer-core needs explicit path
  const executablePath =
    process.env.CHROMIUM_PATH ||
    "/usr/bin/chromium" ||
    "/usr/bin/chromium-browser";

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
    const AN_MS_NAS = /^(AN|MS|NAS)[\d-]/i;
    const pass3Raw = await broadPass(page, 3, "Main_rbDateRange_3", "AN/MS/NAS 30-day", 1000);
    const seen12 = new Set([...pass1, ...pass2].map(s => s.sol_number));
    const pass3 = pass3Raw.filter(s => AN_MS_NAS.test(s.ref_part_number || "") && !seen12.has(s.sol_number));
    info("Pass 3 → " + pass3.length + " AN/MS/NAS sols (from " + pass3Raw.length + " on page)");

    await browser.close();

    // Dedupe — pass1 wins
    const deduped = new Set();
    const all = [];
    for (const sol of [...pass1, ...pass2, ...pass3]) {
      if (!deduped.has(sol.sol_number)) { deduped.add(sol.sol_number); all.push(sol); }
    }

    info("✅ Scrape complete — P1:" + pass1.length + " P2:" + pass2.length + " P3:" + pass3.length + " Total:" + all.length);
    return { ok: true, sols: all, counts: { pass1: pass1.length, pass2: pass2.length, pass3: pass3.length, total: all.length } };

  } catch (e) {
    fail("Scrape error:", e.message);
    try { await browser.close(); } catch {}
    return { ok: false, error: e.message, sols: [] };
  }
}

module.exports = { scrape };
