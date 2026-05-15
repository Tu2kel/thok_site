// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — DIBBS NAVIGATOR SCRAPER v1.0
// Runs in dibbs-agent (Node.js, local machine)
// Puppeteer-based: login → filter FSC lanes → scrape daily batch → return JSON
//
// Usage (from agent):
//   const nav = require('./navigator-scraper');
//   const batch = await nav.scrapeNavigatorBatch();
//   // Returns: { ok: true, sols: [...], timestamp, count, ... }
//
// Credentials: Loaded from .env (NAVIGATOR_USERNAME, NAVIGATOR_PASSWORD)
// ═══════════════════════════════════════════════════════════════════════

const puppeteer = require("puppeteer");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

// ── Config ──────────────────────────────────────────────────────────────
const CONFIG = {
  username: process.env.NAVIGATOR_USERNAME,
  password: process.env.NAVIGATOR_PASSWORD,
  fscLanes: (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320").split(","),
  setAsideFilter: (process.env.NAVIGATOR_SET_ASIDE_FILTER || "Y,R,ST").split(","),
  excludeRestricted: process.env.NAVIGATOR_EXCLUDE_RESTRICTED === "true",
  excludeAidc: process.env.NAVIGATOR_EXCLUDE_AIDC === "true",
  dateOffset: parseInt(process.env.NAVIGATOR_DATE_OFFSET || "0"),
  headless: process.env.NAVIGATOR_HEADLESS !== "false",
  verbose: process.env.NAVIGATOR_VERBOSE === "true",
  maxRetries: parseInt(process.env.NAVIGATOR_MAX_RETRIES || "2"),
  pageTimeout: parseInt(process.env.NAVIGATOR_PAGE_TIMEOUT || "15000"),
  backupDir: process.env.NAVIGATOR_BACKUP_DIR || "./navigator-backups",
};

// Ensure backup dir exists
if (!fs.existsSync(CONFIG.backupDir)) {
  fs.mkdirSync(CONFIG.backupDir, { recursive: true });
}

const log  = (msg) => { if (CONFIG.verbose) console.log(`[navigator-scraper] ${msg}`); };
const warn = (msg) => console.warn(`[navigator-scraper] ⚠️  ${msg}`);
const error = (msg) => console.error(`[navigator-scraper] ❌ ${msg}`);

// ── NAVIGATOR URL & SELECTORS ───────────────────────────────────────────
const NAVIGATOR_URL = "https://www.dibbsnavigator.com";
const SELECTORS = {
  loginEmailInput:       'input[type="email"]',
  loginPasswordInput:    'input[type="password"]',
  loginSubmit:           'button[type="submit"]',
  selectedDateButton:    'button:has-text("Selected"), span:contains("Selected")',
  nsnFscInput:           "#Main_NSN_Search, #ct1005MainSNSearch",
  applySelectionsButton: 'button:contains("Apply Selections"), input[value="Apply Selections"]',
  resultsTable:          "table, tbody tr, [role='grid'] [role='row'], .search-results",
};

// ── MAIN SCRAPER FUNCTION ───────────────────────────────────────────────
async function scrapeNavigatorBatch() {
  let browser;
  try {
    log("Starting Navigator batch scrape...");
    log(`Config: FSC lanes = ${CONFIG.fscLanes.join(", ")}`);
    log(`Config: Set-aside filter = ${CONFIG.setAsideFilter.join(", ")}`);

    if (!CONFIG.username || !CONFIG.password) {
      throw new Error("NAVIGATOR_USERNAME or NAVIGATOR_PASSWORD not set in .env");
    }

    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(CONFIG.pageTimeout);
    await page.setViewport({ width: 1920, height: 1080 });

    log("Browser launched, navigating to Navigator...");
    await page.goto(NAVIGATOR_URL, { waitUntil: "networkidle2" });

    // ── LOGIN ──────────────────────────────────────────────────────────
    log("Attempting login...");
    await page.type(SELECTORS.loginEmailInput, CONFIG.username, { delay: 50 });
    await page.type(SELECTORS.loginPasswordInput, CONFIG.password, { delay: 50 });
    await page.click(SELECTORS.loginSubmit);
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    log("✅ Login successful");

    // ── SET DATE ───────────────────────────────────────────────────────
    log("Setting date filter...");
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - CONFIG.dateOffset);
    const dateStr = targetDate.toLocaleDateString("en-US", {
      month: "2-digit", day: "2-digit", year: "numeric",
    });
    log(`Target date: ${dateStr} (offset: ${CONFIG.dateOffset} days)`);

    try {
      const dateDropdown = await page.$('select[name*="Date"], [id*="Date"]');
      if (dateDropdown) {
        await page.select('[name*="Date"]', "Selected");
        log("✅ Selected date filter");
      }
    } catch (e) {
      log("Date selector not found, may already be set");
    }

    // ── FILTER BY FSC LANES ────────────────────────────────────────────
    log(`Filtering by FSC lanes: ${CONFIG.fscLanes.join(", ")}`);
    const fscInput = await page.$('[id*="NSN"], [id*="FSC"]');
    if (fscInput) {
      await page.evaluate((sel) => {
        document.querySelector(sel).value = "";
      }, '[id*="NSN"]');
      await page.type('[id*="NSN"]', CONFIG.fscLanes.join(", "));
      log("✅ FSC lanes entered");
    } else {
      warn("FSC input field not found, skipping FSC filter");
    }

    // ── APPLY SELECTIONS ───────────────────────────────────────────────
    log("Clicking 'Apply Selections' button...");
    try {
      await page.click('input[value="Apply Selections"]');
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      log("✅ Selections applied, results loading...");
    } catch (e) {
      log("Apply button click failed, may not be needed");
    }

    // ── SCRAPE RESULTS TABLE ───────────────────────────────────────────
    log("Extracting results table...");
    const sols = await page.evaluate(() => {
      const rows = [];
      const table = document.querySelector("table");

      if (!table) {
        console.warn("[navigator-scraper] No table found on page");
        return [];
      }

      const trs = table.querySelectorAll("tbody tr");
      console.log(`[navigator-scraper] Found ${trs.length} rows`);

      trs.forEach((tr) => {
        try {
          const cells = tr.querySelectorAll("td");
          if (cells.length < 5) return;

          const row = {
            sol_number:            cells[0]?.textContent?.trim() || "",
            nsn:                   cells[1]?.textContent?.trim() || "",
            fsc:                   cells[2]?.textContent?.trim() || "",
            item_name:             cells[3]?.textContent?.trim() || "",
            qty:                   cells[4]?.textContent?.trim() || "",
            unit_price:            cells[5]?.textContent?.trim() || "",
            ext_price:             cells[6]?.textContent?.trim() || "",
            delivery_days:         cells[7]?.textContent?.trim() || "",
            set_aside:             cells[8]?.textContent?.trim() || "",
            supplier_restrictions: cells[9]?.textContent?.trim() || "",
            jcp_status:            cells[10]?.textContent?.trim() || "",
            drawings_available:    cells[11]?.textContent?.trim() || "",
            quote_due:             cells[12]?.textContent?.trim() || "",
            award_status:          cells[13]?.textContent?.trim() || "",
          };

          if (row.sol_number) rows.push(row);
        } catch (e) {
          console.warn(`[navigator-scraper] Row parse error: ${e.message}`);
        }
      });

      return rows;
    });

    log(`✅ Scraped ${sols.length} solicitations`);

    const filtered = filterAndNormalize(sols);

    const backupPath = path.join(
      CONFIG.backupDir,
      `navigator-batch-${new Date().toISOString().split("T")[0]}.json`
    );
    fs.writeFileSync(backupPath, JSON.stringify(filtered, null, 2));
    log(`✅ Results backed up to ${backupPath}`);

    await browser.close();

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      count: filtered.length,
      dateOffset: CONFIG.dateOffset,
      fscLanes: CONFIG.fscLanes,
      sols: filtered,
      backupPath,
    };
  } catch (err) {
    error(`Scrape failed: ${err.message}`);
    if (browser) await browser.close();
    return { ok: false, error: err.message, timestamp: new Date().toISOString() };
  }
}

// ── FILTER & NORMALIZE ──────────────────────────────────────────────────
function filterAndNormalize(sols) {
  return sols
    .map((sol) => {
      const qty         = parseFloat(sol.qty.replace(/[^0-9.]/g, "")) || 0;
      const unitPrice   = parseFloat(sol.unit_price.replace(/[^0-9.]/g, "")) || 0;
      const extPrice    = qty * unitPrice;
      const deliveryDays = parseInt(sol.delivery_days.replace(/[^0-9]/g, "")) || 0;

      return {
        sol_number:            sol.sol_number.toUpperCase(),
        nsn:                   sol.nsn.replace(/[^0-9]/g, ""),
        fsc:                   sol.fsc.replace(/[^0-9]/g, ""),
        item_name:             sol.item_name,
        qty,
        unit_price:            unitPrice,
        ext_price:             extPrice,
        delivery_days:         deliveryDays,
        set_aside:             sol.set_aside,
        supplier_restrictions: sol.supplier_restrictions,
        jcp_status:            sol.jcp_status,
        drawings_available:    sol.drawings_available,
        quote_due:             sol.quote_due,
        award_status:          sol.award_status,
        scraped_at:            new Date().toISOString(),
      };
    })
    .filter((sol) => {
      if (CONFIG.excludeAidc && sol.item_name.includes("AIDC")) return false;
      if (CONFIG.excludeRestricted && sol.drawings_available === "Restricted") return false;
      if (sol.award_status === "Awarded" || sol.award_status === "Removed") return false;
      if (!sol.sol_number || !sol.nsn || sol.qty <= 0 || sol.unit_price <= 0) return false;
      return true;
    });
}

// ── EXPORTS ──────────────────────────────────────────────────────────────
module.exports = { scrapeNavigatorBatch, filterAndNormalize, CONFIG };

// ── STANDALONE CLI ────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const result = await scrapeNavigatorBatch();
    console.log("\n=== NAVIGATOR BATCH RESULT ===");
    console.log(JSON.stringify(result, null, 2));
  })();
}
