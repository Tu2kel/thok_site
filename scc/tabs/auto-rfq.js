(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — AUTO RFQ ENGINE
  //  After a sol saves to pipeline: screen → match vendors → send RFQ emails
  //  All intelligence runs client-side using existing SCC data.
  //  Exports: window.SCC_AUTO_RFQ.run(record)
  // ═══════════════════════════════════════════════════════════════════════

  const SEND_ENDPOINT = "/.netlify/functions/send-rfq";

  // ── SCREENER ─────────────────────────────────────────────────────────
  // Mirrors rfq-seed-router.js hard-reject rules (auto-reject only — no soft blocks)
  function autoScreen(record) {
    const name = (record.item_name || "").toLowerCase();
    const days = parseInt(record.delivery_days) || 0;

    // Hard rejects
    if (/\baidc\b/.test(name))           return { pass: false, reason: "AIDC — auto-reject" };
    if (/sole source/i.test(name))       return { pass: false, reason: "Sole source" };
    if (/proprietary/i.test(name))       return { pass: false, reason: "Proprietary" };

    // Delivery too tight
    if (days > 0 && days < 10)           return { pass: false, reason: "Delivery < 10 days ARO" };

    // QA=Y flag in notes/name
    if (/\bqa\s*=\s*y\b/i.test(name) || /\bqa\s*=\s*y\b/i.test(record.notes || ""))
      return { pass: false, reason: "QA=Y" };

    return { pass: true };
  }

  // ── VENDOR SELECTION ─────────────────────────────────────────────────
  function selectVendors(record) {
    const WL   = window.SCC_WIN_LEDGER;
    const DIST = window.SCC_DIST;
    const BLK  = window.SCC_TABS && window.SCC_TABS.isBlocked;

    const dists     = (DIST && DIST.DISTRIBUTORS) || [];
    const fsc       = (record.fsc || record.nsn || "").slice(0, 4);
    const nsnUpper  = (record.nsn || "").trim().toUpperCase();
    const selected  = [];
    const seenIds   = new Set();

    const addDist = (d, reason) => {
      if (!d || seenIds.has(d.id)) return;
      if (!d.email) return;                            // need email to send
      if (BLK && BLK(d.name))     return;             // skip blocked
      seenIds.add(d.id);
      selected.push({ dist: d, reason });
    };

    // 1. Prior wins on this NSN — first priority
    if (WL && record.nsn) {
      const wins = WL.lookup(record.nsn, record.ref_part_number);
      for (const w of wins) {
        const match = dists.find(d => d.name.toLowerCase() === w.vendor_name.toLowerCase());
        if (match) addDist(match, "Prior win · " + (w.date || w.logged));
      }
    }

    // 2. Manufacturers with JCP cert
    for (const d of dists) {
      if (d.is_manufacturer && d.has_jcp) addDist(d, "MFR · JCP");
    }

    // 3. Other manufacturers
    for (const d of dists) {
      if (d.is_manufacturer && !d.has_jcp) addDist(d, "MFR");
    }

    // 4. Distributors whose tags match this FSC
    for (const d of dists) {
      const tags = (d.tags || []).map(t => t.toLowerCase());
      if (tags.includes("fsc-" + fsc) || (d.fsc_specialties || []).includes(fsc))
        addDist(d, "FSC match " + fsc);
    }

    // 5. Preferred distributors with NSN tags matching
    for (const d of dists) {
      const starred = d.is_starred || (d.tags || []).includes("preferred");
      if (starred) addDist(d, "Preferred");
    }

    return selected;
  }

  // ── EMAIL BUILDER ─────────────────────────────────────────────────────
  function buildEmail(dist, record) {
    const item = record.item_name || "—";
    const nsn  = record.nsn       || "—";
    const pn   = record.ref_part_number || "—";
    const qty  = record.quantity  ? record.quantity + (record.unit_of_issue ? " " + record.unit_of_issue : "") : "—";
    const del  = record.delivery_days ? record.delivery_days + " days ARO" : "—";
    const gov  = record.unit_price ? "$" + Number(record.unit_price).toLocaleString() + " est." : "—";

    const subject = "RFQ – " + item + " | " + record.sol_number + " | Imperio Federal Logistics";

    const body = [
      "Hi " + dist.name + ",",
      "",
      "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.",
      "",
      "I need pricing and availability on the following item:",
      "",
      "  Item:            " + item,
      "  NSN:             " + nsn,
      "  Part Number:     " + pn,
      "  Quantity:        " + qty,
      "  Required Del.:   " + del,
      "  Est. Gov. Value: " + gov,
      "  Solicitation:    " + record.sol_number,
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
      "",
      "Anthony K Kelley | Founder & CEO",
      "Imperio Federal Logistics",
      "The House of Kel LLC · CAGE 152U4",
      "SDVOSB | VetHUB",
      "anthony@ifedlog.com | ifedlog.com",
      "(254) 226-5216",
    ].join("\n");

    return { subject, body };
  }

  // ── MAIN ENTRY POINT ─────────────────────────────────────────────────
  async function run(record, opts) {
    opts = opts || {};
    const log    = [];
    const addLog = (msg) => { log.push(msg); if (opts.onLog) opts.onLog(msg); };

    // Screen
    const screen = autoScreen(record);
    if (!screen.pass) {
      addLog("SKIP " + record.sol_number + " — " + screen.reason);
      return { skipped: true, reason: screen.reason, log };
    }

    addLog("PASS " + record.sol_number + " — selecting vendors…");

    // Select vendors
    const vendors = selectVendors(record);
    if (vendors.length === 0) {
      addLog("No vendors matched for " + record.sol_number);
      return { skipped: false, sent: 0, log };
    }

    addLog("Matched " + vendors.length + " vendor(s): " + vendors.map(v => v.dist.name).join(", "));

    // Send emails
    let sent = 0;
    for (const { dist, reason } of vendors) {
      const { subject, body } = buildEmail(dist, record);
      try {
        const res = await fetch(SEND_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: dist.email,
            subject,
            emailBody: body,
            attachCert: false,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          addLog("✓ RFQ sent → " + dist.name + " (" + dist.email + ") [" + reason + "]");
          sent++;
        } else {
          addLog("✗ Send failed → " + dist.name + ": " + (data.error || "unknown error"));
        }
      } catch (e) {
        addLog("✗ Network error → " + dist.name + ": " + e.message);
      }
    }

    addLog("Done — " + sent + "/" + vendors.length + " RFQs sent for " + record.sol_number);
    return { skipped: false, sent, total: vendors.length, log };
  }

  window.SCC_AUTO_RFQ = { run };
})();
