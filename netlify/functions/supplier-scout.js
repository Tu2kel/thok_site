// netlify/functions/supplier-scout.js
// Imperio SCC — Supplier Scout
// Runs two jobs in parallel:
//   1. Claude API — asks for lesser-known US distributors in this FSC/category
//   2. Browserless — fires 2 targeted searches: P/N+distributor, Mfr+authorized dealer gov
// POST body: { pn, nsn, fsc, item_name, approved_sources: ["OAKLEY INC"] }
// Returns: { ok, claude: [{name, reason, website?, phone?}], web: [{title, url, snippet}] }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io/scrape";

// ── Claude API — distributor discovery ───────────────────────────────────────
async function claudeScout({ pn, nsn, fsc, item_name, approved_sources }) {
  const mfr = (approved_sources || [])
    .map((s) => s.replace(/\b(INC|LLC|CORP|CO|LTD)\b\.?/gi, "").trim())
    .join(", ");

  const prompt = `You are a federal supply chain sourcing specialist. 

I need US distributors or manufacturers for this DLA solicitation:
- Item: ${item_name || "unknown"}
- FSC: ${fsc || "unknown"}
- Part Number: ${pn || nsn || "unknown"}
- OEM/Approved Source: ${mfr || "unknown"}

Find me 5-8 lesser-known US distributors or authorized resellers that:
1. Are NOT Grainger, MSC, McMaster-Carr, Zoro, Amazon, or other national catalog giants
2. Are likely to work with a new SDVOSB veteran-owned small business reseller
3. Can drop-ship directly to government delivery addresses
4. Are BAA/TAA compliant (US or approved country manufacture)
5. Are regional, specialty, or mid-tier distributors with actual inventory

Respond ONLY with a JSON array. No preamble, no markdown, no explanation.
Format exactly:
[
  {
    "name": "Company Name",
    "website": "website.com",
    "reason": "one sentence why this is a good match",
    "type": "distributor|manufacturer|dealer"
  }
]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) throw new Error("Claude API HTTP " + res.status);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Strip any accidental markdown fences
  const clean = text.replace(/```json|```/gi, "").trim();
  return JSON.parse(clean);
}

// ── Browserless — 2 targeted searches ────────────────────────────────────────
async function browserlessSearch(query, apiKey) {
  const searchUrl =
    "https://www.google.com/search?q=" + encodeURIComponent(query) + "&num=5";
  try {
    const res = await fetch(
      `${BROWSERLESS_ENDPOINT}?token=${apiKey}&proxy=residential&proxyCountry=us&stealth=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: searchUrl,
          elements: [
            { selector: "h3", timeout: 5000 },
            { selector: ".VwiC3b", timeout: 5000 }, // Google snippet class
            { selector: "cite", timeout: 5000 }, // URL shown in result
          ],
          waitFor: 3000,
        }),
        signal: AbortSignal.timeout(20000),
      },
    );

    if (!res.ok) throw new Error("Browserless HTTP " + res.status);
    const data = await res.json();

    // Extract h3 titles, snippets, and cites
    const titles = (data?.data?.[0]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);
    const snippets = (data?.data?.[1]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);
    const urls = (data?.data?.[2]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);

    return titles.slice(0, 5).map((title, i) => ({
      title,
      snippet: snippets[i] || "",
      url: urls[i] || "",
      query,
    }));
  } catch (err) {
    return [{ title: "Search failed", snippet: err.message, url: "", query }];
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !anthropicKey) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "Missing API keys" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const { pn, nsn, fsc, item_name, approved_sources } = body;
  const mfr = (approved_sources || [])[0] || "";
  const partQuery = pn || nsn || "";

  // Build the 2 targeted search queries
  const searchQ1 = partQuery
    ? `"${partQuery}" distributor price buy`
    : `${item_name} distributor government supply`;

  const searchQ2 = mfr
    ? `"${mfr.replace(/\b(INC|LLC|CORP)\b\.?/gi, "").trim()}" authorized dealer distributor government`
    : `${item_name} authorized dealer military government`;

  // Fire Claude + both Browserless searches in parallel
  const [claudeResult, webResult1, webResult2] = await Promise.allSettled([
    claudeScout({ pn, nsn, fsc, item_name, approved_sources }),
    browserlessSearch(searchQ1, apiKey),
    browserlessSearch(searchQ2, apiKey),
  ]);

  const claudeSuppliers =
    claudeResult.status === "fulfilled" ? claudeResult.value : [];
  const webHits = [
    ...(webResult1.status === "fulfilled" ? webResult1.value : []),
    ...(webResult2.status === "fulfilled" ? webResult2.value : []),
  ];

  // Filter web hits — remove obvious nationals and junk
  const EXCLUDE = [
    "grainger",
    "amazon",
    "zoro",
    "mcmaster",
    "msc",
    "ebay",
    "walmart",
    "home depot",
  ];
  const filteredWeb = webHits.filter((r) => {
    const combined = (r.title + r.url + r.snippet).toLowerCase();
    return !EXCLUDE.some((e) => combined.includes(e));
  });

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ok: true,
      item: item_name,
      fsc,
      pn: partQuery,
      mfr,
      queries: [searchQ1, searchQ2],
      claude: claudeSuppliers,
      web: filteredWeb,
    }),
  };
};
