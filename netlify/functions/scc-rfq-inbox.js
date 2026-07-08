// netlify/functions/scc-rfq-inbox.js
// Imperio SCC — Vendor RFQ Inbox Scanner
//
// Reads kelley.anthonyk@gmail.com via IMAP (GMAIL_APP_PASSWORD — same cred as send-rfq.js).
// Finds Re: RFQ replies from vendors, parses price/no-bid with Claude Haiku,
// compares vs DIBBS historical unit_price, calculates margin, saves to MongoDB,
// sends summary email to anthony@ifedlog.com after each run.
//
// Actions (POST): scan | getReport | getScanLog
// Scheduled 4x/day via netlify.toml: 8AM, 12PM, 4PM, 8PM CT
//
// Env: GMAIL_APP_PASSWORD, ANTHROPIC_API_KEY, MONGODB_URI

const { ImapFlow }   = require("imapflow");
const { MongoClient } = require("mongodb");

const IMAP_USER    = "kelley.anthonyk@gmail.com";
const SUMMARY_TO   = "anthony@ifedlog.com";
const FROM_NAME    = "Anthony K Kelley | Imperio Federal Logistics";
const RESEND_FROM  = FROM_NAME + " <" + SUMMARY_TO + ">";

const HIST_OVER_THRESHOLD  =  15;
const HIST_UNDER_THRESHOLD = -10;
const STANDARD_MARGIN      = 0.275;

// ── IMAP ───────────────────────────────────────────────────────────────────
function makeImapClient() {
  return new ImapFlow({
    host:   "imap.gmail.com",
    port:   993,
    secure: true,
    auth:   { user: IMAP_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });
}

// Pull plain text from raw RFC2822 source buffer
function extractBody(source) {
  const raw = source.toString("utf-8");
  const sep = raw.indexOf("\r\n\r\n");
  if (sep === -1) return raw.slice(0, 3000);

  const hdrs = raw.slice(0, sep).toLowerCase();
  let body   = raw.slice(sep + 4);

  const isBase64 = hdrs.includes("content-transfer-encoding: base64");
  const isQP     = hdrs.includes("content-transfer-encoding: quoted-printable");

  // Multipart — find first text/plain or text/html section
  const bmatch = hdrs.match(/boundary="?([^"\r\n;]+)"?/);
  if (bmatch) {
    const boundary = "--" + bmatch[1].trim();
    const parts    = body.split(boundary);
    let fallback   = "";
    for (const part of parts) {
      const pl   = part.toLowerCase();
      const psep = part.indexOf("\r\n\r\n");
      if (psep < 0) continue;
      const phdr = part.slice(0, psep).toLowerCase();
      let   pbody = part.slice(psep + 4).replace(/--$/, "").trim();
      if (phdr.includes("base64")) {
        try { pbody = Buffer.from(pbody.replace(/\s+/g, ""), "base64").toString("utf-8"); } catch {}
      } else if (phdr.includes("quoted-printable")) {
        pbody = pbody.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      }
      if (pl.includes("text/plain")) return pbody.slice(0, 3000);
      if (pl.includes("text/html") && !fallback) fallback = pbody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (fallback) return fallback.slice(0, 3000);
  }

  // Single-part
  if (isBase64) {
    try { body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8"); } catch {}
  } else if (isQP) {
    body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
}

// ── SOL EXTRACTION ─────────────────────────────────────────────────────────
const SOL_RE = /\b([A-Z]{2,7}[\dA-Z]{0,5}-\d{2,4}-[A-Z]-\d{3,7})\b/g;
function extractSol(text) {
  const m = [...(text || "").matchAll(SOL_RE)];
  return m.length ? m[0][1] : null;
}

// ── RESEND SUMMARY ─────────────────────────────────────────────────────────
async function sendSummary(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify({ from: RESEND_FROM, to: [SUMMARY_TO], subject, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Resend summary failed: " + JSON.stringify(data));
}

// ── CLAUDE PARSER ──────────────────────────────────────────────────────────
async function claudeParse(body, vendorName, subject) {
  const prompt = [
    "Parse this vendor email response to a US government DLA RFQ (Request for Quote) from Imperio Federal Logistics.",
    "Return ONLY a JSON object:",
    '{"type":"quote|no_bid","unit_price":number|null,"lead_time_days":number|null,"country_of_origin":"string"|null,"no_bid_reason":"string"|null,"notes":"string"|null}',
    "",
    "Rules:",
    "- type=no_bid if vendor says: unable, cannot, no bid, NB, not available, out of stock, decline, pass, no quote, EOL, discontinued, do not carry",
    "- unit_price = per-unit USD price only (ignore freight totals); if range, use lower end",
    "- lead_time_days: convert weeks×7, months×30",
    "- no_bid_reason: their stated reason, max 80 chars",
    "- notes: MOQ, certifications, special terms",
    "",
    "Subject: " + subject,
    "From: " + vendorName,
    "",
    "Email:",
    body.slice(0, 2000),
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const raw  = data.content?.[0]?.text;
  if (!raw) throw new Error("No Claude response: " + JSON.stringify(data).slice(0, 200));
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in Claude response");
  return JSON.parse(m[0]);
}

// ── PRICE ANALYSIS ─────────────────────────────────────────────────────────
function analyzePrice(vendorPrice, histPrice) {
  const out = {
    hist_price: histPrice || null,
    hist_deviation_pct: null,
    hist_flag: histPrice ? "NO_DATA" : "NO_HIST",
    target_bid: null,
    margin_at_target_pct: parseFloat((STANDARD_MARGIN * 100).toFixed(1)),
    margin_at_hist_pct: null,
    margin_flag: null,
  };
  if (!vendorPrice || vendorPrice <= 0) return out;

  out.target_bid = parseFloat((vendorPrice / (1 - STANDARD_MARGIN)).toFixed(4));

  if (histPrice && histPrice > 0) {
    const dev = ((vendorPrice - histPrice) / histPrice) * 100;
    out.hist_deviation_pct = parseFloat(dev.toFixed(1));
    out.hist_flag = dev > HIST_OVER_THRESHOLD  ? "OVER"
                  : dev < HIST_UNDER_THRESHOLD ? "UNDER"
                  : "FAIR";

    const margAtHist = ((histPrice - vendorPrice) / histPrice) * 100;
    out.margin_at_hist_pct = parseFloat(margAtHist.toFixed(1));
    out.margin_flag = margAtHist < 0    ? "NEGATIVE"
                    : margAtHist < 8   ? "SQUEEZED"
                    : margAtHist < 15  ? "TIGHT"
                    : margAtHist < 27.5 ? "OK"
                    : "GOOD";
  }
  return out;
}

// ── DAILY REPORT ───────────────────────────────────────────────────────────
async function buildDailyReport(db, dateStr) {
  const responses = await db.collection("rfq_responses")
    .find({ date: dateStr })
    .sort({ sol_number: 1, unit_price: 1 })
    .toArray();

  const bySol = {};
  for (const r of responses) {
    if (!bySol[r.sol_number]) bySol[r.sol_number] = { item_name: r.item_name || "", quotes: [], no_bids: [] };
    if (r.type === "no_bid") bySol[r.sol_number].no_bids.push(r);
    else bySol[r.sol_number].quotes.push(r);
  }

  const sols = Object.entries(bySol).map(([sol_number, { item_name, quotes, no_bids }]) => {
    const best = quotes.length
      ? quotes.reduce((b, q) => (q.unit_price || Infinity) < (b.unit_price || Infinity) ? q : b, quotes[0])
      : null;
    return {
      sol_number, item_name,
      quote_count: quotes.length, no_bid_count: no_bids.length,
      best_vendor: best ? (best.vendor_name || best.vendor_email) : null,
      best_price:  best ? best.unit_price : null,
      best_hist_flag:   best ? best.hist_flag   : null,
      best_margin_flag: best ? best.margin_flag  : null,
      best_target_bid:  best ? best.target_bid   : null,
      action: quotes.length === 0 && no_bids.length > 0 ? "ALL_NO_BID"
            : best && best.hist_flag === "OVER"          ? "REVIEW_PRICE"
            : best && best.margin_flag === "NEGATIVE"    ? "MARGIN_NEGATIVE"
            : null,
      quotes, no_bids,
    };
  }).sort((a, b) => {
    if (a.quote_count > 0 && b.quote_count === 0) return -1;
    if (b.quote_count > 0 && a.quote_count === 0) return 1;
    return a.sol_number.localeCompare(b.sol_number);
  });

  return {
    date: dateStr,
    total_responses: responses.length,
    total_quotes:    responses.filter((r) => r.type === "quote").length,
    total_no_bids:   responses.filter((r) => r.type === "no_bid").length,
    total_sols:      sols.length,
    sols,
    generated_at: new Date().toISOString(),
  };
}

// ── SUMMARY EMAIL TEXT ──────────────────────────────────────────────────────
function buildSummaryText(report, stats, fscScrubLog = []) {
  const ct = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const lines = [
    "RFQ INBOX SCAN — " + ct + " CT",
    "═".repeat(50),
    "",
    "Scan:  " + stats.scanned + " checked · " + stats.new_count + " new · " + stats.errors + " error(s)",
    "Daily: " + report.total_quotes + " quote(s) · " + report.total_no_bids + " no-bid(s) · " + report.total_sols + " sol(s)",
    fscScrubLog.length ? "FSC Auto-Scrub: " + fscScrubLog.length + " vendor(s) updated" : "",
    "",
  ];

  if (!report.sols.length) {
    lines.push("No vendor responses today.");
  } else {
    for (const sol of report.sols) {
      lines.push("SOL: " + sol.sol_number + (sol.item_name ? " — " + sol.item_name.slice(0, 40) : ""));
      for (const q of sol.quotes) {
        const dev = q.hist_deviation_pct != null ? (q.hist_deviation_pct >= 0 ? "+" : "") + q.hist_deviation_pct + "%" : "";
        const hist = q.hist_flag && q.hist_flag !== "NO_HIST" ? " [" + q.hist_flag + (dev ? " " + dev : "") + "]" : " [NO HIST]";
        const marg = q.margin_flag ? " → " + q.margin_flag : "";
        const bid  = q.target_bid  ? " | Bid@27.5%: $" + q.target_bid.toFixed(4) : "";
        lines.push("  QUOTE   " + (q.vendor_name || q.vendor_email).slice(0, 28).padEnd(28) +
          " $" + (q.unit_price != null ? q.unit_price.toFixed(4) : "?") + hist + marg + bid);
      }
      for (const nb of sol.no_bids) {
        lines.push("  NO-BID  " + (nb.vendor_name || nb.vendor_email).slice(0, 28) +
          (nb.no_bid_reason ? ": " + nb.no_bid_reason : ""));
      }
      if (sol.best_vendor && sol.quote_count > 0) {
        lines.push("  ★ BEST: " + sol.best_vendor + " @ $" + (sol.best_price || "?") +
          (sol.best_target_bid   ? " → Bid $" + sol.best_target_bid.toFixed(4) : "") +
          (sol.best_margin_flag  ? " [" + sol.best_margin_flag + "]" : ""));
      }
      if (sol.action === "ALL_NO_BID")      lines.push("  !! Re-blast or mark No Source");
      if (sol.action === "REVIEW_PRICE")    lines.push("  ⚠  Best quote above historical — review before bidding");
      if (sol.action === "MARGIN_NEGATIVE") lines.push("  !! Vendor price exceeds DIBBS price — margin negative");
      lines.push("");
    }
  }
  if (fscScrubLog.length) {
    lines.push("FSC AUTO-SCRUB LOG");
    lines.push("─".repeat(40));
    for (const s of fscScrubLog) {
      lines.push("  " + (s.vendor_name || s.vendor_email) + " → stripped FSC " + s.removed.join(", "));
    }
    lines.push("");
  }
  lines.push("═".repeat(50));
  lines.push("Pipeline → https://thehouseofkel.com/scc/");
  return lines.join("\n");
}

// ── FSC AUTO-SCRUB ─────────────────────────────────────────────────────────
// Called whenever a vendor no-bid is detected. Looks up the FSC code for each
// sol number (via rfq_refs), finds the vendor in distributors, and $pulls those
// FSC codes so the vendor stops receiving blasts for items in that lane.
async function scrubFscForNoBid(db, vendorEmail, solNumbers) {
  const fscs = new Set();
  for (const sol of solNumbers) {
    if (!sol || sol === "UNMATCHED") continue;
    const doc = await db.collection("rfq_refs").findOne({ $or: [{ ref: sol }, { sol_number: sol }] });
    if (doc && doc.fsc) fscs.add(String(doc.fsc));
    // Also try blast_log for older sol numbers not in rfq_refs
    if (!doc) {
      const log = await db.collection("blast_log").findOne({ sol_number: sol });
      if (log && log.fsc) fscs.add(String(log.fsc));
    }
  }
  if (!fscs.size) return { removed: [], vendor_name: null, reason: "no_fsc_found" };

  const dist = db.collection("distributors");
  let vendor = await dist.findOne({
    email: new RegExp("^" + vendorEmail.replace(/[.+[\](){}^$|\\]/g, "\\$&") + "$", "i"),
  });
  if (!vendor) {
    const domain = vendorEmail.split("@")[1];
    if (domain) {
      vendor = await dist.findOne({
        email: new RegExp("@" + domain.replace(/\./g, "\\.") + "$", "i"),
      });
    }
  }
  if (!vendor) return { removed: [], vendor_name: null, reason: "vendor_not_in_db" };

  const vendorFsc = (vendor.fsc || vendor.fsc_codes || []).map(String);
  const toRemove  = [...fscs].filter(f => vendorFsc.includes(f));
  if (!toRemove.length) return { removed: [], vendor_name: vendor.name || vendor.company_name, reason: "fsc_not_assigned" };

  await dist.updateOne(
    { id: vendor.id },
    { $pull: { fsc: { $in: toRemove }, fsc_codes: { $in: toRemove } } },
  );
  return { removed: toRemove, vendor_name: vendor.name || vendor.company_name, reason: "scrubbed" };
}

// ── MONGODB ────────────────────────────────────────────────────────────────
let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db("scc_db");
}

async function getProcessed(db) {
  const doc = await db.collection("_meta").findOne({ _id: "rfq_inbox_processed" });
  return new Set(doc ? doc.ids : []);
}
async function markProcessed(db, ids) {
  if (!ids.length) return;
  await db.collection("_meta").updateOne(
    { _id: "rfq_inbox_processed" },
    { $addToSet: { ids: { $each: ids } } },
    { upsert: true },
  );
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const h = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: h, body: "" };

  let action = "scan", payload = {};
  if (event.httpMethod === "POST" && event.body) {
    try { const b = JSON.parse(event.body); action = b.action || "scan"; payload = b; } catch {}
  }

  const db = await getDb();

  if (action === "getReport") {
    const report = await buildDailyReport(db, payload.date || new Date().toISOString().slice(0, 10));
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, report }) };
  }

  if (action === "getScanLog") {
    const logs = await db.collection("rfq_scan_log").find({}).sort({ scanned_at: -1 }).limit(20).toArray();
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, logs }) };
  }

  if (action === "clearProcessed") {
    await db.collection("_meta").deleteOne({ _id: "rfq_inbox_processed" });
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, message: "Processed IDs cleared — next scan will recheck all emails from the last 7 days" }) };
  }

  // processBounces: bulk-scan all mailer-daemon emails, mark distributors email_invalid
  if (action === "processBounces") {
    const days = payload.days || 30;
    const imap3 = makeImapClient();
    const bounceLog = [];
    let marked = 0, noMatch = 0;
    try {
      await imap3.connect();
      // Search All Mail so Gmail delivery failures aren't missed (they often skip INBOX)
      const lock3 = await imap3.getMailboxLock("[Gmail]/All Mail");
      try {
        const since3 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const bounceUids = await imap3.search({ since: since3, from: "mailer-daemon" }).catch(() => []);
        bounceLog.push("Found " + bounceUids.length + " bounce email(s) in last " + days + " days (All Mail)");

        // Permanent-bounce indicators — SMTP 5xx or "no such user" class errors
        // Soft bounces (4xx, timed out, connection refused, "will retry") are skipped
        const PERM_BOUNCE = /\bStatus:\s*5\.\d+\.\d+|\b55[012345]\s|\bno such (user|mailbox|address)\b|user (not found|does not exist|unknown)\b|mailbox (not found|does not exist|unavailable)\b|account.*does not exist|invalid (address|mailbox)\b/i;
        const SOFT_BOUNCE = /\bStatus:\s*4\.\d+\.\d+|\btemporary\b|timed?\s*out|connection (refused|reset|failed|could not)|will retry|Delivery incomplete|retry for/i;

        const emailSet = new Set();
        let softSkipped = 0;
        for await (const bMsg of imap3.fetch(bounceUids, { source: true })) {
          try {
            const raw = bMsg.source ? bMsg.source.toString() : "";

            // Skip soft/temporary bounces — don't DNS vendors that just had a server hiccup
            if (SOFT_BOUNCE.test(raw) && !PERM_BOUNCE.test(raw)) {
              softSkipped++;
              continue;
            }

            const patterns = [
              /Final-Recipient:[^\n]*;\s*([^\s\n]+)/i,
              /Original-Recipient:[^\n]*;\s*([^\s\n]+)/i,
              /Your message.*?couldn't be delivered to\s+([^\s\n.]+@[^\s\n.]+\.[^\s\n]+)/i,
              /wasn't delivered to\s+([^\s\n]+@[^\s\n]+)/i,
            ];
            for (const pat of patterns) {
              const m = raw.match(pat);
              if (m) {
                const email = m[1].replace(/^mailto:/i, "").trim().toLowerCase();
                if (email.includes("@")) { emailSet.add(email); break; }
              }
            }
          } catch {}
        }
        if (softSkipped) bounceLog.push("Skipped " + softSkipped + " soft/temporary bounce(s) — server will retry");
        bounceLog.push("Extracted " + emailSet.size + " permanent bounced address(es)");

        // Bulk update distributors — DNS them so they're out of active list (revisit later)
        for (const email of emailSet) {
          const r = await db.collection("distributors").updateOne(
            { email },
            { $set: { email_invalid: true, email_bounced_at: new Date().toISOString(), is_dns: true, dns_reason: "Email bounced — stale SAM.gov contact. Revisit when updated." } },
          );
          if (r.modifiedCount) { marked++; bounceLog.push("✓ DNS'd: " + email); }
          else { noMatch++; }
        }
      } finally { lock3.release(); }
      await imap3.logout();
    } catch (e) {
      bounceLog.push("Error: " + e.message);
    }
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, marked, noMatch, log: bounceLog }) };
  }

  // debugScan: show raw from/subject/skip-reason for every email, no Claude, no DB writes
  if (action === "debugScan") {
    const imap2 = makeImapClient();
    const rows = [];
    try {
      await imap2.connect();
      const lock2 = await imap2.getMailboxLock("INBOX");
      try {
        const since2 = new Date(); since2.setDate(since2.getDate() - 7);
        const uids2 = await imap2.search({ since: since2, subject: "RFQ" });
        const processed2 = await getProcessed(db);
        for await (const msg of imap2.fetch(uids2, { envelope: true })) {
          const msgId = msg.envelope.messageId || ("uid-" + msg.uid);
          const subject = msg.envelope.subject || "";
          const fromAddr = msg.envelope.from?.[0];
          const from = fromAddr ? ((fromAddr.address || (fromAddr.mailbox + "@" + fromAddr.host)) || "") : "";
          let skip = null;
          if (processed2.has(msgId)) skip = "already_processed";
          else if (/ifedlog\.com|thehouseofkel|kelley\.anthonyk/i.test(from)) skip = "own_email";
          else if (/automatic reply|out of office|autoreply/i.test(subject)) skip = "auto_reply";
          else if (!/(?:re|fw[d]?):\s*rfq/i.test(subject)) skip = "subject_no_re_rfq";
          rows.push({ from, subject, msgId: msgId.slice(0, 40), skip: skip || "WOULD_PROCESS" });
        }
      } finally { lock2.release(); }
      await imap2.logout();
    } catch (e) {
      return { statusCode: 500, headers: h, body: JSON.stringify({ ok: false, error: e.message }) };
    }
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, total: rows.length, rows }) };
  }

  // ── scan ──────────────────────────────────────────────────────────────────
  const log    = [];
  const addLog = (m) => { log.push(m); console.log("[rfq-inbox]", m); };
  const today  = new Date().toISOString().slice(0, 10);

  const imap = makeImapClient();
  let scanned = 0, errors = 0;
  const newDocs      = [];
  const newMsgIds    = [];
  const fscScrubLog  = [];  // { vendor_name, removed[], sol_numbers[] }

  try {
    await imap.connect();
    addLog("IMAP connected");

    const lock = await imap.getMailboxLock("INBOX");
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);

      // ── Bounce scan: mark invalid emails in distributors ──────────────────
    const bounceSince = new Date();
    bounceSince.setDate(bounceSince.getDate() - 3);
    const bounceUids = await imap.search({ since: bounceSince, from: "mailer-daemon" }).catch(() => []);
    if (bounceUids.length) {
      addLog(bounceUids.length + " bounce(s) to process");
      for await (const bMsg of imap.fetch(bounceUids, { source: true })) {
        try {
          const raw = bMsg.source ? bMsg.source.toString() : "";
          // Extract the original recipient from bounce body
          const recipMatch = raw.match(/Final-Recipient:[^\n]*;\s*([^\s\n]+)/i)
            || raw.match(/Original-Recipient:[^\n]*;\s*([^\s\n]+)/i)
            || raw.match(/failed to reach\s+([^\s\n<>]+@[^\s\n<>]+)/i)
            || raw.match(/<([^>]+@[^>]+)>.*?(?:does not exist|address not found|user unknown)/si);
          const bouncedEmail = recipMatch ? recipMatch[1].replace(/^mailto:/i, "").trim().toLowerCase() : null;
          if (bouncedEmail && bouncedEmail.includes("@")) {
            const updated = await db.collection("distributors").updateOne(
              { email: bouncedEmail },
              { $set: { email_invalid: true, email_bounced_at: new Date().toISOString() } },
            );
            if (updated.modifiedCount) addLog("BOUNCE marked invalid: " + bouncedEmail);
            else addLog("BOUNCE no dist match: " + bouncedEmail);
          }
        } catch {}
      }
    }

    // Search for any email with RFQ in subject from last 7 days
      const uids = await imap.search({ since, subject: "RFQ" });
      addLog(uids.length + " candidate(s) found");
      scanned = uids.length;

      if (uids.length === 0) {
        lock.release();
        await imap.logout();
        const report = await buildDailyReport(db, today);
        const stats  = { scanned: 0, new_count: 0, errors: 0, scanned_at: new Date() };
        await db.collection("rfq_scan_log").insertOne(stats);
        return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, stats, report, log }) };
      }

      const processed = await getProcessed(db);

      for await (const msg of imap.fetch(uids, { source: true, envelope: true })) {
        const msgId = msg.envelope.messageId || ("uid-" + msg.uid);

        if (processed.has(msgId)) { addLog("SKIP already_processed: " + msgId.slice(0, 30)); continue; }

        const subject     = msg.envelope.subject || "";
        const fromAddr    = msg.envelope.from?.[0];
        const vendorEmail = fromAddr ? ((fromAddr.address || (fromAddr.mailbox + "@" + fromAddr.host)) || "").toLowerCase() : "";
        const vendorName  = fromAddr ? (fromAddr.name || vendorEmail).trim() : vendorEmail;
        const msgDate     = msg.envelope.date;
        const dateStr     = msgDate instanceof Date && !isNaN(msgDate)
          ? msgDate.toISOString().slice(0, 10) : today;

        // Skip our own outbound/auto emails
        if (/ifedlog\.com|thehouseofkel|kelley\.anthonyk/i.test(vendorEmail)) {
          addLog("SKIP own_email: " + vendorEmail + " | " + subject.slice(0, 50));
          newMsgIds.push(msgId);
          continue;
        }
        // Skip auto-replies and out-of-office
        if (/automatic reply|out of office|autoreply/i.test(subject)) {
          addLog("SKIP auto_reply: " + vendorEmail + " | " + subject.slice(0, 50));
          newMsgIds.push(msgId);
          continue;
        }
        // Must be a reply or forward of an RFQ
        if (!/(?:re|fw[d]?):\s*rfq/i.test(subject)) {
          addLog("SKIP no_re_rfq: " + vendorEmail + " | " + subject.slice(0, 50));
          newMsgIds.push(msgId);
          continue;
        }

        const body      = extractBody(msg.source);
        let solNumber   = extractSol(subject) || extractSol(body);

        // Fallback: no sol in email — look up via blast_log for this vendor
        let blastSols = null;
        if (!solNumber) {
          const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

          // 1. Exact email match
          blastSols = await db.collection("blast_log").find({
            vendor_email: vendorEmail, status: "sent", sent_at: { $gte: cutoff },
          }).toArray();

          const domain = vendorEmail.split("@")[1] || null;

          // 2. Domain match — vendor may reply from different address than we sent to
          if (!blastSols.length && domain) {
            blastSols = await db.collection("blast_log").find({
              vendor_email: { $regex: "@" + domain.replace(/\./g, "\\.") + "$", $options: "i" },
              status: "sent",
              sent_at: { $gte: cutoff },
            }).toArray();
            if (blastSols.length) addLog("No SOL — domain match @" + domain + ": " + blastSols.length + " sol(s)");
          }

          // 3. Distributor DB fallback — blast_log empty; find vendor by domain, use recent sols in their FSC lanes
          if (!blastSols.length && domain) {
            const distRecord = await db.collection("distributors").findOne({
              email: { $regex: "@" + domain.replace(/\./g, "\\.") + "$", $options: "i" },
            });
            if (distRecord) {
              const fscList = (distRecord.fsc || []).map(String);
              const solQuery = fscList.length
                ? { fsc: { $in: fscList }, status: { $nin: ["No Source", "Lost", "Awarded"] } }
                : { status: { $nin: ["No Source", "Lost", "Awarded"] } };
              const recentSols = await db.collection("solicitations").find(solQuery).sort({ _id: -1 }).limit(5).toArray();
              if (recentSols.length) {
                blastSols = recentSols.map(s => ({ sol_number: s.sol_number, item_name: s.item_name || "" }));
                addLog("dist fallback — @" + domain + " → " + distRecord.name + (fscList.length ? " (FSC)" : " (recent)") + ": " + blastSols.length + " sols");
              }
            }
          }

          // Level 4: known vendor reply, no sol match — save as UNMATCHED so nothing is lost
          if (!blastSols.length) {
            blastSols = [{ sol_number: "UNMATCHED", item_name: "" }];
            addLog("Level 4 UNMATCHED — saving reply from " + vendorEmail + " for manual review");
          }
          addLog("match: " + blastSols.length + " target(s) for " + vendorEmail);
        }

        newMsgIds.push(msgId);

        // Build target list
        const targets = blastSols
          ? blastSols.map(b => ({ sol_number: b.sol_number, item_name: b.item_name || "" }))
          : [{ sol_number: solNumber, item_name: null }];

        // Run Claude parse + batch sol lookup in parallel
        const targetSolNums = targets.map(t => t.sol_number);
        let parsed;
        let solRecMap = {};
        let parseError = null;
        try {
          const [parsedResult, solRecs] = await Promise.all([
            claudeParse(body, vendorName, subject),
            db.collection("solicitations").find({ sol_number: { $in: targetSolNums } }).toArray(),
          ]);
          parsed = parsedResult;
          solRecMap = Object.fromEntries(solRecs.map(s => [s.sol_number, s]));
        } catch (e) {
          parseError = e.message;
          addLog("Parse failed (" + vendorEmail + "): " + e.message + " — saving raw");
          errors++;
          parsed = { type: "parse_error", unit_price: null, lead_time_days: null, country_of_origin: null, no_bid_reason: null, notes: "Claude parse failed: " + e.message };
          solRecMap = {};
        }

        for (const target of targets) {
          const solRec    = solRecMap[target.sol_number] || null;
          const histPrice = solRec ? (parseFloat(solRec.hist_unit_price || solRec.unit_price || 0) || null) : null;
          const itemName  = solRec ? (solRec.item_name || solRec.item_description || "") : (target.item_name || "");

          addLog(target.sol_number + " | " + vendorName + " → " + parsed.type + (parsed.unit_price ? " $" + parsed.unit_price : ""));

          const priceAnalysis = (parsed.type === "quote" && parsed.unit_price)
            ? analyzePrice(parsed.unit_price, histPrice)
            : { hist_price: histPrice, hist_flag: histPrice ? "NO_DATA" : "NO_HIST", margin_flag: null, target_bid: null, hist_deviation_pct: null, margin_at_hist_pct: null, margin_at_target_pct: null };

          const doc = {
            imap_msg_id:       msgId,
            scanned_at:        new Date(),
            date:              dateStr,
            sol_number:        target.sol_number,
            item_name:         itemName,
            vendor_email:      vendorEmail,
            vendor_name:       vendorName,
            type:              parsed.type || "unknown",
            unit_price:        parsed.unit_price        || null,
            lead_time_days:    parsed.lead_time_days     || null,
            country_of_origin: parsed.country_of_origin  || null,
            no_bid_reason:     parsed.no_bid_reason      || null,
            notes:             parsed.notes              || null,
            raw_excerpt:       body.slice(0, 600),
            ...priceAnalysis,
          };

          await db.collection("rfq_responses").updateOne(
            { sol_number: target.sol_number, vendor_email: vendorEmail, date: dateStr },
            { $set: doc },
            { upsert: true },
          );
          newDocs.push(doc);
        }

        // Auto-scrub FSC lanes when vendor says no-bid / not our lane
        if (parsed.type === "no_bid") {
          try {
            const scrub = await scrubFscForNoBid(db, vendorEmail, targets.map(t => t.sol_number));
            if (scrub.removed.length > 0) {
              fscScrubLog.push({ vendor_name: scrub.vendor_name, vendor_email: vendorEmail, removed: scrub.removed, sol_numbers: targets.map(t => t.sol_number) });
              addLog("FSC SCRUB " + vendorEmail + " → stripped " + scrub.removed.join(",") + " from " + scrub.vendor_name);
            } else {
              addLog("FSC SCRUB " + vendorEmail + " → " + (scrub.reason || "no change"));
            }
          } catch (e) {
            addLog("FSC scrub error for " + vendorEmail + ": " + e.message);
          }
        }
      }
    } finally {
      lock.release();
    }
    await imap.logout();
    addLog("IMAP disconnected");
  } catch (e) {
    addLog("IMAP error: " + e.message);
    errors++;
    try { await imap.logout(); } catch {}
    return { statusCode: 500, headers: h, body: JSON.stringify({ ok: false, error: e.message, log }) };
  }

  await markProcessed(db, newMsgIds);

  const report = await buildDailyReport(db, today);
  const stats  = { scanned, new_count: newDocs.length, errors, fsc_scrubs: fscScrubLog.length, scanned_at: new Date(), log };
  await db.collection("rfq_scan_log").insertOne(stats);

  const summaryText    = buildSummaryText(report, stats, fscScrubLog);
  const summarySubject = stats.new_count === 0
    ? "SCC Inbox Scan: No new responses · " + new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })
    : "SCC: " + stats.new_count + " new · " + report.total_quotes + " quotes · " + report.total_no_bids + " no-bids";

  try {
    await sendSummary(summarySubject, summaryText);
    addLog("Summary sent → " + SUMMARY_TO);
  } catch (e) {
    addLog("Summary email failed: " + e.message);
  }

  return {
    statusCode: 200,
    headers: h,
    body: JSON.stringify({ ok: true, stats, report, log }),
  };
};
