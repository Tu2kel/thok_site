// netlify/functions/catalog-search.js
// Imperio SCC — Catalog Search (Browserless-powered)
// Hits Zoro, Grainger, MSC via Browserless residential proxies.
// Raw fetch was getting blocked — Browserless handles JS rendering + CAPTCHA + stealth.
// POST body: { pn: "MS35338-43", nsn: "5310001234567" }
// Returns: { ok, query, results: [{ supplier, found, price, stock, url, sku, error }] }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io/scrape";

// ── Core Browserless fetch ────────────────────────────────────────────────────
async function browserlessFetch(url, selectors, apiKey) {
  const res = await fetch(
    `${BROWSERLESS_ENDPOINT}?token=${apiKey}&proxy=residential&proxyCountry=us&stealth=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        elements: selectors.map((s) => ({ selector: s, timeout: 5000 })),
        waitFor: 3000,
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) throw new Error("Browserless HTTP " + res.status);
  const data = await res.json();
  // Flatten all text results
  const texts = (data?.data || []).map((d) =>
    (d.results || []).map((r) => r.text || r.html || "").join(" "),
  );
  return texts.join(" ");
}

// ── ZORO ─────────────────────────────────────────────────────────────────────
async function searchZoro(query, apiKey) {
  const searchUrl =
    "https://www.zoro.com/search?q=" + encodeURIComponent(query);
  try {
    const text = await browserlessFetch(
      searchUrl,
      [
        "[data-testid='product-card']",
        ".product-card",
        "[class*='ProductCard']",
        "[class*='price']",
        "body",
      ],
      apiKey,
    );

    const priceMatch = text.match(/\$\s*([\d,]+\.\d{2})/);
    const skuMatch = text.match(/(?:Item#|SKU|G-)[:\s]?([A-Z0-9]{5,15})/i);
    const found =
      !!priceMatch ||
      text.toLowerCase().includes("add to cart") ||
      text.toLowerCase().includes("in stock");

    return {
      supplier: "Zoro",
      found,
      price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null,
      stock: text.toLowerCase().includes("in stock")
        ? "In Stock"
        : found
          ? "Check"
          : null,
      url: searchUrl,
      sku: skuMatch ? skuMatch[1] : null,
      error: null,
    };
  } catch (err) {
    return {
      supplier: "Zoro",
      found: false,
      price: null,
      stock: null,
      url: searchUrl,
      sku: null,
      error: err.message,
    };
  }
}

// ── GRAINGER ─────────────────────────────────────────────────────────────────
async function searchGrainger(query, apiKey) {
  const searchUrl =
    "https://www.grainger.com/search?searchQuery=" + encodeURIComponent(query);
  try {
    const text = await browserlessFetch(
      searchUrl,
      [
        "[class*='ProductCard']",
        "[class*='product-card']",
        "[data-testid*='product']",
        "[class*='price']",
        "body",
      ],
      apiKey,
    );

    const priceMatch = text.match(/\$\s*([\d,]+\.\d{2})/);
    const skuMatch = text.match(/Item\s*#\s*([A-Z0-9]{4,12})/i);
    const found =
      !!priceMatch ||
      text.toLowerCase().includes("add to cart") ||
      text.toLowerCase().includes("in stock");

    return {
      supplier: "Grainger",
      found,
      price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null,
      stock: text.toLowerCase().includes("in stock")
        ? "In Stock"
        : found
          ? "Check"
          : null,
      url: searchUrl,
      sku: skuMatch ? skuMatch[1] : null,
      error: null,
    };
  } catch (err) {
    return {
      supplier: "Grainger",
      found: false,
      price: null,
      stock: null,
      url: searchUrl,
      sku: null,
      error: err.message,
    };
  }
}

// ── MSC INDUSTRIAL ───────────────────────────────────────────────────────────
async function searchMSC(query, apiKey) {
  const searchUrl =
    "https://www.mscdirect.com/browse/tn?searchterm=" +
    encodeURIComponent(query);
  try {
    const text = await browserlessFetch(
      searchUrl,
      [
        "[class*='product']",
        "[class*='Product']",
        "[class*='price']",
        "[class*='Price']",
        "body",
      ],
      apiKey,
    );

    const priceMatch = text.match(/\$\s*([\d,]+\.\d{2})/);
    const skuMatch = text.match(/MSC#?\s*:?\s*([\d]{7,10})/i);
    const found =
      !!priceMatch ||
      text.toLowerCase().includes("add to cart") ||
      text.toLowerCase().includes("in stock");

    return {
      supplier: "MSC Industrial",
      found,
      price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null,
      stock: text.toLowerCase().includes("in stock")
        ? "In Stock"
        : found
          ? "Check"
          : null,
      url: searchUrl,
      sku: skuMatch ? skuMatch[1] : null,
      error: null,
    };
  } catch (err) {
    return {
      supplier: "MSC Industrial",
      found: false,
      price: null,
      stock: null,
      url: searchUrl,
      sku: null,
      error: err.message,
    };
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
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

  let pn, nsn;
  try {
    ({ pn, nsn } = JSON.parse(event.body));
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const query = (pn || "").trim() || (nsn || "").replace(/-/g, "").trim();
  if (!query) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "pn or nsn required" }),
    };
  }

  // Fire all three in parallel
  const [zoroResult, graingerResult, mscResult] = await Promise.allSettled([
    searchZoro(query, apiKey),
    searchGrainger(query, apiKey),
    searchMSC(query, apiKey),
  ]);

  const output = [zoroResult, graingerResult, mscResult].map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          supplier: "Unknown",
          found: false,
          price: null,
          stock: null,
          url: null,
          sku: null,
          error: r.reason?.message || "Failed",
        },
  );

  // Check if ALL returned not found — triggers GSA cascade on front end
  const allNotFound = output.every((r) => !r.found);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, query, results: output, allNotFound }),
  };
};
