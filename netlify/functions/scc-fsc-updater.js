// netlify/functions/scc-fsc-updater.js — FSC Updater agent
// Reads the "Change FSC…" Gmail label on anthony@ifedlog.com, and for each vendor
// email figures out which FSC lanes they DO and DON'T serve, then updates that
// vendor's distributor card ($addToSet the ones they serve, $pull the ones they
// don't). Separate from SCRUBBER, which only strips no-bid lanes on quotes.
//
// Actions (POST JSON):
//   { "action": "preview" }  → read label, report proposed changes, NO DB writes
//   { "action": "apply" }    → apply the changes + mark messages processed
//   optional: "limit" (default 40), "label" (override auto-discovery)
//
// Auth is IFEDLOG_APP_PASSWORD (same mailbox SCRUBBER reads). Vendor match is by
// sender email (exact, then domain). Processed message-ids are logged to
// fsc_update_log so a re-run won't double-apply.

const { ImapFlow }    = require("imapflow");
const { MongoClient } = require("mongodb");

const IMAP_USER    = "anthony@ifedlog.com";
const RESEND_FROM  = "Anthony Kelley | Imperio Federal Logistics <anthony@ifedlog.com>";
const SUMMARY_TO   = "anthony@ifedlog.com";

// FSC reference so Claude can map product words ("valves", "bearings") → codes.
const FSC_NAMES = {
  2510:"Vehicular Cab/Body/Frame",2530:"Brake/Steering/Axle",2540:"Vehicular Furniture",
  2910:"Engine Fuel System",2940:"Engine Filters",2990:"Engine Accessories",
  3020:"Gears/Pulleys/Sprockets",3030:"Belting/Drive Belts",3110:"Bearings",3120:"Bearings Plain",3130:"Bearing Housings",
  4110:"Refrigeration",4210:"Fire Fighting",4240:"Safety/PPE",4320:"Pumps",4330:"Filters/Separators",
  4710:"Pipe/Tube",4720:"Hose/Flexible Tubing",4730:"Hose/Pipe Fittings",4740:"Valves Nonpower",4820:"Valves",4840:"Valves Misc",
  4910:"Shop Equipment",4940:"Maintenance Equipment",5110:"Hand Tools",5120:"Power Tools",
  5305:"Screws",5306:"Bolts",5310:"Nuts/Washers",5315:"Pins/Rivets",5320:"Rivets",5330:"Packing/Gaskets",
  5331:"Seals/O-Rings",5340:"Commercial Hardware",5365:"Retaining Rings",
  5920:"Fuses/Arrestors",5925:"Circuit Breakers",5935:"Electrical Connectors",5961:"Semiconductors",
  5962:"Electronic Components",5975:"Electrical Hardware",6110:"Electrical Control",6120:"Power Distribution",
  1560:"Aircraft Structural",1680:"Aircraft Accessories",5820:"Radio/TV Comm",6230:"Electric Portable Lighting",
};

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db();
}

function makeImapClient() {
  return new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: IMAP_USER, pass: process.env.IFEDLOG_APP_PASSWORD },
    logger: false,
  });
}

// Plain text from raw RFC2822 source (mirrors SCRUBBER's extractBody).
function extractBody(source) {
  const raw = source.toString("utf-8");
  const sep = raw.indexOf("\r\n\r\n");
  if (sep === -1) return raw.slice(0, 3000);
  const hdrs = raw.slice(0, sep).toLowerCase();
  let body = raw.slice(sep + 4);
  const isBase64 = hdrs.includes("content-transfer-encoding: base64");
  const isQP     = hdrs.includes("content-transfer-encoding: quoted-printable");
  const bmatch = hdrs.match(/boundary="?([^"\r\n;]+)"?/);
  if (bmatch) {
    const boundary = "--" + bmatch[1].trim();
    let fallback = "";
    for (const part of body.split(boundary)) {
      const pl = part.toLowerCase();
      const psep = part.indexOf("\r\n\r\n");
      if (psep < 0) continue;
      const phdr = part.slice(0, psep).toLowerCase();
      let pbody = part.slice(psep + 4).replace(/--$/, "").trim();
      if (phdr.includes("base64")) { try { pbody = Buffer.from(pbody.replace(/\s+/g, ""), "base64").toString("utf-8"); } catch {} }
      else if (phdr.includes("quoted-printable")) { pbody = pbody.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_,h)=>String.fromCharCode(parseInt(h,16))); }
      if (pl.includes("text/plain")) return pbody.slice(0, 3000);
      if (pl.includes("text/html") && !fallback) fallback = pbody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (fallback) return fallback.slice(0, 3000);
  }
  if (isBase64) { try { body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8"); } catch {} }
  else if (isQP) { body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_,h)=>String.fromCharCode(parseInt(h,16))); }
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
}

// Find vendor by sender email (exact, then domain) — mirrors scc-fsc-scrub.
async function findVendor(db, senderEmail) {
  const dist = db.collection("distributors");
  let vendor = await dist.findOne({ email: new RegExp("^" + senderEmail.replace(/[.+]/g, "\\$&") + "$", "i") });
  if (!vendor) {
    const domain = (senderEmail.split("@")[1] || "").replace(/\./g, "\\.");
    if (domain) vendor = await dist.findOne({ email: new RegExp("@" + domain, "i") });
  }
  return vendor;
}

// Auto-discover the Gmail label mailbox (e.g. "Change FSC to meet Customer").
async function findLabelMailbox(imap, override) {
  const boxes = await imap.list();
  const paths = boxes.map(b => b.path);
  if (override) {
    const hit = paths.find(p => p.toLowerCase() === override.toLowerCase()) || override;
    return hit;
  }
  // Prefer a label mentioning FSC + change/update/meet.
  const rx = /(change|update|fix|correct).*fsc|fsc.*(meet|change|update|correct)/i;
  return paths.find(p => rx.test(p)) || paths.find(p => /fsc/i.test(p)) || null;
}

// Claude: which FSC codes does this vendor serve / not serve?
async function classifyFsc(body, subject, vendorName, currentFsc) {
  const fscRef = Object.entries(FSC_NAMES).map(([c,n]) => c + "=" + n).join(", ");
  const prompt = [
    "You classify a vendor's email about which FSC (Federal Supply Class) product",
    "lines they handle. Return ONLY JSON: {\"serves\":[4-digit codes they DO handle],",
    "\"not_serves\":[4-digit codes they explicitly do NOT handle]}.",
    "Rules:",
    "- Use 4-digit FSC codes. Map product words to codes with this reference:",
    "  " + fscRef,
    "- serves = lines they say they carry/manufacture/stock/quote.",
    "- not_serves = lines they say they don't do / aren't theirs / to remove.",
    "- Only include codes you are confident about. Empty arrays are fine.",
    "- Do not invent codes not in the reference unless the email states a 4-digit FSC directly.",
    "",
    "Vendor: " + vendorName,
    "Their current FSC lanes: " + (currentFsc.join(", ") || "(none on file)"),
    "Subject: " + subject,
    "",
    "Email:",
    (body || "").slice(0, 2500),
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const raw = data.content?.[0]?.text;
  if (!raw) throw new Error("No Claude response: " + JSON.stringify(data).slice(0, 300));
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in Claude response");
  const parsed = JSON.parse(m[0]);
  const norm = (arr) => [...new Set((arr || []).map(x => String(x).replace(/\D/g, "")).filter(x => x.length === 4))];
  return { serves: norm(parsed.serves), not_serves: norm(parsed.not_serves) };
}

async function run({ apply, limit, label }) {
  const db   = await getDb();
  const imap = makeImapClient();
  const changes = [];   // { vendor, email, add[], remove[], serves[], not_serves[] }
  const skipped = [];   // { email, reason }
  let labelPath = null, scanned = 0;

  await imap.connect();
  try {
    labelPath = await findLabelMailbox(imap, label);
    if (!labelPath) throw new Error("Could not find a Gmail label matching FSC. Pass \"label\" explicitly.");

    const lock = await imap.getMailboxLock(labelPath);
    const processedIds = new Set(
      (await db.collection("fsc_update_log").find({}, { projection: { message_id: 1 } }).toArray())
        .map(d => d.message_id).filter(Boolean),
    );
    try {
      const uids = await imap.search({ all: true }).catch(() => []);
      const recent = uids.slice(-limit); // newest N
      for await (const msg of imap.fetch(recent, { source: true, envelope: true })) {
        const env  = msg.envelope || {};
        const fromA = (env.from && env.from[0]) || {};
        const from = (fromA.address || (fromA.mailbox && fromA.host ? fromA.mailbox + "@" + fromA.host : "")) || "";
        const messageId = env.messageId || String(msg.uid);
        if (!from) { skipped.push({ email: "(no sender)", reason: "no_from" }); continue; }
        if (processedIds.has(messageId)) continue;
        scanned++;

        const vendor = await findVendor(db, from);
        if (!vendor) { skipped.push({ email: from, reason: "vendor_not_in_db" }); continue; }

        const body = extractBody(msg.source);
        let cls;
        try { cls = await classifyFsc(body, env.subject || "", vendor.name || vendor.company_name || from, (vendor.fsc || vendor.fsc_codes || []).map(String)); }
        catch (e) { skipped.push({ email: from, reason: "claude_error: " + e.message.slice(0, 220) }); continue; }

        const cur = new Set((vendor.fsc || vendor.fsc_codes || []).map(String));
        const add    = cls.serves.filter(f => !cur.has(f));
        const remove = cls.not_serves.filter(f => cur.has(f));
        if (!add.length && !remove.length) { skipped.push({ email: from, reason: "no_change" }); continue; }

        const entry = {
          vendor: vendor.name || vendor.company_name, vendor_id: vendor.id, email: from,
          add, remove, serves: cls.serves, not_serves: cls.not_serves,
          add_names: add.map(f => FSC_NAMES[Number(f)] || f),
          remove_names: remove.map(f => FSC_NAMES[Number(f)] || f),
        };
        changes.push(entry);

        if (apply) {
          const upd = {};
          if (add.length)    upd.$addToSet = { fsc: { $each: add } };
          if (remove.length) upd.$pull     = { fsc: { $in: remove }, fsc_codes: { $in: remove } };
          if (Object.keys(upd).length) await db.collection("distributors").updateOne({ id: vendor.id }, upd);
          await db.collection("fsc_update_log").insertOne({
            message_id: messageId, vendor_id: vendor.id, vendor_name: entry.vendor, email: from,
            added: add, removed: remove, applied_at: new Date().toISOString(),
          });
          try { await imap.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true }); } catch {}
        }
      }
    } finally { lock.release(); }
    await imap.logout();
  } catch (e) {
    try { await imap.logout(); } catch {}
    throw e;
  }

  return { label: labelPath, mode: apply ? "apply" : "preview", scanned, changes, skipped };
}

async function sendSummary(result) {
  if (!process.env.RESEND_API_KEY) return;
  const lines = [
    "FSC UPDATER — " + result.mode.toUpperCase(),
    "Label: " + result.label + " · scanned " + result.scanned,
    "",
    result.changes.length ? "CHANGES (" + result.changes.length + "):" : "No changes.",
    ...result.changes.map(c =>
      "• " + c.vendor + " <" + c.email + ">" +
      (c.add.length ? "  +[" + c.add_names.join(", ") + "]" : "") +
      (c.remove.length ? "  -[" + c.remove_names.join(", ") + "]" : "")),
    "",
    result.skipped.length ? "SKIPPED (" + result.skipped.length + "): " +
      result.skipped.slice(0, 20).map(s => s.email + " (" + s.reason + ")").join("; ") : "",
  ].join("\n");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [SUMMARY_TO], subject: "FSC Updater — " + result.mode + " (" + result.changes.length + " changes)", text: lines }),
  }).catch(() => {});
}

exports.handler = async (ev) => {
  let body = {};
  try { body = JSON.parse(ev.body || "{}"); } catch {}
  const action = body.action || "preview";
  const limit  = Math.min(parseInt(body.limit, 10) || 40, 200);
  const label  = body.label || null;
  const ok  = (d) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, result: d }) });
  const fail = (m) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: m }) });
  try {
    const result = await run({ apply: action === "apply", limit, label });
    if (body.emailSummary !== false) await sendSummary(result);
    return ok(result);
  } catch (e) {
    return fail(e.message);
  }
};
