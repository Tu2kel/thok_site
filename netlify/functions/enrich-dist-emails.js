// netlify/functions/enrich-dist-emails.js
// Uses Browserless to scrape SBA Small Business Search for email addresses.
// Matches results to DB vendors by CAGE code or normalized company name.
// Env vars: BROWSERLESS_API_KEY, MONGODB_URI (via scc-distributors internal call)

const BROWSERLESS_URL = "https://chrome.browserless.io/function";
const DIST_API = "https://thehouseofkel.com/.netlify/functions/scc-distributors";

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Scraper function executed inside Browserless headless Chrome
const scraperFn = async ({ page, context }) => {
  const { naicsCode } = context;

  // SBA Small Business Search — filter Authorized Distributors + SDVOSB
  const BASE = "https://search.certifications.sba.gov/s/";
  const params = new URLSearchParams({
    t: "All",
    q: "",
    filters: JSON.stringify({
      BusinessType: ["Authorized Distributor"],
      SmallBusinessProgram: ["SDVOSB"],
      ...(naicsCode ? { NaicsCode: [naicsCode] } : {}),
    }),
  });

  await page.goto(BASE + "?" + params.toString(), { waitUntil: "networkidle2", timeout: 60000 });

  const results = [];
  let pageNum = 0;
  const MAX_PAGES = 10;

  while (pageNum < MAX_PAGES) {
    await page.waitForSelector(".search-result-item, .sba-c-result, [data-testid='result']", { timeout: 15000 }).catch(() => {});

    const items = await page.evaluate(() => {
      const found = [];
      const cards = document.querySelectorAll(
        ".search-result-item, .sba-c-result, .result-card, article[class*='result'], li[class*='result']"
      );
      cards.forEach((card) => {
        const text = card.innerText || "";
        const emailM = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
        const cageM  = text.match(/CAGE[:\s#]*([A-Z0-9]{5})/i) || text.match(/\b([A-Z][A-Z0-9]{4}|[0-9][A-Z0-9]{4})\b/);
        const nameEl = card.querySelector("h2,h3,[class*='company'],[class*='name']");
        found.push({
          name:  nameEl ? nameEl.textContent.trim() : "",
          cage:  cageM ? cageM[1].toUpperCase() : "",
          email: emailM ? emailM[0].toLowerCase() : "",
          raw:   text.slice(0, 400),
        });
      });
      return found;
    });

    results.push(...items.filter((i) => i.email));

    // Check for next page button
    const nextBtn = await page.$("button[aria-label*='next' i], a[aria-label*='next' i], .next-page");
    if (!nextBtn) break;
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}), nextBtn.click()]);
    pageNum++;
  }

  return results;
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const API_KEY = process.env.BROWSERLESS_API_KEY;
  if (!API_KEY) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "BROWSERLESS_API_KEY not set" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const { naicsCode } = body;

  try {
    // 1. Scrape SBA for emails
    const scrapeResp = await fetch(`${BROWSERLESS_URL}?token=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: scraperFn.toString(),
        context: { naicsCode: naicsCode || null },
      }),
    });

    if (!scrapeResp.ok) {
      const txt = await scrapeResp.text();
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: "Browserless error: " + txt.slice(0, 200) }) };
    }

    const scraped = await scrapeResp.json();
    if (!Array.isArray(scraped) || !scraped.length) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, matched: 0, total_scraped: 0, message: "No results with emails scraped" }),
      };
    }

    // 2. Get all vendors from DB
    const dbResp = await fetch(DIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "distGetAll", payload: {} }),
    });
    const dbData = await dbResp.json();
    const vendors = dbData.result || [];

    // 3. Match and update
    let matched = 0;
    const updates = [];

    for (const hit of scraped) {
      if (!hit.email) continue;

      // Match by CAGE first, then normalized name
      let vendor = hit.cage ? vendors.find((v) => (v.cage || "").toUpperCase() === hit.cage) : null;
      if (!vendor && hit.name) {
        const normHit = norm(hit.name);
        vendor = vendors.find((v) => norm(v.name) === normHit);
      }
      if (!vendor) continue;
      if (vendor.email && vendor.email.trim()) continue; // already has email

      // Update DB
      const updated = { ...vendor, email: hit.email };
      const saveResp = await fetch(DIST_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "distSave", payload: { record: updated } }),
      });
      const saveData = await saveResp.json();
      if (saveData.ok) {
        matched++;
        updates.push({ id: vendor.id, name: vendor.name, cage: vendor.cage, email: hit.email });
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        total_scraped: scraped.length,
        scraped_with_email: scraped.filter((s) => s.email).length,
        matched,
        updates,
      }),
    };
  } catch (e) {
    console.error("enrich-dist-emails error:", e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
