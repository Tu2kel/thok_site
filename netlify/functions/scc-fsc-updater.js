// netlify/functions/scc-fsc-updater-background.js — FSC Updater agent
// Reads the "Change FSC…" Gmail label on anthony@ifedlog.com, and for each vendor
// email figures out which FSC lanes they DO and DON'T serve, then updates that
// vendor's distributor card ($addToSet the ones they serve, $pull the ones they
// don't). Separate from SCRUBBER, which only strips no-bid lanes on quotes.
//
// SYNCHRONOUS function (background functions don't execute on this Netlify plan).
// Classifies all labeled emails CONCURRENTLY so they fit the 10s sync budget, and
// returns the result in the response body. Also persists to _meta.fsc_last_run.
//
// Actions (POST JSON):
//   { "action": "preview" }  → return proposed changes, NO DB writes
//   { "action": "apply" }    → apply changes to distributor cards, log to fsc_update_log
//   optional: "limit" (default 40), "label" (override), "emailSummary": false
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

// Pull the item nomenclatures ("Item:  TUBE ASSEMBLY,METAL") from the quoted RFQ.
// These are always present in the email — unlike rfq_refs/blast_log FSC data,
// which is missing for vendors blasted outside the pipeline.
function parseItems(text) {
  const items = [];
  const rx = /Item(?:\s*\d+)?\s*:\s*([^\n\r]+)/gi;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const v = m[1].trim().replace(/\s+/g, " ");
    // Skip the "Item N:" wrapper lines that have no nomenclature after them.
    if (v && v.length > 2 && !/^\d+\s*:?$/.test(v) && !items.includes(v)) items.push(v);
  }
  return items.slice(0, 25);
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
async function classifyReply(body, subject, items, currentLanes) {
  const fscRef = Object.entries(FSC_NAMES).map(([c,n]) => c + "=" + n).join(", ");
  const laneList = currentLanes.length
    ? currentLanes.map(l => "  " + l.code + " (" + l.name + ")").join("\n")
    : "  (none on file)";
  const itemList = items.length ? items.map(i => "  - " + i).join("\n") : "  (none parsed)";
  const prompt = [
    "A distributor replied to our RFQ. We ONLY change their product-lane coverage",
    "when they signal an item is STRUCTURALLY outside their business — not when they",
    "merely pass on this one request.",
    "",
    "Their CURRENT FSC lanes (code + name):",
    laneList,
    "",
    "Items in the RFQ they replied to:",
    itemList,
    "",
    "Reply text:",
    (body || "").slice(0, 2000),
    "",
    "Return ONLY JSON:",
    '{"decline_permanent": true|false,',
    ' "remove_fsc": ["4-digit codes FROM their current lanes above that match the',
    '   declined items and should be removed"],',
    ' "add_fsc": ["4-digit codes for lines they explicitly say they DO carry"],',
    ' "reason": "short paraphrase of their words", "prefers_aerospace": true|false}',
    "Rules:",
    "- This reply was MANUALLY flagged by our team for FSC correction, so a decline",
    "  should almost always REMOVE the declined item's lane. Bias toward decline_permanent=true.",
    "- decline_permanent=true for ANY no-bid / no-quote / decline / \"we don't carry/sell/",
    "  stock it\" / \"outside our offering\" / \"out of our wheelhouse\" / \"not our line\".",
    "  Examples that are TRUE:",
    "    \"We do not carry the items below so they are all no bid.\" → true",
    "    \"These are out of our wheelhouse... I'm going to no quote this request.\" → true",
    "    \"The items requested are outside of our current offering.\" → true",
    "    \"Thank you but we do not sell the product you are looking for.\" → true",
    "    \"No bid.\" (bare) → true",
    "- decline_permanent=false ONLY if they clearly say they DO normally carry the item and",
    "  are passing only THIS time (\"too busy right now\", \"can't hit the deadline\",",
    "  \"will quote future requests\", \"out of stock currently but we do carry it\").",
    "- remove_fsc MUST be chosen only from their current lanes above, and only those that",
    "  correspond to the declined items. Match items to lanes by meaning (e.g. \"TUBE",
    "  ASSEMBLY\"→4710 Pipe/Tube, \"PADLOCK\"→5340 Hardware, \"SLIDE,DRAWER\"→5340, \"VALVE\"→4820,",
    "  \"FUSE\"→5920). When declined, return every current lane that matches a declined item;",
    "  only empty if truly none of their lanes relate to the declined items.",
    "- add_fsc: only when they name a line they DO carry. Map words with: " + fscRef,
    "- prefers_aerospace=true if they say they specialize in aerospace/mil hardware",
    "  (AN/AS/MIL/MS/NAS/BAC/DIN/NA/NSA).",
    "- reason must quote or closely paraphrase their actual words.",
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
  return {
    decline_permanent: !!parsed.decline_permanent,
    remove_fsc: norm(parsed.remove_fsc),
    add_fsc: norm(parsed.add_fsc),
    reason: String(parsed.reason || "").slice(0, 140),
    prefers_aerospace: !!parsed.prefers_aerospace,
  };
}

async function run({ apply, limit, label, removeOnly }) {
  const db   = await getDb();
  const imap = makeImapClient();
  const changes = [];
  const skipped = [];
  let labelPath = null, scanned = 0, runError = null;

  try {
    await imap.connect();
    labelPath = await findLabelMailbox(imap, label);
    if (!labelPath) throw new Error("Could not find a Gmail label matching FSC. Pass \"label\" explicitly.");

    const processedIds = new Set(
      (await db.collection("fsc_update_log").find({}, { projection: { message_id: 1 } }).toArray())
        .map(d => d.message_id).filter(Boolean),
    );

    // 1) Pull the messages (fast), then release IMAP.
    const msgs = [];
    const lock = await imap.getMailboxLock(labelPath);
    try {
      const uids = await imap.search({ all: true }).catch(() => []);
      for await (const msg of imap.fetch(uids.slice(-limit), { source: true, envelope: true })) {
        const env = msg.envelope || {};
        const fa = (env.from && env.from[0]) || {};
        const from = (fa.address || (fa.mailbox && fa.host ? fa.mailbox + "@" + fa.host : "")) || "";
        msgs.push({ from, messageId: env.messageId || String(msg.uid), subject: env.subject || "", body: extractBody(msg.source) });
      }
    } finally { lock.release(); }
    await imap.logout();

    // 2) Classify all messages CONCURRENTLY (Claude calls in parallel fit the 10s
    //    sync budget where a sequential loop would not).
    const pending = msgs.filter(m => m.from && !processedIds.has(m.messageId));
    scanned = pending.length;
    const evals = await Promise.all(pending.map(async (m) => {
      const vendor = await findVendor(db, m.from);
      if (!vendor) return { skip: { email: m.from, reason: "vendor_not_in_db" } };
      const curArr = (vendor.fsc || vendor.fsc_codes || []).map(String);
      const cur = new Set(curArr);
      const currentLanes = curArr.map(c => ({ code: c, name: FSC_NAMES[Number(c)] || ("FSC " + c) }));
      let cls;
      try { cls = await classifyReply(m.body, m.subject, parseItems(m.body), currentLanes); }
      catch (e) { return { skip: { email: m.from, reason: "claude_error: " + e.message.slice(0, 200) } }; }
      const remove = cls.decline_permanent ? cls.remove_fsc.filter(f => cur.has(f)) : [];
      const add    = cls.add_fsc.filter(f => !cur.has(f));
      if (!add.length && !remove.length) {
        return { skip: { email: m.from, reason: !cls.decline_permanent
          ? "no_change (one-time pass, not a line change)"
          : "no_change (no current lanes matched the declined items)" } };
      }
      return { change: {
        vendor: vendor.name || vendor.company_name, vendor_id: vendor.id, email: m.from,
        add, remove, reason: cls.reason, prefers_aerospace: cls.prefers_aerospace,
        add_names: add.map(f => FSC_NAMES[Number(f)] || f),
        remove_names: remove.map(f => FSC_NAMES[Number(f)] || f),
        _messageId: m.messageId,
      } };
    }));

    // 3) Collect, and apply if requested.
    for (const e of evals) {
      if (e.skip) { skipped.push(e.skip); continue; }
      const c = e.change;
      changes.push(c);
      if (apply) {
        const doAdd = !removeOnly && c.add.length;
        if (!c.remove.length && !doAdd) continue; // add-only change in remove-only run → skip
        try {
          // Separate ops — never $pull and $addToSet the same path in one update
          // (Mongo rejects that as a conflict). fsc and fsc_codes pulled separately.
          const dist = db.collection("distributors");
          if (c.remove.length) {
            await dist.updateOne({ id: c.vendor_id }, { $pull: { fsc:       { $in: c.remove } } });
            await dist.updateOne({ id: c.vendor_id }, { $pull: { fsc_codes: { $in: c.remove } } });
          }
          if (doAdd) await dist.updateOne({ id: c.vendor_id }, { $addToSet: { fsc: { $each: c.add } } });
          await db.collection("fsc_update_log").insertOne({
            message_id: c._messageId, vendor_id: c.vendor_id, vendor_name: c.vendor, email: c.email,
            added: doAdd ? c.add : [], removed: c.remove, applied_at: new Date().toISOString(),
          });
        } catch (e) { c._apply_error = e.message; }
      }
    }
  } catch (e) {
    runError = e.message;
    try { await imap.logout(); } catch {}
  }

  const result = { label: labelPath, mode: apply ? "apply" : "preview", scanned, changes, skipped, error: runError };
  await db.collection("_meta").updateOne(
    { _id: "fsc_last_run" }, { $set: { result, at: new Date().toISOString() } }, { upsert: true },
  ).catch(() => {});
  return result;
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
    const result = await run({ apply: action === "apply", limit, label, removeOnly: body.removeOnly !== false });
    if (body.emailSummary !== false) await sendSummary(result);
    return ok(result);
  } catch (e) {
    return fail(e.message);
  }
};
