// netlify/functions/scc-rfq-inbox.js
// Fast data-query layer for the Inbox Monitor UI.
// IMAP scanning moved to scc-rfq-inbox-background.js (15-min background function).
//
// Actions (POST): getReport | getScanLog | clearProcessed
// Env: MONGODB_URI

const { MongoClient } = require("mongodb");

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db("scc_db");
}

async function buildDailyReport(db, dateStr) {
  const responses = await db.collection("rfq_responses")
    .find({ date: dateStr })
    .sort({ sol_number: 1, unit_price: 1 })
    .toArray();

  const bySol = {};
  for (const r of responses) {
    if (!bySol[r.sol_number]) bySol[r.sol_number] = { item_name: r.item_name || "", quotes: [], no_bids: [] };
    if (r.type === "no_bid") bySol[r.sol_number].no_bids.push(r);
    else bySol[r.sol_number].quotes.push(r);
  }

  const sols = Object.entries(bySol).map(([sol_number, { item_name, quotes, no_bids }]) => {
    const best = quotes.length
      ? quotes.reduce((b, q) => (q.unit_price || Infinity) < (b.unit_price || Infinity) ? q : b, quotes[0])
      : null;
    return {
      sol_number, item_name,
      quote_count: quotes.length, no_bid_count: no_bids.length,
      best_vendor: best ? (best.vendor_name || best.vendor_email) : null,
      best_price:  best ? best.unit_price : null,
      best_hist_flag:   best ? best.hist_flag   : null,
      best_margin_flag: best ? best.margin_flag  : null,
      best_target_bid:  best ? best.target_bid   : null,
      action: quotes.length === 0 && no_bids.length > 0 ? "ALL_NO_BID"
            : best && best.hist_flag === "OVER"          ? "REVIEW_PRICE"
            : best && best.margin_flag === "NEGATIVE"    ? "MARGIN_NEGATIVE"
            : null,
      quotes, no_bids,
    };
  }).sort((a, b) => {
    if (a.quote_count > 0 && b.quote_count === 0) return -1;
    if (b.quote_count > 0 && a.quote_count === 0) return 1;
    return a.sol_number.localeCompare(b.sol_number);
  });

  return {
    date: dateStr,
    total_responses: responses.length,
    total_quotes:    responses.filter(r => r.type === "quote").length,
    total_no_bids:   responses.filter(r => r.type === "no_bid").length,
    total_sols:      sols.length,
    sols,
    generated_at: new Date().toISOString(),
  };
}

exports.handler = async (event) => {
  const h = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: h, body: "" };

  let action = "getReport", payload = {};
  if (event.body) {
    try { const b = JSON.parse(event.body); action = b.action || action; payload = b; } catch {}
  }

  try {
    const db = await getDb();

    if (action === "getReport") {
      const report = await buildDailyReport(db, payload.date || new Date().toISOString().slice(0, 10));
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, report }) };
    }

    if (action === "getScanLog") {
      const logs = await db.collection("rfq_scan_log").find({}).sort({ scanned_at: -1 }).limit(20).toArray();
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, logs }) };
    }

    if (action === "clearProcessed") {
      await db.collection("_meta").deleteOne({ _id: "rfq_inbox_processed" });
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, message: "Processed IDs cleared — next scan will recheck all emails from the last 7 days" }) };
    }

    return { statusCode: 400, headers: h, body: JSON.stringify({ ok: false, error: "Unknown action: " + action + ". Scan runs via scc-rfq-inbox-background." }) };

  } catch (e) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
