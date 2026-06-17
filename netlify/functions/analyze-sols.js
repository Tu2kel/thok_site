// netlify/functions/analyze-sols.js
// Imperio SCC — AI analysis proxy for DIBBS batch triage
//
// Keeps ANTHROPIC_API_KEY and OPENAI_API_KEY server-side (never in browser).
// Tries Claude Sonnet first; falls back to GPT-4o on quota/rate-limit errors.
//
// Env vars required (Netlify → Site config → Environment variables):
//   ANTHROPIC_API_KEY
//   OPENAI_API_KEY

const PROTOCOL = `
COMPANY PROFILE: Imperio Federal Logistics (CAGE 152U4) is a JCP-certified SDVOSB DLA DIBBS reseller.
JCP certification means we can access controlled technical data and source from approved manufacturers.
We are NOT a manufacturer/OEM — we cannot produce, machine, or fabricate parts ourselves.

DEFAULT BIAS: When in doubt, lean GO or VERIFY FIRST. REJECT only on hard gates below.
VERIFY FIRST is a holding pattern — it means "bid if we can source it." GO means "bid now."
Do NOT stack soft concerns to push a sol from GO to VERIFY FIRST. One clear path to supply = GO.

HARD REJECT (verdict: REJECT) — these are absolute stops, no exceptions:
- Set-aside codes: AL (AbilityOne), FG, PO, FI, H (HUBZone), L, E — ineligible for SDVOSB
- AMSC: G — government-peculiar design, no commercial market
- AMSC: B with approved_sources count = 1 — sole-source OEM lock
- AIDC flag in item name
- Blocked CAGEs in supplier_restrictions: 81SA7, R9004, 07482, 062W0, 75Q65
- Blocked OEMs in item name: SureFire, Streamlight, Furuno TZT9F
- QA = QSL — quality systems list, not achievable as reseller
- Prime-dominated FSCs (no resale channel): 1305,1310,1315,1320,1340,1350,1360,1376,2835,2840,1560,1720,1730,5860

GO (verdict: GO) — passes all hard rejects AND any of:
- AMSC: C (commercial item) — always GO if hard rejects clear and ext_price > $0
- AMSC: blank/null — GO if FSC is clean, no spec set-aside, standard P/N (no MS/MIL/AN/NAS prefix), ext_price > $0
- AMSC: A or B with 2+ approved sources — JCP gives drawing access, sourceable through authorized distributors
- AMSC: Q or M — QPL/mil-spec items are regularly stocked by JCP-certified distributors we use; GO unless sole-sourced
- Any AMSC where ext_price supports ≥27.5% gross margin at 90% cost ceiling and net > $500 after 7.5% FE fees
- Delivery window 30–120 days and quote deadline ≥ 3 days out

VERIFY FIRST (verdict: VERIFY FIRST) — passes hard rejects but has ONE specific concern to resolve:
- MS-/MIL-/NAS-/AN- P/N prefix AND AMSC A/B/Q/M AND single approved source — check authorized dealer
- Quote deadline ≤ 2 days — too tight to source and bid
- Delivery window > 150 days — non-performance risk for a small business
- Margin clearly tight (ext_price math shows < 15% gross at any realistic cost)
- Blocked CAGE in supplier_restrictions but item may have alternate source path

MISSING DATA RULES:
- blank amsc + clean FSC + no set-aside + ext_price > 0 → GO (do not default to VERIFY FIRST)
- blank approved_sources → skip sole-source reject rule; treat as GO if other criteria pass
- missing ext_price or unit_price → VERIFY FIRST (cannot confirm margin)
`;

// ── JSON mode: analyze pre-structured sol array ───────────────────────────
const ANALYSIS_SYSTEM_PROMPT = `You are a senior procurement analyst for Imperio Federal Logistics (CAGE 152U4), an SDVOSB federal supply contractor specializing in DLA DIBBS COTS resale.

For each solicitation, apply the full procurement protocol:
${PROTOCOL}
For each sol output a JSON object with:
{
  "sol_number": "...",
  "verdict": "GO" | "VERIFY FIRST" | "REJECT",
  "reason": "one-line plain English reason",
  "sourcing_path": "brief sourcing note for GO/VERIFY (skip for REJECT)",
  "margin_flag": "ok" | "tight" | "blocked",
  "winProbabilityPct": 0-100
}

Return ONLY a JSON array. No markdown, no preamble, no backticks.`;

// ── Image/text mode: extract + analyze in one pass ────────────────────────
const EXTRACT_ANALYZE_SYSTEM_PROMPT = `You are a senior procurement analyst for Imperio Federal Logistics (CAGE 152U4), an SDVOSB federal supply contractor specializing in DLA DIBBS COTS resale.

You will receive either a DIBBS solicitation table screenshot or raw pasted DIBBS table text.

Step 1 — Extract each row into a structured record with these fields (use null if not visible):
- sol_number: solicitation number (e.g. SPE4A626T84N8)
- item_name: nomenclature/description
- quantity: integer
- unit_issue: EA, PG, etc.
- unit_price: historical unit price as number (strip $, commas)
- quote_due: MM/DD/YY
- delivery_days: integer
- nsn: NSN (digits only, no dashes, e.g. "5305013688779")
- fsc: first 4 digits of NSN
- ref_part_number: piece part number if shown
- set_aside: set-aside code if shown
- material: material code (ST, NI, etc.)
- part_char: Char., Critical, etc.
- supplier_restrictions: "Restricted" or "Unrestricted"
- qa: QA code (N, C, QSL, etc.)
- naics: NAICS code
- supplier_list: supplier names from Supplier List column

Step 2 — Apply the procurement protocol to each extracted record:
${PROTOCOL}
Output a single JSON array. Each element must include ALL extracted fields PLUS:
  "verdict": "GO" | "VERIFY FIRST" | "REJECT",
  "reason": "one-line plain English reason",
  "sourcing_path": "brief sourcing note for GO/VERIFY (omit for REJECT)",
  "margin_flag": "ok" | "tight" | "blocked",
  "winProbabilityPct": 0-100

Return ONLY the JSON array. No markdown, no preamble, no backticks.`;

// ── Status codes that mean "quota/rate-limit — try the other provider" ──
function isQuotaError(status) {
  return status === 400 || status === 429 || status === 529 || status === 503 || status === 402;
}

function buildUserMsg(sols) {
  return (
    "Analyze this batch of DLA DIBBS solicitations:\n\n" +
    JSON.stringify(sols, null, 2)
  );
}

function parseJsonResponse(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── Claude Sonnet (JSON mode) ─────────────────────────────────────────────
async function callClaude(sols) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    throw Object.assign(new Error("ANTHROPIC_API_KEY not set"), {
      status: 500,
    });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMsg(sols) }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[analyze-sols] Claude error", resp.status, text);
    throw Object.assign(
      new Error("Claude " + resp.status + ": " + text),
      { status: resp.status },
    );
  }

  const data = await resp.json();
  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { results: parseJsonResponse(raw), provider: "claude" };
}

// ── Claude Vision (image or raw text extract + analyze) ───────────────────
async function callClaudeVision({ imageBase64, imageMediaType, rawText }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    throw Object.assign(new Error("ANTHROPIC_API_KEY not set"), { status: 500 });

  let userContent;
  if (imageBase64) {
    userContent = [
      {
        type: "image",
        source: { type: "base64", media_type: imageMediaType || "image/png", data: imageBase64 },
      },
      {
        type: "text",
        text: "Extract and analyze every solicitation row visible in this DIBBS table screenshot. Return the JSON array as instructed.",
      },
    ];
  } else {
    userContent = [
      {
        type: "text",
        text: "Extract and analyze every solicitation from this DIBBS table text:\n\n" + rawText,
      },
    ];
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: EXTRACT_ANALYZE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error("Claude vision " + resp.status + ": " + text.slice(0, 200)),
      { status: resp.status },
    );
  }

  const data = await resp.json();
  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { results: parseJsonResponse(raw), provider: "claude-vision" };
}

// ── GPT-4o fallback ──────────────────────────────────────────────────────
async function callGPT(sols) {
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw Object.assign(new Error("OPENAI_API_KEY not set"), { status: 500 });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4000,
      temperature: 0,
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: buildUserMsg(sols) },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[analyze-sols] OpenAI error", resp.status, text);
    throw Object.assign(
      new Error("OpenAI " + resp.status + ": " + text),
      { status: resp.status },
    );
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  return { results: parseJsonResponse(raw), provider: "gpt-4o" };
}

// ── Netlify handler ──────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "POST only" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Invalid JSON" }) };
  }

  const { sols, imageBase64, imageMediaType, rawText } = body;
  const isVisionMode = !!(imageBase64 || rawText);

  // ── Vision mode (screenshot or raw text paste) — Claude only ────────────
  if (isVisionMode) {
    try {
      const { results, provider } = await callClaudeVision({ imageBase64, imageMediaType, rawText });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, results, provider }) };
    } catch (err) {
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: err.message }) };
    }
  }

  // ── JSON mode (pre-structured sols array) — Claude → GPT fallback ───────
  if (!Array.isArray(sols) || !sols.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "sols array, imageBase64, or rawText required" }) };
  }

  try {
    const { results, provider } = await callClaude(sols);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, results, provider }) };
  } catch (claudeErr) {
    if (!isQuotaError(claudeErr.status)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ ok: false, error: claudeErr.message, provider: "claude" }),
      };
    }

    // Claude quota/rate-limit — try GPT-4o
    try {
      const { results, provider } = await callGPT(sols);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, results, provider, claudeFallback: true }),
      };
    } catch (gptErr) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Both providers failed. Claude: " + claudeErr.message + " | GPT: " + gptErr.message,
        }),
      };
    }
  }
};
