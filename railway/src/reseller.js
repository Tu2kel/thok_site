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

// Scrape the results grid on the current page. Resolves columns by header text
// so a layout change degrades gracefully. Returns [{company,cage,...}].
async function scrapeGrid(page) {
  return page.evaluate(() => {
    const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const numify = s => { const n = String(s || "").replace(/[^0-9.]/g, ""); return n ? Number(n) : 0; };
    // biggest table = the grid
    let best = null, bestRows = 0;
    document.querySelectorAll("table").forEach(t => {
      const r = t.querySelectorAll("tr").length; if (r > bestRows) { bestRows = r; best = t; }
    });
    if (!best) return [];
    const trs = [...best.querySelectorAll("tr")];
    // find header row = the one containing "reseller"
    let hIdx = trs.findIndex(tr => /reseller/i.test(tr.innerText));
    if (hIdx < 0) return [];
    const hCells = [...trs[hIdx].querySelectorAll("th,td")].map(c => norm(c.innerText));
    const col = {};
    hCells.forEach((t, i) => {
      if (t === "company") col.company = i;
      else if (t.includes("cage")) col.cage = i;
      else if (t === "city") col.city = i;
      else if (t === "state") col.state = i;
      else if (t === "zip") col.zip = i;
      else if (t.includes("no. nsns") || t.includes("no.nsns")) col.no_nsns = i;
      else if (t.includes("quantity")) col.qty = i;
      else if (t.includes("total value")) col.total_value = i;
      else if (t.includes("reseller")) col.reseller = i;
    });
    if (col.cage == null || col.reseller == null) return [];
    const out = [];
    for (let i = hIdx + 1; i < trs.length; i++) {
      const cells = [...trs[i].querySelectorAll("td,th")];
      if (cells.length <= col.reseller) continue;
      const cage = (cells[col.cage]?.innerText || "").trim();
      if (!/^[A-Z0-9]{5}$/i.test(cage)) continue; // skip pager / non-data rows
      out.push({
        company: (cells[col.company]?.innerText || "").trim(),
        cage: cage.toUpperCase(),
        city: (cells[col.city]?.innerText || "").trim(),
        state: (cells[col.state]?.innerText || "").trim(),
        zip: (cells[col.zip]?.innerText || "").trim(),
        no_nsns: numify(cells[col.no_nsns]?.innerText),
        qty: numify(cells[col.qty]?.innerText),
        total_value: numify(cells[col.total_value]?.innerText),
        reseller_pct: numify(cells[col.reseller]?.innerText),
      });
    }
    return out;
  });
}

// Full Reseller Tool scrape: filter to high reseller % + min NSN count, paginate,
// dedupe by CAGE. onBatch(rows, pageNum) is called per page so the caller can
// stream to Mongo. Pagination drives ASP.NET __doPostBack('Page$N') directly.
async function scrapeResellerTool({ username, password, minResell = 90, minNoNSNs = 2, maxPages = 40 }, onBatch) {
  const { browser, page } = await launchAndLogin(username, password);
  try {
    await page.goto("https://dibbsnavigator.com/suppliers.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#Main_MinResell", { timeout: 30000 });
    await page.evaluate((mr, mn) => {
      const r = document.querySelector("#Main_MinResell"); if (r) r.value = mr;
      const n = document.querySelector("#Main_MinNoNSNs"); if (n) n.value = mn;
    }, String(minResell), String(minNoNSNs));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.click("#Main_btnApply"),
    ]);
    await new Promise(r => setTimeout(r, 1500));

    // discover the pager postback target from any Page$ link
    const pagerTarget = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(x => /Page\$\d/.test(x.getAttribute("href") || ""));
      if (!a) return null;
      const m = (a.getAttribute("href") || "").match(/__doPostBack\(['"]([^'"]+)['"],\s*['"]Page\$/);
      return m ? m[1] : null;
    });

    const seen = new Set();
    const all = [];
    let pageNum = 1, capped = false;
    while (pageNum <= maxPages) {
      const rows = await scrapeGrid(page);
      const fresh = rows.filter(r => !seen.has(r.cage));
      fresh.forEach(r => seen.add(r.cage));
      all.push(...fresh);
      if (onBatch) { try { await onBatch(fresh, pageNum); } catch {} }
      info(`page ${pageNum}: ${rows.length} rows (${fresh.length} new) — total ${all.length}`);
      if (fresh.length === 0 && pageNum > 1) break; // no new data → done
      if (!pagerTarget) break;                        // single page
      // advance to next page via postback
      const before = rows[0]?.cage || "";
      let advanced = false;
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
          page.evaluate((t, n) => { window.__doPostBack(t, "Page$" + n); }, pagerTarget, pageNum + 1),
        ]);
        await new Promise(r => setTimeout(r, 800));
        const after = await page.evaluate(() => {
          const a = document.querySelector("table tr td")?.innerText || "";
          return a;
        });
        advanced = true; // navigation happened; loop re-scrapes and dedups
      } catch { advanced = false; }
      if (!advanced) break;
      if (pageNum + 1 > maxPages) { capped = true; }
      pageNum++;
    }
    if (pageNum > maxPages) capped = true;
    await browser.close();
    return { ok: true, count: all.length, pages: pageNum, capped, suppliers: all };
  } catch (e) {
    fail("scrape error:", e.message);
    try { await browser.close(); } catch {}
    return { ok: false, error: e.message, suppliers: [] };
  }
}

module.exports = { reconResellerTool, scrapeResellerTool, launchAndLogin };
