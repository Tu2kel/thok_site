// src/email.js — Dual sender: Gmail (450/day) → Resend (150/day)
const nodemailer = require("nodemailer");

// ── Gmail ─────────────────────────────────────────────────────────────────────
const GMAIL_ADDRESS = "kelley.anthonyk@gmail.com";
const GMAIL_FROM    = "Anthony Kelley | Imperio Federal Logistics <" + GMAIL_ADDRESS + ">";

// Single reused transport — avoids opening a new TCP connection to smtp.gmail.com per email
let _gmailTransport = null;
function getGmailTransport() {
  if (!_gmailTransport) {
    _gmailTransport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type:         "OAuth2",
        user:         GMAIL_ADDRESS,
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      },
    });
  }
  return _gmailTransport;
}

async function sendEmailGmail({ to, subject, body }) {
  await getGmailTransport().sendMail({ from: GMAIL_FROM, to, subject, text: body });
}

// ── Resend ────────────────────────────────────────────────────────────────────
const RESEND_API     = "https://api.resend.com/emails";
const RESEND_ADDRESS = "anthony@ifedlog.com";
const RESEND_FROM    = "Anthony Kelley | Imperio Federal Logistics <" + RESEND_ADDRESS + ">";

async function sendEmailResend({ to, subject, body, isHtml = false }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const res  = await fetch(RESEND_API, {
    method:  "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify({
      from:                               RESEND_FROM,
      to:                                 Array.isArray(to) ? to : [to],
      subject,
      [isHtml ? "html" : "text"]:        body,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Resend send failed: " + JSON.stringify(data));
  return data;
}

// Backwards-compat alias (used by any code that still calls sendEmail)
const sendEmail = sendEmailResend;

// ── Body builder ──────────────────────────────────────────────────────────────
function dayBefore(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  d.setDate(d.getDate() - 1);
  return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0") + "/" + d.getFullYear();
}

function toTitleCase(s) {
  if (!s) return s;
  return s.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// sender = "gmail" | "resend"
function buildBodyForSender(vendor, sols, sender) {
  const greeting = toTitleCase(vendor.poc_first || vendor.poc_name || vendor.name || vendor.company_name);
  const isMulti  = sols.length > 1;

  // Build item lines — distros don't know NSNs, never include price
  const itemLines = sols.map((s, i) => {
    const shipTo = [s.ship_to_name, s.ship_to_street, s.ship_to_csz].filter(Boolean).join(", ");
    const fob    = (s.fob || "").toUpperCase();
    const fobStr = fob === "ORIGIN"
      ? "FOB Origin — government-arranged transport (FDT). Pack per MIL-STD-129, we coordinate pickup."
      : fob === "DESTINATION"
      ? "FOB Destination — deliver to: " + (shipTo || "government depot (details on PO)")
      : shipTo ? "Ship to: " + shipTo : null;

    return [
      isMulti ? ("Item " + (i + 1) + ":") : null,
      "  Item:          " + (s.item_name || "—"),
      s.nsn               ? "  NSN:           " + s.nsn : null,
      s.ref_part_number
        ? "  Part Number:   " + s.ref_part_number + (s.manufacturer_cage ? "  (Mfr CAGE: " + s.manufacturer_cage + ")" : "")
        : null,
      (s.quantity || s.qty) ? "  Quantity:      " + (s.quantity || s.qty) : null,
      s.delivery_days    ? "  Deliver By:    " + s.delivery_days + " days ARO" : null,
      dayBefore(s.quote_due) ? "  Response Due:  " + dayBefore(s.quote_due) : null,
      fobStr             ? "  Shipping:      " + fobStr : null,
      "  Ref #:         " + s.sol_number,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  // Packaging question — only raised if sol requires Mil-Spec; otherwise assume commercial
  const needsMilSpec = sols.some(s => s.packaging_type === "Mil-Spec");
  const packagingLine = needsMilSpec
    ? "- Packaging: This requirement calls for MIL-STD-2073 military specification packaging. Are you able to comply?"
    : null;

  const sig = sender === "gmail"
    ? [
        "Anthony K Kelley | Founder and CEO",
        "Imperio Federal Logistics · CAGE 152U4 · SDVOSB | VetHUB | (254) 226-5216",
        "kelley.anthonyk@gmail.com | anthony@ifedlog.com | ifedlog.com",
      ]
    : [
        "Anthony K Kelley | Founder and CEO",
        "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
        "SDVOSB | VetHUB | (254) 226-5216",
        "anthony@ifedlog.com | ifedlog.com",
      ];

  return [
    "Hi " + greeting + ",",
    "",
    "My name is Anthony Kelley, Founder and CEO of Imperio Federal Logistics (CAGE 152U4 · SDVOSB · VetHUB). We are a DLA-registered reseller and defense supply chain partner. We'd appreciate being extended your wholesale / distributor-level pricing — we can provide a resale certificate or tax exemption documentation on request.",
    "",
    "I have active government procurement needs in your lane and need pricing and availability on the following:",
    "",
    itemLines,
    "",
    "Requirements:",
    packagingLine,
    "- Payment: Immediate PO upon award. Wire payment prior to shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin" + (isMulti ? " for each item" : ""),
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and country of origin. We move fast.",
    "",
    "Thank you for your time,",
    ...sig,
  ].filter(line => line !== null).join("\n");
}

// Single-sol helper (used for subject extraction in older call sites)
function buildRFQBody(dist, record) {
  const subject = "RFQ | " + record.sol_number + " | Imperio Federal Logistics";
  const body    = buildBodyForSender(dist, [record], "resend");
  return { subject, body };
}

module.exports = {
  sendEmail,
  sendEmailGmail,
  sendEmailResend,
  buildBodyForSender,
  buildRFQBody,
  GMAIL_ADDRESS,
  RESEND_ADDRESS,
  FROM_ADDRESS: RESEND_ADDRESS,
};
