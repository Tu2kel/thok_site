// src/gmail-watcher.js — polls Gmail for DLA DIBBS solicitation emails
// DLA sends daily emails: "The following Solicitations have been posted publicly on DIBBS."
// Each line: {url} {nsn_digits} {cage}

const GMAIL_BASE  = "https://gmail.googleapis.com/gmail/v1/users/me";
const { sendEmail } = require("./email");

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Gmail token refresh failed");
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

async function gmailGet(path) {
  const token = await getToken();
  const res = await fetch(GMAIL_BASE + path, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("Gmail API error " + res.status + " on " + path);
  return res.json();
}

// Parse email body text → array of { sol_number, nsn, url }
function parseDibbsEmail(text) {
  const sols = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // Pattern: URL sol_or_nsn cage
    // https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=SPE4A726T529C 1560001239723 152U4
    const m = line.match(/RFQRec\.aspx\?sn=([A-Z0-9]+)\s+(\d{13})\s+(\w+)/);
    if (!m) continue;
    const sol_number = m[1];
    const nsn_raw    = m[2]; // 13 digits, no dashes
    const nsn        = nsn_raw.slice(0,4) + "-" + nsn_raw.slice(4,6) + "-" + nsn_raw.slice(6,9) + "-" + nsn_raw.slice(9);
    sols.push({
      sol_number,
      nsn,
      fsc: nsn_raw.slice(0, 4),
      url: "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=" + sol_number,
    });
  }
  return sols;
}

function decodeBody(part) {
  if (!part) return "";
  if (part.body && part.body.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  if (part.parts) {
    for (const p of part.parts) {
      const text = decodeBody(p);
      if (text) return text;
    }
  }
  return "";
}

// Fetch unread DLA solicitation emails from the last N hours
async function fetchDibbsSols({ lookbackHours = 26 } = {}) {
  const after = Math.floor((Date.now() - lookbackHours * 3600 * 1000) / 1000);
  const q = encodeURIComponent('from:dla.mil "Solicitations have been posted publicly" after:' + after);

  const list = await gmailGet("/messages?q=" + q + "&maxResults=20");
  const messages = list.messages || [];

  console.log("[gmail-watcher] Found " + messages.length + " DLA email(s) in last " + lookbackHours + "h");

  const allSols = [];
  const seenSols = new Set();

  for (const { id } of messages) {
    const msg  = await gmailGet("/messages/" + id + "?format=full");
    const body = decodeBody(msg.payload);
    const sols = parseDibbsSols(body);

    for (const sol of sols) {
      if (!seenSols.has(sol.sol_number)) {
        seenSols.add(sol.sol_number);
        allSols.push(sol);
      }
    }
    console.log("[gmail-watcher] Email " + id + " → " + sols.length + " sols");
  }

  console.log("[gmail-watcher] Total unique sols from email: " + allSols.length);
  return allSols;
}

// Alias
function parseDibbsSols(text) { return parseDibbsEmail(text); }

module.exports = { fetchDibbsSols, parseDibbsSols };
