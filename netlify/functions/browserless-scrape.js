// netlify/functions/browserless-scrape.js
// Imperio SCC — Browserless Scrape Utility
// Central scraping function — all SCC Netlify functions route through here.
// Uses Browserless /scrape REST API with residential proxies + CAPTCHA solving.
// POST body: { url, selectors: [{selector, type}], timeout? }
// Returns: { ok, results: [{selector, text, html}], error? }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io/scrape";

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

  let url, selectors, timeout;
  try {
    ({ url, selectors, timeout } = JSON.parse(event.body));
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!url) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "url required" }),
    };
  }

  // Default selectors — grab full body text if none specified
  const elements = (selectors || [{ selector: "body" }]).map((s) => ({
    selector: s.selector || "body",
    timeout: s.timeout || 5000,
  }));

  try {
    const res = await fetch(
      `${BROWSERLESS_ENDPOINT}?token=${apiKey}&proxy=residential&proxyCountry=us&stealth=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          elements,
          waitFor: timeout || 3000,
        }),
        signal: AbortSignal.timeout(25000),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: res.status,
        headers: HEADERS,
        body: JSON.stringify({ ok: false, error: errText }),
      };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, results: data?.data || [] }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
