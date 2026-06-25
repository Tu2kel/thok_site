// netlify/functions/scc-blast-log.js
// Blast log + daily briefs CRUD for the SCC Briefs tab
// Actions: getBriefs | getBlastLog | reBlast

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = "scc_db";

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

// ── Gmail helpers for re-blast ────────────────────────────────────────────

let _token = null, _tokenExpiry = 0;

async function getGmailToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Gmail token failed: " + JSON.stringify(data));
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

async function gmailSend(to, subject, body) {
  const FROM = "kelley.anthonyk@gmail.com";
  const msg  = [
    "From: Anthony Kelley | Imperio Federal Logistics <" + FROM + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");

  const token = await getGmailToken();
  const res   = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method:  "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(msg).toString("base64url") }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gmail send failed: " + JSON.stringify(data));
  return data;
}

function dayBefore(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  d.setDate(d.getDate() - 1);
  return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0") + "/" + d.getFullYear();
}

function buildRFQBody(vendor, sols) {
  const vendorName = (typeof vendor === "string") ? vendor : (vendor.poc_first || vendor.poc_name || vendor.name || vendor.company_name);
  const itemLines = sols.map((s, i) => [
    "Item " + (i + 1) + ": " + (s.item_name || "—"),
    s.ref_part_number ? "  Part Number:  " + s.ref_part_number : null,
    "  Quantity:     " + (s.quantity || "—"),
    "  Need By:      " + (dayBefore(s.quote_due) || "—"),
    "  Ref #:        " + s.sol_number,
  ].filter(Boolean).join("\n")).join("\n\n");

  const body = [
    "Hi " + vendorName + ",",
    "",
    "My name is Anthony Kelley — Founder & CEO of Imperio Federal Logistics (CAGE 152U4 · SDVOSB · VetHUB). Quick heads-up: we recently went through a company restructuring and our new corporate email, anthony@ifedlog.com, is still building deliverability as a fresh domain. I'm reaching out from my personal business Gmail in the meantime. Please add kelley.anthonyk@gmail.com to your safe senders.",
    "",
    "I have " + sols.length + " active DLA procurement need" + (sols.length > 1 ? "s" : "") + " in your lane and need pricing and availability on the following:",
    "",
    itemLines,
    "",
    "Requirements:",
    "- Destination: Government delivery address (continental US)",
    "- Payment: Immediate PO upon award. Supplier receives wire payment prior to shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin for each item",
    "- Shipping: FOB Destination required",
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and country of origin. We issue POs immediately upon award and move fast.",
    "",
    "Thank you for your time,",
    "Anthony K Kelley | Founder & CEO",
    "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
    "SDVOSB | VetHUB | (254) 226-5216",
    "kelley.anthonyk@gmail.com | anthony@ifedlog.com | ifedlog.com",
  ].join("\n");

  const subject = "RFQ – " + (sols[0]?.item_name || sols[0]?.sol_number) +
    (sols.length > 1 ? " +" + (sols.length - 1) + " more" : "") +
    " | Imperio Federal Logistics";

  return { subject, body };
}

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { action } = payload;
  const ok  = (d) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, result: d }) });
  const fail = (m) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: m }) });

  try {
    const db = await getDb();

    // ── getBriefs — list recent daily runs ──────────────────────────────
    if (action === "getBriefs") {
      const limit = payload.limit || 60;
      const briefs = await db.collection("blast_briefs")
        .find({}, { projection: { sols: 0, blast_log: 0 } })
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray();
      return ok(briefs);
    }

    // ── getBriefDetail — one brief with full sols + blast_log ───────────
    if (action === "getBriefDetail") {
      const { id } = payload;
      if (!id) return fail("id required");
      const { ObjectId } = require("mongodb");
      const brief = await db.collection("blast_briefs").findOne({ _id: new ObjectId(id) });
      if (!brief) return fail("Not found");

      // Enrich each sol with who was already contacted
      const solNums = (brief.sols || []).map(s => s.sol_number);
      const logs    = await db.collection("blast_log").find({ sol_number: { $in: solNums } }).toArray();
      const logMap  = {};
      for (const l of logs) {
        if (!logMap[l.sol_number]) logMap[l.sol_number] = [];
        logMap[l.sol_number].push(l);
      }
      brief.sols = (brief.sols || []).map(s => ({ ...s, contacts: logMap[s.sol_number] || [] }));
      return ok(brief);
    }

    // ── getBlastLog — all log entries, optionally filtered ──────────────
    if (action === "getBlastLog") {
      const filter = {};
      if (payload.sol_number) filter.sol_number = payload.sol_number;
      if (payload.vendor_email) filter.vendor_email = payload.vendor_email.toLowerCase();
      const logs = await db.collection("blast_log").find(filter).sort({ sent_at: -1 }).limit(500).toArray();
      return ok(logs);
    }

    // ── reBlast — send additional vendors for a sol from the SCC UI ─────
    if (action === "reBlast") {
      const { sol, vendors } = payload;
      if (!sol || !vendors?.length) return fail("sol and vendors required");

      const results = [];
      for (const vendor of vendors) {
        if (!vendor.email) { results.push({ vendor: vendor.name, status: "skipped", reason: "no email" }); continue; }

        // Dedup check
        const existing = await db.collection("blast_log").findOne({
          sol_number: sol.sol_number,
          vendor_email: vendor.email.toLowerCase(),
          status: "sent",
        });
        if (existing) {
          results.push({ vendor: vendor.name, status: "skipped", reason: "already sent on " + existing.sent_at?.slice(0, 10) });
          continue;
        }

        try {
          const { subject, body } = buildRFQBody(vendor, [sol]);
          await gmailSend(vendor.email, subject, body);

          await db.collection("blast_log").updateOne(
            { sol_number: sol.sol_number, vendor_email: vendor.email.toLowerCase() },
            { $set: { sol_number: sol.sol_number, item_name: sol.item_name || "", fsc: sol.fsc || "", quote_due: sol.quote_due || "", vendor_name: vendor.name, vendor_email: vendor.email.toLowerCase(), vendor_id: vendor.id || null, status: "sent", sent_at: new Date().toISOString() } },
            { upsert: true },
          );
          results.push({ vendor: vendor.name, status: "sent" });
        } catch (e) {
          results.push({ vendor: vendor.name, status: "failed", error: e.message });
        }
      }
      return ok(results);
    }

    return fail("Unknown action: " + action);
  } catch (e) {
    return fail(e.message);
  }
};
