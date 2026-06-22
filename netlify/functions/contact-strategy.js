// netlify/functions/contact-strategy.js
// Imperio SCC — Batch CAGE contact lookup
// POST: { cages: ["73197", "L4528", ...] }
// Returns: { ok, contacts: { "73197": { cage, companyName, phone, email, strategy } } }
// strategy: "call" | "email" | "lookup"

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

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };

  let cages;
  try {
    const body = JSON.parse(event.body || "{}");
    cages = (body.cages || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: "Bad request" }) };
  }

  if (!cages.length) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, contacts: {} }) };
  }

  try {
    const db = await getDb();
    const phoneCol = db.collection("cage_phones");

    // Batch fetch — cage_phones stores cage in mixed case; try as-is and uppercased
    const records = await phoneCol.find({ cage: { $in: [...cages, ...cages.map((c) => c.toLowerCase())] } }).toArray();

    // Build map: normalized CAGE → contact record
    const contacts = {};
    for (const r of records) {
      const key = String(r.cage || "").toUpperCase().trim();
      if (!key) continue;
      const hasPhone = !!(r.phone && r.phone.trim());
      const hasEmail = !!(r.email && r.email.trim());
      contacts[key] = {
        cage: key,
        companyName: r.name || r.companyName || "",
        phone: r.phone || "",
        email: r.email || "",
        strategy: hasEmail ? "email" : hasPhone ? "call" : "lookup",
      };
    }

    // For CAGEs not found, return empty lookup entry
    for (const cage of cages) {
      if (!contacts[cage]) {
        contacts[cage] = { cage, companyName: "", phone: "", email: "", strategy: "lookup" };
      }
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, contacts }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
