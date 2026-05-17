// netlify/functions/analyze-sols.js
// Imperio SCC — AI analysis proxy for DIBBS batch triage
//
// Keeps ANTHROPIC_API_KEY and OPENAI_API_KEY server-side (never in browser).
// Tries Claude Sonnet first; falls back to GPT-4o on quota/rate-limit errors.
//
// Env vars required (Netlify → Site config → Environment variables):
//   ANTHROPIC_API_KEY
//   OPENAI_API_KEY

const ANALYSIS_SYSTEM_PROMPT = `You are a senior procurement analyst for Imperio Federal Logistics (CAGE 152U4), an SDVOSB federal supply contractor specializing in DLA DIBBS COTS resale.

For each solicitation, apply the full procurement protocol:

HARD REJECT (output verdict: REJECT) if ANY of:
- Set-aside codes: AL (AbilityOne), FG, PO, FI, H (HUBZone), L, E — ineligible
- AMSC: G, B, or A — government drawing / sole source lock
- AIDC flag in item name
- Blocked CAGEs in supplier_restrictions: 81SA7, R9004, 07482, 062W0, 75Q65
- Blocked OEMs in item name: SureFire, Streamlight, Furuno TZT9F
- QA = QSL
- Restricted drawings with no COTS path
- Prime-dominated FSCs with no resale channel: 1305,1310,1315,1320,1340,1350,1360,1376,2835,2840,1560,1720,1730,5860

GO (verdict: GO) if:
- Passes all hard reject gates
- Item is sourceable via commercial distributor channel (COTS path exists)
- Historical unit price supports 27.5%+ gross margin at 90% cost ceiling
- Net after worst-case FE fees (7.5%) exceeds $500
- Delivery window is achievable (standard commercial lead times)

VERIFY FIRST (verdict: VERIFY FIRST) if:
- Passes hard rejects but has one of: tight margin, spec-designator risk (MS-/MIL-/NAS-/AN- prefix), single approved source that may have dealer channel, short quote deadline, delivery risk

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

// ── Status codes that mean "quota/rate-limit — try the other provider" ──
function isQuotaError(status) {
  return status === 429 || status === 529 || status === 503 || status === 402;
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

// ── Claude Sonnet ────────────────────────────────────────────────────────
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
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMsg(sols) }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error("Claude " + resp.status + ": " + text.slice(0, 200)),
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
      max_tokens: 8000,
      temperature: 0,
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: buildUserMsg(sols) },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error("OpenAI " + resp.status + ": " + text.slice(0, 200)),
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

  let sols;
  try {
    ({ sols } = JSON.parse(event.body || "{}"));
    if (!Array.isArray(sols) || !sols.length)
      throw new Error("sols array required");
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }

  // Try Claude → fall back to GPT-4o on quota/rate errors
  try {
    const { results, provider } = await callClaude(sols);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, results, provider }),
    };
  } catch (claudeErr) {
    if (!isQuotaError(claudeErr.status)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: claudeErr.message,
          provider: "claude",
        }),
      };
    }

    // Claude quota/rate-limit — try GPT-4o
    try {
      const { results, provider } = await callGPT(sols);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          results,
          provider,
          claudeFallback: true,
        }),
      };
    } catch (gptErr) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error:
            "Both providers failed. Claude: " +
            claudeErr.message +
            " | GPT: " +
            gptErr.message,
        }),
      };
    }
  }
};
