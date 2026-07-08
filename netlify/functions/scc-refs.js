// netlify/functions/scc-refs.js — IFL ref lookup
// POST { ref: "IFL-260707-01" } → { sol_number, item_name, fsc, nsn, ref_part_number, blast_date }
const { MongoClient } = require("mongodb");

let _client = null;
async function getDb() {
  if (!_client) _client = new MongoClient(process.env.MONGODB_URI);
  await _client.connect();
  return _client.db();
}

exports.handler = async (ev) => {
  if (ev.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  let body;
  try { body = JSON.parse(ev.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const ref = (body.ref || "").trim().toUpperCase();
  if (!ref) return { statusCode: 400, body: "ref required" };

  try {
    const db  = await getDb();
    const doc = await db.collection("rfq_refs").findOne({ ref });
    if (!doc) return { statusCode: 404, body: JSON.stringify({ error: "Ref not found: " + ref }) };
    const { _id, ...result } = doc;
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
