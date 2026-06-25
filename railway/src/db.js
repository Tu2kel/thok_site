// src/db.js — shared MongoDB connection
const { MongoClient } = require("mongodb");

const URI = process.env.MONGODB_URI;
const DB_NAME = "scc_db";

let _client;

async function getDb() {
  if (!_client) {
    _client = new MongoClient(URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

async function getDistributors(db) {
  return db.collection("distributors").find({}).toArray();
}

async function getNsnWatchList(db) {
  return db.collection("nsn_watch").find({}).toArray();
}

async function upsertNsnWatch(db, items) {
  const col = db.collection("nsn_watch");
  const ops = items
    .filter(i => i.nsn)
    .map(i => ({
      updateOne: {
        filter: { nsn: i.nsn },
        update: { $set: { ...i, updated_at: new Date().toISOString() }, $setOnInsert: { date_added: i.date_added || new Date().toISOString().slice(0, 10) } },
        upsert: true,
      },
    }));
  if (!ops.length) return 0;
  const r = await col.bulkWrite(ops);
  return r.upsertedCount + r.modifiedCount;
}

async function getAlreadyActedSols(db) {
  const acted = await db.collection("solicitations").find(
    { status: { $in: ["Awaiting Quotes", "Bid Submitted", "Awarded", "Lost", "Outreach"] } },
    { projection: { sol_number: 1 } },
  ).toArray();
  return new Set(acted.map(s => s.sol_number));
}

async function saveSol(db, record) {
  await db.collection("solicitations").updateOne(
    { sol_number: record.sol_number },
    { $set: record },
    { upsert: true },
  );
}

// ── BLAST LOG ────────────────────────────────────────────────────────────────

// Save one send entry per sol+vendor pair (upsert — re-send updates timestamp)
async function saveBlastEntry(db, { sol_number, vendor_name, vendor_email, vendor_id, status, error }) {
  const email = (vendor_email || "").toLowerCase();
  await db.collection("blast_log").updateOne(
    { sol_number, vendor_email: email },
    { $set: { sol_number, vendor_name, vendor_email: email, vendor_id: vendor_id || null, status, error: error || null, sent_at: new Date().toISOString() } },
    { upsert: true },
  );
}

// Returns Set of sol_numbers already sent to this vendor (status=sent only)
async function getSentSolsForVendor(db, vendor_email, sol_numbers) {
  if (!sol_numbers.length) return new Set();
  const rows = await db.collection("blast_log").find({
    vendor_email: (vendor_email || "").toLowerCase(),
    sol_number: { $in: sol_numbers },
    status: "sent",
  }).toArray();
  return new Set(rows.map(r => r.sol_number));
}

// ── DAILY BRIEFS ─────────────────────────────────────────────────────────────

async function saveDailyBrief(db, brief) {
  await db.collection("blast_briefs").insertOne({ ...brief, created_at: new Date().toISOString() });
}

async function getDailyBriefs(db, limit = 60) {
  return db.collection("blast_briefs").find({}).sort({ created_at: -1 }).limit(limit).toArray();
}

module.exports = { getDb, getDistributors, getNsnWatchList, upsertNsnWatch, getAlreadyActedSols, saveSol, saveBlastEntry, getSentSolsForVendor, saveDailyBrief, getDailyBriefs };
