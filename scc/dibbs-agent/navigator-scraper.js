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

// ── Config ───────────────────────────────────────────────────────────────
const CONFIG = {
  username: process.env.NAVIGATOR_USERNAME,
  password: process.env.NAVIGATOR_PASSWORD,
  fscLanes: (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320")
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

// ── MAIN SCRAPER ─────────────────────────────────────────────────────────
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
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.setViewport({ width: 1920, height: 1080 });

    // ── STEP 1: LOGIN ──────────────────────────────────────────────────
    info("Navigating to login page...");
    await page.goto("https://dibbsnavigator.com/login.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    await page.waitForSelector("#Main_Input_Customer_Name", {
      timeout: 120000,
    });
    info("Login form found — typing credentials...");

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
    info("Post-login URL:", postLoginUrl);

    if (postLoginUrl.includes("login.aspx")) {
      throw new Error(
        "Login failed — still on login page. Check NAVIGATOR_USERNAME and NAVIGATOR_PASSWORD in .env.",
      );
    }
    info("✅ Login successful");

    // Navigate to Search DIBBS if not already there
    if (!postLoginUrl.includes("dn.aspx")) {
      info("Navigating to Search DIBBS (dn.aspx)...");
      await page.goto("https://dibbsnavigator.com/dn.aspx", {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
    }

    // ── STEP 2: SET FILTERS ────────────────────────────────────────────
    info("Waiting for filter form...");
    await page.waitForSelector("#btnFullDN", { timeout: 120000 });
    info("Filter form ready — applying filters...");

    // FSC Lanes — confirmed selector: #Main_NSN_Search
    const fscInput = await page.$("#Main_NSN_Search");
    if (fscInput) {
      await fscInput.click({ clickCount: 3 });
      await fscInput.type(CONFIG.fscLanes.join(","), { delay: 30 });
      info("✅ FSC lanes:", CONFIG.fscLanes.join(","));
    } else {
      info("⚠️ FSC input (#Main_NSN_Search) not found — no FSC filter applied");
    }

    // Date: Last 30 days (#Main_rbDateRange_3, value=30)
    await clickRadio(page, "#Main_rbDateRange_3");
    info("✅ Date: Last 30 days");

    // Not Already Awarded (#Main_rbAwarded_2, value=Not_Awarded)
    await clickRadio(page, "#Main_rbAwarded_2");
    info("✅ Not Already Awarded");

    // Filter Set: None (#Main_rbDefaultSets_4, value=4)
    await clickRadio(page, "#Main_rbDefaultSets_4");
    info("✅ Filter set: None");

    // Not Expired: check (#Main_chNotExpired)
    await ensureChecked(page, "#Main_chNotExpired");
    info("✅ Not Expired: checked");

    // Expired: uncheck (#Main_chExpired)
    await ensureUnchecked(page, "#Main_chExpired");
    info("✅ Expired: unchecked");

    // Com. Pack: check (#Main_chCPac)
    await ensureChecked(page, "#Main_chCPac");
    info("✅ Com. Pack: checked");

    // Supplier Restrictions: COTS
    await page.select("#Main_DropDownList_SupRestrict", "COTS");
    info("✅ Supplier Restrictions: COTS");

    // JCP: No JCP Cert.
    await page.select("#Main_DropDownListJCP", "No JCP Cert.");
    info("✅ JCP: No JCP Cert.");

    // ── STEP 3: APPLY SELECTIONS ───────────────────────────────────────
    info("Clicking Apply Selections...");
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }),
      page.click("#btnFullDN"),
    ]);
    info("✅ Results loaded");

    // Grab result count for logging
    const resultCount = await page.evaluate(() => {
      const el = document.querySelector(
        ".GridViewCount, [id*='lblCount'], #Main_lblCount",
      );
      return el?.textContent?.trim() || "unknown";
    });
    info("Result count:", resultCount);

    // ── STEP 4: SORT BY EXTENDED PRICE DESC ───────────────────────────
    info("Sorting by Extended Price descending...");

    // First click — may sort ascending
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 120000,
      }),
      page.evaluate(() => {
        __doPostBack("ctl00$Main$GridView1", "Sort$Extended");
      }),
    ]);

    // Check first row price — if low, we're ascending, click again
    const firstPrice = await page.evaluate((colIdx) => {
      const rows = document.querySelectorAll("#Main_GridView1 tbody tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 20) continue;
        const txt = cells[colIdx]?.textContent?.replace(/[$,\s]/g, "") || "0";
        const val = parseFloat(txt);
        if (!isNaN(val) && val > 0) return val;
      }
      return 0;
    }, COL.ext_price);

    info("First row Extended Price after sort:", firstPrice);

    // If under $5K on the first visible row, likely ascending — click again
    if (firstPrice > 0 && firstPrice < 5000) {
      info("Appears ascending — clicking sort again for descending...");
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
    info("✅ Sort applied");

    // ── STEP 5: SCRAPE FIRST PAGE ──────────────────────────────────────
    info(`Scraping rows with Extended Price ≥ $${CONFIG.minExtPrice}...`);

    const sols = await page.evaluate(
      (colMap, minPrice) => {
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

          // Once we hit below floor, stop
          if (extPrice > 0 && extPrice < minPrice) break;

          // Skip zero-price rows (spacer/header rows)
          if (extPrice === 0 && getNum(cells, colMap.unit_price) === 0)
            continue;

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
            scraped_at: new Date().toISOString(),
          });
        }

        return results;
      },
      COL,
      CONFIG.minExtPrice,
    );

    info(`✅ Scraped ${sols.length} solicitations`);

    // ── STEP 6: BACKUP & RETURN ────────────────────────────────────────
    const timestamp = new Date().toISOString().split("T")[0];
    const backupPath = path.join(
      CONFIG.backupDir,
      `navigator-batch-${timestamp}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(sols, null, 2));
    info(`✅ Backup saved: ${backupPath}`);

    await browser.close();

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      count: sols.length,
      fscLanes: CONFIG.fscLanes,
      minPrice: CONFIG.minExtPrice,
      sols,
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
