// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — DIBBS NAVIGATOR SCRAPER v3.0
//
// Three-pass scrape:
//   Pass 1 — Today, broad (catches fresh daily sols)
//   Pass 2 — Last 30 days, broad (LHF pool)
//   Pass 3 — Last 30 days, per-FSC with native typing (catches rows past
//             page cap that broad passes miss)
//
// Fix vs v2.0: FSC field now uses page.type() so ASP.NET registers the
// value. DOM .value injection alone does not fire the change events
// ASP.NET needs — native typing does.
// ═══════════════════════════════════════════════════════════════════════

const puppeteer = require("puppeteer");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

// ── CONFIG ───────────────────────────────────────────────────────────────
const CONFIG = {
  username: process.env.NAVIGATOR_USERNAME,
  password: process.env.NAVIGATOR_PASSWORD,
  // FSC lanes — used for Pass 1 broad + Pass 3 per-FSC
  fscLanes: (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320")
    .split(",")
    .map((f) => f.trim()),
  // Winning lanes — kept for config reference / future use
  fscLanesWinning: (
    process.env.NAVIGATOR_FSC_LANES_WINNING ||
    "5305,5310,5315,5320,5340,4330,4730,2910,9510"
  )
    .split(",")
    .map((f) => f.trim()),
  headless: process.env.NAVIGATOR_HEADLESS !== "false",
  verbose: process.env.NAVIGATOR_VERBOSE === "true",
  backupDir: process.env.NAVIGATOR_BACKUP_DIR || "./navigator-backups",
  minExtPrice: parseFloat(process.env.NAVIGATOR_MIN_EXT_PRICE || "1000"),
};

if (!fs.existsSync(CONFIG.backupDir)) {
  fs.mkdirSync(CONFIG.backupDir, { recursive: true });
}

const log = (...a) => {
  if (CONFIG.verbose) console.log("[navigator-scraper]", ...a);
};
const info = (...a) => console.log("[navigator-scraper]", ...a);
const fail = (...a) => console.error("[navigator-scraper] ❌", ...a);

// ── COLUMN MAP (0-indexed, verified from live table) ─────────────────────
// Headers: Solicitation | AI | Sol.Type | Send | Save | Nomenclature |
//   QTY | Unit Issue | Unit Price | Price Hist. | Extended Price |
//   Quote Due | Del.(days) | NSN | Piece Part No. | Set Aside |
//   Material | Part Char. | Supplier Restrictions | Quote | QA |
//   Insp. | FOB | Com.Pack | NAICS | Suppliers | NSN Info |
//   Resell Opp. | Supplier List | Exclude NSNs
const COL = {
  sol_number: 0,
  ai: 1,
  sol_type: 2,
  nomenclature: 5,
  qty: 6,
  unit_issue: 7,
  unit_price: 8,
  hist_price: 9,
  ext_price: 10,
  quote_due: 11,
  delivery_days: 12,
  nsn: 13,
  piece_part_no: 14,
  set_aside: 15,
  material: 16,
  part_char: 17,
  supplier_restrictions: 18,
  fob: 22,
  com_pack: 23,
  naics: 24,
  supplier_list: 28,
};

// ── HELPERS ───────────────────────────────────────────────────────────────
async function ensureChecked(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el && !el.checked) el.click();
  }, selector);
}

async function ensureUnchecked(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el && el.checked) el.click();
  }, selector);
}

async function clickRadio(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
  }, selector);
}

// ── SHARED SCRAPE HELPER — scrapes current page, dedupes against seen set ─
async function scrapePage(page, { passNum, passLabel, fscHint = "" }) {
  return await page.evaluate(
    (colMap, minPrice, passNum, passLabel, fscHint) => {
      const rows = Array.from(
        document.querySelectorAll("#Main_GridView1 tbody tr"),
      );
      const results = [];
      const getText = (cells, idx) =>
        cells[idx]?.textContent?.replace(/\s+/g, " ").trim() || "";
      const getNum = (cells, idx) =>
        parseFloat(getText(cells, idx).replace(/[$,]/g, "")) || 0;

      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 20) continue;
        const extPrice = getNum(cells, colMap.ext_price);
        if (extPrice > 0 && extPrice < minPrice) break;
        if (extPrice === 0 && getNum(cells, colMap.unit_price) === 0) continue;
        const solNum = getText(cells, colMap.sol_number);
        if (!solNum || solNum.length < 8) continue;
        const nsn = getText(cells, colMap.nsn).replace(/[^0-9]/g, "");
        results.push({
          sol_number: solNum,
          ai: getText(cells, colMap.ai),
          sol_type: getText(cells, colMap.sol_type),
          item_name: getText(cells, colMap.nomenclature),
          qty: getNum(cells, colMap.qty),
          unit_issue: getText(cells, colMap.unit_issue),
          unit_price: getNum(cells, colMap.unit_price),
          hist_price: getNum(cells, colMap.hist_price),
          ext_price: extPrice,
          quote_due: getText(cells, colMap.quote_due),
          delivery_days: getNum(cells, colMap.delivery_days),
          nsn: nsn,
          fsc: fscHint || nsn.slice(0, 4) || "",
          piece_part_no: getText(cells, colMap.piece_part_no),
          set_aside: getText(cells, colMap.set_aside),
          material: getText(cells, colMap.material),
          part_char: getText(cells, colMap.part_char),
          supplier_restrictions: getText(cells, colMap.supplier_restrictions),
          fob: getText(cells, colMap.fob),
          com_pack: getText(cells, colMap.com_pack),
          naics: getText(cells, colMap.naics),
          supplier_list: getText(cells, colMap.supplier_list),
          pass: passNum,
          pass_label: passLabel,
          scraped_at: new Date().toISOString(),
        });
      }
      return results;
    },
    COL,
    CONFIG.minExtPrice,
    passNum,
    passLabel,
    fscHint,
  );
}

// ── SORT DESC BY EXTENDED PRICE ───────────────────────────────────────────
async function sortDescByExtPrice(page) {
  info("Sorting by Extended Price...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.evaluate(() => {
      __doPostBack("ctl00$Main$GridView1", "Sort$Extended");
    }),
  ]);

  // Check direction — if first price is low, it sorted asc; click again
  const firstPrice = await page.evaluate((colIdx) => {
    const rows = document.querySelectorAll("#Main_GridView1 tbody tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 20) continue;
      const val = parseFloat(
        (cells[colIdx]?.textContent || "0").replace(/[$,\s]/g, ""),
      );
      if (!isNaN(val) && val > 0) return val;
    }
    return 0;
  }, COL.ext_price);

  if (firstPrice > 0 && firstPrice < 5000) {
    info("Ascending — clicking sort again...");
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }),
      page.evaluate(() => {
        __doPostBack("ctl00$Main$GridView1", "Sort$Extended");
      }),
    ]);
  }
  info("✅ Sorted desc");
}

// ── NAVIGATE TO dn.aspx AND DISMISS POPUP ────────────────────────────────
async function goToSearchPage(page) {
  await page.goto("https://dibbsnavigator.com/dn.aspx", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector("#btnFullDN", { timeout: 30000 });

  await page.evaluate(() => {
    const btn = document.querySelector("#Button111");
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
}

// ── SET COMMON FILTERS ────────────────────────────────────────────────────
// Filter Set (COTS, No JCP, etc.) is saved in the Navigator account —
// Puppeteer does not override it. Only touch: Not Already Awarded,
// Not Expired, and Com. Pack checkbox.
async function setCommonFilters(page) {
  await clickRadio(page, "#Main_rbAwarded_2"); // Not Already Awarded
  await ensureChecked(page, "#Main_chNotExpired");
  await ensureUnchecked(page, "#Main_chExpired");

  await page.evaluate(() => {
    const cb = document.querySelector("#Main_chCPac");
    if (cb && !cb.checked) cb.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

// ── PASS 1 & 2: BROAD SCRAPE ──────────────────────────────────────────────
async function runScrapePass(page, { passNum, dateRadioId, dateLabel }) {
  info(`\n── PASS ${passNum}: ${dateLabel} — broad search ──`);

  await goToSearchPage(page);
  await page.waitForSelector("#Main_chCPac", { timeout: 30000 });

  // Clear FSC field — broad pass
  const fscInput = await page.$("#Main_NSN_Search");
  if (fscInput) {
    await fscInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
  }
  info("✅ FSC field cleared — broad search");

  await clickRadio(page, `#${dateRadioId}`);
  info(`✅ Date: ${dateLabel}`);

  await setCommonFilters(page);
  info("✅ Common filters set");

  info("Clicking Apply Selections...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.click("#btnFullDN"),
  ]);
  info("✅ Results loaded");

  await sortDescByExtPrice(page);

  const sols = await scrapePage(page, { passNum, passLabel: dateLabel });
  info(`✅ Pass ${passNum} scraped ${sols.length} sols`);
  return sols;
}

// ── PASS 3: PER-FSC SCRAPE ────────────────────────────────────────────────
// Uses native page.type() on the FSC field so ASP.NET actually registers it.
// DOM .value assignment alone does NOT fire the change/input events that
// ASP.NET's __doPostBack wiring depends on.
async function runFscPass(page, { fsc, fscIndex, fscTotal, seen }) {
  info(`\n── PASS 3 FSC ${fscIndex + 1}/${fscTotal}: ${fsc} ──`);

  await goToSearchPage(page);
  await page.waitForSelector("#Main_chCPac", { timeout: 30000 });

  // Date: Last 30 days
  await clickRadio(page, "#Main_rbDateRange_3");
  info(`✅ Date: Last 30 days`);

  await setCommonFilters(page);
  info("✅ Common filters set");

  // FSC field — native typing (critical: fires change/input events ASP.NET needs)
  const fscInput = await page.$("#Main_NSN_Search");
  if (fscInput) {
    await fscInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type("#Main_NSN_Search", fsc, { delay: 50 });
  }
  info(`✅ FSC typed: ${fsc}`);

  info("Clicking Apply Selections...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.click("#btnFullDN"),
  ]);
  info("✅ Results loaded");

  await sortDescByExtPrice(page);

  const allOnPage = await scrapePage(page, {
    passNum: 3,
    passLabel: `Phase 3 FSC ${fsc}`,
    fscHint: fsc,
  });

  const newSols = allOnPage.filter((s) => !seen.has(s.sol_number));
  newSols.forEach((s) => seen.add(s.sol_number));

  info(`   FSC ${fsc}: ${allOnPage.length} on page, +${newSols.length} new`);
  return newSols;
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function scrapeNavigatorBatch() {
  let browser;
  try {
    if (!CONFIG.username || !CONFIG.password) {
      throw new Error(
        "NAVIGATOR_USERNAME or NAVIGATOR_PASSWORD not set in .env",
      );
    }

    info("Launching browser...");
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-notifications",
        "--disable-infobars",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--deny-permission-prompts",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.setViewport({ width: 1920, height: 1080 });

    // ── LOGIN ──────────────────────────────────────────────────────────
    info("Navigating to login page...");
    await page.goto("https://dibbsnavigator.com/login.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForSelector("#Main_Input_Customer_Name", {
      timeout: 120000,
    });
    info("Typing credentials...");
    await page.type("#Main_Input_Customer_Name", CONFIG.username, {
      delay: 60,
    });
    await page.type("#Main_Input_Password", CONFIG.password, { delay: 60 });
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }),
      page.click("#Main_btnCustOK"),
    ]);

    if (page.url().includes("login.aspx")) {
      throw new Error(
        "Login failed — check NAVIGATOR_USERNAME / NAVIGATOR_PASSWORD in .env",
      );
    }
    info("✅ Login successful:", page.url());

    // ── PASS 1: TODAY — BROAD ─────────────────────────────────────────
    const pass1 = await runScrapePass(page, {
      passNum: 1,
      dateRadioId: "Main_rbDateRange_0",
      dateLabel: "Selected (today)",
    });

    // ── PASS 2: LAST 30 DAYS — BROAD (LHF) ───────────────────────────
    const pass2 = await runScrapePass(page, {
      passNum: 2,
      dateRadioId: "Main_rbDateRange_3",
      dateLabel: "Last 30 days (LHF)",
    });

    // ── PASS 3: LAST 30 DAYS — PER-FSC ───────────────────────────────
    // Catches rows past the broad-pass page cap.
    // Native page.type() on FSC field ensures ASP.NET registers the filter.
    info("\n── PASS 3: Last 30 days — per-FSC ──");
    const seen = new Set([...pass1, ...pass2].map((s) => s.sol_number));
    const pass3Sols = [];

    for (let i = 0; i < CONFIG.fscLanes.length; i++) {
      try {
        const newSols = await runFscPass(page, {
          fsc: CONFIG.fscLanes[i],
          fscIndex: i,
          fscTotal: CONFIG.fscLanes.length,
          seen,
        });
        pass3Sols.push(...newSols);
      } catch (e) {
        fail(`FSC ${CONFIG.fscLanes[i]} failed: ${e.message} — skipping`);
      }
    }

    await browser.close();

    // ── MERGE + DEDUPE (pass1 wins on conflict) ───────────────────────
    const deduped = new Set();
    const allSols = [];
    for (const sol of [...pass1, ...pass2, ...pass3Sols]) {
      if (!deduped.has(sol.sol_number)) {
        deduped.add(sol.sol_number);
        allSols.push(sol);
      }
    }

    info(
      `\n✅ COMPLETE — Pass 1: ${pass1.length} | Pass 2: ${pass2.length} | Pass 3 (per-FSC): ${pass3Sols.length} | Total unique: ${allSols.length}`,
    );

    // ── BACKUP ────────────────────────────────────────────────────────
    const timestamp = new Date().toISOString().split("T")[0];
    const backupPath = path.join(
      CONFIG.backupDir,
      `navigator-batch-${timestamp}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(allSols, null, 2));
    info(`✅ Backup: ${backupPath}`);

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      count: allSols.length,
      pass1: pass1.length,
      pass2: pass2.length,
      pass3: pass3Sols.length,
      minPrice: CONFIG.minExtPrice,
      sols: allSols,
      backupPath,
    };
  } catch (e) {
    fail("Scrape failed:", e.message);
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
    return { ok: false, error: e.message, timestamp: new Date().toISOString() };
  }
}

// ── EXPORTS ───────────────────────────────────────────────────────────────
module.exports = { scrapeNavigatorBatch, CONFIG };

// ── CLI ───────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const result = await scrapeNavigatorBatch();
    console.log("\n=== NAVIGATOR BATCH RESULT ===");
    console.log(JSON.stringify(result, null, 2));
  })();
}
