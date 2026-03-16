// netlify/functions/scc-distributors.js
// Imperio SCC — Distributor database (serverless)
// Handles CRUD for the distributors collection.
// NSN/part-prefix merges into existing records — never duplicates by company id.

const { MongoClient } = require("mongodb");

const URI = process.env.MONGODB_URI;
const DB  = "scc_db";

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  return client.db(DB);
}

// Strip _id from output
function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === "object") {
    const { _id, ...rest } = obj;
    return rest;
  }
  return obj;
}

// Merge arrays without duplicates
function mergeUnique(existing = [], incoming = []) {
  const set = new Set(existing.map(String));
  incoming.forEach(v => set.add(String(v)));
  return [...set];
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { action, payload } = body;

  try {
    const db   = await getDb();
    const dist = db.collection("distributors");

    let result;

    switch (action) {

      // ── Get all distributors ──
      case "distGetAll": {
        result = await dist.find({}).sort({ tier: 1, name: 1 }).toArray();
        break;
      }

      // ── Upsert single distributor ──
      // If id exists: merges known_nsns + part_prefixes, updates other fields.
      // If new: inserts as-is.
      case "distSave": {
        const { record } = payload;
        const existing = await dist.findOne({ id: record.id });

        if (existing) {
          const merged = {
            ...existing,
            ...record,
            known_nsns:    mergeUnique(existing.known_nsns,    record.known_nsns),
            part_prefixes: mergeUnique(existing.part_prefixes, record.part_prefixes),
            fsc:           mergeUnique(existing.fsc,           record.fsc),
            tags:          mergeUnique(existing.tags,          record.tags),
          };
          await dist.replaceOne({ id: record.id }, merged, { upsert: true });
          result = { action: "merged", id: record.id };
        } else {
          await dist.insertOne(record);
          result = { action: "inserted", id: record.id };
        }
        break;
      }

      // ── Batch upsert — drop raw intel array, each entry merged/inserted ──
      case "distBatch": {
        const { records } = payload;
        if (!Array.isArray(records)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "records must be an array" }) };
        }
        const summary = { inserted: 0, merged: 0, errors: [] };

        for (const record of records) {
          try {
            if (!record.id) {
              summary.errors.push(`Missing id: ${record.name}`);
              continue;
            }
            const existing = await dist.findOne({ id: record.id });
            if (existing) {
              const merged = {
                ...existing,
                ...record,
                known_nsns:    mergeUnique(existing.known_nsns,    record.known_nsns),
                part_prefixes: mergeUnique(existing.part_prefixes, record.part_prefixes),
                fsc:           mergeUnique(existing.fsc,           record.fsc),
                tags:          mergeUnique(existing.tags,          record.tags),
              };
              await dist.replaceOne({ id: record.id }, merged, { upsert: true });
              summary.merged++;
            } else {
              await dist.insertOne(record);
              summary.inserted++;
            }
          } catch (e) {
            summary.errors.push(`${record.id}: ${e.message}`);
          }
        }
        result = summary;
        break;
      }

      // ── Add NSN to existing distributor by id ──
      case "distAddNSN": {
        const { id, nsn, part_numbers } = payload;
        const existing = await dist.findOne({ id });
        if (!existing) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: `Distributor not found: ${id}` }) };
        }
        await dist.updateOne({ id }, {
          $addToSet: {
            known_nsns:    nsn,
            part_prefixes: { $each: part_numbers || [] },
          }
        });
        result = { action: "nsn_added", id, nsn };
        break;
      }

      // ── Get distributors by FSC code ──
      case "distGetByFSC": {
        const { fsc } = payload;
        result = await dist.find({ fsc: fsc }).sort({ tier: 1 }).toArray();
        break;
      }

      // ── Get distributors that carry a specific NSN ──
      case "distGetByNSN": {
        const { nsn } = payload;
        result = await dist.find({ known_nsns: nsn }).sort({ tier: 1 }).toArray();
        break;
      }

      // ── Delete distributor by id ──
      case "distDelete": {
        await dist.deleteOne({ id: payload.id });
        result = true;
        break;
      }

      // ── Seed from existing in-memory distributors.js array ──
      // POST the full array once to migrate flat file → Mongo
      case "distSeedFromArray": {
        const { records } = payload;
        if (!Array.isArray(records)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "records must be an array" }) };
        }
        let inserted = 0, skipped = 0;
        for (const record of records) {
          const exists = await dist.findOne({ id: record.id });
          if (!exists) {
            await dist.insertOne(record);
            inserted++;
          } else {
            skipped++;
          }
        }
        result = { inserted, skipped };
        break;
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Unknown action: ${action}` }),
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, result: clean(result) }),
    };

  } catch (err) {
    console.error("scc-distributors error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
