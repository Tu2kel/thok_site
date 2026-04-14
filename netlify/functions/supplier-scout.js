// netlify/functions/supplier-scout.js
// Imperio SCC — Supplier Scout
// Two parallel jobs:
//   1. Claude API — lesser-known US distributors for this FSC/item
//   2. Browserless — 2 targeted Bing searches
// POST body: { pn, nsn, fsc, item_name, approved_sources: ["OAKLEY INC"] }
// Returns: { ok, claude: [{name, reason, website, type}], web: [{title, url, snippet}] }
//
// Browserless free-tier rules:
//   - NO proxy/stealth params (400)
//   - NO waitFor in POST body (400) — use timeout= in QUERY STRING
//   - /scrape endpoint with elements array

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── Claude API — distributor discovery ───────────────────────────────────────
async function claudeScout({ pn, nsn, fsc, item_name, approved_sources }) {
  const mfrList = (approved_sources || [])
    .map((s) => s.replace(/\b(INC|LLC|CORP|CO|LTD)\b\.?/gi, "").trim())
    .filter(Boolean)
    .join(", ");

  const prompt = `You are a federal supply chain sourcing specialist for a veteran-owned SDVOSB government reseller.

Find US distributors or authorized resellers for this DLA DIBBS solicitation:
- Item: ${item_name || "unknown item"}
- FSC: ${fsc || "unknown"}
- Part/NSN: ${pn || nsn || "no part number"}
- OEM / DLA Approved Source: ${mfrList || "not specified"}

Requirements — ALL must apply:
1. NOT a national catalog giant (no Grainger, MSC Industrial, McMaster-Carr, Zoro, Amazon, Global Industrial, Fastenal)
2. Regional, specialty, or mid-tier — ideally 5-200 employees
3. Likely to work with a new SDVOSB reseller placing government drop-ship orders
4. BAA/TAA compliant — US domestic or approved-country manufacture only, no China-origin
5. Can ship direct to a government delivery address
6. Will accept third-party PO funding

Return ONLY a JSON array. No preamble, no explanation, no markdown fences.
Return 4-8 real companies. Do NOT fabricate — if fewer real matches exist, return fewer.

[
  {
    "name": "Exact Company Name",
    "website": "domain.com",
    "phone": "555-555-5555 or null",
    "reason": "One sentence why this is a viable source for this specific item/FSC",
    "type": "distributor|manufacturer|dealer|wholesaler"
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
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  console.log("Claude raw (first 400):", text.slice(0, 400));

  // Strip markdown fences, then extract the JSON array
  const clean = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.error("Claude returned no JSON array:", text.slice(0, 300));
    return [];
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) throw new Error("Not an array");
    console.log(`Claude: ${parsed.length} leads returned`);
    return parsed;
  } catch (err) {
    console.error(
      "Claude JSON parse error:",
      err.message,
      "raw:",
      arrayMatch[0].slice(0, 200),
    );
    return [];
  }
}

// ── Browserless Bing search — free-tier compatible ────────────────────────────
// timeout= in QUERY STRING only. Nothing extra in POST body.
async function browserlessSearch(query, apiKey) {
  const searchUrl =
    "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&count=8";
  console.log("Browserless search:", query);

  try {
    const res = await fetch(
      `https://production-sfo.browserless.io/scrape?token=${apiKey}&timeout=15000`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: searchUrl,
          elements: [
            { selector: "h2 a" },
            { selector: ".b_caption p" },
            { selector: "cite" },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Browserless ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const titles = (data?.data?.[0]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);
    const snippets = (data?.data?.[1]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);
    const urls = (data?.data?.[2]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);

    console.log(`Bing [${query.slice(0, 40)}]: ${titles.length} titles`);

    if (!titles.length) {
      // Selectors returned nothing — scrape raw body for any URLs
      const allText = (data?.data || [])
        .flatMap((d) => d.results || [])
        .map((r) => r.text || r.html || "")
        .join(" ");
      const bodyUrls = allText.match(/https?:\/\/[^\s"<>]{10,80}/g) || [];
      console.log(`Bing body fallback: ${bodyUrls.length} raw URLs`);
      return bodyUrls
        .slice(0, 5)
        .map((u) => ({ title: u, snippet: "", url: u, query }));
    }

    return titles.slice(0, 6).map((title, i) => ({
      title,
      snippet: snippets[i] || "",
      url: urls[i] || "",
      query,
    }));
  } catch (err) {
    console.error("Browserless error:", err.message, "query:", query);
    return [
      { title: "__browserless_error__", snippet: err.message, url: "", query },
    ];
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  console.log("supplier-scout: BROWSERLESS_API_KEY:", !!apiKey);
  console.log("supplier-scout: ANTHROPIC_API_KEY:", !!anthropicKey);

  if (!anthropicKey) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }),
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
  const itemDesc = item_name || "industrial supply item";

  console.log(
    "supplier-scout: item=",
    itemDesc,
    "fsc=",
    fsc,
    "pn=",
    partQuery,
    "mfr=",
    mfr,
  );

  const mfrClean = mfr.replace(/\b(INC|LLC|CORP|CO|LTD)\b\.?/gi, "").trim();

  // Q1: part number — most specific, finds who stocks this exact item
  // Q2: OEM authorized dealer — finds who can source from approved mfr
  const searchQ1 = partQuery
    ? `"${partQuery}" distributor buy stock price`
    : `${itemDesc} distributor government supply`;

  const searchQ2 = mfrClean
    ? `"${mfrClean}" authorized dealer reseller government military`
    : `${itemDesc} supplier government military distributor`;

  // Claude always fires; Browserless only if key present
  const promises = [claudeScout({ pn, nsn, fsc, item_name, approved_sources })];
  if (apiKey) {
    promises.push(browserlessSearch(searchQ1, apiKey));
    promises.push(browserlessSearch(searchQ2, apiKey));
  } else {
    console.log("supplier-scout: no Browserless key — skipping web search");
  }

  const [claudeResult, webResult1, webResult2] =
    await Promise.allSettled(promises);

  const claudeSuppliers =
    claudeResult.status === "fulfilled" ? claudeResult.value : [];
  if (claudeResult.status === "rejected") {
    console.error(
      "Claude scout failed:",
      claudeResult.reason?.message || claudeResult.reason,
    );
  }

  const rawWeb = [
    ...(webResult1?.status === "fulfilled" ? webResult1.value : []),
    ...(webResult2?.status === "fulfilled" ? webResult2.value : []),
  ];

  const EXCLUDE = [
    "grainger",
    "amazon",
    "zoro",
    "mcmaster",
    "msc",
    "ebay",
    "walmart",
    "home depot",
    "fastenal",
    "__browserless_error__",
  ];
  const filteredWeb = rawWeb.filter((r) => {
    if (r.title === "__browserless_error__") return false;
    const combined = (r.title + r.url + r.snippet).toLowerCase();
    return !EXCLUDE.some((e) => combined.includes(e));
  });

  const browserlessErrors = rawWeb
    .filter((r) => r.title === "__browserless_error__")
    .map((r) => r.snippet);
  if (browserlessErrors.length)
    console.error("Browserless errors:", browserlessErrors);

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
      browserlessErrors: browserlessErrors.length
        ? browserlessErrors
        : undefined,
    }),
  };
};
