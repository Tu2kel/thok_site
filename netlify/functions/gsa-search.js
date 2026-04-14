// netlify/functions/gsa-search.js
// Imperio SCC — GSA Advantage Search
// Fires automatically when catalog-search returns allNotFound=true.
// POST body: { manufacturer: "Oakley Inc", pn: "OO9452-0965", nsn: "4240017017266" }
// Returns: { ok, found, results: [{name, partNo, price, contractor, url}] }
//
// Browserless free-tier rules (hard lessons):
//   - NO proxy/stealth params in query string (400)
//   - NO waitFor in POST body (400) — timeout goes in QUERY STRING as timeout=
//   - Endpoint: production-sfo.browserless.io/content

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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

function gsaSearchUrl(term, mode) {
  const prefix = mode === "part" ? "1:8" : "0:8";
  return `https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=${prefix}${encodeURIComponent(term)}&db=0&searchType=0&perPage=10`;
}

function parseGSA(text) {
  const results = [];
  if (!text || text.length < 50) return results;

  const contractors = [],
    names = [],
    prices = [],
    parts = [],
    urls = [];
  let m;

  // XML patterns
  const pContractor = /<contractor[^>]*>([^<]{3,80})<\/contractor>/gi;
  const pName = /<name[^>]*>([^<]{3,120})<\/name>/gi;
  const pPrice = /<(?:unitPrice|price)[^>]*>([\d.]+)<\/(?:unitPrice|price)>/gi;
  const pPart =
    /<(?:partNum|mfgPartNum|partNumber)[^>]*>([^<]{2,40})<\/(?:partNum|mfgPartNum|partNumber)>/gi;
  const pDesc =
    /<(?:description|longDescription|title)[^>]*>([^<]{5,200})<\/(?:description|longDescription|title)>/gi;
  const pUrl =
    /<(?:productUrl|url|link)[^>]*>([^<]{10,300})<\/(?:productUrl|url|link)>/gi;

  while ((m = pContractor.exec(text)) !== null) contractors.push(m[1].trim());
  while ((m = pName.exec(text)) !== null) names.push(m[1].trim());
  while ((m = pPrice.exec(text)) !== null) prices.push(parseFloat(m[1]));
  while ((m = pPart.exec(text)) !== null) parts.push(m[1].trim());
  while ((m = pUrl.exec(text)) !== null) urls.push(m[1].trim());

  // JSON fallback
  if (!names.length) {
    const jName = /"(?:description|title|productName)"\s*:\s*"([^"]{5,200})"/g;
    const jContractor = /"(?:contractor|company|vendor)"\s*:\s*"([^"]{3,80})"/g;
    const jPrice = /"(?:unitPrice|price)"\s*:\s*([\d.]+)/g;
    const jPart = /"(?:partNum|mfgPartNum|partNumber)"\s*:\s*"([^"]{2,40})"/g;
    while ((m = jName.exec(text)) !== null) names.push(m[1].trim());
    while ((m = jContractor.exec(text)) !== null) contractors.push(m[1].trim());
    while ((m = jPrice.exec(text)) !== null) prices.push(parseFloat(m[1]));
    while ((m = jPart.exec(text)) !== null) parts.push(m[1].trim());
  }
  if (!names.length) {
    while ((m = pDesc.exec(text)) !== null) names.push(m[1].trim());
  }

  const limit = Math.min(
    Math.max(names.length, contractors.length, prices.length),
    8,
  );
  for (let i = 0; i < limit; i++) {
    const name = names[i] || contractors[i] || "GSA Item";
    if (name.toLowerCase().includes("javascript") || name.length < 3) continue;
    results.push({
      name,
      contractor: contractors[i] || null,
      partNo: parts[i] || null,
      price: prices[i] || null,
      url: urls[i] || null,
    });
  }

  // Last resort — page loaded but parser missed structure
  if (!results.length && text.length > 200) {
    const hasContent =
      text.includes("$") || /contract|price|schedule/i.test(text);
    if (hasContent && !/no results|0 results/i.test(text)) {
      results.push({
        name: "GSA Schedule Items Found — click Open GSA to view",
        contractor: null,
        partNo: null,
        price: null,
        url: null,
      });
    }
  }

  return results;
}

// Browserless free-tier fetch — timeout in QUERY STRING, nothing extra in POST body
async function browserlessFetch(targetUrl, apiKey) {
  const res = await fetch(
    `https://production-sfo.browserless.io/content?token=${apiKey}&timeout=15000`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
      signal: AbortSignal.timeout(18000),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Browserless ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };

  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey)
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "BROWSERLESS_API_KEY not configured" }),
    };

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

  console.log("gsa-search: mfr=", manufacturer, "pn=", pn, "nsn=", nsn);

  // Try P/N first (most specific), then NSN, then mfr name
  const queries = [];
  if (pn) queries.push({ term: pn, mode: "part", label: "part_number" });
  if (nsn)
    queries.push({
      term: (nsn || "").replace(/-/g, ""),
      mode: "part",
      label: "nsn",
    });
  if (manufacturer) {
    const c = cleanMfr(manufacturer);
    if (c) queries.push({ term: c, mode: "desc", label: "manufacturer" });
  }

  let results = [],
    usedQuery = null,
    usedUrl = null,
    lastError = null;

  for (const q of queries) {
    const url = gsaSearchUrl(q.term, q.mode);
    console.log(`gsa-search [${q.label}]:`, url);
    try {
      const html = await browserlessFetch(url, apiKey);
      console.log(`gsa-search [${q.label}]: ${html.length} chars`);
      const parsed = parseGSA(html);
      if (parsed.length > 0) {
        results = parsed;
        usedQuery = q;
        usedUrl = url;
        console.log(`gsa-search: ${parsed.length} results via ${q.label}`);
        break;
      }
    } catch (err) {
      console.error(`gsa-search [${q.label}] failed:`, err.message);
      lastError = err.message;
    }
  }

  const openUrl =
    usedUrl ||
    (manufacturer
      ? `https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=0:8${encodeURIComponent(cleanMfr(manufacturer))}&db=0&searchType=0`
      : "https://www.gsaadvantage.gov/advantage/main/home.do");

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
