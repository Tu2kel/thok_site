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
    // Callers rejected by the updater's unattended-apply block. This is how the
    // still-unidentified scheduler that POSTs "apply" daily at 22:00 UTC gets named.
    const blocked = await db.collection("_meta").findOne({ _id: "fsc_blocked_calls" });
    if (doc) return { statusCode: 200, headers: hdrs, body: JSON.stringify({ ...doc, blocked_calls: blocked ? blocked.calls : [] }) };
    // Diagnostic: which db are we on, and does a write even work here?
    const dbName = db.databaseName;
    const metaIds = (await db.collection("_meta").find({}, { projection: { _id: 1 } }).limit(30).toArray()).map(d => d._id);
    let writeTest = "untested";
    try {
      await db.collection("_meta").updateOne({ _id: "fsc_writetest" }, { $set: { at: new Date().toISOString() } }, { upsert: true });
      const back = await db.collection("_meta").findOne({ _id: "fsc_writetest" });
      writeTest = back ? "ok" : "wrote-but-not-read";
    } catch (e) { writeTest = "FAILED: " + e.message; }
    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ note: "no fsc_last_run", db: dbName, meta_ids: metaIds, writeTest }) };
  } catch (e) {
    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ error: e.message }) };
  }
};
