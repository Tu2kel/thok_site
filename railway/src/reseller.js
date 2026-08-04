// Reseller Tool scraper — dibbsnavigator.com/suppliers.aspx
//
// The Reseller Tool lists every company DLA identified as a designated supplier
// for one or more NSNs in a recent 180-day window, WITH a "Reseller Opp %" —
// the share of times that company resells to a 3rd party instead of selling
// direct to DLA. High % = a supplier that, by track record, sells to resellers
// like us. Filtering to high % turns the OEM-lock problem on its head: instead
// of per-NSN designated suppliers (mostly primes that never quote us), we get
// the willing sellers first, then match them to the NSNs we bid.
//
// Field IDs on suppliers.aspx are unknown until recon — resolveResellerForm()
// discovers them by label so a Navigator layout change degrades gracefully
// instead of silently mis-clicking.

const puppeteer = require("puppeteer-core");
const fs = require("fs");

function info(...a) { console.log("[reseller]", ...a); }
function fail(...a) { console.error("[reseller]", ...a); }

function findChromium() {
  const c = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  return c.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || c[0];
}

async function launchAndLogin(username, password) {
  const executablePath = findChromium();
  info("Launching Chromium at " + executablePath + "…");
  const browser = await puppeteer.launch({
    headless: true, executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-notifications", "--disable-infobars", "--disable-extensions",
      "--disable-popup-blocking", "--deny-permission-prompts",
      "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("https://dibbsnavigator.com/login.aspx", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  if (!(await page.$("#Main_Input_Customer_Name"))) {
    await page.goto("https://dibbsnavigator.com/login.aspx?cc=true", { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.waitForSelector("#Main_Input_Customer_Name", { timeout: 30000 });
  await page.type("#Main_Input_Customer_Name", username, { delay: 60 });
  await page.type("#Main_Input_Password", password, { delay: 60 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
    page.click("#Main_btnCustOK"),
  ]);
  if (page.url().includes("login.aspx")) throw new Error("Navigator login failed — check credentials");
  info("✅ Login successful");
  return { browser, page };
}

// RECON — dump the suppliers.aspx form + table structure so the real scrape can
// be wired to the correct field IDs. Returns a plain object (no scraping logic).
async function reconResellerTool({ username, password }) {
  const { browser, page } = await launchAndLogin(username, password);
  try {
    await page.goto("https://dibbsnavigator.com/suppliers.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
    await new Promise(r => setTimeout(r, 2500));
    const dump = await page.evaluate(() => {
      const near = (el) => {
        // best-effort label: preceding cell text, previous sibling text, or aria-label
        let t = "";
        const td = el.closest("td");
        if (td && td.previousElementSibling) t = td.previousElementSibling.innerText.trim();
        if (!t && el.previousElementSibling) t = (el.previousElementSibling.innerText || "").trim();
        if (!t) t = el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
        return t.slice(0, 40);
      };
      const fields = [];
      document.querySelectorAll("input, select, textarea").forEach(el => {
        fields.push({ tag: el.tagName, type: el.type || "", id: el.id || "", name: el.name || "", label: near(el) });
      });
      const buttons = [];
      document.querySelectorAll("input[type=button], input[type=submit], button, a.btn").forEach(el => {
        buttons.push({ id: el.id || "", name: el.name || "", value: el.value || el.innerText || "" });
      });
      // Find the biggest table (the results grid) and dump header + first 2 rows
      let best = null, bestRows = 0;
      document.querySelectorAll("table").forEach(t => {
        const rows = t.querySelectorAll("tr").length;
        if (rows > bestRows) { bestRows = rows; best = t; }
      });
      let header = [], sample = [];
      if (best) {
        const trs = best.querySelectorAll("tr");
        if (trs[0]) header = [...trs[0].querySelectorAll("th,td")].map(c => c.innerText.trim().slice(0, 30));
        for (let i = 1; i < Math.min(3, trs.length); i++) {
          sample.push([...trs[i].querySelectorAll("td,th")].map(c => c.innerText.trim().slice(0, 30)));
        }
      }
      // count text near "Companies" (e.g. "7,705 Companies")
      const bodyText = document.body.innerText;
      const m = bodyText.match(/([\d,]+)\s+Companies/i);
      return { url: location.href, fields, buttons, tableRowCount: bestRows, header, sample, companiesText: m ? m[0] : "" };
    });
    await browser.close();
    return { ok: true, ...dump };
  } catch (e) {
    fail("recon error:", e.message);
    try { await browser.close(); } catch {}
    return { ok: false, error: e.message };
  }
}

module.exports = { reconResellerTool, launchAndLogin };
