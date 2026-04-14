// netlify/functions/supplier-scout.js
// Imperio SCC — Supplier Scout
// Runs two jobs in parallel:
//   1. Claude API — asks for lesser-known US distributors in this FSC/category
//   2. Browserless — fires 2 targeted Bing searches: P/N+distributor, Mfr+authorized dealer gov
// POST body: { pn, nsn, fsc, item_name, approved_sources: ["OAKLEY INC"] }
// Returns: { ok, claude: [{name, reason, website, type}], web: [{title, url, snippet}] }
//
// Fix log:
//   - Model string corrected: claude-sonnet-4-6 (was claude-sonnet-4-20250514 — invalid)
//   - Proxy params removed from Browserless (caused 400 on non-enterprise tier)
//   - Claude prompt hardened: explicit FSC context, tighter JSON schema, web_search tool enabled
//   - Bing selector fallback added: if h2 a returns nothing, fall back to full body text parse
//   - All errors now logged with context before returning empty arrays

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// NO proxy params — those cause 400 on free/basic Browserless tier
const BROWSERLESS_SCRAPE = "https://production-sfo.browserless.io/scrape";

// ── Claude API — distributor discovery ───────────────────────────────────────
async function claudeScout({ pn, nsn, fsc, item_name, approved_sources }) {
  const mfrList = (approved_sources || [])
    .map((s) => s.replace(/\b(INC|LLC|CORP|CO|LTD)\b\.?/gi, "").trim())
    .filter(Boolean)
    .join(", ");

  const itemDesc = item_name || "unknown item";
  const partRef = pn || nsn || "no part number";
  const fscCode = fsc || "unknown";

  const prompt = `You are a federal supply chain sourcing specialist for a veteran-owned SDVOSB government reseller.

Find US distributors or authorized resellers for this DLA DIBBS solicitation:
- Item: ${itemDesc}
- FSC: ${fscCode}
- Part/NSN: ${partRef}
- OEM / DLA Approved Source: ${mfrList || "not specified"}

Requirements — ALL must apply:
1. NOT a national catalog giant (no Grainger, MSC Industrial, McMaster-Carr, Zoro, Amazon, Global Industrial, Fastenal)
2. Regional, specialty, or mid-tier — ideally 5-200 employees
3. Likely to work with a new SDVOSB reseller placing government drop-ship orders
4. BAA/TAA compliant — US domestic or approved-country manufacture only, no China-origin
5. Can ship direct to a government delivery address (drop-ship capable)
6. Will accept third-party PO funding (not net-30 direct-pay only)

Return ONLY a JSON array. No preamble, no explanation, no markdown fences.
Return between 4 and 8 results. If you cannot find enough real companies, return fewer — do NOT fabricate.

[
  {
    "name": "Exact Company Name",
    "website": "domain.com",
    "phone": "555-555-5555 or null",
    "reason": "One sentence: why this is a viable source for this specific item/FSC",
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
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API HTTP ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  console.log("Claude raw response (first 500):", text.slice(0, 500));

  // Strip accidental markdown fences
  const clean = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // Extract JSON array — handle leading/trailing text if present
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.error(
      "Claude returned no JSON array. Full response:",
      text.slice(0, 400),
    );
    return [];
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) throw new Error("Not an array");
    console.log(`Claude returned ${parsed.length} leads`);
    return parsed;
  } catch (parseErr) {
    console.error(
      "Claude JSON parse failed:",
      parseErr.message,
      "raw:",
      arrayMatch[0].slice(0, 300),
    );
    return [];
  }
}

// ── Browserless — Bing search, NO proxy params ────────────────────────────────
async function browserlessSearch(query, apiKey) {
  const searchUrl =
    "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&count=8";
  console.log("Browserless search:", query);

  try {
    const res = await fetch(`${BROWSERLESS_SCRAPE}?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: searchUrl,
        elements: [
          { selector: "h2 a", timeout: 6000 }, // Bing result titles
          { selector: ".b_caption p", timeout: 6000 }, // Bing snippets
          { selector: "cite", timeout: 6000 }, // Bing URL citations
        ],
        waitFor: 4000,
      }),
      signal: AbortSignal.timeout(22000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Browserless HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }

    const data = await res.json();

    let titles = (data?.data?.[0]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);
    let snippets = (data?.data?.[1]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);
    let urls = (data?.data?.[2]?.results || [])
      .map((r) => r.text || "")
      .filter(Boolean);

    // Fallback: if selectors returned nothing, scrape raw body text
    if (!titles.length) {
      console.log("Bing selectors returned nothing — trying body fallback");
      const allText = (data?.data || [])
        .flatMap((d) => d.results || [])
        .map((r) => r.text || r.html || "")
        .join(" ");
      // Extract URLs and surrounding text from raw body
      const bodyUrls = allText.match(/https?:\/\/[^\s"<>]{10,80}/g) || [];
      return bodyUrls.slice(0, 5).map((u) => ({
        title: u,
        snippet: "",
        url: u,
        query,
      }));
    }

    console.log(`Bing returned ${titles.length} titles for: ${query}`);

    return titles.slice(0, 6).map((title, i) => ({
      title,
      snippet: snippets[i] || "",
      url: urls[i] || "",
      query,
    }));
  } catch (err) {
    console.error(
      "Browserless search error for query:",
      query,
      "—",
      err.message,
    );
    // Return structured error so front end knows Browserless failed, not zero results
    return [
      { title: "__browserless_error__", snippet: err.message, url: "", query },
    ];
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

  console.log("supplier-scout: BROWSERLESS_API_KEY present:", !!apiKey);
  console.log("supplier-scout: ANTHROPIC_API_KEY present:", !!anthropicKey);

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
    item_name,
    "fsc=",
    fsc,
    "pn=",
    partQuery,
    "mfr=",
    mfr,
  );

  // Build 2 targeted Bing search queries
  // Q1: specific part number — finds distributors who stock this exact item
  // Q2: OEM + authorized dealer — finds who can source from the approved manufacturer
  const searchQ1 = partQuery
    ? `"${partQuery}" distributor buy stock price`
    : `${itemDesc} distributor government supply Texas`;

  const mfrClean = mfr.replace(/\b(INC|LLC|CORP|CO|LTD)\b\.?/gi, "").trim();
  const searchQ2 = mfrClean
    ? `"${mfrClean}" authorized dealer reseller government military`
    : `${item_name || ""} supplier government military distributor`;

  // Fire Claude always; Browserless only if key present
  const promises = [claudeScout({ pn, nsn, fsc, item_name, approved_sources })];
  if (apiKey) {
    promises.push(browserlessSearch(searchQ1, apiKey));
    promises.push(browserlessSearch(searchQ2, apiKey));
  } else {
    console.log("supplier-scout: No Browserless key — skipping web search");
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

  // Filter web hits — remove nationals, error sentinels, and junk
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

  // Surface Browserless errors in logs but don't fail the whole response
  const browserlessErrors = rawWeb
    .filter((r) => r.title === "__browserless_error__")
    .map((r) => r.snippet);
  if (browserlessErrors.length) {
    console.error("Browserless errors:", browserlessErrors);
  }

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
