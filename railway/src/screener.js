// src/screener.js — Claude batch analysis (mirrors analyze-sols Netlify function)
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a federal procurement analyst for Imperio Federal Logistics (SDVOSB, CAGE 152U4).
Analyze each DLA solicitation and return a JSON array with one object per solicitation.

For each sol return:
{
  "sol_number": "...",
  "verdict": "GO" | "VERIFY FIRST" | "REJECT",
  "reason": "one sentence",
  "winProbabilityPct": 0-100,
  "sourcing_path": "brief supplier strategy",
  "claudeReason": "same as reason"
}

GO = clean commercial item, we can source it, good margin potential.
VERIFY FIRST = possible OEM restriction, unusual spec, mil-spec only, or unusual set-aside.
REJECT = clearly OEM-only source, weapon system only, hazmat we cannot handle, or no commercial equivalent exists.

Respond with ONLY a JSON array, no prose.`;

function info(...a) { console.log("[screener]", ...a); }

async function screenBatch(sols) {
  if (!sols.length) return [];

  // Batch in groups of 40 to stay under Claude context limits
  const BATCH = 40;
  const results = [];

  for (let i = 0; i < sols.length; i += BATCH) {
    const chunk = sols.slice(i, i + BATCH);
    info("Screening " + chunk.length + " sols (batch " + Math.floor(i / BATCH + 1) + "/" + Math.ceil(sols.length / BATCH) + ")…");

    const prompt = JSON.stringify(chunk.map(s => ({
      sol_number:           s.sol_number,
      item_name:            s.item_name,
      nsn:                  s.nsn,
      fsc:                  s.fsc,
      ref_part_number:      s.ref_part_number || s.piece_part_no,
      quantity:             s.qty || s.quantity,
      unit_price:           s.hist_price || s.unit_price,
      ext_price:            s.ext_price,
      set_aside:            s.set_aside,
      supplier_restrictions: s.supplier_restrictions,
      material:             s.material,
      part_char:            s.part_char,
      supplier_list:        s.supplier_list,
    })));

    try {
      const msg = await client.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 4096,
        system:     SYSTEM,
        messages:   [{ role: "user", content: "Analyze these solicitations:\n" + prompt }],
      });

      const text = msg.content[0]?.text || "[]";
      const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || "[]");
      results.push(...parsed);
      info("Batch complete — " + parsed.length + " results");
    } catch (e) {
      info("Claude batch failed: " + e.message + " — defaulting GO for batch");
      results.push(...chunk.map(s => ({
        sol_number:        s.sol_number,
        verdict:           "GO",
        reason:            "Claude unavailable — manual review recommended",
        winProbabilityPct: 50,
        sourcing_path:     "",
        claudeReason:      "Claude unavailable",
      })));
    }

    // Rate limit breathing room between batches
    if (i + BATCH < sols.length) await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

module.exports = { screenBatch };
