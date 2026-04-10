// netlify/functions/catalog-search.js
// Imperio SCC — Catalog Search
// Hits Zoro, Grainger, MSC public search APIs in parallel for a given P/N or NSN.
// POST body: { pn: "MS35338-43", nsn: "5310001234567" }
// Returns: array of { supplier, found, price, stock, url, error }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── ZORO ─────────────────────────────────────────────────────────────────────
// Public search API — no auth required, returns JSON
async function searchZoro(query) {
  const url =
    "https://www.zoro.com/search?q=" +
    encodeURIComponent(query) +
    "&page=1&pageSize=3";
  try {
    const res = await fetch(
      "https://www.zoro.com/api/2.0/search/products?q=" +
        encodeURIComponent(query) +
        "&pageSize=3",
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          Referer: "https://www.zoro.com/",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const items = data?.results || data?.products || [];
    if (!items.length) {
      // Fallback: HTML scrape
      return await searchZoroHtml(query);
    }
    const first = items[0];
    const price =
      first?.price ||
      first?.listPrice ||
      first?.pricing?.listPrice ||
      null;
    const sku = first?.sku || first?.itemId || "";
    const slug = first?.slug || first?.url || "";
    const productUrl = slug
      ? "https://www.zoro.com" + (slug.startsWith("/") ? slug : "/" + slug)
      : "https://www.zoro.com/search?q=" + encodeURIComponent(query);
    return {
      supplier: "Zoro",
      found: true,
      price: price ? parseFloat(price) : null,
      stock: first?.availability?.availableToSell ? "In Stock" : "Check",
      url: productUrl,
      sku,
      error: null,
    };
  } catch (err) {
    return await searchZoroHtml(query).catch(() => ({
      supplier: "Zoro",
      found: false,
      price: null,
      stock: null,
      url: "https://www.zoro.com/search?q=" + encodeURIComponent(query),
      error: err.message,
    }));
  }
}

async function searchZoroHtml(query) {
  const res = await fetch(
    "https://www.zoro.com/search?q=" + encodeURIComponent(query),
    {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    }
  );
  const html = await res.text();
  // Extract price from HTML — Zoro renders price in data attributes / JSON-LD
  const priceMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
  const skuMatch = html.match(/"sku"\s*:\s*"([^"]+)"/);
  const urlMatch = html.match(/"url"\s*:\s*"(https:\/\/www\.zoro\.com\/[^"]+)"/);
  const found = !!priceMatch || html.includes("Add to Cart");
  return {
    supplier: "Zoro",
    found,
    price: priceMatch ? parseFloat(priceMatch[1]) : null,
    stock: html.includes("In Stock") ? "In Stock" : found ? "Check" : null,
    url: urlMatch
      ? urlMatch[1]
      : "https://www.zoro.com/search?q=" + encodeURIComponent(query),
    sku: skuMatch ? skuMatch[1] : null,
    error: null,
  };
}

// ── GRAINGER ─────────────────────────────────────────────────────────────────
// Public product search — JSON API, no auth for catalog prices
async function searchGrainger(query) {
  try {
    const res = await fetch(
      "https://www.grainger.com/search?searchQuery=" +
        encodeURIComponent(query) +
        "&sst=1",
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/html",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    // Try JSON first
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) {
      const data = await res.json();
      const items =
        data?.products ||
        data?.searchResults?.products ||
        data?.result?.products ||
        [];
      if (items.length) {
        const first = items[0];
        return {
          supplier: "Grainger",
          found: true,
          price: first?.listPrice ? parseFloat(first.listPrice) : null,
          stock: first?.availability || "Check",
          url: first?.pdpUrl
            ? "https://www.grainger.com" + first.pdpUrl
            : "https://www.grainger.com/search?searchQuery=" +
              encodeURIComponent(query),
          sku: first?.itemNumber || first?.sku || null,
          error: null,
        };
      }
    }
    // HTML fallback
    const html = ct.includes("json") ? "" : await res.text();
    const priceMatch = html.match(/\$\s*([\d,]+\.\d{2})/);
    const itemMatch = html.match(/data-item-number="([^"]+)"/);
    const found = !!priceMatch || html.includes("Add to Cart");
    return {
      supplier: "Grainger",
      found,
      price: priceMatch
        ? parseFloat(priceMatch[1].replace(/,/g, ""))
        : null,
      stock: html.includes("In Stock") ? "In Stock" : found ? "Check" : null,
      url:
        "https://www.grainger.com/search?searchQuery=" +
        encodeURIComponent(query),
      sku: itemMatch ? itemMatch[1] : null,
      error: null,
    };
  } catch (err) {
    return {
      supplier: "Grainger",
      found: false,
      price: null,
      stock: null,
      url:
        "https://www.grainger.com/search?searchQuery=" +
        encodeURIComponent(query),
      error: err.message,
    };
  }
}

// ── MSC INDUSTRIAL ───────────────────────────────────────────────────────────
// Public search — MSC has a JSON search API
async function searchMSC(query) {
  try {
    const res = await fetch(
      "https://www.mscdirect.com/browse/tn?searchterm=" +
        encodeURIComponent(query) +
        "&hdrsrh=true",
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/html",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    // MSC embeds product data in page JSON
    const jsonMatch = html.match(
      /window\.__INITIAL_STATE__\s*=\s*({.+?});\s*<\/script>/s
    );
    if (jsonMatch) {
      try {
        const state = JSON.parse(jsonMatch[1]);
        const products =
          state?.search?.searchResults?.products ||
          state?.products?.list ||
          [];
        if (products.length) {
          const first = products[0];
          const price =
            first?.unitPrice ||
            first?.listPrice ||
            first?.price?.listPrice ||
            null;
          return {
            supplier: "MSC Industrial",
            found: true,
            price: price ? parseFloat(price) : null,
            stock: first?.availability?.stockStatus || "Check",
            url: first?.productUrl
              ? "https://www.mscdirect.com" + first.productUrl
              : "https://www.mscdirect.com/browse/tn?searchterm=" +
                encodeURIComponent(query),
            sku: first?.mscPartNumber || first?.sku || null,
            error: null,
          };
        }
      } catch {}
    }
    // HTML fallback — look for price patterns
    const priceMatch = html.match(/\$\s*([\d,]+\.\d{2})/);
    const skuMatch = html.match(/MSC#\s*([\d]+)/);
    const found = !!priceMatch || html.includes("Add to Cart");
    return {
      supplier: "MSC Industrial",
      found,
      price: priceMatch
        ? parseFloat(priceMatch[1].replace(/,/g, ""))
        : null,
      stock: html.includes("In Stock") ? "In Stock" : found ? "Check" : null,
      url:
        "https://www.mscdirect.com/browse/tn?searchterm=" +
        encodeURIComponent(query),
      sku: skuMatch ? skuMatch[1] : null,
      error: null,
    };
  } catch (err) {
    return {
      supplier: "MSC Industrial",
      found: false,
      price: null,
      stock: null,
      url:
        "https://www.mscdirect.com/browse/tn?searchterm=" +
        encodeURIComponent(query),
      error: err.message,
    };
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
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

  // Build query — prefer P/N, fallback to NSN (strip dashes for search)
  const query = (pn || "").trim() || (nsn || "").replace(/-/g, "").trim();
  if (!query) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "pn or nsn required" }),
    };
  }

  // Fire all three in parallel — never let one failure block the others
  const results = await Promise.allSettled([
    searchZoro(query),
    searchGrainger(query),
    searchMSC(query),
  ]);

  const output = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          supplier: "Unknown",
          found: false,
          price: null,
          stock: null,
          url: null,
          error: r.reason?.message || "Failed",
        }
  );

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, query, results: output }),
  };
};
