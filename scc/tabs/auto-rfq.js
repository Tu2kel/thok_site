(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — AUTO RFQ ENGINE
  //  Batch flow: collect all GO records → group by vendor → one email per vendor
  //  Single flow: run(record) for individual use
  //  Blast log: persisted to localStorage scc_blast_log_v1
  // ═══════════════════════════════════════════════════════════════════════

  const ANALYZE_ENDPOINT = "/.netlify/functions/analyze-sols";
  const SEND_ENDPOINT    = "/.netlify/functions/send-rfq";
  const TEST_EMAIL       = "tu2kel.lg@gmail.com";
  const TEST_LIMIT       = 10;
  const BLAST_LOG_KEY    = "scc_blast_log_v1";
  const PN_QUEUE_KEY     = "scc_pn_queue_v1";

  // ── PN QUEUE STORAGE ──────────────────────────────────────────────────
  function loadPNQueue()  { try { return JSON.parse(localStorage.getItem(PN_QUEUE_KEY) || "null"); } catch { return null; } }
  function savePNQueue(q) { try { localStorage.setItem(PN_QUEUE_KEY, JSON.stringify(q)); } catch {} }
  function clearPNQueue() { try { localStorage.removeItem(PN_QUEUE_KEY); } catch {} }

  // ── BLAST LOG ─────────────────────────────────────────────────────────
  function loadBlastLog() {
    try { return JSON.parse(localStorage.getItem(BLAST_LOG_KEY) || "[]"); } catch { return []; }
  }
  function appendBlastEntry(entry) {
    try {
      const log = loadBlastLog();
      log.unshift(entry);
      if (log.length > 300) log.length = 300;
      localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(log));
    } catch {}
  }

  // ── FAST PRE-SCREEN ───────────────────────────────────────────────────
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

    return null;
  }

  // ── CLAUDE ANALYSIS ───────────────────────────────────────────────────
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
    return data.results[0];
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
      if (d.is_dns)                return;
      if (BLK && BLK(d.name))     return;
      const solNSN = (record.nsn || "").replace(/\D/g, "");
      if (solNSN && (d.known_nsns || []).some(n => n.replace(/\D/g, "") === solNSN)) {
        // NSN exact match — bypass keyword filter, vendor has won this part before
      } else if (d.item_keywords && d.item_keywords.length > 0) {
        const iname = (record.item_name || "").toLowerCase();
        if (!d.item_keywords.some(kw => iname.includes(kw.toLowerCase()))) return;
      }
      seenIds.add(d.id);
      selected.push({ dist: d, reason });
    };

    if (WL && (record.nsn || record.ref_part_number)) {
      for (const w of WL.lookup(record.nsn, record.ref_part_number)) {
        const match = dists.find(d => d.name.toLowerCase() === w.vendor_name.toLowerCase());
        if (match) addDist(match, "Prior win · " + (w.date || w.logged));
      }
    }

    // NSN exact-match vendors (from Intel run) — highest priority after prior wins
    const solNSNClean = (record.nsn || "").replace(/\D/g, "");
    if (solNSNClean) {
      for (const d of dists) {
        if ((d.known_nsns || []).some(n => n.replace(/\D/g, "") === solNSNClean))
          addDist(d, "NSN match · " + record.nsn);
      }
    }

    // AN/MS/NAS prefix — route through MFR+JCP chain (no G-Fast override)

    for (const d of dists) {
      if (d.is_manufacturer && d.has_jcp)  addDist(d, "MFR · JCP");
    }
    for (const d of dists) {
      if (d.is_manufacturer && !d.has_jcp) addDist(d, "MFR");
    }

    for (const d of dists) {
      if ((d.fsc || []).includes(fsc))
        addDist(d, "FSC " + fsc);
    }

    for (const d of dists) {
      if (d.is_starred || (d.tags || []).includes("preferred"))
        addDist(d, "Preferred");
    }

    return selected;
  }

  // ── QUOTE DUE HELPER — one day before DLA deadline ───────────────────
  function quoteDueDisplay(dateStr) {
    if (!dateStr) return null;
    let m, d;
    // ISO-8601: YYYY-MM-DD
    m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      if (isNaN(d.getTime())) return null;
      d.setDate(d.getDate() - 1);
      return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    }
    // MM/DD/YY[YY] (DIBBS slash format)
    m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    d = new Date(yr, parseInt(m[1]) - 1, parseInt(m[2]));
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() - 1);
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  }

  // ── BATCHED EMAIL BUILDER (HTML) ─────────────────────────────────────
  // One email per vendor listing all their matched solicitations.
  function buildBatchEmail(dist, records) {
    const count = records.length;

    const subject = count === 1
      ? "RFQ - " + (records[0].item_name || "Item") + " | " + records[0].sol_number + " | Imperio Federal Logistics"
      : "RFQ - " + count + " Items Needed | Imperio Federal Logistics";

    const itemTables = records.map(function (record, i) {
      const item    = record.item_name || "—";
      const qty     = record.quantity
        ? record.quantity + (record.unit_of_issue ? " " + record.unit_of_issue : "")
        : "—";
      const del     = record.delivery_days ? record.delivery_days + " days ARO" : "—";
      const dueDate = quoteDueDisplay(record.quote_due);

      const label   = count > 1 ? (i + 1) + ". Item:" : "Item:";
      var rows = [
        "<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>" + label + "</td><td style='padding:2px 0;'><strong>" + item + "</strong></td></tr>",
      ];
      if (record.ref_part_number) {
        rows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Part Number:</td><td style='padding:2px 0;'>" + record.ref_part_number + "</td></tr>");
      }
      rows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Quantity:</td><td style='padding:2px 0;'>" + qty + "</td></tr>");
      rows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Required Del.:</td><td style='padding:2px 0;'>" + del + "</td></tr>");
      rows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Please Respond By:</td><td style='padding:2px 0;'><strong>" + (dueDate || "As soon as possible") + "</strong></td></tr>");
      rows.push("<tr><td style='color:#666;padding:2px 14px 2px 0;white-space:nowrap;'>Ref #:</td><td style='padding:2px 0;'>" + record.sol_number + "</td></tr>");

      return "<table style='border-left:3px solid #cc0000;padding-left:10px;margin:0 0 14px 0;border-spacing:0;border-collapse:collapse;'>" + rows.join("") + "</table>";
    }).join("");

    const body = [
      "<!DOCTYPE html><html><body style='margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;background:#fff;'>",
      "<div style='background:#000;padding:7px 16px;'>",
        "<span style='color:#cc0000;font-weight:bold;font-style:italic;font-size:13px;'>Retired</span>",
        "<span style='color:#fff;font-weight:bold;font-size:13px;'> U.S. Army Veteran</span>",
        "<span style='color:#00aaff;font-weight:bold;font-size:13px;margin-left:20px;'>&#9733; Texas Veteran-Owned Business</span>",
      "</div>",
      "<div style='padding:20px 24px;'>",
        "<p style='margin:0 0 16px 0;'>Hi " + dist.name + ",</p>",
        "<p style='margin:0 0 16px 0;'>My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have " +
          (count === 1 ? "an active government procurement need" : count + " active government procurement needs") +
          " in your lane.</p>",
        "<p style='margin:0 0 12px 0;'>I need pricing and availability on the following item" + (count > 1 ? "s" : "") + ":</p>",
        itemTables,
        "<p style='margin:0 0 6px 0;'><strong>Requirements:</strong></p>",
        "<ul style='margin:0 0 16px 0;padding-left:20px;line-height:1.8;'>",
          "<li>Destination: Government delivery address (continental US)</li>",
          "<li>Compliance: BAA/TAA required — please confirm country of origin</li>",
          "<li>Shipping: FOB Destination required</li>",
          "<li>Condition: New/unused only. No substitutions without prior approval.</li>",
        "</ul>",
        "<p style='margin:0 0 20px 0;'>Please provide unit price, lead time, and confirm country of origin" + (count > 1 ? " for each item" : "") + ". We issue POs immediately upon award.</p>",
        "<p style='margin:0 0 4px 0;'>V/R,</p>",
        "<p style='margin:0 0 16px 0;line-height:1.9;'>",
          "<strong>Anthony K. Kelley</strong><br>",
          "<strong>Founder | Imperio Federal Logistics</strong><br>",
          "<span style='color:#666;font-size:13px;'>A Division of</span><br>",
          "The House of Kel LLC<br>",
          "<strong>CAGE Code: 152U4</strong><br>",
          "<a href='mailto:anthony@ifedlog.com' style='color:#0066cc;'>anthony@ifedlog.com</a> | <a href='https://www.ifedlog.com' style='color:#0066cc;'>www.ifedlog.com</a><br>",
          "(254) 226-5216",
        "</p>",
        "<hr style='border:none;border-top:1px solid #ccc;margin:0 0 12px 0;'>",
        "<p style='margin:0 0 12px 0;font-size:13px;'>SDVOSB | &#11088; | VetHUB</p>",
        "<img src='https://thehouseofkel.com/ifl_banner.png' alt='Imperio Federal Logistics' style='max-width:420px;display:block;'>",
      "</div>",
      "</body></html>",
    ].join("");

    return { subject, body };
  }

  // ── PIPELINE UPDATE ───────────────────────────────────────────────────
  async function updatePipeline(record, patch) {
    if (!window.SCC_DB) return;
    const rows = window.SCC_DB.dbLoad ? window.SCC_DB.dbLoad() : [];
    const current = rows.find(r => r.sol_number === record.sol_number);
    if (!current) return;
    await window.SCC_DB.dbSave({ ...current, ...patch });
  }

  // ── SINGLE RECORD (kept for gmail-ingest compatibility) ───────────────
  async function run(record, opts) {
    opts = opts || {};
    const log    = [];
    const addLog = (msg) => { log.push(msg); if (opts.onLog) opts.onLog(msg); };

    let verdict;
    if (record.verdict === "GO") {
      verdict = "GO";
    } else {
      const preReject = preScreen(record);
      if (preReject) {
        addLog("PRE-REJECT " + record.sol_number + " — " + preReject);
        return { verdict: "REJECT", reason: preReject, sent: 0, log };
      }
      addLog("Analyzing " + record.sol_number + " with Claude…");
      try {
        const analysis = await claudeAnalyze(record);
        addLog("Claude verdict: " + analysis.verdict + " — " + analysis.reason);
        verdict = analysis.verdict;
        record = { ...record, ...analysis };
      } catch (e) {
        addLog("Claude unavailable (" + e.message + ") — defaulting GO");
        verdict = "GO";
      }
    }

    if (verdict === "REJECT" || verdict === "VERIFY FIRST") {
      return { verdict, reason: record.reason || "", sent: 0, log };
    }

    const r = await runBatch([record], opts);
    if (r.queued) return { verdict: "GO", sent: 0, queued: true, log };
    return { verdict: "GO", sent: r.vendorsSent.length, log };
  }

  // ── BATCH RUNNER — VENDOR-GROUPED ─────────────────────────────────────
  // Phase 1: screen all records, build vendor → [records] map
  // Phase 2: one batched email per vendor covering all their matched sols
  // Phase 3: persist blast log + send summary to anthony@ifedlog.com
  async function runBatch(records, opts) {
    opts = opts || {};
    const addLog = opts.onLog || function () {};
    const batch  = opts.testMode ? records.slice(0, TEST_LIMIT) : records;

    const results = {
      go:          [],
      verifyFirst: [],
      rejected:    [],
      errors:      [],
      vendorsSent: [],
      testMode:    !!opts.testMode,
    };

    // ── PN Gate: hold entire batch if any GO record has no part number ──
    // Records explicitly marked N/A by the user carry _pn_na: true — they pass.
    const missingPN = batch.filter(function (r) {
      return r.verdict === "GO" && !r.ref_part_number && !r._pn_na;
    });
    if (missingPN.length > 0) {
      var qEntry = {
        batch_id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        ts:       new Date().toISOString(),
        opts:     { testMode: !!opts.testMode },
        records:  batch,
      };
      savePNQueue(qEntry);
      addLog("⏸ " + missingPN.length + " sol(s) missing part numbers — full batch held. Open PN Queue to resolve, then release.");
      if (opts.onQueue) opts.onQueue(qEntry);
      return { queued: true, batchId: qEntry.batch_id, pendingCount: missingPN.length };
    }

    // ── Phase 1: categorize + map vendors ──
    const vendorMap = new Map(); // dist key → { dist, reasons: Set, records: [] }

    for (const record of batch) {
      if (record.verdict !== "GO") {
        results.verifyFirst.push({ sol: record.sol_number, reason: record.reason || "VERIFY FIRST" });
        continue;
      }

      const vendors = selectVendors(record);

      if (vendors.length === 0) {
        if (opts.testMode) {
          const key = "__test_fallback__";
          if (!vendorMap.has(key)) {
            vendorMap.set(key, {
              dist: { name: "[No vendor matched — test preview]", email: TEST_EMAIL },
              reasons: new Set(["test fallback"]),
              records: [],
            });
          }
          vendorMap.get(key).records.push(record);
        } else {
          addLog("No vendors matched for " + record.sol_number + " — skipped");
        }
        results.go.push({ sol: record.sol_number, vendorCount: 0 });
        continue;
      }

      results.go.push({ sol: record.sol_number, vendorCount: vendors.length });

      for (const v of vendors) {
        const key = v.dist.id || v.dist.email;
        if (!vendorMap.has(key)) {
          vendorMap.set(key, { dist: v.dist, reasons: new Set(), records: [] });
        }
        const entry = vendorMap.get(key);
        entry.reasons.add(v.reason);
        // dedupe — a vendor can match a sol via multiple paths (FSC + preferred)
        if (!entry.records.find(function (r) { return r.sol_number === record.sol_number; })) {
          entry.records.push(record);
        }
      }
    }

    // ── Apply vendor queue: sort by ext desc / due asc, cap at 10, track overflow ──
    var VQ = window.SCC_VENDOR_QUEUE;
    if (VQ) {
      for (var [vqKey, vqEntry] of vendorMap.entries()) {
        var vqResult = VQ.buildVendorBatch(vqKey, vqEntry.records);
        vqEntry.records  = vqResult.batch;
        vqEntry.overflow = vqResult.overflow;
        if (vqResult.overflow.length > 0) {
          addLog("AUTO ▶ " + vqEntry.dist.name + " — sending top " + vqResult.batch.length + " of " + (vqResult.batch.length + vqResult.overflow.length) + " matched sols (" + vqResult.overflow.length + " queued for next run)", "info");
        }
      }
    }

    addLog(
      vendorMap.size + " vendor(s) to contact · " +
      results.go.length + " GO · " +
      results.verifyFirst.length + " VERIFY · " +
      results.rejected.length + " REJECT"
    );

    // ── Dry run: return vendor plan without sending (used by AUTO approval gate) ──
    if (opts.dryRun) {
      var plan = [];
      for (var dre of vendorMap.values()) {
        var dreEmail = buildBatchEmail(dre.dist, dre.records);
        plan.push({
          dist:     dre.dist,
          records:  dre.records,
          overflow: dre.overflow || [],
          reasons:  Array.from(dre.reasons),
          to:       opts.testMode ? TEST_EMAIL : dre.dist.email,
          subject:  opts.testMode ? "[TEST] " + dreEmail.subject : dreEmail.subject,
        });
      }
      return { dryRun: true, plan, goCount: results.go.length };
    }

    // ── Phase 2: one email per vendor ──
    const batchLogEntries = [];
    for (const entry of vendorMap.values()) {
      var dist       = entry.dist;
      var reasons    = entry.reasons;
      var vendorRecs = entry.records;
      var reasonStr  = Array.from(reasons).join(" · ");

      var emailData = buildBatchEmail(dist, vendorRecs);
      var subject   = emailData.subject;
      var body      = emailData.body;
      var toAddr    = opts.testMode ? TEST_EMAIL : dist.email;
      var subj      = opts.testMode ? "[TEST] " + subject : subject;

      var logEntry = {
        ts:           new Date().toISOString(),
        live:         !opts.testMode,
        vendor:       dist.name,
        email:        opts.testMode ? TEST_EMAIL : dist.email,
        item_count:   vendorRecs.length,
        sol_numbers:  vendorRecs.map(function (r) { return r.sol_number; }),
        items:        vendorRecs.map(function (r) { return r.item_name || r.sol_number; }),
        subject:      subj,
        match_reason: reasonStr,
        sent:         false,
        error:        null,
      };

      try {
        var res  = await fetch(SEND_ENDPOINT, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ to: toAddr, subject: subj, emailBody: body, attachCert: false }),
        });
        var data = await res.json();
        if (data.ok) {
          logEntry.sent = true;
          results.vendorsSent.push({
            vendor:    dist.name,
            email:     opts.testMode ? TEST_EMAIL : dist.email,
            itemCount: vendorRecs.length,
            reason:    reasonStr,
          });
          addLog(
            "✓ " + dist.name +
            (opts.testMode ? " [TEST → " + TEST_EMAIL + "]" : " <" + dist.email + ">") +
            " · " + vendorRecs.length + " item(s) [" + reasonStr + "]"
          );
        } else {
          logEntry.error = data.error || "unknown";
          results.errors.push({ vendor: dist.name, error: logEntry.error });
          addLog("✗ " + dist.name + ": " + logEntry.error);
        }
      } catch (e) {
        logEntry.error = e.message;
        results.errors.push({ vendor: dist.name, error: e.message });
        addLog("✗ " + dist.name + ": " + e.message);
      }

      batchLogEntries.push(logEntry);
    }

    if (batchLogEntries.length > 0) {
      try {
        const bl = loadBlastLog();
        for (const e of batchLogEntries) bl.unshift(e);
        if (bl.length > 300) bl.length = 300;
        localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(bl));
      } catch {}
    }

    await sendBatchSummary(results, opts);
    return results;
  }

  // ── SUMMARY EMAIL ─────────────────────────────────────────────────────
  async function sendBatchSummary(results, opts) {
    opts = opts || {};
    const total = results.go.length + results.verifyFirst.length + results.rejected.length;
    if (total === 0) return;

    const sent      = results.vendorsSent || [];
    const totalItems = sent.reduce(function (n, v) { return n + v.itemCount; }, 0);

    const lines = [
      "SCC Auto-RFQ Batch Summary",
      "Processed: " + new Date().toLocaleString(),
      "─".repeat(40),
      "",
      "✅ VENDORS CONTACTED (" + sent.length + " vendors · " + totalItems + " item-requests sent)",
    ];

    for (const v of sent) {
      lines.push("  • " + v.vendor + " → " + v.itemCount + " item(s) [" + v.reason + "]");
    }
    if (sent.length === 0) lines.push("  (none)");

    lines.push("", "Sol breakdown:");
    lines.push("  GO: " + results.go.length + "   VERIFY: " + results.verifyFirst.length + "   REJECT: " + results.rejected.length);

    if (results.verifyFirst.length > 0) {
      lines.push("", "⚠ VERIFY FIRST — Held (" + results.verifyFirst.length + ")");
      for (const r of results.verifyFirst) lines.push("  • " + r.sol + " — " + r.reason);
    }

    if (results.rejected.length > 0) {
      lines.push("", "🔒 REJECTED (" + results.rejected.length + ")");
      for (const r of results.rejected) lines.push("  • " + r.sol + " — " + r.reason);
    }

    if (results.errors && results.errors.length > 0) {
      lines.push("", "✗ ERRORS (" + results.errors.length + ")");
      for (const r of results.errors) lines.push("  • " + (r.vendor || r.sol) + " — " + r.error);
    }

    lines.push("", "─".repeat(40), "View Pipeline → https://thehouseofkel.com/scc/");

    try {
      await fetch(SEND_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          to:        "anthony@ifedlog.com",
          subject:   (opts.testMode ? "[TEST] " : "") +
                     "SCC Auto-RFQ: " + sent.length + " vendor(s) · " + totalItems + " items · " +
                     results.go.length + " GO · " + results.verifyFirst.length + " review · " + results.rejected.length + " rejected",
          emailBody: (opts.testMode ? "TEST MODE — RFQ emails redirected to " + TEST_EMAIL + "\n\n" : "") + lines.join("\n"),
          attachCert: false,
        }),
      });
    } catch (e) {
      console.warn("[AutoRFQ] Summary notification failed:", e.message);
    }
  }

  async function sendOneVendorBatch(entry, opts) {
    opts = opts || {};
    var testMode  = !!opts.testMode;
    var emailData = buildBatchEmail(entry.dist, entry.records);
    var toAddr    = testMode ? TEST_EMAIL : (entry.dist.email || entry.to);
    var subj      = testMode ? "[TEST] " + emailData.subject : emailData.subject;
    var reasonStr = Array.isArray(entry.reasons) ? entry.reasons.join(" · ") : (entry.reasons || "");

    var logEntry = {
      ts:          new Date().toISOString(),
      live:        !testMode,
      vendor:      entry.dist.name,
      email:       toAddr,
      item_count:  entry.records.length,
      sol_numbers: entry.records.map(function (r) { return r.sol_number; }),
      items:       entry.records.map(function (r) { return r.item_name || r.sol_number; }),
      subject:     subj,
      match_reason: reasonStr,
      sent:        false,
      error:       null,
    };

    try {
      var res  = await fetch(SEND_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ to: toAddr, subject: subj, emailBody: emailData.body, attachCert: false }),
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "send failed");
      logEntry.sent = true;
      // Mark sent + save overflow so next run knows what was already blasted
      var VQ2 = window.SCC_VENDOR_QUEUE;
      if (VQ2) {
        var vKey = entry.dist.id || entry.dist.email || entry.dist.name;
        VQ2.markSent(vKey, entry.records, entry.overflow || []);
      }
    } catch (e) {
      logEntry.error = e.message;
      try {
        var bl2 = loadBlastLog(); bl2.unshift(logEntry);
        if (bl2.length > 300) bl2.length = 300;
        localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(bl2));
      } catch {}
      throw e;
    }

    try {
      var bl = loadBlastLog(); bl.unshift(logEntry);
      if (bl.length > 300) bl.length = 300;
      localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(bl));
    } catch {}

    return logEntry;
  }

  window.SCC_AUTO_RFQ = { run, runBatch, sendOneVendorBatch, sendBatchSummary, getBlastLog: loadBlastLog, loadPNQueue, savePNQueue, clearPNQueue };
})();
