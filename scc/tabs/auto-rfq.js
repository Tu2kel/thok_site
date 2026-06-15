(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — AUTO RFQ ENGINE
  //  Flow: fast pre-screen → Claude analysis → vendor selection → RFQ emails
  //  Claude uses the full procurement protocol from analyze-sols.js.
  //  GO → fire emails. VERIFY FIRST → flag pipeline, no send. REJECT → mark closed.
  //  Exports: window.SCC_AUTO_RFQ.run(record)
  // ═══════════════════════════════════════════════════════════════════════

  const ANALYZE_ENDPOINT = "/.netlify/functions/analyze-sols";
  const SEND_ENDPOINT    = "/.netlify/functions/send-rfq";
  const TEST_EMAIL       = "tu2kel.lg@gmail.com";
  const TEST_LIMIT       = 10;

  // ── FAST PRE-SCREEN ───────────────────────────────────────────────────
  // Catches unambiguous hard-rejects before spending an API call.
  function preScreen(record) {
    const name = (record.item_name || "").toLowerCase();
    const days = parseInt(record.delivery_days) || 0;

    if (/\baidc\b/.test(name))                      return "AIDC";
    if (/sole[\s-]source/i.test(name))              return "Sole source";
    if (days > 0 && days < 10)                      return "Delivery < 10 days ARO";
    if (/\bqa\s*=\s*[yY]\b/.test(name))             return "QA=Y";

    const setAside = (record.set_aside || "").trim().toUpperCase();
    const hardSetAsides = ["AL", "FG", "PO", "FI"];
    if (hardSetAsides.includes(setAside))           return "Set-aside " + setAside;

    return null; // passes pre-screen
  }

  // ── CLAUDE ANALYSIS ───────────────────────────────────────────────────
  // Calls analyze-sols.js with the full procurement protocol.
  // Returns { verdict, reason, sourcing_path, margin_flag, winProbabilityPct }
  async function claudeAnalyze(record) {
    const solPayload = {
      sol_number:       record.sol_number,
      item_name:        record.item_name || "",
      nsn:              record.nsn || "",
      fsc:              record.fsc || (record.nsn || "").slice(0, 4),
      ref_part_number:  record.ref_part_number || "",
      quantity:         record.quantity || "",
      unit_issue:       record.unit_of_issue || "",
      unit_price:       parseFloat(record.unit_price) || null,
      delivery_days:    parseInt(record.delivery_days) || null,
      set_aside:        record.set_aside || "",
      qa:               record.qa || "",
      amsc:             record.amsc || "",
      approved_sources: record.approved_sources || [],
      fob:              record.fob || "",
      posted_date:      record.posted_date || "",
      quote_due:        record.quote_due || "",
    };

    const res = await fetch(ANALYZE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sols: [solPayload] }),
    });

    if (!res.ok) throw new Error("analyze-sols HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "analyze-sols error");
    return data.results[0]; // single sol → first result
  }

  // ── P/N PREFIX DETECTION ─────────────────────────────────────────────
  function detectPNPrefix(pn) {
    const p = (pn || "").trim().toUpperCase();
    if (/^AN[\d-]/.test(p)) return "AN";
    if (/^MS[\d-]/.test(p)) return "MS";
    if (/^NAS[\d-]/.test(p)) return "NAS";
    return null;
  }

  // ── VENDOR SELECTION ─────────────────────────────────────────────────
  function selectVendors(record) {
    const WL   = window.SCC_WIN_LEDGER;
    const DIST = window.SCC_DIST;
    const BLK  = window.SCC_TABS && window.SCC_TABS.isBlocked;

    const dists    = (DIST && DIST.DISTRIBUTORS) || [];
    const fsc      = (record.fsc || record.nsn || "").slice(0, 4);
    const pnPrefix = detectPNPrefix(record.ref_part_number);
    const selected = [];
    const seenIds  = new Set();

    const addDist = (d, reason) => {
      if (!d || seenIds.has(d.id)) return;
      if (!d.email)                return;
      if (BLK && BLK(d.name))     return;
      seenIds.add(d.id);
      selected.push({ dist: d, reason });
    };

    // 1. Prior wins on this NSN
    if (WL && (record.nsn || record.ref_part_number)) {
      for (const w of WL.lookup(record.nsn, record.ref_part_number)) {
        const match = dists.find(d => d.name.toLowerCase() === w.vendor_name.toLowerCase());
        if (match) addDist(match, "Prior win · " + (w.date || w.logged));
      }
    }

    // 2. AN/MS prefix → G-Fast Distribution (Steve) before standard chain
    if (pnPrefix === "AN" || pnPrefix === "MS") {
      const gfast = dists.find(d => /g[\s-]?fast/i.test(d.name));
      if (gfast) addDist(gfast, "P/N prefix " + pnPrefix + " → G-Fast (Steve)");
    }

    // 3. Manufacturers — JCP first, then others
    for (const d of dists) {
      if (d.is_manufacturer && d.has_jcp)  addDist(d, "MFR · JCP");
    }
    for (const d of dists) {
      if (d.is_manufacturer && !d.has_jcp) addDist(d, "MFR");
    }

    // 4. FSC-matched distributors
    for (const d of dists) {
      const tags = (d.tags || []).map(t => t.toLowerCase());
      if (tags.includes("fsc-" + fsc) || (d.fsc_specialties || []).includes(fsc))
        addDist(d, "FSC " + fsc);
    }

    // 5. Preferred distributors
    for (const d of dists) {
      if (d.is_starred || (d.tags || []).includes("preferred"))
        addDist(d, "Preferred");
    }

    return selected;
  }

  // ── EMAIL BUILDER ─────────────────────────────────────────────────────
  function buildEmail(dist, record, analysis) {
    const item = record.item_name || "—";
    const qty  = record.quantity
      ? record.quantity + (record.unit_of_issue ? " " + record.unit_of_issue : "")
      : "—";
    const del  = record.delivery_days ? record.delivery_days + " days ARO" : "—";
    const gov  = record.unit_price
      ? "$" + Number(record.unit_price).toLocaleString() + " est."
      : "—";

    const subject = "RFQ – " + item + " | " + record.sol_number + " | Imperio Federal Logistics";

    const lines = [
      "Hi " + dist.name + ",",
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
    ].filter(l => l !== null);

    // Add sourcing path hint from Claude if it came back
    if (analysis && analysis.sourcing_path) {
      lines.push("", "  Sourcing note: " + analysis.sourcing_path);
    }

    lines.push(
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
    );

    return { subject, body: lines.join("\n") };
  }

  // ── PIPELINE UPDATE ───────────────────────────────────────────────────
  async function updatePipeline(record, patch) {
    if (!window.SCC_DB) return;
    const rows = window.SCC_DB.dbLoad ? window.SCC_DB.dbLoad() : [];
    const current = rows.find(r => r.sol_number === record.sol_number);
    if (!current) return;
    await window.SCC_DB.dbSave({ ...current, ...patch });
  }

  // ── MAIN ENTRY POINT ─────────────────────────────────────────────────
  async function run(record, opts) {
    opts = opts || {};
    const log    = [];
    const addLog = (msg) => { log.push(msg); if (opts.onLog) opts.onLog(msg); };

    // 1. If already screened GO by batch analyzer — trust it, skip re-analysis
    let analysis = null;
    let verdict;
    if (record.verdict === "GO") {
      addLog("Batch pre-screened GO — skipping re-analysis for " + record.sol_number);
      analysis = {
        verdict: "GO",
        reason: record.reason || "Pre-screened GO",
        sourcing_path: record.sourcing_path || null,
        winProbabilityPct: record.winProbabilityPct || null,
      };
      verdict = "GO";
    } else {
      // Fast pre-screen — unambiguous hard rejects, no API cost
      const preReject = preScreen(record);
      if (preReject) {
        addLog("PRE-REJECT " + record.sol_number + " — " + preReject);
        await updatePipeline(record, {
          status: "No Source",
          notes: [record.notes, "Auto-rejected: " + preReject].filter(Boolean).join("\n"),
        });
        return { verdict: "REJECT", reason: preReject, sent: 0, log };
      }

      // Claude analysis — full procurement protocol
      addLog("Analyzing " + record.sol_number + " with Claude…");
      try {
        analysis = await claudeAnalyze(record);
        addLog("Claude verdict: " + analysis.verdict + " — " + analysis.reason);
      } catch (e) {
        addLog("Claude unavailable (" + e.message + ") — falling back to vendor selection only");
      }
      verdict = analysis ? analysis.verdict : "GO";
    }

    // Branch on verdict

    if (verdict === "REJECT") {
      await updatePipeline(record, {
        status: "No Source",
        notes: [record.notes, "Auto-rejected by Claude: " + analysis.reason].filter(Boolean).join("\n"),
      });
      addLog("REJECT — pipeline marked No Source. Done.");
      return { verdict: "REJECT", reason: analysis.reason, sent: 0, log };
    }

    if (verdict === "VERIFY FIRST") {
      const noteLines = [
        record.notes,
        "Claude: VERIFY FIRST — " + analysis.reason,
        analysis.sourcing_path ? "Sourcing path: " + analysis.sourcing_path : null,
        analysis.winProbabilityPct != null ? "Win probability: " + analysis.winProbabilityPct + "%" : null,
      ].filter(Boolean).join("\n");
      await updatePipeline(record, {
        status: "Researching",
        notes: noteLines,
      });
      addLog("VERIFY FIRST — pipeline moved to Researching. RFQs held pending manual review.");
      return { verdict: "VERIFY FIRST", reason: analysis.reason, sent: 0, log };
    }

    // 4. GO — select vendors and fire emails
    addLog("GO — selecting vendors…");
    let vendors = selectVendors(record);
    if (vendors.length === 0) {
      if (opts.testMode) {
        // In test mode send anyway so you can review the email format
        vendors = [{ dist: { name: "[No vendor matched — test preview]", email: TEST_EMAIL }, reason: "test fallback" }];
        addLog("No vendors matched — sending test preview to " + TEST_EMAIL);
      } else {
        addLog("No vendors matched for " + record.sol_number + " — manual sourcing needed.");
        await updatePipeline(record, { status: "Sourcing" });
        return { verdict: "GO", sent: 0, log };
      }
    }

    addLog("Matched " + vendors.length + " vendor(s): " + vendors.map(v => v.dist.name).join(", "));

    let sent = 0;
    for (const { dist, reason } of vendors) {
      const { subject, body } = buildEmail(dist, record, analysis);
      const toAddr  = opts.testMode ? TEST_EMAIL : dist.email;
      const subj    = opts.testMode ? "[TEST] " + subject : subject;
      try {
        const res = await fetch(SEND_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: toAddr, subject: subj, emailBody: body, attachCert: false }),
        });
        const data = await res.json();
        if (data.ok) {
          addLog("✓ RFQ sent → " + (opts.testMode ? "[TEST→" + TEST_EMAIL + "]" : dist.name + " <" + dist.email + ">") + " [" + reason + "]");
          sent++;
        } else {
          addLog("✗ Failed → " + dist.name + ": " + (data.error || "unknown"));
        }
      } catch (e) {
        addLog("✗ Network → " + dist.name + ": " + e.message);
      }
    }

    // Update pipeline to Awaiting Quotes with analysis notes
    const winNote = analysis
      ? ["Auto-RFQ sent to " + sent + " vendor(s).",
          "Claude: " + analysis.reason,
          analysis.sourcing_path ? "Path: " + analysis.sourcing_path : null,
          analysis.winProbabilityPct != null ? "Win probability: " + analysis.winProbabilityPct + "%" : null,
        ].filter(Boolean).join("\n")
      : "Auto-RFQ sent to " + sent + " vendor(s).";

    await updatePipeline(record, {
      status: sent > 0 ? "Awaiting Quotes" : "Sourcing",
      notes: [record.notes, winNote].filter(Boolean).join("\n"),
    });

    addLog("Done — " + sent + "/" + vendors.length + " RFQs sent · " + record.sol_number);
    return { verdict: "GO", sent, total: vendors.length, log };
  }

  // ── BATCH RUNNER + SUMMARY NOTIFICATION ──────────────────────────────
  // Call this after ingesting multiple sols to get one summary email.
  async function runBatch(records, opts) {
    opts = opts || {};
    const batch = opts.testMode ? records.slice(0, TEST_LIMIT) : records;
    const results = { go: [], verifyFirst: [], rejected: [], errors: [], testMode: !!opts.testMode };

    for (const record of batch) {
      try {
        const r = await run(record, opts);
        if (r.verdict === "GO")                results.go.push({ sol: record.sol_number, sent: r.sent, total: r.total });
        else if (r.verdict === "VERIFY FIRST") results.verifyFirst.push({ sol: record.sol_number, reason: r.reason });
        else                                   results.rejected.push({ sol: record.sol_number, reason: r.reason });
      } catch (e) {
        results.errors.push({ sol: record.sol_number, error: e.message });
      }
    }

    await sendBatchSummary(results, opts);
    return results;
  }

  async function sendBatchSummary(results, opts) {
    opts = opts || {};
    const total = results.go.length + results.verifyFirst.length + results.rejected.length + results.errors.length;
    if (total === 0) return;

    const lines = [
      "SCC Auto-RFQ Batch Summary",
      "Processed: " + new Date().toLocaleString(),
      "─".repeat(40),
      "",
      "✅ GO — RFQs Sent (" + results.go.length + ")",
    ];

    for (const r of results.go) {
      lines.push("  • " + r.sol + " → " + r.sent + "/" + (r.total || "?") + " vendor(s)");
    }
    if (results.go.length === 0) lines.push("  (none)");

    lines.push("", "⚠ VERIFY FIRST — Held for Review (" + results.verifyFirst.length + ")");
    for (const r of results.verifyFirst) {
      lines.push("  • " + r.sol + " — " + r.reason);
    }
    if (results.verifyFirst.length === 0) lines.push("  (none)");

    lines.push("", "🔒 REJECTED — Marked No Source (" + results.rejected.length + ")");
    for (const r of results.rejected) {
      lines.push("  • " + r.sol + " — " + r.reason);
    }
    if (results.rejected.length === 0) lines.push("  (none)");

    if (results.errors.length > 0) {
      lines.push("", "✗ ERRORS (" + results.errors.length + ")");
      for (const r of results.errors) {
        lines.push("  • " + r.sol + " — " + r.error);
      }
    }

    lines.push("", "─".repeat(40), "View Pipeline → https://thehouseofkel.com/scc/");

    try {
      await fetch(SEND_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "anthony@ifedlog.com",
          subject: (opts.testMode ? "[TEST] " : "") + "SCC Auto-RFQ: " + results.go.length + " sent · " + results.verifyFirst.length + " review · " + results.rejected.length + " rejected",
          emailBody: (opts.testMode ? "⚠ TEST MODE — RFQ emails redirected to " + TEST_EMAIL + "\n\n" : "") + lines.join("\n"),
          attachCert: false,
        }),
      });
    } catch (e) {
      console.warn("[AutoRFQ] Summary notification failed:", e.message);
    }
  }

  window.SCC_AUTO_RFQ = { run, runBatch, sendBatchSummary };
})();
