// src/gmail-watcher.js — polls Gmail via IMAP for DLA DIBBS solicitation emails
// DLA sends daily emails: "The following Solicitations have been posted publicly on DIBBS."
// Each line: {url} {nsn_13digits} {cage}
// Auth: GMAIL_APP_PASSWORD (same cred as scc-rfq-inbox.js) — no OAuth scope needed

const { ImapFlow } = require("imapflow");

const IMAP_USER = process.env.GMAIL_ADDRESS || "kelley.anthonyk@gmail.com";

function makeImapClient() {
  return new ImapFlow({
    host:   "imap.gmail.com",
    port:   993,
    secure: true,
    auth:   { user: IMAP_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });
}

// Parse email body text → array of { sol_number, nsn, fsc, url }
function parseDibbsEmail(text) {
  const sols = [];
  const seenSols = new Set();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/RFQRec\.aspx\?sn=([A-Z0-9]+)\s+(\d{13})/);
    if (!m) continue;
    const sol_number = m[1];
    if (seenSols.has(sol_number)) continue;
    seenSols.add(sol_number);
    const nsn_raw = m[2];
    const nsn = nsn_raw.slice(0,4) + "-" + nsn_raw.slice(4,6) + "-" + nsn_raw.slice(6,9) + "-" + nsn_raw.slice(9);
    sols.push({
      sol_number,
      nsn,
      fsc: nsn_raw.slice(0, 4),
      url: "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=" + sol_number,
    });
  }
  return sols;
}

// Pull href URLs out of HTML so they survive tag-stripping
function extractHrefs(html) {
  const lines = [];
  const re = /href="([^"]*RFQRec\.aspx[^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Append URL on its own line so parseDibbsEmail can match it
    lines.push(m[1]);
  }
  return lines.join("\n");
}

// Strip HTML tags, preserving text content
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

// Decode a single MIME part body string
function decodePart(raw, hdrs) {
  if (hdrs.includes("base64")) {
    try { return Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf-8"); } catch {}
  }
  if (hdrs.includes("quoted-printable")) {
    return raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return raw;
}

// Extract plain text from raw RFC2822 source.
// For HTML parts: extracts href URLs first (in case the URL is only in the href),
// then appends stripped tag text — so parseDibbsEmail sees everything.
function extractPlainText(source) {
  const raw = source.toString("utf-8");
  const sep = raw.indexOf("\r\n\r\n");
  if (sep === -1) return raw;

  const hdrs = raw.slice(0, sep).toLowerCase();
  let body   = raw.slice(sep + 4);

  const bmatch = hdrs.match(/boundary="?([^"\r\n;]+)"?/);
  if (bmatch) {
    const boundary = "--" + bmatch[1].trim();
    const parts    = body.split(boundary);
    let htmlFallback = "";
    for (const part of parts) {
      const psep = part.indexOf("\r\n\r\n");
      if (psep < 0) continue;
      const phdr  = part.slice(0, psep).toLowerCase();
      const pbody = decodePart(part.slice(psep + 4).replace(/--$/, "").trim(), phdr);
      if (phdr.includes("text/plain")) return pbody;
      if (phdr.includes("text/html") && !htmlFallback) {
        // Combine href URLs + visible text so nothing is lost
        htmlFallback = extractHrefs(pbody) + "\n" + stripTags(pbody);
      }
    }
    if (htmlFallback) return htmlFallback;
  }

  // Single-part
  body = decodePart(body, hdrs);
  if (hdrs.includes("text/html")) {
    return extractHrefs(body) + "\n" + stripTags(body);
  }
  return body;
}

// Fetch DLA solicitation emails from the last N hours via IMAP
async function fetchDibbsSols({ lookbackHours = 26 } = {}) {
  const client = makeImapClient();
  const allSols = [];
  const seenSols = new Set();

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    const since = new Date(Date.now() - lookbackHours * 3600 * 1000);
    const uids = await client.search({ from: "dla.mil", since }, { uid: true });

    console.log("[gmail-watcher] " + uids.length + " DLA email(s) in last " + lookbackHours + "h");

    for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
      const text = extractPlainText(msg.source);
      // Only process solicitation notification emails
      if (!text.includes("Solicitations have been posted publicly") && !text.includes("RFQRec.aspx")) continue;

      const sols = parseDibbsEmail(text);
      for (const sol of sols) {
        if (!seenSols.has(sol.sol_number)) {
          seenSols.add(sol.sol_number);
          allSols.push(sol);
        }
      }
      console.log("[gmail-watcher] → " + sols.length + " sol(s) parsed");
    }
  } finally {
    await client.logout().catch(() => {});
  }

  console.log("[gmail-watcher] Total unique sols: " + allSols.length);
  return allSols;
}

module.exports = { fetchDibbsSols, parseDibbsSols: parseDibbsEmail };
