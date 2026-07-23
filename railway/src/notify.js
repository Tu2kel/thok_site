// src/notify.js — daily blast report email
const { sendEmail, FROM_ADDRESS } = require("./email");

const SITE_URL = "https://thehouseofkel.com/scc/";

function pad(s, n) { return String(s || "").padEnd(n).slice(0, n); }
function fmtDate(d) {
  if (!d) return "—";
  // YYYY-MM-DD → Mon DD YYYY
  const p = d.slice(0, 10).split("-");
  if (p.length !== 3) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[parseInt(p[1], 10) - 1] + " " + parseInt(p[2], 10) + " " + p[0];
}
function divider(char, n) { return (char || "─").repeat(n || 54); }

function buildReport({ scrape, screen, blast, watchHits = [], errors = [], runDate, heldSols = [] }) {
  const ct        = new Date(runDate).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const sentLog   = (blast.log || []).filter(e => e.status === "sent");
  const sentNums  = new Set(sentLog.flatMap(e => e.sol_numbers || []));

  const go       = screen.filter(s => s.verdict === "GO");
  const verify   = screen.filter(s => s.verdict === "VERIFY FIRST");
  const rejected = screen.filter(s => s.verdict === "REJECT");
  const blasted  = screen.filter(s => sentNums.has(s.sol_number));
  const totalPulled = scrape.counts.total || 0;
  const pdfParsed   = scrape.counts.pass2  || 0;

  const lines = [
    divider("═"),
    "IMPERIO SCC — DAILY BLAST REPORT",
    ct + " CT",
    divider("═"),
    "",
    "Scrape (" + (process.env.SOL_SOURCE || "navigator") + "): " + totalPulled + " sols   |   PDFs parsed: " + pdfParsed + "/" + totalPulled +
      "   |   Screened: " + screen.length + "   |   Blasted: " + blasted.length,
    "",
  ];

  // ── BLASTED SOLS ────────────────────────────────────────────────────────
  if (blasted.length) {
    lines.push(
      divider("─"),
      "BLASTED — " + blasted.length + " RFQ" + (blasted.length > 1 ? "s" : "") +
        "  →  " + blast.sent + " vendor email" + (blast.sent !== 1 ? "s" : "") + " sent",
      divider("─"),
    );
    for (const s of blasted) {
      const tag = s.verdict === "GO" ? "[GO  " + (s.winProbabilityPct || "?") + "%]"
                                     : "[VFY " + (s.winProbabilityPct || "?") + "%]";
      lines.push("");
      lines.push(tag + "  " + s.sol_number);
      lines.push("  " + (s.item_name || "(no item name)"));
      if (s.nsn)              lines.push("  NSN     " + s.nsn);
      lines.push("  Qty     " + (s.quantity || "?") + " EA   |   Due " + fmtDate(s.quote_due));
      if (s.ship_to_name)     lines.push("  Ship To " + s.ship_to_name + (s.ship_to_csz ? " — " + s.ship_to_csz : ""));
      if (s.ref_part_number)  lines.push("  P/N     " + s.ref_part_number);
      if (s.supplier_restrictions) lines.push("  ⚠  " + s.supplier_restrictions);
      if (s.set_aside)        lines.push("  Set-Aside: " + s.set_aside);
      const intel = s.claudeReason || s.reason || s.sourcing_path || "";
      if (intel)              lines.push("  Intel   " + intel);
    }
    lines.push("");
  } else {
    lines.push(divider("─"), "NO SOLS BLASTED THIS RUN", divider("─"), "");
  }

  // ── HELD BY QUALITY GATE ────────────────────────────────────────────────
  if (heldSols.length) {
    lines.push(
      divider("─"),
      "HELD — QUALITY GATE (" + heldSols.length + " not blasted — incomplete data)",
      divider("─"),
    );
    for (const s of heldSols) {
      lines.push("  ⛔ " + s.sol_number + (s.item_name ? "  " + s.item_name : "") +
        "  →  missing: " + (s._missing || []).join(", "));
    }
    lines.push("");
  }

  // ── VERIFY FIRST sols not blasted ───────────────────────────────────────
  const verifyNotBlasted = verify.filter(s => !sentNums.has(s.sol_number));
  if (verifyNotBlasted.length) {
    lines.push(
      divider("─"),
      "VERIFY FIRST — FLAGGED, NOT BLASTED (" + verifyNotBlasted.length + ")",
      divider("─"),
    );
    for (const s of verifyNotBlasted) {
      lines.push("  ⚠  " + s.sol_number + "  " + (s.item_name || "") + "  |  " + (s.reason || ""));
    }
    lines.push("");
  }

  // ── REJECTED ────────────────────────────────────────────────────────────
  if (rejected.length) {
    lines.push(
      divider("─"),
      "REJECTED (" + rejected.length + ")",
      divider("─"),
    );
    for (const s of rejected) {
      lines.push("  ✗  " + s.sol_number + "  " + (s.item_name || "") + "  —  " + (s.reason || ""));
    }
    lines.push("");
  }

  // ── VENDOR EMAIL LOG ────────────────────────────────────────────────────
  if (sentLog.length) {
    lines.push(
      divider("─"),
      "VENDOR EMAILS CONFIRMED SENT (" + sentLog.length + ")",
      divider("─"),
    );
    for (const e of sentLog) {
      const solList = (e.sol_numbers || []).join(", ");
      lines.push(
        "  ✓  " + pad(e.vendor || e.vendor_email, 36) +
        "  " + e.sols + " RFQ" + (e.sols !== 1 ? "s" : "") +
        "  [" + (e.sender || "?").toUpperCase() + "]"
      );
      if (solList) lines.push("       " + solList);
    }
    lines.push("");
  }

  // ── ERRORS ──────────────────────────────────────────────────────────────
  if (errors.length) {
    lines.push(divider("─"), "ERRORS (" + errors.length + ")", divider("─"));
    for (const e of errors) lines.push("  ! " + e);
    lines.push("");
  }

  lines.push(divider("═"), "View in SCC → " + SITE_URL, divider("═"));

  return lines.join("\n");
}

async function sendSummary({ scrape, screen, blast, watchHits = [], errors = [], runDate, heldSols = [] }) {
  const body = buildReport({ scrape, screen, blast, watchHits, errors, runDate, heldSols });

  const sentLog  = (blast.log || []).filter(e => e.status === "sent");
  const sentNums = new Set(sentLog.flatMap(e => e.sol_numbers || []));
  const blasted  = screen.filter(s => sentNums.has(s.sol_number));
  const goBlasted = blasted.filter(s => s.verdict === "GO").length;
  const vfyBlasted = blasted.filter(s => s.verdict === "VERIFY FIRST").length;

  let subject;
  if (!blasted.length && !heldSols.length) {
    subject = "SCC Daily: Nothing actionable today";
  } else {
    subject = "SCC Daily: " +
      (goBlasted  ? goBlasted  + " GO"      : "") +
      (vfyBlasted ? (goBlasted ? " · " : "") + vfyBlasted + " VFY" : "") +
      (heldSols.length ? " · " + heldSols.length + " held" : "") +
      " · " + blast.sent + " emails out";
  }

  const to = process.env.SUMMARY_EMAIL || FROM_ADDRESS;
  await sendEmail({ to, subject, body });
  console.log("[notify] Summary sent → " + to + " | " + subject);
}

module.exports = { sendSummary };
