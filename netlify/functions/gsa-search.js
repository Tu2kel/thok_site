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

// Build GSA Advantage search URL
// q=0:8{term} searches product descriptions; q=1:8{term} searches part numbers
function gsaUrl(term, mode = "desc") {
  const prefix = mode === "part" ? "1:8" : "0:8";
  return `https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=${prefix}${encodeURIComponent(term)}&db=0&searchType=0&perPage=10`;
}

// Parse GSA response — handles both XML and JSON-ish formats GSA returns
function parseGSA(text) {
  const results = [];
  if (!text || text.length < 50) return results;

  // GSA returns items wrapped in <item> or similar tags with product details
  // Extract contractor/company names — they appear as CAGE-registered companies
  const contractorPattern = /<contractor[^>]*>([^<]{3,80})<\/contractor>/gi;
  const namePattern = /<name[^>]*>([^<]{3,120})<\/name>/gi;
  const pricePattern =
    /<(?:unitPrice|price)[^>]*>([\d.]+)<\/(?:unitPrice|price)>/gi;
  const partPattern =
    /<(?:partNum|mfgPartNum|partNumber)[^>]*>([^<]{2,40})<\/(?:partNum|mfgPartNum|partNumber)>/gi;
  const descPattern =
    /<(?:description|longDescription|title)[^>]*>([^<]{5,200})<\/(?:description|longDescription|title)>/gi;
  const urlPattern =
    /<(?:productUrl|url|link)[^>]*>([^<]{10,300})<\/(?:productUrl|url|link)>/gi;

  // Also handle plain-text/JSON responses from newer GSA endpoints
  const jsonPricePattern = /"(?:unitPrice|price)"\s*:\s*([\d.]+)/g;
  const jsonNamePattern =
    /"(?:description|title|productName)"\s*:\s*"([^"]{5,200})"/g;
  const jsonContractorPattern =
    /"(?:contractor|company|vendor)"\s*:\s*"([^"]{3,80})"/g;
  const jsonPartPattern =
    /"(?:partNum|mfgPartNum|partNumber)"\s*:\s*"([^"]{2,40})"/g;

  const contractors = [];
  const names = [];
  const prices = [];
  const parts = [];
  const urls = [];

  let m;

  // XML extraction
  while ((m = contractorPattern.exec(text)) !== null)
    contractors.push(m[1].trim());
  while ((m = namePattern.exec(text)) !== null) names.push(m[1].trim());
  while ((m = pricePattern.exec(text)) !== null) prices.push(parseFloat(m[1]));
  while ((m = partPattern.exec(text)) !== null) parts.push(m[1].trim());
  while ((m = urlPattern.exec(text)) !== null) urls.push(m[1].trim());

  // JSON extraction (fallback)
  if (!names.length) {
    while ((m = jsonNamePattern.exec(text)) !== null) names.push(m[1].trim());
    while ((m = jsonContractorPattern.exec(text)) !== null)
      contractors.push(m[1].trim());
    while ((m = jsonPricePattern.exec(text)) !== null)
      prices.push(parseFloat(m[1]));
    while ((m = jsonPartPattern.exec(text)) !== null) parts.push(m[1].trim());
  }

  // Also try description pattern if name came up empty
  if (!names.length) {
    while ((m = descPattern.exec(text)) !== null) names.push(m[1].trim());
  }

  // Fallback: scrape any dollar amounts and surrounding company-like text
  if (!names.length && !prices.length) {
    const dollarPattern = /\$([\d,]+\.\d{2})/g;
    while ((m = dollarPattern.exec(text)) !== null) {
      prices.push(parseFloat(m[1].replace(/,/g, "")));
    }
  }

  const count = Math.max(names.length, contractors.length, prices.length);
  const limit = Math.min(count, 8);

  for (let i = 0; i < limit; i++) {
    const name = names[i] || contractors[i] || "GSA Item";
    if (name.toLowerCase().includes("javascript") || name.length < 3) continue;
    results.push({
      name,
      contractor: contractors[i] || null,
      partNo: parts[i] || null,
      price: prices[i] || null,
      url: urls[i] || null,
      sources: null,
    });
  }

  // Last resort — at least confirm something is on schedule
  if (!results.length && text.length > 200 && !text.includes("No results")) {
    const hasContent =
      text.includes("$") || text.includes("price") || text.includes("contract");
    if (hasContent) {
      results.push({
        name: "GSA Schedule Items Found — Open link to view",
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
