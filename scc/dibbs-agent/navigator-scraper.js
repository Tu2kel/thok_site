// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — DIBBS NAVIGATOR SCRAPER v4.0
//
// PHASE 1 — Today, broad, first page:
//   1. Login → lands on dn.aspx with Selected + Filter Set: None already set
//   2. Dismiss yellow popup
//   3. Single evaluate() sets all fields (no postbacks)
//   4. Apply Selections → sort → scrape
//
// PHASE 2 — Last 30 days, per-FSC, first page each:
//   1. Navigate fresh to dn.aspx (Filter Set: None already default)
//   2. Dismiss popup
//   3. Single evaluate() sets all fields + Last 30 days + FSC
//   4. Apply Selections → sort → scrape → repeat
// ═══════════════════════════════════════════════════════════════════════

const puppeteer = require("puppeteer");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const CONFIG = {
  username: process.env.NAVIGATOR_USERNAME,
  password: process.env.NAVIGATOR_PASSWORD,
  fscLanes: (process.env.NAVIGATOR_FSC_LANES || "5305,5310,5315,5320")
    .split(",")
    .map((f) => f.trim()),
  headless: process.env.NAVIGATOR_HEADLESS !== "false",
  backupDir: process.env.NAVIGATOR_BACKUP_DIR || "./navigator-backups",
  minExtPrice: parseFloat(process.env.NAVIGATOR_MIN_EXT_PRICE || "1000"),
};

if (!fs.existsSync(CONFIG.backupDir))
  fs.mkdirSync(CONFIG.backupDir, { recursive: true });

const info = (...a) => console.log("[navigator-scraper]", ...a);
const fail = (...a) => console.error("[navigator-scraper] ❌", ...a);

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

// ── SET ALL FORM FIELDS IN ONE EVALUATE ───────────────────────────────
// No postbacks — just DOM value setting. ASP.NET reads these on Apply.
async function setFormFields(page, { fsc = "", last30 = false } = {}) {
  await page.evaluate(
    (fscVal, useLast30) => {
      // Com. Pack
      const comPack = document.querySelector("#Main_chCPac");
      if (comPack) comPack.checked = true;

      // Not Expired
      const notExpired = document.querySelector("#Main_chNotExpired");
      if (notExpired) notExpired.checked = true;
      const expired = document.querySelector("#Main_chExpired");
      if (expired) expired.checked = false;

      // Not Already Awarded
      const notAwarded = document.querySelector("#Main_rbAwarded_2");
      if (notAwarded) notAwarded.checked = true;

      // Date — Selected (default) or Last 30 days
      if (useLast30) {
        const date30 = document.querySelector("#Main_rbDateRange_3");
        if (date30) date30.checked = true;
        const dateSelected = document.querySelector("#Main_rbDateRange_0");
        if (dateSelected) dateSelected.checked = false;
      }

      // Supplier Restrictions: COTS = "C"
      const supRestrict = document.querySelector(
        "#Main_DropDownList_SupRestrict",
      );
      if (supRestrict) supRestrict.value = "C";

      // JCP: No JCP Cert. = "N"
      const jcp = document.querySelector("#Main_DropDownListJCP");
      if (jcp) jcp.value = "N";

      // FSC field
      const nsnField = document.querySelector("#Main_NSN_Search");
      if (nsnField) nsnField.value = fscVal;
    },
    fsc,
    last30,
  );

  info(
    `✅ Fields set — FSC: ${fsc || "none"} | Date: ${last30 ? "Last 30 days" : "Selected"} | COTS | No JCP`,
  );
}

// ── APPLY SELECTIONS ─────────────────────────────────────────────────
async function applySelections(page) {
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
}

// ── SORT + SCRAPE FIRST PAGE ──────────────────────────────────────────
async function sortAndScrape(page, label) {
  info("Sorting by Extended Price...");
  await new Promise((r) => setTimeout(r, 1000));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.evaluate(function () {
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
    info("Ascending — sorting again...");
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

  const sols = await page.evaluate(
    (colMap, minPrice, label) => {
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
          pass_label: label,
          scraped_at: new Date().toISOString(),
        });
      }
      return results;
    },
    COL,
    CONFIG.minExtPrice,
    label,
  );

  info(`✅ Scraped ${sols.length} sols (${label})`);
  return sols;
}

// ── NAVIGATE TO SEARCH PAGE ───────────────────────────────────────────
async function goToSearchPage(page) {
  await new Promise((r) => setTimeout(r, 500));
  await page.goto("https://dibbsnavigator.com/dn.aspx", {
    waitUntil: "load",
    timeout: 120000,
  });
  await new Promise((r) => setTimeout(r, 2000));
  await page.waitForSelector("#btnFullDN", { timeout: 30000 });

  // Dismiss yellow popup
  await page.evaluate(() => {
    const btn = document.querySelector("#Button111");
    if (btn) btn.click();
  });
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
}

// ── MAIN ──────────────────────────────────────────────────────────────
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

    // ── LOGIN ─────────────────────────────────────────────────────────
    info("Navigating to login...");
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
      throw new Error("Login failed");
    }
    info("✅ Login successful");

    // ── PHASE 1: Today — broad ────────────────────────────────────────
    info("\n── PHASE 1: Today — broad ──");
    await goToSearchPage(page);
    await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
    await setFormFields(page, { last30: false });
    await applySelections(page);
    const pass1 = await sortAndScrape(page, "Today (broad)");

    // Save immediately
    const p1Date = new Date().toISOString().split("T")[0];
    const p1Path = path.join(
      CONFIG.backupDir,
      `navigator-pass1-${p1Date}.json`,
    );
    fs.writeFileSync(p1Path, JSON.stringify(pass1, null, 2));
    info(`✅ Pass 1 saved (${pass1.length} sols): ${p1Path}`);

    // ── PHASE 2: Last 30 days — per FSC ──────────────────────────────
    info("\n── PHASE 2: Last 30 days — per FSC ──");
    const pass2Sols = [];
    const seen = new Set(pass1.map((s) => s.sol_number));

    for (let i = 0; i < CONFIG.fscLanes.length; i++) {
      const fsc = CONFIG.fscLanes[i];
      info(`\n── FSC ${i + 1}/${CONFIG.fscLanes.length}: ${fsc} ──`);
      try {
        await goToSearchPage(page);
        await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
        await setFormFields(page, { fsc, last30: true });
        await applySelections(page);
        const fscSols = await sortAndScrape(page, `Last 30 days FSC ${fsc}`);
        const newSols = fscSols.filter((s) => !seen.has(s.sol_number));
        newSols.forEach((s) => seen.add(s.sol_number));
        pass2Sols.push(...newSols);
        info(
          `   +${newSols.length} new from FSC ${fsc} (${fscSols.length} on page)`,
        );
      } catch (e) {
        fail(`FSC ${fsc} failed: ${e.message} — skipping`);
      }
    }

    await browser.close();

    const allSols = [...pass1, ...pass2Sols];
    info(
      `\n✅ COMPLETE — Pass 1: ${pass1.length} | Pass 2: ${pass2Sols.length} | Total: ${allSols.length}`,
    );

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
      pass2: pass2Sols.length,
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

module.exports = { scrapeNavigatorBatch, CONFIG };

if (require.main === module) {
  (async () => {
    const result = await scrapeNavigatorBatch();
    console.log("\n=== NAVIGATOR BATCH RESULT ===");
    if (result.ok) {
      console.log("✅ Total sols:", result.count);
      console.log("   Pass 1 (today):", result.pass1);
      console.log("   Pass 2 (per-FSC):", result.pass2);
      console.log("   Backup:", result.backupPath);
    } else {
      console.log("❌ Failed:", result.error);
    }
  })();
}
