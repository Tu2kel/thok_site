// netlify/functions/scc-usaspending.js
// Proxy to USASpending.gov public API — no auth required.
// Actions: awardsByFsc | laneSummary
// Both filtered to Defense Logistics Agency + contract award types only.

const USA = "https://api.usaspending.gov/api/v2";

const DLA = { type: "awarding", tier: "subtier", name: "Defense Logistics Agency" };
const CONTRACT_TYPES = ["A", "B", "C", "D"];

// Returns "YYYY-10-01" for N fiscal years back from today
function fyStart(yearsBack = 2) {
  const now = new Date();
  const curFyYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return `${curFyYear - (yearsBack - 1)}-10-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function usaFetch(path, body) {
  const res = await fetch(`${USA}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`USASpending ${path} → ${res.status}`);
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { action, fsc } = body;

  if (!fsc) return { statusCode: 400, headers, body: JSON.stringify({ error: "fsc required" }) };

  const timePeriod = [{ start_date: fyStart(2), end_date: today() }];
  const baseFilters = {
    award_type_codes: CONTRACT_TYPES,
    agencies: [DLA],
    product_or_service_codes: [fsc],
    time_period: timePeriod,
  };

  try {
    // ── awardsByFsc — last 10 DLA contract awards for this FSC ──────────
    if (action === "awardsByFsc") {
      const data = await usaFetch("/search/spending_by_award/", {
        filters: baseFilters,
        fields: ["Award ID", "Recipient Name", "Award Amount", "Start Date", "Description"],
        sort: "Start Date",
        order: "desc",
        limit: 10,
        page: 1,
      });

      const awards = (data.results || []).map(r => ({
        id:          r["Award ID"]      || "",
        recipient:   r["Recipient Name"] || "—",
        amount:      r["Award Amount"]  || 0,
        date:        r["Start Date"]    || "",
        description: (r["Description"] || "").slice(0, 120),
      }));

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, result: { awards, total: data.page_metadata?.total || 0 } }),
      };
    }

    // ── laneSummary — total DLA spend + top 5 recipients for this FSC ──
    if (action === "laneSummary") {
      const [summary, recipients] = await Promise.all([
        usaFetch("/search/transaction_spending_summary/", { filters: baseFilters }),
        usaFetch("/search/spending_by_category/recipient/", {
          filters: baseFilters,
          limit: 5,
          page: 1,
        }),
      ]);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          result: {
            total_obligations: summary.prime_award_obligations || 0,
            award_count:       summary.prime_award_count       || 0,
            top_recipients:    (recipients.results || []).map(r => ({
              name:   r.name   || "—",
              amount: r.amount || 0,
              id:     r.id     || "",
            })),
          },
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
  } catch (err) {
    console.error("scc-usaspending error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
