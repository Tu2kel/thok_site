// netlify/functions/scc-usaspending.js
// Proxy to USASpending.gov public API — no auth required.
// Actions: awardsByFsc | laneSummary
// Both filtered to Defense Logistics Agency + contract award types only.
// laneSummary also cross-refs top recipients against the distributor DB.

const { MongoClient } = require("mongodb");
const USA = "https://api.usaspending.gov/api/v2";
const URI = process.env.MONGODB_URI;
const DB_NAME = "scc_db";

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  return client.db(DB_NAME);
}

// Normalize a company name for fuzzy matching
function normName(s) {
  return (s || "")
    .toUpperCase()
    .replace(/\b(INC|LLC|CORP|LTD|CO|LP|LLP|INCORPORATED|CORPORATION|COMPANY|LIMITED)\b\.?/g, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

    // ── laneSummary — total DLA spend + top 10 recipients; cross-refs against vendor DB ──
    if (action === "laneSummary") {
      const [summary, recipients] = await Promise.all([
        usaFetch("/search/transaction_spending_summary/", { filters: baseFilters }),
        usaFetch("/search/spending_by_category/recipient/", {
          filters: baseFilters,
          limit: 10,
          page: 1,
        }),
      ]);

      const rawRecipients = recipients.results || [];
      const top_recipients = rawRecipients.map(r => ({
        name:   r.name   || "—",
        amount: r.amount || 0,
        code:   r.code   || "",
        id:     r.id     || "",
      }));

      // Cross-reference recipients against the distributor DB
      let competitor_matches = [];
      try {
        const db = await getDb();
        const dist = db.collection("distributors");

        // Build lookup sets from recipients
        const ueiSet  = new Set(rawRecipients.map(r => r.code).filter(Boolean));
        const normSet = new Map(rawRecipients.map(r => [normName(r.name), r]));

        // Query DB: match by UEI first, then name-normalized fallback
        const ueiMatches = ueiSet.size > 0
          ? await dist.find(
              { uei: { $in: [...ueiSet] }, is_dns: { $ne: true } },
              { projection: { id: 1, name: 1, uei: 1, email: 1 } }
            ).toArray()
          : [];

        const alreadyMatchedIds = new Set(ueiMatches.map(v => v.id));

        // Name-based fallback: pull all non-DNS vendors and normalize-compare
        const allVendors = await dist.find(
          { is_dns: { $ne: true } },
          { projection: { id: 1, name: 1, uei: 1, email: 1 } }
        ).toArray();

        const nameMatches = allVendors.filter(v => {
          if (alreadyMatchedIds.has(v.id)) return false;
          const nn = normName(v.name);
          return nn.length > 3 && normSet.has(nn);
        });

        const allMatches = [...ueiMatches, ...nameMatches];

        competitor_matches = allMatches.map(v => {
          let usaR = rawRecipients.find(r => r.code && r.code === v.uei);
          if (!usaR) usaR = rawRecipients.find(r => normName(r.name) === normName(v.name));
          return {
            db_id:    v.id,
            db_name:  v.name,
            db_email: v.email || null,
            usa_name: usaR ? usaR.name : v.name,
            usa_amount: usaR ? (usaR.amount || 0) : 0,
            usa_code:   usaR ? (usaR.code  || "") : "",
          };
        });

        // Auto-flag all matches as DNS immediately — no user action needed
        if (allMatches.length > 0) {
          const ids = allMatches.map(v => v.id);
          const reason = `USASpending: DLA top award recipient in FSC ${fsc} — direct competitor, will not quote`;
          await dist.updateMany(
            { id: { $in: ids } },
            { $set: { is_dns: true, dns_reason: reason } }
          );
        }
      } catch (dbErr) {
        console.error("competitor cross-ref error:", dbErr.message);
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: true,
          result: {
            total_obligations:  summary.prime_award_obligations || 0,
            award_count:        summary.prime_award_count       || 0,
            top_recipients,
            competitor_matches,
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
