// netlify/functions/scc-rfq-inbox.js
// Imperio SCC — Vendor RFQ Inbox Scanner
//
// Scans Gmail (kelley.anthonyk@gmail.com) for vendor replies to RFQ blasts.
// Parses price, lead time, no-bid reason using Claude Haiku.
// Compares vendor price vs. DIBBS historical unit_price stored in solicitations.
// Calculates margin at Standard 27.5% and flags OVER/FAIR/UNDER vs. history.
// Saves per-response records + sends email summary after each run.
//
// Actions (POST): scan | getReport | getScanLog
// Scheduled: 4x/day via netlify.toml (8AM, 12PM, 4PM, 8PM CT)
//
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//      ANTHROPIC_API_KEY, MONGODB_URI

const { MongoClient } = require("mongodb");

const FROM_ADDRESS = "kelley.anthonyk@gmail.com";
const FROM_NAME    = "Anthony K Kelley | Imperio Federal Logistics";
const TOKEN_URL    = "https://oauth2.googleapis.com/token";
const GMAIL_BASE   = "https://gmail.googleapis.com/gmail/v1/users/me";

// Price analysis thresholds
const HIST_OVER_THRESHOLD  =  15;  // > +15% vs historical → OVER
const HIST_UNDER_THRESHOLD = -10;  // > -10% vs historical → UNDER
const STANDARD_MARGIN      = 0.275;

// ── GOOGLE AUTH ────────────────────────────────────────────────────────────
async function getGoogleToken() {
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  const res  = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token refresh failed: " + JSON.stringify(data));
  return data.access_token;
}

// ── GMAIL HELPERS ──────────────────────────────────────────────────────────
async function gmailList(token, query, maxResults) {
  const url = GMAIL_BASE + "/messages?q=" + encodeURIComponent(query) + "&maxResults=" + (maxResults || 100);
  const res  = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const data = await res.json();
  return data.messages || [];
}

async function gmailGet(token, id) {
  const res = await fetch(GMAIL_BASE + "/messages/" + id + "?format=full", {
    headers: { Authorization: "Bearer " + token },
  });
  return res.json();
}

function gmailHeader(msg, name) {
  const hdrs = (msg.payload && msg.payload.headers) || [];
  const h = hdrs.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function decodeBody(msg) {
  function findPart(part, mime) {
    if (!part) return null;
    if (part.mimeType === mime && part.body && part.body.data) return part.body.data;
    for (const p of part.parts || []) {
      const f = findPart(p, mime);
      if (f) return f;
    }
    return null;
  }
  const b64 = findPart(msg.payload, "text/plain") || findPart(msg.payload, "text/html") || "";
  if (!b64) return "";
  const text = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

async function gmailSend(token, subject, body) {
  const CRLF = "\r\n";
  const raw  = [
    "From: " + FROM_NAME + " <" + FROM_ADDRESS + ">",
    "To: " + FROM_ADDRESS,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join(CRLF);
  const res = await fetch(GMAIL_BASE + "/messages/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gmail send failed: " + JSON.stringify(data));
  return data;
}

// ── SOL EXTRACTION ─────────────────────────────────────────────────────────
// DLA sol patterns: SPE7MX-26-Q-1234, W91CRB-26-Q-1234, FA8101-26-Q-1234, etc.
const SOL_REGEX = /\b([A-Z]{2,7}[\dA-Z]{1,5}-\d{2,4}-[A-Z]-\d{3,7})\b/g;

function extractSol(text) {
  const matches = [...(text || "").matchAll(SOL_REGEX)];
  return matches.length ? matches[0][1] : null;
}

// ── CLAUDE PARSER ──────────────────────────────────────────────────────────
async function claudeParse(emailBody, vendorName, subject) {
  const prompt = [
    "You are parsing a vendor email response to an RFQ (Request for Quote) for a US government DLA contract.",
    "The vendor is responding to Imperio Federal Logistics.",
    "",
    "Return ONLY a JSON object with these fields:",
    '{"type":"quote|no_bid","unit_price":number|null,"lead_time_days":number|null,"country_of_origin":"string"|null,"no_bid_reason":"string"|null,"notes":"string"|null}',
    "",
    "Rules:",
    "- type=no_bid if vendor says: unable, cannot, no bid, NB, not available, out of stock, decline, pass, no quote, no inventory, EOL, discontinued, do not carry",
    "- unit_price = per-unit price in USD only (ignore freight/handling totals); if range use lower",
    "- lead_time_days: convert weeks×7, months×30; 'ARO' just means after receipt of order (keep the number)",
    "- no_bid_reason: brief quote of their stated reason (max 80 chars)",
    "- notes: min order qty, special terms, certification notes, or other relevant detail",
    "",
    "Subject: " + subject,
    "From: " + vendorName,
    "",
    "Email:",
    emailBody.slice(0, 2000),
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
  const raw  = data.content && data.content[0] && data.content[0].text;
  if (!raw) throw new Error("No content from Claude: " + JSON.stringify(data));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude response: " + raw.slice(0, 200));
  return JSON.parse(jsonMatch[0]);
}

// ── PRICE ANALYSIS ─────────────────────────────────────────────────────────
function analyzePrice(vendorPrice, histPrice) {
  const out = {
    hist_price:           histPrice || null,
    hist_deviation_pct:   null,
    hist_flag:            histPrice ? "NO_DATA" : "NO_HIST",
    target_bid:           null,
    margin_at_target_pct: parseFloat((STANDARD_MARGIN * 100).toFixed(1)),
    margin_at_hist_pct:   null,
    margin_flag:          null,
  };

  if (!vendorPrice || vendorPrice <= 0) return out;

  // Bid price at standard margin target
  out.target_bid = parseFloat((vendorPrice / (1 - STANDARD_MARGIN)).toFixed(4));

  // Historical deviation
  if (histPrice && histPrice > 0) {
    const dev = ((vendorPrice - histPrice) / histPrice) * 100;
    out.hist_deviation_pct = parseFloat(dev.toFixed(1));
    out.hist_flag = dev > HIST_OVER_THRESHOLD ? "OVER"
                  : dev < HIST_UNDER_THRESHOLD ? "UNDER"
                  : "FAIR";

    // Margin if bidding AT the historical DIBBS price (competitive target)
    const marginAtHist = ((histPrice - vendorPrice) / histPrice) * 100;
    out.margin_at_hist_pct = parseFloat(marginAtHist.toFixed(1));
    out.margin_flag = marginAtHist < 0   ? "NEGATIVE"
                    : marginAtHist < 8   ? "SQUEEZED"
                    : marginAtHist < 15  ? "TIGHT"
                    : marginAtHist < 27.5 ? "OK"
                    : "GOOD";
  }

  return out;
}

// ── BUILD DAILY REPORT ─────────────────────────────────────────────────────
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
    // Best = lowest valid price
    const best = quotes.length
      ? quotes.reduce((b, q) => (q.unit_price || Infinity) < (b.unit_price || Infinity) ? q : b, quotes[0])
      : null;

    return {
      sol_number,
      item_name,
      quote_count:    quotes.length,
      no_bid_count:   no_bids.length,
      best_vendor:    best ? (best.vendor_name || best.vendor_email) : null,
      best_price:     best ? best.unit_price : null,
      best_hist_flag: best ? best.hist_flag : null,
      best_margin_flag: best ? best.margin_flag : null,
      best_target_bid:  best ? best.target_bid : null,
      action: quotes.length === 0 && no_bids.length > 0 ? "ALL_NO_BID"
            : best && best.hist_flag === "OVER"          ? "REVIEW_PRICE"
            : best && best.margin_flag === "NEGATIVE"    ? "MARGIN_NEGATIVE"
            : null,
      quotes,
      no_bids,
    };
  }).sort((a, b) => {
    if (a.quote_count > 0 && b.quote_count === 0) return -1;
    if (b.quote_count > 0 && a.quote_count === 0) return 1;
    return a.sol_number.localeCompare(b.sol_number);
  });

  return {
    date:            dateStr,
    total_responses: responses.length,
    total_quotes:    responses.filter((r) => r.type === "quote").length,
    total_no_bids:   responses.filter((r) => r.type === "no_bid").length,
    total_sols:      sols.length,
    sols,
    generated_at:    new Date().toISOString(),
  };
}

// ── EMAIL SUMMARY ──────────────────────────────────────────────────────────
async function sendSummary(token, report, stats) {
  const ct = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const lines = [
    "RFQ INBOX SCAN — " + ct + " CT",
    "═".repeat(50),
    "",
    "Scan:  " + stats.scanned + " emails checked · " + stats.new_count + " new response(s) · " + stats.errors + " error(s)",
    "Daily: " + report.total_quotes + " quote(s) · " + report.total_no_bids + " no-bid(s) across " + report.total_sols + " sol(s)",
    "",
  ];

  if (report.sols.length === 0) {
    lines.push("No vendor responses in inbox today.");
  } else {
    for (const sol of report.sols) {
      const header = "SOL: " + sol.sol_number + (sol.item_name ? " — " + sol.item_name.slice(0, 40) : "");
      lines.push(header);

      for (const q of sol.quotes) {
        const devStr    = q.hist_deviation_pct != null ? (q.hist_deviation_pct >= 0 ? "+" : "") + q.hist_deviation_pct + "%" : "";
        const histPart  = q.hist_flag && q.hist_flag !== "NO_HIST" ? " [" + q.hist_flag + (devStr ? " " + devStr : "") + "]" : " [NO HIST]";
        const margPart  = q.margin_flag ? " → " + q.margin_flag : "";
        const bidPart   = q.target_bid ? " | Bid@27.5%: $" + q.target_bid.toFixed(4) : "";
        lines.push("  QUOTE   " + (q.vendor_name || q.vendor_email).slice(0, 28).padEnd(28) +
          " $" + (q.unit_price != null ? q.unit_price.toFixed(4) : "?") + "/ea" +
          histPart + margPart + bidPart);
      }
      for (const nb of sol.no_bids) {
        lines.push("  NO-BID  " + (nb.vendor_name || nb.vendor_email).slice(0, 28) +
          (nb.no_bid_reason ? ": " + nb.no_bid_reason : ""));
      }
      if (sol.action === "ALL_NO_BID") lines.push("  !! ACTION: Re-blast or mark No Source");
      if (sol.action === "REVIEW_PRICE") lines.push("  ⚠  REVIEW: Best quote is above historical price");
      if (sol.action === "MARGIN_NEGATIVE") lines.push("  !! MARGIN NEGATIVE: Vendor price exceeds DIBBS price");
      if (sol.best_vendor && sol.quote_count > 0) {
        lines.push("  ★ BEST: " + sol.best_vendor + " @ $" + (sol.best_price || "?") +
          (sol.best_target_bid ? " → Bid $" + sol.best_target_bid.toFixed(4) : "") +
          (sol.best_margin_flag ? " [" + sol.best_margin_flag + "]" : ""));
      }
      lines.push("");
    }
  }

  lines.push("═".repeat(50));
  lines.push("Pipeline → https://thehouseofkel.com/scc/");

  const subject = stats.new_count === 0
    ? "SCC Inbox Scan: No new responses · " + ct.split(",")[0]
    : "SCC: " + stats.new_count + " new · " + report.total_quotes + " quotes · " + report.total_no_bids + " no-bids · " + ct.split(",")[0];

  await gmailSend(token, subject, lines.join("\n"));
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

  let action = "scan";
  let payload = {};
  if (event.httpMethod === "POST" && event.body) {
    try { const b = JSON.parse(event.body); action = b.action || "scan"; payload = b; } catch {}
  }

  const db = await getDb();

  // ── getReport ────────────────────────────────────────────────────────────
  if (action === "getReport") {
    const todayStr = payload.date || new Date().toISOString().slice(0, 10);
    const report   = await buildDailyReport(db, todayStr);
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, report }) };
  }

  // ── getScanLog ───────────────────────────────────────────────────────────
  if (action === "getScanLog") {
    const logs = await db.collection("rfq_scan_log")
      .find({})
      .sort({ scanned_at: -1 })
      .limit(20)
      .toArray();
    return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true, logs }) };
  }

  // ── scan ─────────────────────────────────────────────────────────────────
  const log     = [];
  const addLog  = (m) => { log.push(m); console.log("[rfq-inbox]", m); };
  const todayStr = new Date().toISOString().slice(0, 10);

  let token;
  try {
    token = await getGoogleToken();
    addLog("Google token OK");
  } catch (e) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ ok: false, error: e.message }) };
  }

  // Search: replies to RFQ emails + any email mentioning SOL numbers
  // 7-day window — dedup by processed IDs prevents double-counting
  const query = "(subject:\"Re: RFQ\" OR subject:\"RE: RFQ\") newer_than:7d in:inbox";
  const msgs  = await gmailList(token, query, 100);
  addLog(msgs.length + " candidate email(s) found");

  const processed = await getProcessed(db);
  const newMsgIds = [];
  const newDocs   = [];
  let errors      = 0;

  for (const ref of msgs) {
    if (processed.has(ref.id)) continue;
    newMsgIds.push(ref.id);

    let msg;
    try { msg = await gmailGet(token, ref.id); } catch (e) {
      addLog("Fetch failed " + ref.id + ": " + e.message);
      errors++;
      continue;
    }

    const subject = gmailHeader(msg, "subject");
    const from    = gmailHeader(msg, "from");
    const dateHdr = gmailHeader(msg, "date");
    const body    = decodeBody(msg);

    // Parse From header: "Name <email>" or "email"
    const fromParsed  = from.match(/^"?([^"<>]+?)"?\s*<([^>]+)>$/) || from.match(/^([^\s]+@[^\s]+)$/);
    const vendorName  = fromParsed ? fromParsed[1].trim() : from;
    const vendorEmail = fromParsed ? (fromParsed[2] || fromParsed[1]).toLowerCase().trim() : from.toLowerCase().trim();

    // Skip our own addresses
    if (/ifedlog\.com|thehouseofkel|kelley\.anthonyk/i.test(vendorEmail)) continue;

    // Extract SOL from subject first, then body
    const solNumber = extractSol(subject) || extractSol(body);
    if (!solNumber) { addLog("No SOL in: " + subject.slice(0, 60)); continue; }

    // Historical price from solicitations collection
    const solRec   = await db.collection("solicitations").findOne({ sol_number: solNumber });
    const histPrice = solRec
      ? parseFloat(solRec.hist_unit_price || solRec.unit_price || 0) || null
      : null;
    const itemName  = solRec ? (solRec.item_name || solRec.item_description || "") : "";

    // Claude parse
    let parsed;
    try {
      parsed = await claudeParse(body, vendorName, subject);
      addLog(solNumber + " | " + vendorName + " → " + parsed.type + (parsed.unit_price ? " $" + parsed.unit_price : ""));
    } catch (e) {
      addLog("Claude failed " + ref.id + ": " + e.message);
      errors++;
      continue;
    }

    const msgDate = new Date(dateHdr);
    const dateStr = isNaN(msgDate.getTime()) ? todayStr : msgDate.toISOString().slice(0, 10);

    const priceAnalysis = (parsed.type === "quote" && parsed.unit_price)
      ? analyzePrice(parsed.unit_price, histPrice)
      : { hist_price: histPrice, hist_flag: histPrice ? "NO_DATA" : "NO_HIST", margin_flag: null, target_bid: null, hist_deviation_pct: null, margin_at_hist_pct: null, margin_at_target_pct: null };

    const doc = {
      gmail_msg_id:      ref.id,
      scanned_at:        new Date(),
      date:              dateStr,
      sol_number:        solNumber,
      item_name:         itemName,
      vendor_email:      vendorEmail,
      vendor_name:       vendorName,
      type:              parsed.type || "unknown",
      unit_price:        parsed.unit_price  || null,
      lead_time_days:    parsed.lead_time_days || null,
      country_of_origin: parsed.country_of_origin || null,
      no_bid_reason:     parsed.no_bid_reason || null,
      notes:             parsed.notes || null,
      raw_excerpt:       body.slice(0, 600),
      ...priceAnalysis,
    };

    // Upsert: same vendor + sol + date = update (handles re-scan of same email)
    await db.collection("rfq_responses").updateOne(
      { sol_number: solNumber, vendor_email: vendorEmail, date: dateStr },
      { $set: doc },
      { upsert: true },
    );
    newDocs.push(doc);
  }

  await markProcessed(db, newMsgIds);

  const report = await buildDailyReport(db, todayStr);

  const stats = { scanned: msgs.length, new_count: newDocs.length, errors, scanned_at: new Date() };
  await db.collection("rfq_scan_log").insertOne(stats);

  try {
    await sendSummary(token, report, stats);
    addLog("Summary email sent");
  } catch (e) {
    addLog("Summary email failed: " + e.message);
  }

  return {
    statusCode: 200,
    headers: h,
    body: JSON.stringify({ ok: true, stats, report, log }),
  };
};
