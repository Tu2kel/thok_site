// netlify/functions/gmail-ingest.js
// Imperio SCC — Scheduled DLA email ingestor
// Runs daily (see netlify.toml schedule). Reads anthony@ifedlog.com inbox for
// emails from solmlbsm@dla.mil, parses sol numbers, fetches from DIBBS, screens
// with Claude, fires RFQ emails, saves to MongoDB, sends batch summary.
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   ANTHROPIC_API_KEY (for Claude screening)
//   SCRAPER_API_KEY   (for DIBBS fetch)
//   MONGODB_URI       (for saving to pipeline)

const { MongoClient } = require("mongodb");

// Federal RFQ blast retired 2026-07-15. This function emails vendors over the Gmail
// API, which never touches the Railway blaster's runBlast guard — so it needs its own.
// Default OFF; set FEDERAL_BLAST_ENABLED=true in Netlify env to resume.
const BLAST_ENABLED  = process.env.FEDERAL_BLAST_ENABLED === "true";

const FROM_ADDRESS   = "anthony@ifedlog.com";
const FROM_NAME      = "Anthony K Kelley | Imperio Federal Logistics";
const DLA_SENDER     = "solmlbsm@dla.mil";
const TOKEN_URL      = "https://oauth2.googleapis.com/token";
const GMAIL_BASE     = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SEND_URL = GMAIL_BASE + "/messages/send";
const SITE_URL       = "https://thehouseofkel.com/scc/";

// ── GOOGLE AUTH ───────────────────────────────────────────────────────────
async function getGoogleToken() {
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  const res  = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token refresh failed: " + JSON.stringify(data));
  return data.access_token;
}

// ── GMAIL READ ────────────────────────────────────────────────────────────
async function listMessages(token, query) {
  const url = GMAIL_BASE + "/messages?q=" + encodeURIComponent(query) + "&maxResults=20";
  const res  = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const data = await res.json();
  return data.messages || [];
}

async function getMessage(token, id) {
  const res  = await fetch(GMAIL_BASE + "/messages/" + id + "?format=full", {
    headers: { Authorization: "Bearer " + token },
  });
  return res.json();
}

function decodeBody(msg) {
  // Walk the payload to find text/plain part
  function findPlain(part) {
    if (!part) return null;
    if (part.mimeType === "text/plain" && part.body && part.body.data) return part.body.data;
    for (const p of part.parts || []) {
      const found = findPlain(p);
      if (found) return found;
    }
    return null;
  }
  const b64 = findPlain(msg.payload);
  if (!b64) return "";
  return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

// ── PARSE DLA EMAIL → sol entries ────────────────────────────────────────
function parseEmailBody(raw) {
  const lines   = raw.split(/\r?\n/);
  const results = [];
  const seen    = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    const urlMatch = trimmed.match(/https:\/\/www\.dibbs\.bsm\.dla\.mil\/RFQ\/RFQRec\.aspx\?sn=([A-Z0-9]+)/i);
    if (!urlMatch) continue;
    const sol_number = urlMatch[1].toUpperCase();
    if (seen.has(sol_number)) continue;
    seen.add(sol_number);

    // Extract NSN (13 digits) and flags from the same line
    const nsnMatch  = trimmed.match(/\b(\d{13})\b/);
    const isAIDC    = /\*\*\s*AIDC\s*\*\*/i.test(trimmed);
    const fsc       = nsnMatch ? nsnMatch[1].slice(0, 4) : "";

    results.push({ sol_number, nsn: nsnMatch ? nsnMatch[1] : "", fsc, isAIDC });
  }
  return results;
}

// ── DIBBS FETCH ───────────────────────────────────────────────────────────
async function fetchDibbsSol(sol_number) {
  // Call our own dibbs-sol function internally via HTTP
  const url = process.env.URL + "/.netlify/functions/dibbs-sol";
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sol_number }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error("dibbs-sol error: " + (data.error || "unknown"));
  return data.sol;
}

// ── CLAUDE SCREEN ─────────────────────────────────────────────────────────
async function claudeScreen(record) {
  const url  = process.env.URL + "/.netlify/functions/analyze-sols";
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sols: [record] }),
  });
  const data = await res.json();
  if (!data.ok || !data.results || !data.results[0]) throw new Error("analyze-sols error");
  return data.results[0];
}

// ── DISTRIBUTORS FROM MONGO ───────────────────────────────────────────────
async function getDistributors(db) {
  return db.collection("distributors").find({}).toArray();
}

// ── P/N PREFIX DETECTION ──────────────────────────────────────────────────
function detectPNPrefix(pn) {
  const p = (pn || "").trim().toUpperCase();
  if (/^AN[\d-]/.test(p)) return "AN";
  if (/^MS[\d-]/.test(p)) return "MS";
  if (/^NAS[\d-]/.test(p)) return "NAS";
  return null;
}

// ── VENDOR SELECTION (server-side mirror of auto-rfq.js) ─────────────────
function selectVendors(record, dists) {
  const fsc      = (record.fsc || "").slice(0, 4);
  const pnPrefix = detectPNPrefix(record.ref_part_number);
  const selected = [];
  const seenIds  = new Set();

  const add = (d, reason) => {
    if (!d || seenIds.has(d._id?.toString() || d.name)) return;
    if (!d.email)  return;
    if (d.is_dns)  return;
    seenIds.add(d._id?.toString() || d.name);
    selected.push({ dist: d, reason });
  };

  // AN/MS/NAS prefix — route through MFR+JCP chain (no hardcoded vendor override)

  // Priority: MFR+JCP → MFR → FSC-matched → preferred/starred
  for (const d of dists) if (d.is_manufacturer && d.has_jcp)  add(d, "MFR · JCP");
  for (const d of dists) if (d.is_manufacturer && !d.has_jcp) add(d, "MFR");
  for (const d of dists) {
    if ((d.fsc || []).includes(fsc)) add(d, "FSC " + fsc);
  }
  for (const d of dists) {
    if (d.is_starred || (d.tags || []).includes("preferred")) add(d, "Preferred");
  }
  return selected;
}

// ── QUOTE DUE HELPER ─────────────────────────────────────────────────────
function quoteDueDisplay(dateStr) {
  if (!dateStr) return null;
  let m, d;
  // ISO-8601: YYYY-MM-DD
  m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() - 1);
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  }
  // MM/DD/YY[YY] (DIBBS slash format)
  m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
  d = new Date(yr, parseInt(m[1]) - 1, parseInt(m[2]));
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - 1);
  return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
}

// ── BUILD RFQ EMAIL (HTML) ────────────────────────────────────────────────
function buildRFQEmail(dist, record) {
  const item    = record.item_name || record.item_description || "—";
  const qtyNum  = record.quantity || record.qty;
  const qty     = qtyNum ? qtyNum + (record.unit_of_issue ? " " + record.unit_of_issue : "") : "—";
  const del     = record.delivery_days ? record.delivery_days + " days ARO" : "—";
  const dueDate = quoteDueDisplay(record.quote_due);
  const vendor  = dist.name || dist.company_name || "Team";

  const subject = "RFQ - " + item + " | " + record.sol_number + " | Imperio Federal Logistics";

  var itemRows = [
    "<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Item:</td><td style='padding:2px 0;'><strong>" + item + "</strong></td></tr>",
  ];
  if (record.ref_part_number) {
    itemRows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Part Number:</td><td style='padding:2px 0;'>" + record.ref_part_number + "</td></tr>");
  }
  itemRows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Quantity:</td><td style='padding:2px 0;'>" + qty + "</td></tr>");
  itemRows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Required Del.:</td><td style='padding:2px 0;'>" + del + "</td></tr>");
  if (dueDate) {
    itemRows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Quote Due:</td><td style='padding:2px 0;'>" + dueDate + "</td></tr>");
  }
  itemRows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Ref #:</td><td style='padding:2px 0;'>" + record.sol_number + "</td></tr>");

  const body = [
    "<!DOCTYPE html><html><body style='margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;background:#fff;'>",
    "<div style='background:#000;padding:7px 16px;'>",
      "<span style='color:#cc0000;font-weight:bold;font-style:italic;font-size:13px;'>Retired</span>",
      "<span style='color:#fff;font-weight:bold;font-size:13px;'> U.S. Army Veteran</span>",
      "<span style='color:#00aaff;font-weight:bold;font-size:13px;margin-left:20px;'>&#9733; Texas Veteran-Owned Business</span>",
    "</div>",
    "<div style='padding:20px 24px;'>",
      "<p style='margin:0 0 16px 0;'>Hi " + vendor + ",</p>",
      "<p style='margin:0 0 16px 0;'>My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.</p>",
      "<p style='margin:0 0 12px 0;'>I need pricing and availability on the following item:</p>",
      "<table style='border-left:3px solid #cc0000;padding-left:10px;margin:0 0 14px 0;border-spacing:0;border-collapse:collapse;'>",
        itemRows.join(""),
      "</table>",
      "<p style='margin:0 0 6px 0;'><strong>Requirements:</strong></p>",
      "<ul style='margin:0 0 16px 0;padding-left:20px;line-height:1.8;'>",
        "<li>Destination: Government delivery address (continental US)</li>",
        "<li>Compliance: BAA/TAA required — please confirm country of origin</li>",
        "<li>Shipping: FOB Destination required</li>",
        "<li>Condition: New/unused only. No substitutions without prior approval.</li>",
      "</ul>",
      "<p style='margin:0 0 20px 0;'>Please provide unit price, lead time, and confirm country of origin. We issue POs immediately upon award.</p>",
      "<p style='margin:0 0 4px 0;'>V/R,</p>",
      "<p style='margin:0 0 16px 0;line-height:1.9;'>",
        "<strong>Anthony K. Kelley</strong><br>",
        "<strong>Founder | Imperio Federal Logistics</strong><br>",
        "<span style='color:#666;font-size:13px;'>A Division of</span><br>",
        "The House of Kel LLC<br>",
        "<strong>CAGE Code: 152U4</strong><br>",
        "<a href='mailto:" + FROM_ADDRESS + "' style='color:#0066cc;'>" + FROM_ADDRESS + "</a> | <a href='https://www.ifedlog.com' style='color:#0066cc;'>www.ifedlog.com</a><br>",
        "(254) 226-5216",
      "</p>",
      "<hr style='border:none;border-top:1px solid #ccc;margin:0 0 12px 0;'>",
      "<p style='margin:0 0 12px 0;font-size:13px;'>SDVOSB | &#11088; | VetHUB</p>",
      "<img src='https://thehouseofkel.com/ifl_banner.png' alt='Imperio Federal Logistics' style='max-width:420px;display:block;'>",
    "</div>",
    "</body></html>",
  ].join("");

  return { subject, body };
}

// ── GMAIL SEND ────────────────────────────────────────────────────────────
function buildMimeRaw(to, subject, body) {
  const CRLF = "\r\n";
  const msg  = [
    "From: " + FROM_NAME + " <" + FROM_ADDRESS + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    body,
  ].join(CRLF);
  return Buffer.from(msg).toString("base64url");
}

async function gmailSend(token, to, subject, body) {
  const res = await fetch(GMAIL_SEND_URL, {
    method:  "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body:    JSON.stringify({ raw: buildMimeRaw(to, subject, body) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gmail send failed: " + JSON.stringify(data));
  return data;
}

// ── MONGODB SAVE ──────────────────────────────────────────────────────────
async function saveSolToMongo(db, record) {
  await db.collection("solicitations").updateOne(
    { sol_number: record.sol_number },
    { $set: record },
    { upsert: true },
  );
}

// ── MARK PROCESSED ────────────────────────────────────────────────────────
// Store processed Gmail message IDs to avoid re-processing
async function getProcessedIds(db) {
  const doc = await db.collection("_meta").findOne({ _id: "gmail_processed" });
  return new Set(doc ? doc.ids : []);
}
async function markProcessed(db, ids) {
  await db.collection("_meta").updateOne(
    { _id: "gmail_processed" },
    { $addToSet: { ids: { $each: ids } } },
    { upsert: true },
  );
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
exports.handler = async () => {
  const log = [];
  const addLog = (msg) => { log.push(msg); console.log("[gmail-ingest]", msg); };

  let db;
  try {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db("scc_db");
  } catch (e) {
    return { statusCode: 500, body: "MongoDB connection failed: " + e.message };
  }

  let token;
  try {
    token = await getGoogleToken();
    addLog("Google token acquired");
  } catch (e) {
    return { statusCode: 500, body: "Google auth failed: " + e.message };
  }

  // Read DLA emails from last 2 days
  const msgs = await listMessages(token, "from:" + DLA_SENDER + " newer_than:2d");
  addLog("Found " + msgs.length + " DLA message(s) in inbox");

  if (msgs.length === 0) {
    await gmailSend(token, FROM_ADDRESS, "SCC Auto-Ingest: No new DLA emails today",
      "No emails from " + DLA_SENDER + " in the last 2 days.\n\n" + new Date().toLocaleString() + "\n" + SITE_URL);
    return { statusCode: 200, body: "No new emails" };
  }

  const processedIds = await getProcessedIds(db);
  const dists        = await getDistributors(db);
  const results      = { go: [], verifyFirst: [], rejected: [], errors: [], skipped: [] };
  const newMsgIds    = [];

  for (const msgRef of msgs) {
    if (processedIds.has(msgRef.id)) { addLog("Skip already-processed: " + msgRef.id); continue; }
    newMsgIds.push(msgRef.id);

    const msg     = await getMessage(token, msgRef.id);
    const body    = decodeBody(msg);
    const entries = parseEmailBody(body);
    addLog("Parsed " + entries.length + " sol(s) from message " + msgRef.id);

    for (const entry of entries) {
      const sol = entry.sol_number;
      try {
        // Fast pre-screen
        if (entry.isAIDC) {
          results.rejected.push({ sol, reason: "AIDC (pre-screen)" });
          addLog("PRE-REJECT " + sol + " — AIDC");
          await saveSolToMongo(db, { sol_number: sol, nsn: entry.nsn, fsc: entry.fsc,
            status: "No Source", notes: "Auto-rejected: AIDC", date_added: new Date().toLocaleDateString() });
          continue;
        }

        // Fetch from DIBBS
        addLog("Fetching " + sol + "…");
        let fetched;
        try {
          fetched = await fetchDibbsSol(sol);
        } catch (e) {
          addLog("DIBBS fetch failed for " + sol + ": " + e.message);
          results.errors.push({ sol, error: "DIBBS: " + e.message });
          continue;
        }

        const record = {
          sol_number:       sol,
          nsn:              entry.nsn || fetched.nsn || "",
          fsc:              entry.fsc || (fetched.nsn || "").slice(0, 4),
          item_name:        fetched.item_description || "",
          ref_part_number:  (fetched.part_numbers || []).join(", "),
          quantity:         fetched.qty || "",
          unit_of_issue:    fetched.unit_issue || "",
          unit_price:       fetched.hist_unit_price || fetched.unit_price || "",
          delivery_days:    fetched.delivery_days || "",
          set_aside:        fetched.set_aside || "",
          fob:              fetched.fob || "",
          quote_due:        fetched.due_date || "",
          posted_date:      fetched.issue_date || "",
          approved_sources: fetched.suppliers || [],
          status:           "New",
          date_added:       new Date().toLocaleDateString(),
          notes:            "Auto-ingested via Gmail · " + DLA_SENDER,
          source:           "gmail-ingest",
        };

        // Claude screen
        addLog("Screening " + sol + " with Claude…");
        let analysis;
        try {
          analysis = await claudeScreen(record);
          addLog(sol + " → " + analysis.verdict + ": " + analysis.reason);
        } catch (e) {
          addLog("Claude failed for " + sol + ": " + e.message + " — defaulting GO");
          analysis = { verdict: "GO", reason: "Claude unavailable — manual review recommended" };
        }

        if (analysis.verdict === "REJECT") {
          results.rejected.push({ sol, reason: analysis.reason });
          record.status = "No Source";
          record.notes  = "Auto-rejected: " + analysis.reason;
          await saveSolToMongo(db, record);
          continue;
        }

        // GO or VERIFY FIRST — fire RFQs either way.
        // Requesting a quote commits nothing. You decide at bid time.
        // VERIFY FIRST sols are flagged in notes + summary so you know to review before submitting.
        const isFlag  = analysis.verdict === "VERIFY FIRST";
        const vendors = BLAST_ENABLED ? selectVendors(record, dists) : [];
        if (!BLAST_ENABLED) addLog("⛔ Federal blast disabled — no RFQs sent for " + sol);
        let sent = 0;
        for (const { dist, reason } of vendors) {
          try {
            const { subject, body: emailBody } = buildRFQEmail(dist, record);
            await gmailSend(token, dist.email, subject, emailBody);
            addLog((isFlag ? "⚠ " : "✓ ") + "RFQ → " + (dist.name || dist.company_name) + " [" + reason + "]");
            sent++;
          } catch (e) {
            addLog("✗ RFQ failed → " + (dist.name || dist.company_name) + ": " + e.message);
          }
        }

        record.status = sent > 0 ? "Awaiting Quotes" : "Sourcing";
        record.notes  = [
          record.notes,
          isFlag ? "⚠ VERIFY FIRST — review before bidding: " + analysis.reason : "Claude: " + analysis.reason,
          analysis.sourcing_path ? "Path: " + analysis.sourcing_path : null,
          analysis.winProbabilityPct != null ? "Win prob: " + analysis.winProbabilityPct + "%" : null,
          "Auto-RFQ: " + sent + "/" + vendors.length + " sent",
        ].filter(Boolean).join("\n");
        await saveSolToMongo(db, record);

        if (isFlag) {
          results.verifyFirst.push({ sol, sent, total: vendors.length, reason: analysis.reason, path: analysis.sourcing_path });
        } else {
          results.go.push({ sol, sent, total: vendors.length, reason: analysis.reason });
        }

      } catch (e) {
        addLog("Error on " + sol + ": " + e.message);
        results.errors.push({ sol, error: e.message });
      }
    }
  }

  // Mark all new messages as processed
  if (newMsgIds.length > 0) await markProcessed(db, newMsgIds);

  // Send summary email to owner
  const total = results.go.length + results.verifyFirst.length + results.rejected.length + results.errors.length;
  const summaryLines = [
    "SCC Auto-Ingest Summary",
    new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT",
    "─".repeat(44),
    "",
    "✅ GO — RFQs Sent (" + results.go.length + ")",
    ...results.go.map(r => "  • " + r.sol + " → " + r.sent + "/" + r.total + " vendor(s)  " + r.reason),
    results.go.length === 0 ? "  (none)" : "",
    "",
    "⚠ FLAGGED — RFQ Sent, Review Before Bidding (" + results.verifyFirst.length + ")",
    ...results.verifyFirst.map(r => "  • " + r.sol + " → " + r.sent + "/" + r.total + " vendor(s)  " + r.reason + (r.path ? "\n    " + r.path : "")),
    results.verifyFirst.length === 0 ? "  (none)" : "",
    "",
    "🔒 REJECTED — No Source (" + results.rejected.length + ")",
    ...results.rejected.map(r => "  • " + r.sol + " — " + r.reason),
    results.rejected.length === 0 ? "  (none)" : "",
    results.errors.length > 0 ? "\n✗ ERRORS (" + results.errors.length + ")" : "",
    ...results.errors.map(r => "  • " + r.sol + " — " + r.error),
    "",
    "─".repeat(44),
    "Processed " + total + " solicitation(s) from " + newMsgIds.length + " email(s)",
    "View Pipeline → " + SITE_URL,
  ].filter(l => l !== "").join("\n");

  const summarySubject = total === 0
    ? "SCC Auto-Ingest: Nothing new today"
    : "SCC: " + (results.go.length + results.verifyFirst.length) + " RFQs fired · " + results.verifyFirst.length + " flagged · " + results.rejected.length + " rejected";

  try {
    await gmailSend(token, FROM_ADDRESS, summarySubject, summaryLines);
    addLog("Summary email sent to " + FROM_ADDRESS);
  } catch (e) {
    addLog("Summary email failed: " + e.message);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, results, log }),
  };
};
