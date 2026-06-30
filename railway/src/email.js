// src/email.js — Dual sender: Gmail (450/day) → Resend (150/day)
const nodemailer = require("nodemailer");

// ── Gmail ─────────────────────────────────────────────────────────────────────
const GMAIL_ADDRESS = "kelley.anthonyk@gmail.com";
const GMAIL_FROM    = "Anthony Kelley | Imperio Federal Logistics <" + GMAIL_ADDRESS + ">";

async function sendEmailGmail({ to, subject, body }) {
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type:         "OAuth2",
      user:         GMAIL_ADDRESS,
      clientId:     process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
  });
  await transport.sendMail({ from: GMAIL_FROM, to, subject, text: body });
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

// sender = "gmail" | "resend"
function buildBodyForSender(vendor, sols, sender) {
  const greeting = vendor.poc_first || vendor.poc_name || vendor.name || vendor.company_name;
  const isMulti  = sols.length > 1;

  const itemLines = sols.map((s, i) => [
    (isMulti ? "Item " + (i + 1) + ": " : "  Item:          ") + (s.item_name || "—"),
    s.ref_part_number ? "  Part Number:   " + s.ref_part_number : null,
    "  Quantity:      " + (s.quantity || s.qty || "—"),
    dayBefore(s.quote_due) ? "  Response Due:  " + dayBefore(s.quote_due) : null,
    "  Ref #:         " + s.sol_number,
  ].filter(Boolean).join("\n")).join("\n\n");

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
    "My name is Anthony Kelley, Founder and CEO of Imperio Federal Logistics (CAGE 152U4 · SDVOSB · VetHUB). We are a DLA-registered reseller and defense supply chain partner. As a reseller, we qualify for distributor-level pricing and can provide a sales tax exemption certificate upon request.",
    "",
    "I have " + sols.length + " active DLA procurement need" + (sols.length > 1 ? "s" : "") + " in your lane and need pricing and availability on the following:",
    "",
    itemLines,
    "",
    "Requirements:",
    "- Destination: Government delivery address (continental US)",
    "- Payment: Immediate PO upon award. Supplier receives wire payment prior to shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin" + (isMulti ? " for each item" : ""),
    "- Shipping: FOB Destination required",
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and country of origin. We issue POs immediately upon award and move fast.",
    "",
    "Thank you for your time,",
    ...sig,
  ].join("\n");
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
