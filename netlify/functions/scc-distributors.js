// netlify/functions/scc-distributors.js
// Imperio SCC — Distributor database (serverless)
// Handles CRUD for the distributors collection.
// NSN/part-prefix merges into existing records — never duplicates by company id.

const { MongoClient } = require("mongodb");

const URI = process.env.MONGODB_URI;
const DB = "scc_db";

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
  incoming.forEach((v) => set.add(String(v)));
  return [...set];
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const { action, payload } = body;

  try {
    const db = await getDb();
    const dist = db.collection("distributors");

    let result;

    switch (action) {
      // ── Get all distributors ──
      case "distGetAll": {
        const all = await dist.find({}).sort({ tier: 1, name: 1 }).toArray();
        // Normalize: if record uses 'fsc_codes' (solGo schema), copy to 'fsc'
        result = all.map((d) => {
          if (!d.fsc && d.fsc_codes) d.fsc = d.fsc_codes;
          if (!d.fsc) d.fsc = [];
          return d;
        });
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
            known_nsns: mergeUnique(existing.known_nsns, record.known_nsns),
            part_prefixes: mergeUnique(
              existing.part_prefixes,
              record.part_prefixes,
            ),
            fsc:  record.fsc  != null ? record.fsc  : (existing.fsc  || []),
            tags: record.tags != null ? record.tags : (existing.tags || []),
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
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "records must be an array" }),
          };
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
                known_nsns: mergeUnique(existing.known_nsns, record.known_nsns),
                part_prefixes: mergeUnique(
                  existing.part_prefixes,
                  record.part_prefixes,
                ),
                fsc: mergeUnique(existing.fsc, record.fsc),
                tags: mergeUnique(existing.tags, record.tags),
              };
              await dist.replaceOne({ id: record.id }, merged, {
                upsert: true,
              });
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

      // ── Log vendor outreach response for a P/N ──────────────────────────
      // entry = { pn, response: "bid"|"no_bid"|"pending", price?, qty?,
      //           lead_time?, reason?, sol?, date? }
      case "distLogOutreach": {
        const { id, entry } = payload;
        if (!id || !entry?.pn || !entry?.response) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "id, entry.pn, and entry.response required" }),
          };
        }
        const rec = await dist.findOne({ id });
        if (!rec) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: `Distributor not found: ${id}` }),
          };
        }
        const dated = { ...entry, date: entry.date || new Date().toISOString().slice(0, 10) };
        const updateOps = { $push: { outreach_log: dated } };
        if (entry.response === "no_bid") {
          updateOps.$addToSet = { passed_pns: entry.pn };
        }
        await dist.updateOne({ id }, updateOps);
        result = { action: "outreach_logged", id, pn: entry.pn, response: entry.response };
        break;
      }

      // ── Add NSN to existing distributor by id ──
      case "distAddNSN": {
        const { id, nsn, part_numbers } = payload;
        const existing = await dist.findOne({ id });
        if (!existing) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: `Distributor not found: ${id}` }),
          };
        }
        await dist.updateOne(
          { id },
          {
            $addToSet: {
              known_nsns: nsn,
              part_prefixes: { $each: part_numbers || [] },
            },
          },
        );
        result = { action: "nsn_added", id, nsn };
        break;
      }

      // ── Get distributors by FSC code ──
      // Queries both 'fsc' (SCC seed schema) and 'fsc_codes' (solGo export schema)
      case "distGetByFSC": {
        const { fsc } = payload;
        result = await dist
          .find({ $or: [{ fsc: fsc }, { fsc_codes: fsc }] })
          .sort({ tier: 1 })
          .toArray();
        break;
      }

      // ── Get distributors that carry a specific NSN ──
      case "distGetByNSN": {
        const { nsn } = payload;
        result = await dist
          .find({ known_nsns: nsn })
          .sort({ tier: 1 })
          .toArray();
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
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "records must be an array" }),
          };
        }
        let inserted = 0,
          skipped = 0;
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

      // ── Dedup by name — merge all records with same name into one ──
      case "distDedup": {
        const all = await dist.find({}).toArray();

        const groups = {};
        for (const d of all) {
          const key = (d.name || "").trim().toLowerCase();
          if (!key) continue;
          if (!groups[key]) groups[key] = [];
          groups[key].push(d);
        }

        let merged = 0,
          deleted = 0;
        for (const [, group] of Object.entries(groups)) {
          if (group.length < 2) continue;

          group.sort((a, b) => {
            const score = (r) =>
              (r.phone ? 10 : 0) +
              (r.website ? 5 : 0) +
              (r.email ? 5 : 0) +
              (r.fsc ? r.fsc.length : 0) +
              (r.tags ? r.tags.length : 0);
            return score(b) - score(a);
          });

          const primary = group[0];
          const rest = group.slice(1);

          const mergedRecord = { ...primary };
          for (const r of rest) {
            mergedRecord.phone = mergedRecord.phone || r.phone;
            mergedRecord.website = mergedRecord.website || r.website;
            mergedRecord.email = mergedRecord.email || r.email;
            mergedRecord.search_url = mergedRecord.search_url || r.search_url;
            mergedRecord.notes = mergedRecord.notes || r.notes;
            mergedRecord.fsc = mergeUnique(mergedRecord.fsc, r.fsc);
            mergedRecord.tags = mergeUnique(mergedRecord.tags, r.tags);
            mergedRecord.known_nsns = mergeUnique(
              mergedRecord.known_nsns,
              r.known_nsns,
            );
            mergedRecord.part_prefixes = mergeUnique(
              mergedRecord.part_prefixes,
              r.part_prefixes,
            );
          }

          await dist.replaceOne({ id: primary.id }, mergedRecord, {
            upsert: true,
          });
          merged++;

          for (const r of rest) {
            await dist.deleteOne({ id: r.id });
            deleted++;
          }
        }

        result = { merged, deleted };
        break;
      }

      // ── Batch delete by id array ──
      case "distBatchDelete": {
        const { ids } = payload;
        if (!Array.isArray(ids) || ids.length === 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "ids must be a non-empty array" }),
          };
        }
        const del = await dist.deleteMany({ id: { $in: ids } });
        result = { deleted: del.deletedCount, requested: ids.length };
        break;
      }

      // ── Purge entire collection ──
      case "distPurge": {
        const { count } = await dist.countDocuments({});
        await dist.deleteMany({});
        result = { purged: count };
        break;
      }

      // ── Flag a vendor as Do Not Send ──
      case "distSetDns": {
        const { id, reason } = payload;
        if (!id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "id required" }) };
        }
        const res = await dist.updateOne(
          { id },
          { $set: { is_dns: true, dns_reason: reason || "Flagged as competitor" } }
        );
        result = { updated: res.modifiedCount, id };
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
