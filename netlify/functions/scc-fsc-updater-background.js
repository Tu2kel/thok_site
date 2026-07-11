// netlify/functions/scc-fsc-updater-background.js — FSC Updater agent
// Reads the "Change FSC…" Gmail label on anthony@ifedlog.com, and for each vendor
// email figures out which FSC lanes they DO and DON'T serve, then updates that
// vendor's distributor card ($addToSet the ones they serve, $pull the ones they
// don't). Separate from SCRUBBER, which only strips no-bid lanes on quotes.
//
// BACKGROUND function: returns 202 immediately, runs up to 15 min (a full-label
// pass makes a Claude call per email and exceeds the 10s sync limit). The RESULT
// is delivered as a summary email to anthony@ifedlog.com via Resend — there is no
// synchronous response body.
//
// Actions (POST JSON):
//   { "action": "preview" }  → read label, EMAIL proposed changes, NO DB writes
//   { "action": "apply" }    → apply the changes + mark messages processed, EMAIL summary
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
  if (sep === -1) return raw.slice(0, 8000);
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
      if (pl.includes("text/plain")) return pbody.slice(0, 8000);
      if (pl.includes("text/html") && !fallback) fallback = pbody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (fallback) return fallback.slice(0, 8000);
  }
  if (isBase64) { try { body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8"); } catch {} }
  else if (isQP) { body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_,h)=>String.fromCharCode(parseInt(h,16))); }
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
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

// Pull every "Ref #: IFL-…/sol" from the quoted RFQ inside the reply.
function parseRefs(text) {
  const refs = [];
  const rx = /Ref\s*#\s*:\s*([A-Z0-9\-]+)/gi;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const v = m[1].trim().toUpperCase();
    if (v && !refs.includes(v)) refs.push(v);
  }
  return refs;
}

// ref (IFL ref or sol number) → its FSC — mirrors scc-fsc-scrub.fscForRef.
async function fscForRef(db, ref) {
  let doc = await db.collection("rfq_refs").findOne({ ref });
  if (!doc) doc = await db.collection("rfq_refs").findOne({ sol_number: ref });
  if (!doc) {
    const log = await db.collection("blast_log").findOne({ sol_number: ref });
    if (log) doc = { fsc: log.fsc, item_name: log.item_name, sol_number: ref };
  }
  if (!doc || !doc.fsc) return null;
  return { ref, fsc: String(doc.fsc), item_name: doc.item_name || "" };
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

// Claude: read the vendor's REPLY and decide which of the referenced RFQ items
// they decline (no-bid / don't carry), plus any product lines they explicitly
// DO/DON'T handle. The FSCs come from the referenced sols, not the prose — the
// vendor usually just says "we don't carry the items below."
async function classifyReply(body, subject, refItems) {
  const fscRef = Object.entries(FSC_NAMES).map(([c,n]) => c + "=" + n).join(", ");
  const itemList = refItems.length
    ? refItems.map(r => "  " + r.ref + " — " + (r.item_name || "(item)") + " [FSC " + r.fsc + "]").join("\n")
    : "  (none parsed)";
  const prompt = [
    "A distributor replied to our RFQ. We ONLY want to change their product-lane",
    "coverage when they signal an item is STRUCTURALLY outside their business — not",
    "when they merely pass on this one request.",
    "Return ONLY JSON:",
    '{"decline_permanent": true|false, "decline_refs": ["REF",...],',
    ' "reason": "short paraphrase", "serves_fsc": ["4-digit",...],',
    ' "not_serves_fsc": ["4-digit",...], "prefers_aerospace": true|false}',
    "Rules:",
    "- decline_permanent=true ONLY if they say the item is outside their line/offering/",
    "  wheelhouse or they don't carry/sell/stock it (e.g. \"outside our current offering\",",
    "  \"out of our wheelhouse\", \"we don't sell that\", \"not our line\").",
    "- A bare \"no bid\" / \"no quote\" / \"can't quote this time\" / \"pass\" with NO such reason",
    "  is a ONE-TIME pass — set decline_permanent=false and change NOTHING.",
    "- decline_refs = specific refs permanently declined; empty means ALL referenced items",
    "  (use empty only when decline_permanent and they reject the whole RFQ).",
    "- serves_fsc / not_serves_fsc = ONLY when they name a product line directly; map words",
    "  to codes with: " + fscRef,
    "- prefers_aerospace=true if they say they specialize in aerospace/mil hardware standards",
    "  (AN/AS/MIL/MS/NAS/BAC/DIN/NA/NSA).",
    "- Empty arrays / false are fine. reason must quote or closely paraphrase their words.",
    "",
    "Subject: " + subject,
    "Referenced items:",
    itemList,
    "",
    "Reply email:",
    (body || "").slice(0, 2500),
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const raw = data.content?.[0]?.text;
  if (!raw) throw new Error("No Claude response: " + JSON.stringify(data).slice(0, 300));
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in Claude response");
  const parsed = JSON.parse(m[0]);
  const norm = (arr) => [...new Set((arr || []).map(x => String(x).replace(/\D/g, "")).filter(x => x.length === 4))];
  const upper = (arr) => [...new Set((arr || []).map(x => String(x).trim().toUpperCase()).filter(Boolean))];
  return {
    decline_permanent: !!parsed.decline_permanent,
    decline_refs: upper(parsed.decline_refs),
    reason: String(parsed.reason || "").slice(0, 140),
    serves_fsc: norm(parsed.serves_fsc),
    not_serves_fsc: norm(parsed.not_serves_fsc),
    prefers_aerospace: !!parsed.prefers_aerospace,
  };
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

        // Map the referenced RFQ items (Ref #: …) to their FSCs — this is where
        // "we don't carry the items below" gets its FSC codes from.
        const refs = parseRefs(body);
        const refItems = (await Promise.all(refs.map(r => fscForRef(db, r)))).filter(Boolean);
        const fscByRef = {}; refItems.forEach(r => { fscByRef[r.ref] = r.fsc; });

        let cls;
        try { cls = await classifyReply(body, env.subject || "", refItems); }
        catch (e) { skipped.push({ email: from, reason: "claude_error: " + e.message.slice(0, 220) }); continue; }

        // Only strip lanes on a PERMANENT decline (item outside their line). A bare
        // one-time no-bid changes nothing. FSCs come from the declined refs' sols
        // (all referenced if decline_refs empty) plus any explicitly-named lines.
        const declineRefs = cls.decline_permanent
          ? (cls.decline_refs.length ? cls.decline_refs : refItems.map(r => r.ref))
          : [];
        const removeFromRefs = declineRefs.map(r => fscByRef[r]).filter(Boolean);
        const removeAll = [...new Set([...removeFromRefs, ...cls.not_serves_fsc])];

        const cur = new Set((vendor.fsc || vendor.fsc_codes || []).map(String));
        const add    = cls.serves_fsc.filter(f => !cur.has(f));
        const remove = removeAll.filter(f => cur.has(f));
        if (!add.length && !remove.length) {
          const why = !cls.decline_permanent
            ? "no_change (one-time no-bid, not a line change)"
            : refItems.length ? "no_change (declined refs had no matching lanes on card)"
            : "no_change (no refs/lanes)";
          skipped.push({ email: from, reason: why });
          continue;
        }

        const entry = {
          vendor: vendor.name || vendor.company_name, vendor_id: vendor.id, email: from,
          add, remove, reason: cls.reason, prefers_aerospace: cls.prefers_aerospace, refs: refs.length,
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
    ...result.changes.flatMap(c => [
      "• " + c.vendor + " <" + c.email + ">" +
        (c.add.length ? "  +[" + c.add_names.join(", ") + "]" : "") +
        (c.remove.length ? "  -[" + c.remove_names.join(", ") + "]" : "") +
        (c.prefers_aerospace ? "  ✈AEROSPACE" : ""),
      c.reason ? "    reason: " + c.reason : null,
    ].filter(Boolean)),
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
