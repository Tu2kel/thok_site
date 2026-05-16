// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — DIBBS NAVIGATOR SCRAPER v3.0
//
// PHASE 1 — Today, broad, first page only:
//   1. Login
//   2. Dismiss yellow popup
//   3. Filter Set: None (postback — resets form)
//   4. Com. Pack checkbox
//   5. Not Expired checkbox
//   6. Not Already Awarded radio
//   7. Supplier Restrictions: COTS (dropdown, no postback)
//   8. JCP: No JCP Cert. (dropdown, no postback)
//   9. Apply Selections (postback — loads results)
//  10. Sort Extended Price HIGH→LOW
//  11. Scrape first page, stop at $1000 floor
//
// PHASE 2 — Last 30 days, per-FSC, first page each:
//   1. Last 30 days radio (no postback)
//   2. Type FSC into NSN/FSC field
//   3. Apply Selections (postback)
//   4. Sort + scrape first page
//   5. Clear FSC field via Clear button (#btnClearNSN_PartNo1)
//   6. Type next FSC → repeat
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

const info = (...a) => console.log("[navigator-scraper]", ...a);
const fail = (...a) => console.error("[navigator-scraper] ❌", ...a);

// ── COLUMN MAP ───────────────────────────────────────────────────────────
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

async function clickRadio(page, selector, causesPostback = false) {
  if (causesPostback) {
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 })
        .catch(() => {}),
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      }, selector),
    ]);
    await new Promise((r) => setTimeout(r, 500));
  } else {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ── SORT + SCRAPE — called after results are loaded ───────────────────────
async function sortAndScrape(page, label) {
  // Sort Extended Price desc
  info(`Sorting by Extended Price...`);
  await new Promise((r) => setTimeout(r, 1500));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.evaluate(function () {
      (function () {
        __doPostBack("ctl00$Main$GridView1", "Sort$Extended");
      })();
    }),
  ]);

  // Check direction — if ascending, click again
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

// ── APPLY SELECTIONS ─────────────────────────────────────────────────────
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

    // ── LOGIN ─────────────────────────────────────────────────────────
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

    await page.waitForSelector("#btnFullDN", { timeout: 120000 });

    // ── PHASE 1 SETUP ─────────────────────────────────────────────────
    info("\n── PHASE 1: Today — broad ──");

    // Step 2: Dismiss yellow popup
    await page.evaluate(() => {
      const btn = document.querySelector("#Button111");
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
    info("✅ Popup dismissed");

    // Step 3: Filter Set: None — triggers postback, resets form
    await clickRadio(page, "#Main_rbDefaultSets_4", true);
    await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
    info("✅ Filter set: None");

    // Step 4: Com. Pack
    await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
    await page.evaluate(() => {
      const cb = document.querySelector("#Main_chCPac");
      if (cb && !cb.checked) cb.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    info("✅ Com. Pack");

    // Step 5: Not Expired
    await ensureChecked(page, "#Main_chNotExpired");
    await ensureUnchecked(page, "#Main_chExpired");
    info("✅ Not Expired");

    // Step 6: Not Already Awarded
    await clickRadio(page, "#Main_rbAwarded_2", false);
    info("✅ Not Already Awarded");

    // Step 7: Supplier Restrictions: COTS
    await page.waitForSelector("#Main_DropDownList_SupRestrict", {
      timeout: 30000,
    });
    await page.select("#Main_DropDownList_SupRestrict", "COTS");
    await new Promise((r) => setTimeout(r, 500));
    info("✅ Supplier Restrictions: COTS");

    // Step 8: JCP: No JCP Cert.
    await page.waitForSelector("#Main_DropDownListJCP", { timeout: 30000 });
    await page.select("#Main_DropDownListJCP", "No JCP Cert.");
    await new Promise((r) => setTimeout(r, 500));
    info("✅ JCP: No JCP Cert.");

    // Step 9: Apply Selections
    await applySelections(page);

    // Step 10+11: Sort + scrape
    const pass1 = await sortAndScrape(page, "Today (broad)");

    // Save pass1 immediately
    const p1Timestamp = new Date().toISOString().split("T")[0];
    const p1BackupPath = path.join(
      CONFIG.backupDir,
      `navigator-pass1-${p1Timestamp}.json`,
    );
    fs.writeFileSync(p1BackupPath, JSON.stringify(pass1, null, 2));
    info(`✅ Pass 1 saved (${pass1.length} sols): ${p1BackupPath}`);

    // ── PHASE 2: Last 30 days, per-FSC ───────────────────────────────
    info("\n── PHASE 2: Last 30 days — per FSC lane ──");

    const pass2Sols = [];
    const seen = new Set(pass1.map((s) => s.sol_number));

    for (let i = 0; i < CONFIG.fscLanes.length; i++) {
      const fsc = CONFIG.fscLanes[i];
      info(`\n── FSC LANE ${i + 1}/${CONFIG.fscLanes.length}: ${fsc} ──`);
      try {
        // Navigate fresh for each FSC lane — ensures clean form state
        await new Promise((r) => setTimeout(r, 1000));
        await page.goto("https://dibbsnavigator.com/dn.aspx", {
          waitUntil: "load",
          timeout: 120000,
        });
        await new Promise((r) => setTimeout(r, 2000));
        await page.waitForSelector("#btnFullDN", { timeout: 30000 });

        // Dismiss popup if present
        await page.evaluate(() => {
          const btn = document.querySelector("#Button111");
          if (btn) btn.click();
        });
        await page.keyboard.press("Escape");
        await new Promise((r) => setTimeout(r, 300));

        // Filter Set: None — postback resets form
        await clickRadio(page, "#Main_rbDefaultSets_4", true);
        await page.waitForSelector("#Main_chCPac", { timeout: 30000 });
        info("✅ Filter set: None");

        // Com. Pack
        await page.evaluate(() => {
          const cb = document.querySelector("#Main_chCPac");
          if (cb && !cb.checked) cb.click();
        });
        info("✅ Com. Pack");

        // Not Expired
        await ensureChecked(page, "#Main_chNotExpired");
        await ensureUnchecked(page, "#Main_chExpired");
        info("✅ Not Expired");

        // Not Already Awarded
        await clickRadio(page, "#Main_rbAwarded_2", false);
        info("✅ Not Already Awarded");

        // Last 30 days
        await clickRadio(page, "#Main_rbDateRange_3", false);
        info("✅ Date: Last 30 days");

        // Supplier Restrictions: COTS
        await page.waitForSelector("#Main_DropDownList_SupRestrict", {
          timeout: 30000,
        });
        await page.select("#Main_DropDownList_SupRestrict", "COTS");
        await new Promise((r) => setTimeout(r, 300));
        info("✅ Supplier Restrictions: COTS");

        // JCP: No JCP Cert.
        await page.waitForSelector("#Main_DropDownListJCP", { timeout: 30000 });
        await page.select("#Main_DropDownListJCP", "No JCP Cert.");
        await new Promise((r) => setTimeout(r, 300));
        info("✅ JCP: No JCP Cert.");

        // Type FSC last — after all postback-triggering steps
        await page.waitForSelector("#Main_NSN_Search", { timeout: 30000 });
        const fscInput = await page.$("#Main_NSN_Search");
        if (fscInput) {
          await fscInput.click({ clickCount: 3 });
          await page.keyboard.press("Backspace");
          await fscInput.type(fsc, { delay: 40 });
          await new Promise((r) => setTimeout(r, 300));
          info(`✅ FSC set: ${fsc}`);
        }

        // Apply Selections
        await applySelections(page);

        // Sort + scrape
        const fscSols = await sortAndScrape(page, `Last 30 days FSC ${fsc}`);
        const newSols = fscSols.filter((s) => !seen.has(s.sol_number));
        newSols.forEach((s) => seen.add(s.sol_number));
        pass2Sols.push(...newSols);
        info(
          `   +${newSols.length} new from FSC ${fsc} (${fscSols.length} on page)`,
        );
      } catch (fscErr) {
        fail(`FSC ${fsc} failed: ${fscErr.message} — skipping`);
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
      console.log("   Pass 2 (per-FSC):", result.pass2);
      console.log("   Backup:", result.backupPath);
    } else {
      console.log("❌ Failed:", result.error);
    }
  })();
}
