// netlify/functions/scc-db.js
// Imperio SCC — MongoDB persistence layer (serverless)
// Handles all CRUD for solicitations, vendor_intel, and archive collections.

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
    const sols = db.collection("solicitations");
    const vi = db.collection("vendor_intel");
    const arc = db.collection("archive");

    let result;

    switch (action) {
      // ── Solicitations ──
      case "dbSave": {
        const { record } = payload;
        await sols.replaceOne({ sol_number: record.sol_number }, record, {
          upsert: true,
        });
        result = true;
        break;
      }
      case "dbGetAll": {
        result = await sols.find({}).toArray();
        break;
      }
      case "dbDelete": {
        await sols.deleteOne({ sol_number: payload.sol_number });
        result = true;
        break;
      }

      // ── Archive ──
      case "dbArchive": {
        const { sol_number, reason } = payload;
        const rec = await sols.findOne({ sol_number });
        if (!rec) {
          result = false;
          break;
        }
        const archived = {
          ...rec,
          archived: true,
          archive_reason: reason || "expired",
          archive_date: new Date().toLocaleDateString(),
        };
        await arc.replaceOne({ sol_number }, archived, { upsert: true });
        await sols.deleteOne({ sol_number });
        result = true;
        break;
      }
      case "dbGetArchive": {
        result = await arc.find({}).sort({ archive_date: -1 }).toArray();
        break;
      }
      case "dbRestoreFromArchive": {
        const { sol_number } = payload;
        const rec = await arc.findOne({ sol_number });
        if (!rec) {
          result = false;
          break;
        }
        const { archived, archive_reason, archive_date, _id, ...restored } =
          rec;
        await sols.replaceOne({ sol_number }, restored, { upsert: true });
        await arc.deleteOne({ sol_number });
        result = true;
        break;
      }
      case "dbDeleteFromArchive": {
        await arc.deleteOne({ sol_number: payload.sol_number });
        result = true;
        break;
      }

      // ── Vendor Intel ──
      case "viSave": {
        const { rec } = payload;
        await vi.replaceOne({ id: rec.id }, rec, { upsert: true });
        result = true;
        break;
      }
      case "viGetAll": {
        result = await vi.find({}).toArray();
        break;
      }
      case "viDelete": {
        await vi.deleteOne({ id: payload.id });
        result = true;
        break;
      }
      case "viGetByNSN": {
        const docs = await vi.find({ nsn: payload.nsn }).toArray();
        const rank = { confirmed: 0, quoted: 1, pending: 2, no_stock: 3 };
        result = docs.sort(
          (a, b) =>
            (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
            (parseFloat(a.unit_price) || 999) -
              (parseFloat(b.unit_price) || 999),
        );
        break;
      }

      // ── Bulk export (for backup download) ──
      case "exportAll": {
        result = {
          version: 4,
          exported: new Date().toISOString(),
          solicitations: await sols.find({}).toArray(),
          vendor_intel: await vi.find({}).toArray(),
          archive: await arc.find({}).toArray(),
        };
        break;
      }

      // ── Bulk import (merge, no overwrites) ──
      case "importAll": {
        const {
          solicitations = [],
          vendor_intel = [],
          archive: arcData = [],
        } = payload;
        let solCount = 0,
          viCount = 0;
        for (const r of solicitations) {
          const exists = await sols.findOne({ sol_number: r.sol_number });
          if (!exists) {
            await sols.insertOne(r);
            solCount++;
          }
        }
        for (const r of vendor_intel) {
          const exists = await vi.findOne({ id: r.id });
          if (!exists) {
            await vi.insertOne(r);
            viCount++;
          }
        }
        for (const r of arcData) {
          const exists = await arc.findOne({ sol_number: r.sol_number });
          if (!exists) {
            await arc.insertOne(r);
          }
        }
        result = { solCount, viCount };
        break;
      }

      // ── Supplier Rolodex ──
      case "saveSupplier": {
        const sup = body.supplier;
        if (!sup || !sup.id) {
          result = false;
          break;
        }
        const rolodex = db.collection("supplier_rolodex");
        await rolodex.replaceOne({ id: sup.id }, sup, { upsert: true });
        result = true;
        break;
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Unknown action: ${action}` }),
        };
    }

    // Strip MongoDB _id fields from output
    const clean = (obj) => {
      if (Array.isArray(obj)) return obj.map(clean);
      if (obj && typeof obj === "object") {
        const { _id, ...rest } = obj;
        return rest;
      }
      return obj;
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, result: clean(result) }),
    };
  } catch (err) {
    console.error("scc-db error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
