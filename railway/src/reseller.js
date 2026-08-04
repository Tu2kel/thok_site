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
    const cageRe = /^[A-Z0-9]{5}$/i;
    // The results grid = the table with the most CAGE-shaped rows (robust to a
    // smaller filtered set no longer being the physically largest table, and to
    // nested layout tables). Score every table by direct-child CAGE cells.
    let best = null, bestScore = 0;
    document.querySelectorAll("table").forEach(t => {
      let score = 0;
      t.querySelectorAll(":scope > tbody > tr, :scope > tr").forEach(tr => {
        const cells = [...tr.children].filter(c => c.tagName === "TD" || c.tagName === "TH");
        if (cells.some(c => cageRe.test((c.innerText || "").trim()))) score++;
      });
      if (score > bestScore) { bestScore = score; best = t; }
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

    // Sort by CAGE (unique key) so Page$N returns DISJOINT slices. Without a
    // stable ORDER BY the GridView re-queries in arbitrary order each postback,
    // making pages overlap heavily. Clicking the CAGE header once fixes ordering.
    const firstBeforeSort = (await scrapeGrid(page))[0]?.cage || "";
    const sorted = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(x => /Sort\$Cage/i.test(x.getAttribute("href") || ""));
      if (a) { a.click(); return true; }
      return false;
    });
    if (sorted) {
      for (let w = 0; w < 40; w++) {
        await new Promise(r => setTimeout(r, 500));
        const fc = (await scrapeGrid(page).catch(() => []))[0]?.cage || "";
        if (fc && fc !== firstBeforeSort) break;
      }
      info("sorted by CAGE for stable pagination");
    }

    // discover the pager postback target from any Page$ link + capture pager
    // anchors for diagnostics (their real href format tells us how to advance)
    const pagerInfo = await page.evaluate(() => {
      // capture ONLY the pager links (href references Page$N) — these are the
      // page-number anchors, wherever they sit in the DOM
      const pageAnchors = [...document.querySelectorAll("a")]
        .filter(a => /Page\$/i.test(a.getAttribute("href") || ""))
        .map(a => ({ text: (a.innerText || "").trim(), href: (a.getAttribute("href") || "").slice(0, 140) }));
      let target = null;
      for (const a of document.querySelectorAll("a")) {
        const h = a.getAttribute("href") || "";
        const m = h.match(/__doPostBack\(['"]([^'"]+)['"],\s*['"]Page\$/i);
        if (m) { target = m[1]; break; }
      }
      return { target, pageAnchors, doPostBackType: typeof window.__doPostBack };
    });
    const pagerTarget = pagerInfo.target;
    info("pager target=" + pagerTarget + " pageAnchors=" + JSON.stringify(pagerInfo.pageAnchors));

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
      // advance to next page. The GridView sits in an UpdatePanel, so
      // __doPostBack('...GridView1','Page$N') is an AJAX partial postback — no
      // navigation event, the grid just swaps in place. So fire it, then poll the
      // grid until the first row's CAGE changes (the new page loaded). Firing
      // Page$N beyond the last page reloads the same rows → no change → we stop.
      const before = rows[0]?.cage || "";
      const nextNum = pageNum + 1;
      // Prefer clicking the real page-number anchor (fires the site's own handler,
      // UpdatePanel-aware); fall back to a direct __doPostBack('...','Page$N').
      const how = await page.evaluate((next, tgt) => {
        const links = [...document.querySelectorAll("a")].filter(a => /Page\$/i.test(a.getAttribute("href") || ""));
        const numeric = links.find(a => (a.innerText || "").trim() === String(next));
        if (numeric) { numeric.click(); return "click-num"; }
        const dots = links.find(a => (a.innerText || "").trim() === "...");
        if (dots) { dots.click(); return "click-dots"; }
        if (tgt && window.__doPostBack) { window.__doPostBack(tgt, "Page$" + next); return "postback"; }
        return "none";
      }, nextNum, pagerTarget).catch(() => "err");
      let advanced = false;
      for (let w = 0; w < 40; w++) {           // up to ~28s for the partial postback
        await new Promise(r => setTimeout(r, 700));
        let firstCage = "";
        try { const g = await scrapeGrid(page); firstCage = g[0]?.cage || ""; } catch {}
        if (firstCage && firstCage !== before) { advanced = true; break; }
      }
      if (!advanced) break;
      if (pageNum + 1 > maxPages) { capped = true; }
      pageNum++;
    }
    if (pageNum > maxPages) capped = true;
    let diag = null;
    if (all.length === 0) {
      diag = await page.evaluate(() => {
        const tables = [...document.querySelectorAll("table")];
        return {
          url: location.href,
          table_count: tables.length,
          has_reseller_text: /reseller\s*opp/i.test(document.body.innerText),
          companies_text: (document.body.innerText.match(/([\d,]+)\s+Companies/i) || [])[0] || "",
          min_resell_value: document.querySelector("#Main_MinResell")?.value || "",
          biggest_table_first_rows: (() => {
            let b = null, m = 0; tables.forEach(t => { const r = t.querySelectorAll("tr").length; if (r > m) { m = r; b = t; } });
            if (!b) return [];
            return [...b.querySelectorAll("tr")].slice(0, 3).map(tr => [...tr.querySelectorAll("td,th")].map(c => (c.innerText || "").trim().slice(0, 25)));
          })(),
        };
      });
    }
    await browser.close();
    return { ok: true, count: all.length, pages: pageNum, capped, suppliers: all, diag, pagerInfo };
  } catch (e) {
    fail("scrape error:", e.message);
    try { await browser.close(); } catch {}
    return { ok: false, error: e.message, suppliers: [] };
  }
}

// RECON a supplier's "Details" — filter the Reseller Tool to one CAGE, click its
// Details link, dump whatever appears (looking for contact email/phone). This is
// the no-SAM contact source. Returns the detail panel's text + any links/inputs.
async function reconResellerDetail({ username, password, cage }) {
  const { browser, page } = await launchAndLogin(username, password);
  try {
    await page.goto("https://dibbsnavigator.com/suppliers.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#Main_Cage", { timeout: 30000 });
    await page.evaluate((c) => { const el = document.querySelector("#Main_Cage"); if (el) el.value = c; }, cage);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
      page.click("#Main_btnApply"),
    ]);
    await new Promise(r => setTimeout(r, 1500));
    const beforeText = await page.evaluate(() => document.body.innerText.length);
    // click the Details link (row anchor whose postback target ends in $Cage)
    const clicked = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(x => (x.innerText || "").trim() === "Details");
      if (a) { a.click(); return true; }
      return false;
    });
    // details may open a modal/panel (partial postback) or navigate — wait for change
    for (let w = 0; w < 20; w++) {
      await new Promise(r => setTimeout(r, 600));
      const now = await page.evaluate(() => document.body.innerText.length);
      if (Math.abs(now - beforeText) > 40) break;
    }
    const dump = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const emails = (bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).slice(0, 10);
      const phones = (bodyText.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || []).slice(0, 10);
      // any visible modal/panel text (look for a container that appeared)
      const panels = [...document.querySelectorAll("div,td")].filter(d => /contact|email|phone|willing|address/i.test(d.innerText) && d.innerText.length < 600)
        .slice(0, 5).map(d => d.innerText.replace(/\s+/g, " ").trim().slice(0, 300));
      return { url: location.href, clickedDetails: true, emails, phones, panels, bodyLen: bodyText.length };
    });
    await browser.close();
    return { ok: true, cage, clicked, ...dump };
  } catch (e) {
    fail("detail recon error:", e.message);
    try { await browser.close(); } catch {}
    return { ok: false, error: e.message };
  }
}

module.exports = { reconResellerTool, scrapeResellerTool, reconResellerDetail, launchAndLogin };
