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

  // ── VENDOR SELECTION ─────────────────────────────────────────────────
  function selectVendors(record) {
    const WL   = window.SCC_WIN_LEDGER;
    const DIST = window.SCC_DIST;
    const BLK  = window.SCC_TABS && window.SCC_TABS.isBlocked;

    const dists    = (DIST && DIST.DISTRIBUTORS) || [];
    const fsc      = (record.fsc || record.nsn || "").slice(0, 4);
    const selected = [];
    const seenIds  = new Set();

    const addDist = (d, reason) => {
      if (!d || seenIds.has(d.id)) return;
      if (!d.email)                return; // need email to send
      if (BLK && BLK(d.name))     return; // skip blocked
      seenIds.add(d.id);
      selected.push({ dist: d, reason });
    };

    // 1. Prior wins on this NSN — skip the routing step entirely
    if (WL && (record.nsn || record.ref_part_number)) {
      for (const w of WL.lookup(record.nsn, record.ref_part_number)) {
        const match = dists.find(d => d.name.toLowerCase() === w.vendor_name.toLowerCase());
        if (match) addDist(match, "Prior win · " + (w.date || w.logged));
      }
    }

    // 2. Manufacturers — JCP first, then others
    for (const d of dists) {
      if (d.is_manufacturer && d.has_jcp)  addDist(d, "MFR · JCP");
    }
    for (const d of dists) {
      if (d.is_manufacturer && !d.has_jcp) addDist(d, "MFR");
    }

    // 3. FSC-matched distributors
    for (const d of dists) {
      const tags = (d.tags || []).map(t => t.toLowerCase());
      if (tags.includes("fsc-" + fsc) || (d.fsc_specialties || []).includes(fsc))
        addDist(d, "FSC " + fsc);
    }

    // 4. Preferred distributors
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

    // 1. Fast pre-screen — unambiguous hard rejects, no API cost
    const preReject = preScreen(record);
    if (preReject) {
      addLog("PRE-REJECT " + record.sol_number + " — " + preReject);
      await updatePipeline(record, {
        status: "No Source",
        notes: [record.notes, "Auto-rejected: " + preReject].filter(Boolean).join("\n"),
      });
      return { verdict: "REJECT", reason: preReject, sent: 0, log };
    }

    // 2. Claude analysis — full procurement protocol
    addLog("Analyzing " + record.sol_number + " with Claude…");
    let analysis = null;
    try {
      analysis = await claudeAnalyze(record);
      addLog("Claude verdict: " + analysis.verdict + " — " + analysis.reason);
    } catch (e) {
      addLog("Claude unavailable (" + e.message + ") — falling back to vendor selection only");
    }

    // 3. Branch on verdict
    const verdict = analysis ? analysis.verdict : "GO"; // degrade gracefully if Claude down

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
    const vendors = selectVendors(record);
    if (vendors.length === 0) {
      addLog("No vendors matched for " + record.sol_number + " — manual sourcing needed.");
      await updatePipeline(record, { status: "Sourcing" });
      return { verdict: "GO", sent: 0, log };
    }

    addLog("Matched " + vendors.length + " vendor(s): " + vendors.map(v => v.dist.name).join(", "));

    let sent = 0;
    for (const { dist, reason } of vendors) {
      const { subject, body } = buildEmail(dist, record, analysis);
      try {
        const res = await fetch(SEND_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: dist.email, subject, emailBody: body, attachCert: false }),
        });
        const data = await res.json();
        if (data.ok) {
          addLog("✓ RFQ sent → " + dist.name + " <" + dist.email + "> [" + reason + "]");
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

  window.SCC_AUTO_RFQ = { run };
})();
