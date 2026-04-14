// netlify/functions/gsa-search.js
// Imperio SCC — GSA Advantage Manufacturer Search
// Fires automatically when catalog check returns all-NOT FOUND.
// POST body: { manufacturer: "Oakley Inc" }
// Returns: { ok, manufacturer, query, results: [{partNo, name, price, sources, url}] }
// Search pattern: manufacturer name stripped + lowercased
// URL: https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=0:8{name}&db=0&searchType=0

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Strip legal suffixes and clean manufacturer name for GSA search
function cleanManufacturerName(raw) {
  return raw
    .toLowerCase()
    .replace(/\b(inc|llc|corp|co|ltd|company|group|industries|international|mfg|manufacturing)\b\.?/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)[0]; // First meaningful word is usually enough
}

// Parse GSA Advantage HTML — extract product cards
function parseGSAResults(html) {
  const results = [];

  // Product name pattern — GSA renders as anchor links in product grid
  const productPattern = /<a[^>]+href="([^"]*advantag[^"]*)"[^>]*>([^<]{5,120})<\/a>/gi;
  // Price pattern
  const pricePattern = /\$\s*([\d,]+\.\d{2})/g;
  // Part number pattern — GSA shows Mfr part numbers
  const partPattern = /(?:Mfr[#\s:]+|Part[#\s:]+|Model[#\s:]+)([A-Z0-9\-]{3,30})/gi;
  // Source count
  const sourcePattern = /From\s+(\d+)\s+source/gi;

  // Extract prices from full page first
  const allPrices = [];
  let pm;
  while ((pm = pricePattern.exec(html)) !== null) {
    allPrices.push(parseFloat(pm[1].replace(/,/g, "")));
  }

  // Extract part numbers
  const allParts = [];
  let partm;
  while ((partm = partPattern.exec(html)) !== null) {
    allParts.push(partm[1]);
  }

  // Extract source counts
  const allSources = [];
  let sm;
  while ((sm = sourcePattern.exec(html)) !== null) {
    allSources.push(parseInt(sm[1]));
  }

  // Extract product links + names
  let match;
  let idx = 0;
  while ((match = productPattern.exec(html)) !== null && idx < 8) {
    const name = match[2].trim();
    if (name.length < 5 || name.toLowerCase().includes("javascript")) continue;

    const url = match[1].startsWith("http")
      ? match[1]
      : "https://www.gsaadvantage.gov" + match[1];

    results.push({
      name,
      partNo: allParts[idx] || null,
      price: allPrices[idx] || null,
      sources: allSources[idx] ? `${allSources[idx]} sources` : null,
      url,
    });
    idx++;
  }

  // Fallback: if product pattern found nothing, extract raw text price signals
  if (!results.length && allPrices.length > 0) {
    results.push({
      name: "GSA Schedule Items Found",
      partNo: allParts[0] || null,
      price: allPrices[0] || null,
      sources: allSources[0] ? `${allSources[0]} sources` : null,
      url: null,
    });
  }

  return results;
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

  let manufacturer;
  try {
    ({ manufacturer } = JSON.parse(event.body));
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!manufacturer) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "manufacturer required" }),
    };
  }

  const query = cleanManufacturerName(manufacturer);
  const gsaUrl = `https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=0:8${encodeURIComponent(query)}&db=0&searchType=0`;

  try {
    // Route through Browserless — GSA blocks serverless IPs
    const res = await fetch(
      `https://production-sfo.browserless.io/content?token=${apiKey}&proxy=residential&proxyCountry=us&stealth=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gsaUrl,
          waitFor: 3000,
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: res.status,
        headers: HEADERS,
        body: JSON.stringify({ ok: false, manufacturer, query, error: errText, results: [] }),
      };
    }

    const html = await res.text();
    const results = parseGSAResults(html);
    const found = results.length > 0;

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        manufacturer,
        query,
        gsaUrl,
        found,
        results,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        manufacturer,
        query,
        gsaUrl,
        error: err.message,
        results: [],
      }),
    };
  }
};
