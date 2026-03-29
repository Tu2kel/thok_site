// netlify/functions/cage-phones.js
// Imperio SCC — CAGE phone lookup table
// Collection: scc_db.cage_phones
// Actions: cagePhoneGet, cagePhoneSave

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

function clean(obj) {
  if (!obj) return obj;
  const { _id, ...rest } = obj;
  return rest;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };

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
    const col = db.collection("cage_phones");
    let result;

    switch (action) {
      // Get phone by CAGE code
      case "cagePhoneGet": {
        const { cage } = payload;
        const rec = await col.findOne({ cage });
        result = rec ? clean(rec) : null;
        break;
      }

      // Upsert phone for a CAGE
      case "cagePhoneSave": {
        const { cage, name, phone } = payload;
        await col.updateOne(
          { cage },
          { $set: { cage, name, phone, updated: new Date().toISOString() } },
          { upsert: true },
        );
        result = { ok: true, cage, phone };
        break;
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Unknown action: " + action }),
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, result }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
