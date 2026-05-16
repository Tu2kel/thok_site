// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — DIBBS NAVIGATOR SCRAPER v2.0
// Full rewrite with verified selectors from live Navigator session.
//
// Flow:
//   1. Login → dibbsnavigator.com/login.aspx
//   2. Set filters: Last 30 days, Not Already Awarded, None (filter set),
//      Not Expired, Com. Pack checked, COTS only, No JCP Cert,
//      FSC lanes from .env
//   3. Apply Selections (#btnFullDN)
//   4. Sort Extended Price HIGH → LOW (__doPostBack Sort$Extended)
//   5. Scrape first page only — stop at $1000 extended price floor
//   6. Return normalized sol array + backup JSON
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
  // All FSC lanes — used for Pass 1 (daily)
  fscLanes: (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320")
    .split(",")
    .map((f) => f.trim()),
  // Winning lanes only — used for Pass 2 (30-day LHF)
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

// ── COLUMN MAP (0-indexed, verified from live table) ────────────────────
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

// ── SINGLE PASS SCRAPE ────────────────────────────────────────────────────
// passConfig: { dateRadioId, dateLabel, passNum }
async function runScrapePass(page, passConfig) {
  const { dateRadioId, dateLabel, passNum } = passConfig;
  info(`\n── PASS ${passNum}: ${dateLabel} — broad search ──`);

  // Navigate to Search DIBBS fresh for each pass
  await page.goto("https://dibbsnavigator.com/dn.aspx", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page.waitForSelector("#btnFullDN", { timeout: 120000 });

  // Dismiss yellow popup
  await page.evaluate(() => {
    const btn = document.querySelector("#Button111");
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 500));

  // FSC field — CLEAR it. Broad search. Analyzer handles FSC filtering.
  const fscInput = await page.$("#Main_NSN_Search");
  if (fscInput) {
    await fscInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    info("✅ FSC field cleared — broad search");
  }

  // Date radio
  await clickRadio(page, `#${dateRadioId}`);
  info(`✅ Date: ${dateLabel}`);

  // Not Already Awarded
  await clickRadio(page, "#Main_rbAwarded_2");
  info("✅ Not Already Awarded");

  // Filter Set: None
  await clickRadio(page, "#Main_rbDefaultSets_4");
  info("✅ Filter set: None");

  // Not Expired
  await ensureChecked(page, "#Main_chNotExpired");
  await ensureUnchecked(page, "#Main_chExpired");
  info("✅ Not Expired");

  // Com. Pack
  await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
  await page.evaluate(() => {
    const cb = document.querySelector("#Main_chCPac");
    if (cb && !cb.checked) cb.click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  info("✅ Com. Pack");

  // Supplier Restrictions: COTS
  await page.waitForSelector("#Main_DropDownList_SupRestrict", {
    timeout: 30000,
  });
  await page.select("#Main_DropDownList_SupRestrict", "COTS");
  await new Promise((r) => setTimeout(r, 2000));
  info("✅ Supplier Restrictions: COTS");

  // JCP: No JCP Cert.
  await page.waitForSelector("#Main_DropDownListJCP", { timeout: 30000 });
  await page.select("#Main_DropDownListJCP", "No JCP Cert.");
  await new Promise((r) => setTimeout(r, 2000));
  info("✅ JCP: No JCP Cert.");

  // Apply Selections — force click via evaluate to bypass any overlay/popup
  info("Clicking Apply Selections...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.evaluate(() => {
      const btn = document.querySelector("#btnFullDN");
      if (!btn) throw new Error("#btnFullDN not found");
      btn.scrollIntoView();
      btn.click();
    }),
  ]);
  info("✅ Results loaded");

  // Sort Extended Price desc
  info("Sorting by Extended Price...");
  await new Promise((r) => setTimeout(r, 1500));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.evaluate(function () {
      // wrapped in non-strict function to allow __doPostBack's use of `arguments`
      (function () {
        __doPostBack("ctl00$Main$GridView1", "Sort$Extended");
      })();
    }),
  ]);

  // Check sort direction
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
      page.evaluate(function () {
        (function () {
          __doPostBack("ctl00$Main$GridView1", "Sort$Extended");
        })();
      }),
    ]);
  }
  info("✅ Sorted desc");

  // Scrape first page
  const sols = await page.evaluate(
    (colMap, minPrice, passNum, dateLabel) => {
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
          fsc: nsn.slice(0, 4) || "",
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
          pass_label: dateLabel,
          scraped_at: new Date().toISOString(),
        });
      }
      return results;
    },
    COL,
    CONFIG.minExtPrice,
    passNum,
    dateLabel,
  );

  info(`✅ Pass ${passNum} scraped ${sols.length} sols`);
  return sols;
}

// ── MAIN: TWO-PASS SCRAPER ────────────────────────────────────────────────
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

    const postLoginUrl = page.url();
    if (postLoginUrl.includes("login.aspx")) {
      throw new Error(
        "Login failed — check NAVIGATOR_USERNAME / NAVIGATOR_PASSWORD in .env",
      );
    }
    info("✅ Login successful:", postLoginUrl);

    // ── PASS 1: SELECTED DATE — BROAD SEARCH ──────────────────────────
    const pass1 = await runScrapePass(page, {
      passNum: 1,
      dateRadioId: "Main_rbDateRange_0",
      dateLabel: "Selected (today)",
    });

    // ── PASS 2: LAST 30 DAYS — BROAD SEARCH (LHF) ─────────────────────
    const pass2 = await runScrapePass(page, {
      passNum: 2,
      dateRadioId: "Main_rbDateRange_3",
      dateLabel: "Last 30 days (LHF)",
    });

    await browser.close();

    // Merge, dedupe by sol_number (pass1 wins on conflict)
    const seen = new Set();
    const allSols = [];
    for (const sol of [...pass1, ...pass2]) {
      if (!seen.has(sol.sol_number)) {
        seen.add(sol.sol_number);
        allSols.push(sol);
      }
    }

    info(
      `\n✅ COMPLETE — Pass 1: ${pass1.length} | Pass 2: ${pass2.length} | Total unique: ${allSols.length}`,
    );

    // Backup
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
    if (result.ok) {
      console.log("✅ Total sols:", result.count);
      console.log("   Pass 1 (today):", result.pass1);
      console.log("   Pass 2 (LHF)  :", result.pass2);
      console.log("   Backup:", result.backupPath);
    } else {
      console.log("❌ Failed:", result.error);
    }
  })();
}
