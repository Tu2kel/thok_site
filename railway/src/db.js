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

module.exports = { getDb, getDistributors, getNsnWatchList, upsertNsnWatch, getAlreadyActedSols, saveSol };
