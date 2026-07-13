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
      ? "FOB Origin, we coordinate pickup (FDT). Pack per MIL-STD-129."
      : fob === "DESTINATION"
      ? "FOB Destination, deliver to: " + (shipTo || "ship-to on the PO")
      : shipTo ? "Ship to: " + shipTo : null;

    return [
      isMulti ? ("Item " + (i + 1) + ":") : null,
      "  Item:          " + (s.item_name || "n/a"),
      s.ref_part_number
        ? "  Part Number:   " + s.ref_part_number + (s.manufacturer_cage ? "  (Mfr CAGE: " + s.manufacturer_cage + ")" : "")
        : null,
      (s.quantity || s.qty) ? "  Quantity:      " + (s.quantity || s.qty) : null,
      s.delivery_days    ? "  Deliver By:    " + s.delivery_days + " days ARO" : null,
      dayBefore(s.quote_due) ? "  Response Due:  " + dayBefore(s.quote_due) : null,
      fobStr             ? "  Shipping:      " + fobStr : null,
      isSourceRestricted(s.supplier_restrictions) ? "  ⚠ Source:       " + s.supplier_restrictions + ", please confirm manufacturer CAGE, lot date, and C of C" : null,
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

  // Time-aware greeting + weekday-rotating opener. Casual and human, positions us as
  // a reseller after distributor/wholesale pricing. No account-opening ask (Finance
  // sets up payment later once they are interested), and no em dashes.
  //   Mon/Wed/Fri -> A, Tue/Thu -> B, so repeat recipients don't see the same line.
  const hourCT = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false }), 10);
  const greet  = hourCT < 12 ? "Good morning" : hourCT < 17 ? "Good afternoon" : "Good evening";
  const dow    = new Date().getDay(); // 0 Sun .. 6 Sat
  const openerA = "Here are today's RFQs. As always, we're a reseller looking for distributor / wholesale pricing, so please send your best price, lead time, and availability on the following:";
  const openerB = "Sending over a few RFQs today. As always, we buy at reseller / distributor pricing, not retail, so whatever you can do on price, lead time, and availability is appreciated:";
  const opener  = (dow === 2 || dow === 4) ? openerB : openerA;

  return [
    greet + (greeting ? " " + greeting : "") + ",",
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
