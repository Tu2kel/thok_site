// netlify/functions/gsa-search.js
// Imperio SCC — GSA Advantage Search
// Fires automatically when catalog-search returns allNotFound=true.
// POST body: { manufacturer: "Oakley Inc", pn: "OO9452-0965", nsn: "4240017017266" }
// Returns: { ok, found, results: [{name, partNo, price, contractor, url}] }
//
// Strategy: GSA Advantage has a JSON search API at /advantage/ws/search/advantage_search
// It returns XML-ish content. We try 3 queries in sequence: pn → nsn → mfr name.
// First one that returns results wins. No proxy params — those cause 400 on free/basic tier.

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Clean manufacturer name for search — strip legal suffixes, take first 2 words max
function cleanMfr(raw) {
  return (raw || "")
    .replace(
      /\b(inc|llc|corp|co|ltd|company|group|industries|international|mfg|manufacturing|defense|systems|technologies|solutions)\b\.?/gi,
      "",
    )
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();
}

// Build GSA Advantage search URL — uses the actual search page, not the dead WS endpoint
function gsaUrl(term, mode = "desc") {
  // Both desc and part searches use the same endpoint — GSA's keyword search handles both
  return `https://www.gsaadvantage.gov/advantage/search/search_for_asc.do?q=${encodeURIComponent(term)}&db=0&searchType=0`;
}

// Parse GSA HTML search results page
function parseGSA(text) {
  const results = [];
  if (!text || text.length < 100) return results;

  // GSA search results page structure — contractor names appear in links and table cells
  // Pattern: product names in <a> tags, prices as dollar amounts, contractors in td cells

  // Extract product/contractor names from result links
  const linkPattern =
    /<a[^>]+href="[^"]*advantage[^"]*"[^>]*>([^<]{5,120})<\/a>/gi;
  // Extract any dollar prices
  const pricePattern = /\$\s*([\d,]+\.?\d{0,2})/g;
  // Extract company/contractor names — typically all-caps or title case followed by "Inc" etc
  const companyPattern =
    /([A-Z][A-Za-z\s&,\.]{4,60}(?:Inc|LLC|Corp|Co|Ltd|Company|Group|Industries|Supply|Systems|Technologies|Solutions)\.?)/g;
  // Extract part numbers from table cells
  const partPattern =
    /(?:Part(?:\s+No\.?|Number)?|P\/N|MFR#|Mfg#)[:\s]+([A-Z0-9][A-Z0-9\-\.]{2,30})/gi;

  const links = [];
  const prices = [];
  const companies = [];
  const parts = [];

  let m;
  while ((m = linkPattern.exec(text)) !== null) {
    const t = m[1].trim();
    if (t.length > 4 && !t.toLowerCase().includes("javascript")) links.push(t);
  }
  while ((m = pricePattern.exec(text)) !== null)
    prices.push(parseFloat(m[1].replace(/,/g, "")));
  while ((m = companyPattern.exec(text)) !== null) {
    const c = m[1].trim();
    if (c.length > 5) companies.push(c);
  }
  while ((m = partPattern.exec(text)) !== null) parts.push(m[1].trim());

  // Deduplicate companies
  const uniqueCompanies = [...new Set(companies)].slice(0, 8);
  const uniqueLinks = [...new Set(links)].slice(0, 8);

  const count = Math.max(uniqueLinks.length, uniqueCompanies.length);
  const limit = Math.min(count, 8);

  for (let i = 0; i < limit; i++) {
    const name = uniqueLinks[i] || uniqueCompanies[i] || null;
    if (!name) continue;
    results.push({
      name,
      contractor: uniqueCompanies[i] || null,
      partNo: parts[i] || null,
      price: prices[i] || null,
      url: null,
      sources: null,
    });
  }

  // Fallback — if page loaded but we couldn't parse structure, at least confirm it returned content
  if (!results.length) {
    const hasProducts =
      text.includes("Add to Cart") ||
      text.includes("GSA") ||
      text.includes("contract") ||
      text.includes("schedule");
    const noResults =
      text.includes("No results") ||
      text.includes("0 results") ||
      text.includes("no items found");
    if (hasProducts && !noResults) {
      results.push({
        name: "GSA Schedule Items Found — click Open GSA to view",
        contractor: null,
        partNo: null,
        price: null,
        url: null,
        sources: null,
      });
    }
  }

  return results;
}

// Single Browserless fetch — NO proxy params (causes 400 on non-enterprise tier)
async function browserlessFetch(targetUrl, apiKey) {
  const res = await fetch(
    `https://production-sfo.browserless.io/content?token=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        waitFor: 2000,
      }),
      signal: AbortSignal.timeout(18000),
    },
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Browserless ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "BROWSERLESS_API_KEY not configured" }),
    };
  }

  let manufacturer, pn, nsn;
  try {
    ({ manufacturer, pn, nsn } = JSON.parse(event.body));
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!manufacturer && !pn && !nsn) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "manufacturer, pn, or nsn required" }),
    };
  }

  console.log(
    "gsa-search: manufacturer=",
    manufacturer,
    "pn=",
    pn,
    "nsn=",
    nsn,
  );

  // Build query sequence — try P/N first (most specific), then NSN, then mfr name
  const queries = [];
  if (pn) queries.push({ term: pn, mode: "part", label: "part_number" });
  if (nsn)
    queries.push({ term: nsn.replace(/-/g, ""), mode: "part", label: "nsn" });
  if (manufacturer) {
    const cleaned = cleanMfr(manufacturer);
    if (cleaned)
      queries.push({ term: cleaned, mode: "desc", label: "manufacturer" });
  }

  let results = [];
  let usedQuery = null;
  let usedUrl = null;
  let lastError = null;

  // Try each query in sequence — stop at first hit
  for (const q of queries) {
    const url = gsaUrl(q.term, q.mode);
    console.log(`gsa-search: trying ${q.label} query:`, url);
    try {
      const html = await browserlessFetch(url, apiKey);
      console.log(`gsa-search: got ${html.length} chars for ${q.label}`);
      const parsed = parseGSA(html);
      if (parsed.length > 0) {
        results = parsed;
        usedQuery = q;
        usedUrl = url;
        console.log(
          `gsa-search: found ${parsed.length} results via ${q.label}`,
        );
        break;
      }
    } catch (err) {
      console.error(`gsa-search: ${q.label} query failed:`, err.message);
      lastError = err.message;
      // Continue to next query
    }
  }

  // Build open-in-browser URL for UI — use mfr name search as fallback link
  const openUrl =
    usedUrl ||
    (manufacturer
      ? `https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=0:8${encodeURIComponent(cleanMfr(manufacturer))}&db=0&searchType=0`
      : `https://www.gsaadvantage.gov/advantage/main/home.do`);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ok: true,
      manufacturer: manufacturer || null,
      pn: pn || null,
      nsn: nsn || null,
      usedQuery: usedQuery?.label || null,
      gsaUrl: openUrl,
      found: results.length > 0,
      results,
      error:
        results.length === 0
          ? lastError || "No GSA schedule items found"
          : null,
    }),
  };
};
