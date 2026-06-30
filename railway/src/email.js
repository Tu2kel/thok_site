// src/email.js — Resend API sender (ifedlog.com domain, DKIM verified)
const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = "anthony@ifedlog.com";
const FROM_NAME  = "Anthony Kelley | Imperio Federal Logistics";
const FROM       = FROM_NAME + " <" + FROM_EMAIL + ">";

async function sendEmail({ to, subject, body, isHtml = false }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");

  const res  = await fetch(RESEND_API, {
    method:  "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify({
      from:                               FROM,
      to:                                 Array.isArray(to) ? to : [to],
      subject,
      [isHtml ? "html" : "text"]: body,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Resend send failed: " + JSON.stringify(data));
  return data;
}

function dayBefore(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  d.setDate(d.getDate() - 1);
  return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0") + "/" + d.getFullYear();
}

function buildRFQBody(dist, record) {
  const item   = record.item_name || "—";
  const qty    = record.quantity || record.qty || "—";
  const del    = record.delivery_days ? record.delivery_days + " days ARO" : "—";
  const needBy = dayBefore(record.quote_due);

  const greeting = dist.poc_first || dist.poc_name || dist.name || dist.company_name;
  const lines = [
    "Hi " + greeting + ",",
    "",
    "My name is Anthony Kelley, Founder and CEO of Imperio Federal Logistics (CAGE 152U4 · SDVOSB · VetHUB). We are a DLA-registered reseller and defense supply chain partner. As a reseller, we qualify for distributor-level pricing and can provide a sales tax exemption certificate upon request.",
    "",
    "I have an active DLA procurement need in your lane and need pricing and availability on the following:",
    "",
    "  Item:          " + item,
    record.ref_part_number ? "  Part Number:   " + record.ref_part_number : null,
    "  Quantity:      " + qty,
    "  Delivery:      " + del,
    needBy                 ? "  Response Due:  " + needBy                  : null,
    "  Ref #:         " + record.sol_number,
    "",
    "Requirements:",
    "- Destination: Government delivery address (continental US)",
    "- Payment: Immediate PO upon award. Supplier receives wire payment prior to shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin",
    "- Shipping: FOB Destination required",
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and country of origin. We issue POs immediately upon award and move fast.",
    "",
    "Thank you for your time,",
    "Anthony K Kelley | Founder and CEO",
    "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
    "SDVOSB | VetHUB | (254) 226-5216",
    "anthony@ifedlog.com | ifedlog.com",
  ];

  const subject = "RFQ | " + record.sol_number + " | Imperio Federal Logistics";
  return { subject, body: lines.filter(l => l !== null).join("\n") };
}

const FROM_ADDRESS = FROM_EMAIL;

module.exports = { sendEmail, buildRFQBody, FROM_ADDRESS };
