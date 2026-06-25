// src/notify.js — daily summary email builder
const { sendEmail, FROM_ADDRESS } = require("./email");

const SITE_URL = "https://thehouseofkel.com/scc/";

function buildSummary({ scrape, screen, blast, watchHits, errors, runDate }) {
  const ct = new Date(runDate).toLocaleString("en-US", { timeZone: "America/Chicago" });
  const go       = screen.filter(s => s.verdict === "GO");
  const verify   = screen.filter(s => s.verdict === "VERIFY FIRST");
  const rejected = screen.filter(s => s.verdict === "REJECT");

  const lines = [
    "Imperio SCC — Daily Run Summary",
    ct + " CT",
    "═".repeat(50),
    "",
    "📡 SCRAPE",
    "  Solicitations found: " + scrape.counts.total,
    "  Pass 1 (today):      " + scrape.counts.pass1,
    "  Pass 2 (30-day LHF): " + scrape.counts.pass2,
    "  Pass 3 (per-FSC):    " + scrape.counts.pass3,
    "",
  ];

  if (watchHits.length) {
    lines.push(
      "🔔 WATCHED NSNs RE-SOLICITED (" + watchHits.length + ")",
      ...watchHits.map(s =>
        "  • " + s.sol_number + " — " + s.item_name +
        " | NSN " + s.nsn +
        (s.price_delta_pct ? " | Price Δ " + s.price_delta_pct + "%" : "") +
        (s.watch_record?.preferred_cage ? " | Pref. CAGE " + s.watch_record.preferred_cage : "")
      ),
      "",
    );
  }

  lines.push(
    "✅ GO — RFQs Blasted (" + go.length + ")",
    ...(go.length
      ? go.map(s => "  • " + s.sol_number + " — " + (s.item_name || "") + " | " + (s.sourcing_path || s.reason || ""))
      : ["  (none)"]),
    "",
    "⚠  VERIFY FIRST — RFQ Sent, Review Before Bidding (" + verify.length + ")",
    ...(verify.length
      ? verify.map(s => "  • " + s.sol_number + " — " + (s.item_name || "") + " | " + (s.reason || ""))
      : ["  (none)"]),
    "",
    "🔒 REJECTED (" + rejected.length + ")",
    ...(rejected.length
      ? rejected.map(s => "  • " + s.sol_number + " — " + (s.reason || ""))
      : ["  (none)"]),
    "",
    "📨 BLAST RESULTS",
    "  Vendor emails sent:   " + blast.sent,
    "  Failed:               " + blast.failed,
    "",
  );

  if (errors.length) {
    lines.push(
      "✗ ERRORS (" + errors.length + ")",
      ...errors.map(e => "  • " + e),
      "",
    );
  }

  lines.push(
    "═".repeat(50),
    "View Pipeline → " + SITE_URL,
  );

  return lines.join("\n");
}

async function sendSummary({ scrape, screen, blast, watchHits = [], errors = [], runDate }) {
  const body = buildSummary({ scrape, screen, blast, watchHits, errors, runDate });

  const goCount   = screen.filter(s => s.verdict === "GO").length + watchHits.length;
  const warnCount = screen.filter(s => s.verdict === "VERIFY FIRST").length;

  let subject;
  if (goCount === 0 && warnCount === 0) {
    subject = "SCC Daily: Nothing actionable today";
  } else {
    subject = "SCC Daily: " + goCount + " GO" +
      (warnCount  ? " · " + warnCount + " flagged"    : "") +
      (watchHits.length ? " · " + watchHits.length + " NSN re-solicited" : "") +
      " · " + blast.sent + " RFQs sent";
  }

  const to = process.env.SUMMARY_EMAIL || FROM_ADDRESS;
  await sendEmail({ to, subject, body });
  console.log("[notify] Summary sent → " + to + " | " + subject);
}

module.exports = { sendSummary };
