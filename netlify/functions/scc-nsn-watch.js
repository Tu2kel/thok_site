// netlify/functions/scc-nsn-watch.js
// Imperio SCC — NSN Watch List CRUD
// Collection: scc_db.nsn_watch
// Fields per doc: nsn, fsc, item_name, sol_number, date_added,
//                 last_unit_price, preferred_cage, win (bool|null), notes

const { MongoClient } = require("mongodb");

const URI = process.env.MONGODB_URI;
const DB  = "scc_db";
const COL = "nsn_watch";

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  return client.db(DB);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")   return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { action, payload } = body;

  try {
    const db  = await getDb();
    const col = db.collection(COL);

    switch (action) {

      case "nsnWatchGetAll": {
        const docs = await col.find({}).sort({ date_added: -1 }).toArray();
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result: docs }) };
      }

      case "nsnWatchUpsert": {
        // payload.items = array of { nsn, fsc, item_name, sol_number, date_added, last_unit_price?, preferred_cage? }
        const items = Array.isArray(payload?.items) ? payload.items : [payload?.item].filter(Boolean);
        if (!items.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, upserted: 0 }) };

        let upserted = 0;
        for (const item of items) {
          if (!item.nsn) continue;
          await col.updateOne(
            { nsn: item.nsn },
            { $set: { ...item, updated_at: new Date().toISOString() }, $setOnInsert: { date_added: item.date_added || new Date().toISOString().slice(0, 10) } },
            { upsert: true },
          );
          upserted++;
        }
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, upserted }) };
      }

      case "nsnWatchDelete": {
        const { nsn } = payload || {};
        if (!nsn) return { statusCode: 400, headers, body: JSON.stringify({ error: "nsn required" }) };
        await col.deleteOne({ nsn });
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      case "nsnWatchUpdate": {
        // Partial update — e.g. mark win: true, set preferred_cage
        const { nsn, ...fields } = payload || {};
        if (!nsn) return { statusCode: 400, headers, body: JSON.stringify({ error: "nsn required" }) };
        await col.updateOne({ nsn }, { $set: { ...fields, updated_at: new Date().toISOString() } });
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      case "nsnWatchCheck": {
        // Given array of NSNs, return which ones are watched
        const nsns = payload?.nsns || [];
        if (!nsns.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result: [] }) };
        const docs = await col.find({ nsn: { $in: nsns } }).toArray();
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result: docs }) };
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
