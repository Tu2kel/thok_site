// netlify/functions/scc-fsc-lastrun.js — returns the FSC Updater's last run result.
// Fast sync read of _meta.fsc_last_run (the background updater persists it there),
// so the run's proposed/applied changes are inspectable without waiting on email.
const { MongoClient } = require("mongodb");
let _client;
async function getDb() {
  if (!_client) { _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); await _client.connect(); }
  return _client.db();
}
exports.handler = async () => {
  const hdrs = { "Content-Type": "application/json" };
  try {
    const db = await getDb();
    const doc = await db.collection("_meta").findOne({ _id: "fsc_last_run" });
    return { statusCode: 200, headers: hdrs, body: JSON.stringify(doc || { note: "no run stored yet" }) };
  } catch (e) {
    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ error: e.message }) };
  }
};
