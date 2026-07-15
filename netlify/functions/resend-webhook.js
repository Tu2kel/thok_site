// netlify/functions/resend-webhook.js — real-time Resend event handler.
// Resend fires bounce/complaint events at the SMTP level (most never come back
// as a mailer-daemon email to Gmail, so the inbox scan misses them). This
// catches them ALL, in real time, and updates the distributor so the blaster
// stops emailing bad/complaining addresses.
//   email.bounced (hard)  → email_invalid + is_dns  (stop blasting)
//   email.complained      → is_dns                  (never email again)
//
// Setup: in Resend → Webhooks → add this URL, subscribe to email.bounced +
// email.complained, copy the signing secret to Netlify env RESEND_WEBHOOK_SECRET.

const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const DB = "scc_db"; // the distributors collection the blaster actually reads
let _client;
async function getDb() {
  if (!_client) _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await _client.connect();
  return _client.db(DB);
}

const J = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Svix signature verification (Resend uses Svix). Signed content is
// `${id}.${timestamp}.${rawBody}`, key is base64 after the "whsec_" prefix.
function verifySvix(secret, headers, rawBody) {
  try {
    const id = headers["svix-id"] || headers["Svix-Id"];
    const ts = headers["svix-timestamp"] || headers["Svix-Timestamp"];
    const sigHeader = headers["svix-signature"] || headers["Svix-Signature"] || "";
    if (!id || !ts || !sigHeader) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
    const expBuf = Buffer.from(expected);
    return sigHeader.split(" ").some((part) => {
      const sig = part.split(",")[1];
      if (!sig) return false;
      const sigBuf = Buffer.from(sig);
      return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    });
  } catch (e) { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return J(405, { ok: false, error: "POST only" });
  const raw = event.body || "";
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  // Fail closed — this endpoint mutates the vendor DB; never process unsigned calls.
  if (!secret) return J(500, { ok: false, error: "RESEND_WEBHOOK_SECRET not set" });
  if (!verifySvix(secret, event.headers || {}, raw)) return J(401, { ok: false, error: "bad signature" });

  let ev; try { ev = JSON.parse(raw); } catch { return J(400, { ok: false, error: "bad JSON" }); }
  const type = ev.type || "";
  const data = ev.data || {};
  const recips = [].concat(data.to || data.email || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  if (!recips.length) return J(200, { ok: true, ignored: "no recipient" });

  let update = null;
  if (type === "email.bounced") {
    // Resend's email.bounced is a hard/permanent bounce. Transient delays come as
    // email.delivery_delayed (which we intentionally ignore).
    update = { email_invalid: true, email_bounced_at: new Date().toISOString(), is_dns: true,
      dns_reason: "Hard bounce (Resend): " + (data.bounce?.message || data.bounce?.subType || "undeliverable") };
  } else if (type === "email.complained") {
    update = { is_dns: true, complained_at: new Date().toISOString(),
      dns_reason: "Spam complaint (Resend) — suppressed, never email again" };
  } else {
    return J(200, { ok: true, ignored: type }); // delivered/sent/delayed/etc.
  }

  try {
    const db = await getDb();
    const dist = db.collection("distributors");
    let marked = 0;
    for (const email of recips) {
      // exact email, then domain fallback (vendor may be listed under an alias)
      let res = await dist.updateOne({ email: new RegExp("^" + email.replace(/[.+*?^${}()|[\]\\]/g, "\\$&") + "$", "i") }, { $set: update });
      if (!res.matchedCount) {
        const dom = email.split("@")[1];
        if (dom) res = await dist.updateOne({ email: { $regex: "@" + dom.replace(/\./g, "\\.") + "$", $options: "i" } }, { $set: update });
      }
      marked += res.modifiedCount || 0;
      // reflect on the blast log too
      await db.collection("blast_log").updateMany({ vendor_email: email }, { $set: { last_event: type, last_event_at: new Date().toISOString() } }).catch(() => {});
    }
    return J(200, { ok: true, type, recipients: recips.length, marked });
  } catch (e) { return J(500, { ok: false, error: e.message }); }
};
