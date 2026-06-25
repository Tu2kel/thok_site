// src/email.js — Gmail OAuth2 sender
const FROM_ADDRESS = "anthony@ifedlog.com";
const FROM_NAME    = "Anthony K Kelley | Imperio Federal Logistics";
const TOKEN_URL    = "https://oauth2.googleapis.com/token";
const GMAIL_SEND   = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  const res  = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token refresh failed: " + JSON.stringify(data));

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _cachedToken;
}

function buildRaw(to, subject, body, isHtml = false) {
  const CRLF = "\r\n";
  const msg = [
    "From: " + FROM_NAME + " <" + FROM_ADDRESS + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: " + (isHtml ? "text/html" : "text/plain") + "; charset=utf-8",
    "",
    body,
  ].join(CRLF);
  return Buffer.from(msg).toString("base64url");
}

async function sendEmail({ to, subject, body, isHtml = false }) {
  const token = await getAccessToken();
  const res = await fetch(GMAIL_SEND, {
    method:  "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body:    JSON.stringify({ raw: buildRaw(to, subject, body, isHtml) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gmail send failed: " + JSON.stringify(data));
  return data;
}

function buildRFQBody(dist, record) {
  const item = record.item_name || "—";
  const qty  = record.quantity || record.qty || "—";
  const del  = record.delivery_days ? record.delivery_days + " days ARO" : "—";
  const gov  = record.unit_price ? "$" + Number(record.unit_price).toLocaleString() + " est." : "—";

  const lines = [
    "Hi " + (dist.name || dist.company_name) + ",",
    "",
    "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.",
    "",
    "I need pricing and availability on the following item:",
    "",
    "  Item:            " + item,
    record.nsn             ? "  NSN:             " + record.nsn             : null,
    record.ref_part_number ? "  Part Number:     " + record.ref_part_number : null,
    "  Quantity:        " + qty,
    "  Required Del.:   " + del,
    "  Est. Gov. Value: " + gov,
    "  Solicitation:    " + record.sol_number,
    record.quote_due       ? "  Quote Due:       " + record.quote_due       : null,
    "",
    "Requirements:",
    "- Destination: Government delivery address (continental US)",
    "- Payment: Immediate PO upon award — we use third-party PO funding (Factoring Express). Supplier receives direct wire payment before shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin",
    "- Shipping: FOB Destination required",
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and confirm country of origin. We issue POs immediately upon award.",
    "",
    "Thank you,",
    "Anthony K Kelley | Founder & CEO",
    "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
    "SDVOSB | VetHUB",
    FROM_ADDRESS + " | ifedlog.com | (254) 226-5216",
  ];

  const subject = "RFQ – " + item + " | " + record.sol_number + " | Imperio Federal Logistics";
  return { subject, body: lines.filter(l => l !== null).join("\n") };
}

module.exports = { sendEmail, buildRFQBody, FROM_ADDRESS };
