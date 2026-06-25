// test-blast.js — sends a real RFQ email to yourself as if you were a vendor
// Run: node test-blast.js
// Injects 3 realistic test sols + a test vendor card, fires the actual blast email

const { MongoClient } = require("mongodb");
const { sendEmail }   = require("./src/email");

const TO_EMAIL    = "kelley.anthonyk@gmail.com";
const VENDOR_NAME = "Kelley Defense & Industrial Supply";

const TEST_SOLS = [
  {
    sol_number:      "SPE4A726T0001T",
    item_name:       "VALVE,BUTTERFLY",
    fsc:             "4820",
    ref_part_number: "MS28889-1",
    quantity:        "12",
    delivery_days:   30,
    quote_due:       "2026-07-10",
  },
  {
    sol_number:      "SPE4A726T0002T",
    item_name:       "PUMP,CENTRIFUGAL,LIQUID",
    fsc:             "4320",
    ref_part_number: "A-14615-3",
    quantity:        "3",
    delivery_days:   45,
    quote_due:       "2026-07-14",
  },
  {
    sol_number:      "SPE4A726T0003T",
    item_name:       "FILTER ELEMENT,FLUID PRESSURE",
    fsc:             "4330",
    ref_part_number: "AN6234-1B",
    quantity:        "25",
    delivery_days:   21,
    quote_due:       "2026-07-09",
  },
];

function dayBefore(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  d.setDate(d.getDate() - 1);
  return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0") + "/" + d.getFullYear();
}

async function main() {
  // 1. Inject test vendor into MongoDB
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db("scc_db");

  await db.collection("distributors").updateOne(
    { id: "test-vendor-anthony" },
    { $set: {
      id:              "test-vendor-anthony",
      name:            VENDOR_NAME,
      email:           TO_EMAIL,
      fsc:             ["4820", "4320", "4330"],
      tags:            ["test"],
      is_distributor:  true,
      drop_ship:       true,
      fob_destination: true,
      has_mil_std_pack: false,
      notes:           "TEST CARD — safe to delete after verification",
    }},
    { upsert: true }
  );
  console.log("✓ Test vendor injected into DB");

  await client.close();

  // 2. Build email body (same format as live blast)
  const itemLines = TEST_SOLS.map((s, i) => [
    "Item " + (i + 1) + ": " + s.item_name,
    s.ref_part_number ? "  Part Number:  " + s.ref_part_number : null,
    "  Quantity:     " + s.quantity,
    "  Need By:      " + (dayBefore(s.quote_due) || "—"),
    "  Ref #:        " + s.sol_number,
  ].filter(Boolean).join("\n")).join("\n\n");

  const body = [
    "Hi " + VENDOR_NAME + ",",
    "",
    "My name is Anthony Kelley — Founder & CEO of Imperio Federal Logistics (CAGE 152U4 · SDVOSB · VetHUB). Quick heads-up before the ask: we recently went through a company restructuring and our new corporate email, anthony@ifedlog.com, is still building deliverability as a fresh domain — there's a chance it's landing in spam folders. I'm reaching out from my personal business Gmail in the meantime. Please add kelley.anthonyk@gmail.com to your safe senders list and feel free to reply to either address going forward.",
    "",
    "Now to the reason I'm reaching out — I have " + TEST_SOLS.length + " active DLA procurement needs in your lane and need pricing and availability on the following:",
    "",
    itemLines,
    "",
    "Requirements:",
    "- Destination: Government delivery address (continental US)",
    "- Payment: Immediate PO upon award. Supplier receives wire payment prior to shipment.",
    "- Compliance: BAA/TAA required — please confirm country of origin for each item",
    "- Shipping: FOB Destination required",
    "- Condition: New/unused only. No substitutions without prior approval.",
    "",
    "Please provide unit price, lead time, and country of origin. We issue POs immediately upon award and move fast.",
    "",
    "Thank you for your time,",
    "Anthony K Kelley | Founder & CEO",
    "Imperio Federal Logistics · The House of Kel LLC · CAGE 152U4",
    "SDVOSB | VetHUB | (254) 226-5216",
    "kelley.anthonyk@gmail.com | anthony@ifedlog.com | ifedlog.com",
  ].join("\n");

  const subject = "RFQ – " + TEST_SOLS[0].item_name + " +" + (TEST_SOLS.length - 1) + " more | Imperio Federal Logistics";

  // 3. Send
  await sendEmail({ to: TO_EMAIL, subject, body });
  console.log("✅ Test RFQ email sent → " + TO_EMAIL);
  console.log("   Subject: " + subject);
  console.log("\nCheck " + TO_EMAIL + " — delete the test vendor card from Source > Dist DB when done.");
}

main().catch(e => { console.error("❌ Failed:", e.message); process.exit(1); });
