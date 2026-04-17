// netlify/functions/browserless-scrape.js
// Imperio SCC — Browserless Scrape Utility v3 (Enhanced)

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Use /content for full page rendering to ensure DIBBS tables are visible
const BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io/content";

exports.handler = async (event) => {
  console.log("[browserless-scrape] Request received");

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    console.error("[browserless-scrape] MISSING API KEY");
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "BROWSERLESS_API_KEY not configured" }),
    };
  }

  let url;
  try {
    const body = JSON.parse(event.body || "{}");
    url = body.url;
  } catch (err) {
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
      body: JSON.stringify({ error: "URL is required" }),
    };
  }

  try {
    console.log(`[browserless-scrape] Scraping: ${url}`);

    const res = await fetch(
      `${BROWSERLESS_ENDPOINT}?token=${apiKey}&proxy=residential&stealth=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url,
          gotoOptions: {
            waitUntil: "networkidle2", // Wait for DIBBS background JS to finish
            timeout: 20000,
          },
        }),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!res.ok) {
      const errStatus = res.status;
      const errText = await res.text();
      console.error(
        `[browserless-scrape] Browserless Error ${errStatus}: ${errText}`,
      );
      return {
        statusCode: errStatus,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: `Browserless Error ${errStatus}`,
        }),
      };
    }

    const html = await res.text();
    console.log(`[browserless-scrape] Success! HTML Length: ${html.length}`);

    return {
      statusCode: 200,
      headers: HEADERS,
      // Wrap in results array to maintain compatibility with your existing parsers
      body: JSON.stringify({
        ok: true,
        results: [{ html: html }],
      }),
    };
  } catch (err) {
    console.error(`[browserless-scrape] System Error: ${err.message}`);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
