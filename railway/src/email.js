// src/email.js — Resend is the sole sender.
// A Gmail SMTP placeholder used before Resend was firewalled on Railway and has
// been removed. AWS SES was declined. From-address is anthony@ifedlog.com.

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
// DIBBS puts a value in Supplier Restrictions whether or not the source is
// actually restricted. "Unrestricted" and "COTS" mean anyone may quote — asking
// those vendors to confirm CAGE / lot date / C of C is a warning about the
// absence of a restriction. Only flag genuinely restricted sources.
const NON_RESTRICTIVE = new Set(["unrestricted", "cots", "none", "n/a", ""]);
function isSourceRestricted(raw) {
  return !NON_RESTRICTIVE.has(String(raw || "").trim().toLowerCase());
}

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

// sender arg is retained for call-site compatibility but no longer used —
// Resend is the only sender, so there is one signature block.
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
      s.ref_part_number
        ? "  Part Number:   " + s.ref_part_number + (s.manufacturer_cage ? "  (Mfr CAGE: " + s.manufacturer_cage + ")" : "")
        : null,
      (s.quantity || s.qty) ? "  Quantity:      " + (s.quantity || s.qty) : null,
      s.delivery_days    ? "  Deliver By:    " + s.delivery_days + " days ARO" : null,
      dayBefore(s.quote_due) ? "  Response Due:  " + dayBefore(s.quote_due) : null,
      fobStr             ? "  Shipping:      " + fobStr : null,
      isSourceRestricted(s.supplier_restrictions) ? "  ⚠ Source:       " + s.supplier_restrictions + " — please confirm manufacturer CAGE, lot date, and C of C" : null,
      s.jcp_required === true ? "  ⚠ JCP Required: Joint Certification Program certification required to submit quote" : null,
      "  Ref #:         " + (s.ref_code || s.sol_number),
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  // Packaging question — only raised if sol requires Mil-Spec; otherwise assume commercial
  const needsMilSpec = sols.some(s => s.packaging_type === "Mil-Spec");
  const packagingLine = needsMilSpec
    ? "- Packaging: This requirement calls for MIL-STD-2073 military specification packaging. Are you able to comply?"
    : null;

  const sig = [
    "Anthony K Kelley | Founder and CEO",
    "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
    "SDVOSB | VetHUB | (254) 226-5216",
    "anthony@ifedlog.com | ifedlog.com",
  ];

  // Opener rotates by weekday so repeat recipients don't get the same line twice:
  //   Mon/Wed/Fri → A ("open a wholesale account"), Tue/Thu → B ("source through you").
  // Both position us as a RESELLER / CHANNEL — a buyer that moves volume THROUGH the
  // distributor — not a government end-user, which reads as a competitor and makes
  // them hold back distributor pricing. Each opener leads straight into the item list.
  const openerA = "My name is Anthony Kelley with Imperio Federal Logistics (CAGE 152U4). We're a reseller that places steady, repeat volume, and we'd like to open a wholesale account with you as one of our suppliers. Our resale certificate and tax-exempt documentation are ready to send. We'd appreciate your distributor-level pricing and availability on the following:";
  const openerB = "Anthony Kelley here with Imperio Federal Logistics (CAGE 152U4). We're a distribution and resale company looking to source the items below through you on an ongoing basis — not a one-off. Glad to set up an account and provide our resale certificate and tax exemption up front. Could you extend your wholesale / distributor pricing, lead time, and availability on:";
  const dow = new Date().getDay(); // 0 Sun … 6 Sat
  const opener = (dow === 2 || dow === 4) ? openerB : openerA;

  return [
    "Hi " + greeting + ",",
    "",
    opener,
    "",
    itemLines,
    "",
    "Requirements:",
    packagingLine,
    "- Payment: We issue POs quickly and wire payment prior to shipment.",
    "- Country of origin: please confirm" + (isMulti ? " for each item" : "") + " (some of our customers require TAA-compliant sourcing).",
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
  const subject = "RFQ | " + (record.ref_code || record.sol_number) + " | Imperio Federal Logistics";
  const body    = buildBodyForSender(dist, [record], "resend");
  return { subject, body };
}

module.exports = {
  sendEmail,
  sendEmailResend,
  buildBodyForSender,
  buildRFQBody,
  RESEND_ADDRESS,
  FROM_ADDRESS: RESEND_ADDRESS,
};
