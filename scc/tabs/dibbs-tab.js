(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DIBBS TAB  v1.0
  //  Top of funnel. Daily Navigator scrape → analyze → pipeline → blast.
  //
  //  Flow:
  //    1. Run Batch   — POST localhost:3100/navigator/scrape → live log
  //    2. Mode toggle — Manual (on-demand) / Auto (cron at configured time)
  //    3. Results     — first page of sols, raw table
  //    4. Analyze     — Claude API full protocol → GO / VERIFY / REJECT
  //    5. Send to Intake — dbSave GO (+ optionally VERIFY) sols
  //    6. RFQ Blast   — group GOs by FSC → distributor emails → Gmail compose
  //
  //  Exposes: window.SCC_TABS.DibbsTab
  //  Load order: after core/db.js, core/distributors.js, tabs/navigator-analyzer.js
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: h,
    useState,
    useEffect,
    useRef,
    useCallback,
    Fragment: Frag,
  } = React;

  const AGENT_URL = "http://localhost:3100";
  const STORE_KEY = "scc_dibbs_tab_v1";
  const CRON_KEY = "scc_dibbs_cron_v1";

  // ── PERSIST ──────────────────────────────────────────────────────────
  function parseQuoteDue(s) {
    if (!s) return null;
    // ISO-8601: YYYY-MM-DD
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    // MM/DD/YY[YY] (DIBBS slash format)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    return new Date(yr, parseInt(m[1]) - 1, parseInt(m[2]));
  }

  function storeLoad() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || "null") || {};

      // Auto-prune expired sols and analysis records on every load
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isLive = (r) => { const d = parseQuoteDue(r.quote_due); return !d || d >= today; };

      if (data.sols) data.sols = data.sols.filter(isLive);

      if (data.analysis) {
        data.analysis = {
          go:     (data.analysis.go     || []).filter(isLive),
          verify: (data.analysis.verify || []).filter(isLive),
          reject: (data.analysis.reject || []).filter(isLive),
        };
        if (!data.analysis.go.length && !data.analysis.verify.length && !data.analysis.reject.length) {
          data.analysis = null;
        }
      }

      return data;
    } catch {
      return {};
    }
  }
  function storeSave(d) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(d));
    } catch {}
  }

  // ── FORMAT HELPERS ────────────────────────────────────────────────────
  const fmtD = (n) =>
    n == null || isNaN(n)
      ? "—"
      : "$" +
        Number(n).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const fmtPct = (n) => (n == null ? "—" : Math.round(n * 100) + "%");

  // ── FSC NAME MAP (subset — same as blast.js) ──────────────────────────
  const FSC_NAMES = window.SCC_CONSTANTS.FSC_NAMES;
  const fscName = (fsc) => FSC_NAMES[parseInt(fsc)] || "FSC " + fsc;

  // ── PARSE NAVIGATOR SUPPLIER LIST ────────────────────────────────────
  // Format: "COMPANY NAME|CAGE|PART_NO; COMPANY NAME|CAGE|PART_NO; ..."
  function parseSupplierList(raw) {
    if (!raw || typeof raw !== "string") return [];
    return raw.split(";")
      .map((s) => {
        const parts = s.trim().split("|");
        return {
          companyName: (parts[0] || "").trim(),
          cage:        (parts[1] || "").trim().toUpperCase(),
          partNumber:  (parts[2] || "").trim(),
        };
      })
      .filter((s) => s.cage || s.companyName);
  }

  // ── BUILD PIPELINE RECORD ─────────────────────────────────────────────
  function buildRecord(rec) {
    return {
      sol_number: rec.sol_number,
      nsn: rec.nsn || "",
      fsc: rec.fsc || "",
      item_name: rec.item_name || "",
      ref_part_number: rec.piece_part_no || "",
      quantity: String(rec.qty || ""),
      unit_issue: rec.unit_issue || "",
      unit_price: String(rec.unit_price || ""),
      price_is_hist: true,
      quote_due: rec.quote_due || "",
      posted_date: rec.scraped_at ? rec.scraped_at.slice(0, 10) : "",
      delivery_days: String(rec.delivery_days || ""),
      set_aside: rec.set_aside || "",
      fob: rec.fob || "",
      supplier_restrictions: rec.supplier_restrictions || "",
      status: "New",
      date_added: new Date().toLocaleDateString(),
      notes:
        "Navigator Ingest" +
        (rec.winProbabilityPct != null
          ? " · " + rec.winProbabilityPct + "% win score"
          : "") +
        (rec.claudeReason ? " · " + rec.claudeReason : ""),
      source: "dibbs-tab",
      win_probability: rec.winProbabilityPct || 0,
      verdict: rec.verdict || "",
      supplier_poc: "",
      supplier_moq: "",
      supplier_website: "",
      supplier_phone: "",
      supplier_email: "",
      supplier_quote_price: "",
      supplier_quote_date: "",
      supplier_quote_expires: "",
      supplier_lead_time: "",
      ref_supplier: "",
      ref_cage: "",
      approved_sources: rec.approved_sources && rec.approved_sources.length
        ? rec.approved_sources
        : parseSupplierList(rec.supplier_list),
    };
  }

  // ── AI ANALYSIS — via Netlify function, batched 40 sols at a time ────────
  // Netlify functions time out at ~10s; 451 sols in one shot kills it.
  // We chunk, call sequentially, aggregate.
  async function analyzeWithClaude(sols, logFn) {
    const log = logFn || (() => {});
    const CHUNK = 15;

    const payload = sols.map((s) => ({
      sol_number: s.sol_number,
      item_name: s.item_name,
      fsc: s.fsc,
      nsn: s.nsn,
      amsc: s.amsc || "",
      approved_sources: s.approved_sources || [],
      qty: s.qty,
      unit_issue: s.unit_issue,
      unit_price: s.unit_price,
      ext_price: s.ext_price,
      delivery_days: s.delivery_days,
      set_aside: s.set_aside,
      supplier_restrictions: s.supplier_restrictions,
      piece_part_no: s.piece_part_no,
      material: s.material,
      part_char: s.part_char,
      quote_due: s.quote_due,
    }));

    const chunks = [];
    for (let i = 0; i < payload.length; i += CHUNK) {
      chunks.push(payload.slice(i, i + CHUNK));
    }

    log(`Analyzing ${payload.length} sols in ${chunks.length} batches…`, "info");

    const allResults = [];
    for (let i = 0; i < chunks.length; i++) {
      log(`Batch ${i + 1}/${chunks.length} (${chunks[i].length} sols)…`, "info");

      const resp = await fetch("/.netlify/functions/analyze-sols", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sols: chunks[i] }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Batch ${i + 1} failed ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json();
      if (!data.ok) throw new Error(`Batch ${i + 1}: ${data.error || "Analysis failed"}`);

      allResults.push(...data.results);
    }

    log(`✓ All batches complete — ${allResults.length} results`, "ok");
    return allResults;
  }

  // ── LOCAL ANALYSIS — instant GO/VERIFY/REJECT with no API credits ─────
  // Uses AMSC code + extended value + prime-dominated FSC list.
  // Returns same structure as analyzeWithClaude: [{sol_number, verdict, reason, ...}]
  const LOCAL_PRIME_FSCS = new Set([
    "1560","1305","1310","1315","1320","1340","1350","1360","1376",
    "2835","2840","1720","1730","1680","6910","6920","6930","5860","1081",
  ]);
  const LOCAL_AMSC_BLOCKED     = new Set(["D","E","V","K"]);
  const LOCAL_AMSC_RESTRICTED  = new Set(["R","C","F","G"]);

  function analyzeLocal(sols, logFn) {
    const log = logFn || (() => {});
    log("Local filter — no Claude credits needed.", "info");
    const results = [];
    for (const s of sols) {
      const amsc    = String(s.amsc || "").toUpperCase().trim().slice(0, 1);
      const ext     = parseFloat(s.ext_price) || 0;
      const fsc     = String(s.fsc || "").trim();
      const restr   = String(s.supplier_restrictions || "").toUpperCase();

      let verdict, reason;

      if (LOCAL_PRIME_FSCS.has(fsc)) {
        verdict = "REJECT"; reason = "Prime-dominated FSC " + fsc + " — no resale channel.";
      } else if (LOCAL_AMSC_BLOCKED.has(amsc)) {
        verdict = "REJECT"; reason = "AMSC " + amsc + " — sole source or not procured commercially. Do not bid.";
      } else if (ext < 50) {
        verdict = "REJECT"; reason = "Extended value $" + ext.toFixed(2) + " below minimum. Not worth pursuing.";
      } else if (ext >= 500 && (amsc === "A" || amsc === "B" || amsc === "")) {
        verdict = "GO"; reason = "Open competition (AMSC " + (amsc || "unknown") + "), value $" + Math.round(ext).toLocaleString() + " qualifies.";
      } else if (ext >= 500 && LOCAL_AMSC_RESTRICTED.has(amsc)) {
        verdict = "VERIFY FIRST"; reason = "AMSC " + amsc + " — must be on approved source list. Verify before bidding.";
      } else if (restr.includes("RESTRICTED")) {
        verdict = "VERIFY FIRST"; reason = "Supplier restrictions flagged — verify eligibility.";
      } else if (ext >= 500) {
        verdict = "GO"; reason = "Value $" + Math.round(ext).toLocaleString() + " qualifies. AMSC unknown — verify restrictions.";
      } else {
        verdict = "VERIFY FIRST"; reason = "Value $" + Math.round(ext).toFixed(2) + " below $500 floor — proceed only if margin works.";
      }

      results.push({ sol_number: s.sol_number, verdict, reason, winProbabilityPct: null, localScored: true });
    }
    const go     = results.filter((r) => r.verdict === "GO").length;
    const verify = results.filter((r) => r.verdict === "VERIFY FIRST").length;
    const reject = results.filter((r) => r.verdict === "REJECT").length;
    log("Local filter complete — " + go + " GO · " + verify + " VERIFY · " + reject + " REJECT", "ok");
    return results;
  }

  // ── RFQ EMAIL BUILDER ─────────────────────────────────────────────────
  function buildRFQEmail(dist, sols) {
    const lane = fscName(sols[0].fsc);
    const items = sols
      .map((s, i) => {
        const lines = ["  " + (i + 1) + ". " + (s.item_name || "Item")];
        // Part number: prefer OEM P/N from approved sources, fall back to Navigator piece_part_no
        const oemSrc = (s.approved_sources || []).find(
          (a) => a.pn && a.pn.length > 1,
        );
        const partNum =
          (oemSrc
            ? oemSrc.pn +
              (s.piece_part_no && s.piece_part_no !== oemSrc.pn
                ? " / " + s.piece_part_no
                : "")
            : s.piece_part_no) || "";
        if (partNum)
          lines.push(
            "     Part #: " +
              partNum +
              (oemSrc ? " (Mfr: " + oemSrc.name + ")" : ""),
          );
        if (s.qty)
          lines.push(
            "     Qty: " + s.qty + (s.unit_issue ? " " + s.unit_issue : ""),
          );
        if (s.delivery_days)
          lines.push(
            "     Required Delivery: " + s.delivery_days + " days ARO",
          );
        if (s.sol_number) lines.push("     Ref #: " + s.sol_number);
        const rawDue = s.quote_due || "";
        if (rawDue) {
          const m = rawDue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          if (m) {
            const yr = m[3].length === 2 ? "20" + m[3] : m[3];
            const d = new Date(parseInt(yr), parseInt(m[1])-1, parseInt(m[2]));
            d.setDate(d.getDate() - 1);
            lines.push("     Please Respond By: " + (d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear());
          } else {
            lines.push("     Please Respond By: " + rawDue);
          }
        } else {
          lines.push("     Please Respond By: As soon as possible");
        }
        return lines.join("\n");
      })
      .join("\n\n");

    return [
      "Hi " + (dist.name || dist.Company || "Team") + ",",
      "",
      "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting active DLA requirements and have an immediate procurement need in your lane.",
      "",
      "Quick Note: I sent you an email from anthony@ifedlog.com — we went through a company restructure and transitioned to a new email. If you didn't see it, it may be in your spam folder.",
      "",
      "I need pricing and availability on the following item" +
        (sols.length > 1 ? "s" : "") +
        ":",
      "",
      items,
      "",
      "Requirements:",
      "- Destination: Government delivery address (continental US)",
      "- Payment: Immediate PO upon award — we use Factoring Express for third-party PO funding. Supplier receives direct wire payment before shipment.",
      "- Compliance: BAA/TAA required — please confirm country of origin on all items",
      "- Shipping: FOB Destination required",
      "- Condition: New/unused only",
      "",
      "Please provide unit price, lead time, and country of origin confirmation. We issue POs same-day upon award.",
      "",
      "Thank you,",
      "",
      "Anthony K. Kelley | Founder & CEO",
      "Imperio Federal Logistics | The House of Kel LLC · CAGE 152U4",
      "SDVOSB | VetHUB",
      "anthony@ifedlog.com | (254) 226-5216",
    ].join("\n");
  }

  function openGmailCompose(to, subject, body) {
    const base = "https://mail.google.com/mail/?view=cm&fs=1";
    const url =
      base +
      "&to=" +
      encodeURIComponent(to) +
      "&su=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body);
    window.open(url, "_blank");
  }

  // ── PENDING BLAST PANEL ───────────────────────────────────────────────
  // Shows after AUTO dry-run — lists vendors + items, requires manual approval.
  function PendingBlastPanel({ entry, idx, total, isLive, onSend, onSkip, onCancel, onPipeline, onGoLive, onBlastAll, sending, selectedCount }) {
    const mono  = "JetBrains Mono,monospace";
    const serif = "Cinzel,serif";
    const body  = "Cormorant Garamond,serif";

    const GRID = "150px 50px 120px 1fr 120px 55px 85px 95px 54px 85px";
    const GAP  = "0 10px";
    const PAD  = "0 28px";

    const totalExt = entry.records.reduce(function (s, r) {
      return s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || 1) || parseFloat(r.ext_price || 0) || 0);
    }, 0);
    const avgDel = Math.round(
      entry.records.reduce(function (s, r) { return s + (parseInt(r.delivery_days) || 0); }, 0) /
      Math.max(entry.records.filter(function (r) { return parseInt(r.delivery_days); }).length, 1)
    );
    const tags    = entry.reasons || [];
    const isMfr   = tags.some(function (t) { return String(t).includes("manufacturer") || String(t).includes("source-contact"); });
    const winColor = totalExt >= 100000 ? "rgba(61,214,140,.9)" : totalExt >= 25000 ? "rgba(245,158,11,.9)" : "rgba(245,240,232,.5)";
    const expectedValue = entry.expectedValue || (totalExt * ((entry.avgWin || 50) / 100));

    const btnBase = {
      fontFamily: serif, fontSize: "14px", letterSpacing: ".14em", textTransform: "uppercase",
      cursor: sending ? "not-allowed" : "pointer", opacity: sending ? 0.5 : 1,
      transition: "all .18s", borderRadius: "3px",
    };

    const stat = function(label, value, color, sub) {
      return h("div", { style: { textAlign: "right" } },
        h("div", { style: { fontFamily: mono, fontSize: "14px", letterSpacing: ".12em", color: "rgba(245,240,232,.25)", textTransform: "uppercase", marginBottom: "4px" } }, label),
        h("div", { style: { fontFamily: serif, fontSize: "20px", color: color || "rgba(245,240,232,.7)", letterSpacing: ".04em", lineHeight: 1 } }, value),
        sub && h("div", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,240,232,.3)", marginTop: "3px" } }, sub),
      );
    };

    return h("div", {
      style: { background: "transparent", borderTop: "3px solid rgba(201,168,76,.7)", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 },
    },

      // ══ HEADER ══════════════════════════════════════════════════════════
      h("div", {
        style: { display: "flex", alignItems: "center", gap: "14px", padding: "12px 28px", borderBottom: "1px solid rgba(201,168,76,.12)", background: "rgba(201,168,76,.04)", flexShrink: 0 },
      },
        h("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          h("div", { style: { fontFamily: serif, fontSize: "14px", letterSpacing: ".22em", color: "rgba(201,168,76,.45)", textTransform: "uppercase" } }, "Daily Outreach Brief"),
          h("div", { style: { fontFamily: serif, fontSize: "20px", letterSpacing: ".1em", color: "rgba(201,168,76,.95)" } }, "RFQ " + (idx + 1) + " of " + total),
        ),
        h("div", {
          style: { fontFamily: mono, fontSize: "14px", letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 10px", borderRadius: "2px",
            background: isLive ? "rgba(231,76,60,.15)" : "rgba(245,158,11,.1)",
            color: isLive ? "rgba(231,76,60,.9)" : "rgba(245,158,11,.75)",
            border: "1px solid " + (isLive ? "rgba(231,76,60,.35)" : "rgba(245,158,11,.25)") },
        }, isLive ? "⬤ LIVE" : "◯ TEST"),
        !isLive && h("button", {
          onClick: onGoLive,
          disabled: sending,
          style: {
            fontFamily: serif, fontSize: "14px", letterSpacing: ".14em", textTransform: "uppercase",
            padding: "5px 16px", cursor: "pointer",
            background: "rgba(231,76,60,.12)", color: "rgba(231,76,60,.9)",
            border: "1px solid rgba(231,76,60,.5)", borderRadius: "3px",
          },
        }, "⬤ Go Live"),
        h("div", { style: { flex: 1 } }),
        h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" } },
          h("div", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,240,232,.25)", letterSpacing: ".08em" } }, Math.round((idx / Math.max(total, 1)) * 100) + "% complete"),
          h("div", { style: { width: "140px", height: "3px", background: "rgba(255,255,255,.06)", borderRadius: "2px", overflow: "hidden" } },
            h("div", { style: { width: (idx / Math.max(total, 1) * 100) + "%", height: "100%", background: "rgba(201,168,76,.6)", transition: "width .4s ease" } }),
          ),
        ),
        h("button", { onClick: onBlastAll, disabled: sending, style: { ...btnBase, background: "rgba(61,214,140,.1)", color: "rgba(61,214,140,.9)", border: "1px solid rgba(61,214,140,.4)", padding: "7px 20px" } }, "⚡ Blast All Remaining"),
        h("button", { onClick: onCancel, disabled: sending, style: { ...btnBase, background: "transparent", color: "rgba(231,76,60,.6)", border: "1px solid rgba(231,76,60,.25)", padding: "7px 14px" } }, "✕ End"),
        h("button", { onClick: onSkip, disabled: sending, style: { ...btnBase, background: "rgba(255,255,255,.04)", color: "rgba(245,240,232,.5)", border: "1px solid rgba(255,255,255,.1)", padding: "7px 20px" } }, "Next →"),
      ),

      // ══ VENDOR IDENTITY ═════════════════════════════════════════════════
      h("div", {
        style: { padding: "18px 28px 14px", borderBottom: "1px solid rgba(201,168,76,.08)", flexShrink: 0 },
      },
        h("div", { style: { fontFamily: serif, fontSize: "26px", letterSpacing: ".06em", color: "rgba(245,240,232,.95)", lineHeight: 1, marginBottom: "8px" } }, entry.dist.name),
        h("div", { style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" } },
          h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(201,168,76,.65)" } }, isLive ? (entry.dist.email || entry.to) : "→ tu2kel.lg@gmail.com"),
          entry.dist.cage && h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,240,232,.3)", letterSpacing: ".1em" } }, "CAGE " + entry.dist.cage),
          h("span", {
            style: { fontFamily: mono, fontSize: "14px", letterSpacing: ".1em", textTransform: "uppercase", padding: "2px 8px", borderRadius: "2px",
              background: isMfr ? "rgba(61,214,140,.08)" : "rgba(96,165,250,.08)",
              color: isMfr ? "rgba(61,214,140,.7)" : "rgba(96,165,250,.7)",
              border: "1px solid " + (isMfr ? "rgba(61,214,140,.2)" : "rgba(96,165,250,.2)") },
          }, isMfr ? "Approved Mfr" : "Lane Contact"),
        ),
        // Lanes + stats row
        h("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "20px" } },
          h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap", alignItems: "center" } },
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,240,232,.2)", letterSpacing: ".1em" } }, "LANES"),
            [...new Set(entry.records.map(function(r){ return r.fsc; }).filter(Boolean))].sort().map(function(fsc) {
              return h("span", { key: fsc, style: { fontFamily: mono, fontSize: "14px", color: "rgba(201,168,76,.75)", background: "rgba(201,168,76,.09)", border: "1px solid rgba(201,168,76,.22)", padding: "2px 7px", borderRadius: "2px" } }, fsc);
            }),
          ),
          h("div", { style: { display: "flex", gap: "28px", flexShrink: 0 } },
            stat("Total Ext $", "$" + totalExt.toLocaleString(undefined, { maximumFractionDigits: 0 }), winColor),
            stat("Exp. Value", "$" + Math.round(expectedValue).toLocaleString(), "rgba(96,165,250,.8)", Math.round(entry.avgWin || 50) + "% avg win"),
            stat("Items", entry.records.length, "rgba(245,240,232,.7)"),
            avgDel > 0 && stat("Avg Del", avgDel + "d", "rgba(245,240,232,.4)"),
          ),
        ),
      ),

      // ══ SOL TABLE ═══════════════════════════════════════════════════════
      h("div", { style: { padding: "0 28px 12px", overflowY: "auto", flex: 1, minHeight: 0 } },
        // Header
        h("div", { style: { display: "grid", gridTemplateColumns: GRID, gap: GAP, padding: "10px 0 6px", borderBottom: "1px solid rgba(201,168,76,.12)", marginBottom: "2px" } },
          ["Sol #", "FSC", "NSN", "Item", "Part #", "Qty", "Unit $", "Ext $", "Win%", "Due"].map(function(h_) {
            return h("div", { key: h_, style: { fontFamily: mono, fontSize: "14px", letterSpacing: ".14em", color: "rgba(201,168,76,.4)", textTransform: "uppercase" } }, h_);
          }),
        ),
        // Rows
        entry.records.map(function(r) {
          const ext = parseFloat(r.unit_price || 0) * parseFloat(r.quantity || 1) || parseFloat(r.ext_price || 0) || 0;
          const wp  = parseFloat(r.win_probability || 0);
          const wpColor = wp >= 70 ? "rgba(61,214,140,.85)" : wp >= 50 ? "rgba(245,158,11,.75)" : "rgba(245,240,232,.3)";
          return h("div", { key: r.sol_number, style: { display: "grid", gridTemplateColumns: GRID, gap: GAP, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.04)", background: ext >= 50000 ? "rgba(61,214,140,.06)" : "transparent", alignItems: "center" } },
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(201,168,76,.7)", letterSpacing: ".03em" } }, r.sol_number),
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(201,168,76,.6)", background: "rgba(201,168,76,.08)", border: "1px solid rgba(201,168,76,.2)", padding: "2px 5px", borderRadius: "2px" } }, r.fsc || "—"),
            h("span", { style: { fontFamily: mono, fontSize: "12px", color: "rgba(96,165,250,.7)", letterSpacing: ".02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.nsn || "—"),
            h("span", { style: { fontFamily: body, fontSize: "15px", color: "rgba(245,240,232,.88)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.item_name || "—"),
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(61,214,140,.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.ref_part_number || "—"),
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,240,232,.65)", textAlign: "right" } }, r.quantity || "—"),
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,240,232,.55)", textAlign: "right" } }, r.unit_price ? "$" + parseFloat(r.unit_price).toLocaleString() : "—"),
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: ext >= 50000 ? "rgba(61,214,140,.95)" : "rgba(245,240,232,.75)", textAlign: "right", fontWeight: ext >= 50000 ? "700" : "400" } },
              ext > 0 ? "$" + ext.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"),
            h("span", { style: { fontFamily: mono, fontSize: "14px", textAlign: "right", color: wpColor, fontWeight: wp >= 70 ? "600" : "400" } }, wp ? Math.round(wp) + "%" : "—"),
            h("span", { style: { fontFamily: mono, fontSize: "14px", color: "rgba(245,158,11,.7)", textAlign: "right" } }, r.quote_due || "—"),
          );
        }),
        // Total
        h("div", { style: { display: "grid", gridTemplateColumns: GRID, gap: GAP, padding: "12px 0 0", borderTop: "1px solid rgba(201,168,76,.18)", marginTop: "4px" } },
          h("span", { style: { gridColumn: "1 / 9", fontFamily: mono, fontSize: "14px", letterSpacing: ".14em", color: "rgba(201,168,76,.4)", textTransform: "uppercase", textAlign: "right" } }, "Total Opportunity"),
          h("span", { style: { fontFamily: serif, fontSize: "16px", color: winColor, textAlign: "right", letterSpacing: ".04em" } },
            "$" + totalExt.toLocaleString(undefined, { maximumFractionDigits: 0 })),
        ),
      ),

      // ══ FOOTER ══════════════════════════════════════════════════════════
      h("div", {
        style: { padding: "14px 28px", borderTop: "1px solid rgba(201,168,76,.15)", background: "rgba(10,8,4,.97)", flexShrink: 0, display: "flex", gap: "10px" },
      },
        h("button", {
          onClick: onPipeline,
          disabled: !selectedCount,
          title: selectedCount ? "Push all " + selectedCount + " selected sols to pipeline + register NSNs for watch" : "No sols selected — check boxes on the analysis screen",
          style: { ...btnBase, flex: "0 0 auto", padding: "13px 18px", fontFamily: mono, fontSize: "14px", letterSpacing: ".08em",
            background: selectedCount ? "rgba(96,165,250,.1)" : "rgba(255,255,255,.03)",
            color: selectedCount ? "rgba(96,165,250,.85)" : "rgba(255,255,255,.2)",
            border: "1px solid " + (selectedCount ? "rgba(96,165,250,.35)" : "rgba(255,255,255,.1)"),
            cursor: selectedCount ? "pointer" : "not-allowed",
          },
        }, "→ Pipeline" + (selectedCount ? " (" + selectedCount + ")" : "")),
        h("button", {
          onClick: onSend, disabled: sending,
          style: { ...btnBase, flex: 1, padding: "14px 0", fontSize: "14px", letterSpacing: ".2em",
            background: sending ? "rgba(61,214,140,.06)" : "rgba(61,214,140,.16)",
            color: sending ? "rgba(61,214,140,.4)" : "rgba(61,214,140,.95)",
            border: "1px solid " + (sending ? "rgba(61,214,140,.2)" : "rgba(61,214,140,.5)"),
            boxShadow: sending ? "none" : "0 0 20px rgba(61,214,140,.12)" },
        }, sending ? "Sending…" : "✓ Send Email"),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // ── MAIN TAB COMPONENT ────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  function DibbsTab({ setTab }) {
    const saved = storeLoad();

    // ── State ──
    const [mode, setMode] = useState(saved.mode || "manual");
    const [agentAlive, setAgentAlive] = useState(null); // null=unknown true/false
    const [running, setRunning] = useState(false);
    const [log, setLog] = useState([]);
    const [sols, setSols] = useState(saved.sols || []);
    const [scrapeDate, setScrapeDate] = useState(saved.scrapeDate || "");

    const [analyzing, setAnalyzing] = useState(false);
    const [analysis, setAnalysis] = useState(saved.analysis || null); // { go, verify, reject }
    const [analyzeErr, setAnalyzeErr] = useState("");

    const [selected, setSelected] = useState(new Set());
    const [pushing, setPushing] = useState(false);
    const [pushLog, setPushLog] = useState([]);

    const [blastView, setBlastView] = useState(false);
    const [blastPlan, setBlastPlan] = useState(null); // { [fsc]: { sols, dists } }

    const [anmsSweeping, setAnmsSweeping] = useState(false);
    const [toast, setToast] = useState(null);
    const [resultTab, setResultTab] = useState("GO");
    const [minValue, setMinValue] = useState(500);   // dispatch value floor
    const [minScore, setMinScore] = useState(0);     // show all by default — use filter to hide low scores
    const [bwsScores, setBwsScores] = useState({});  // nsn → { score, label, color }
    const [bwsLoading, setBwsLoading] = useState(false);
    const [rawExpanded, setRawExpanded] = useState(false);
    const [rawSearch, setRawSearch] = useState("");
    const [liveMode, setLiveMode] = useState(false); // always starts OFF — must be explicitly enabled each session
    const [blastCapPerFsc, setBlastCapPerFsc] = useState(3);
    const blastCapRef = useRef(3);
    const [blasting, setBlasting] = useState(false);
    const [blastLog, setBlastLog] = useState([]);
    const [showBlastLog, setShowBlastLog] = useState(false);
    const [pnQueue, setPNQueue] = useState(null); // loaded from localStorage on mount
    const [pendingBlast, setPendingBlast] = useState(null); // { plan, records, isLive } — AUTO dry-run awaiting approval

    const abortRef   = useRef(false);
    const modeRef     = useRef(mode);
    useEffect(() => { modeRef.current = mode; }, [mode]);
    const liveModeRef = useRef(liveMode);
    useEffect(() => { liveModeRef.current = liveMode; }, [liveMode]);
    useEffect(() => { blastCapRef.current = blastCapPerFsc; }, [blastCapPerFsc]);

    // ── Persist ──
    useEffect(() => {
      storeSave({ mode, sols, scrapeDate, analysis });
    }, [mode, sols, scrapeDate, analysis]);

    // ── Auto-blast trigger: intel chain fires "scc:auto_blast" window event ──
    // DibbsTab is always mounted, so we listen for the event rather than watching mount/unmount
    useEffect(() => {
      const handler = () => {
        if (!window.SCC_AUTO_RFQ) return;

        // Read GO sols — filter to unrestricted + ≥70% win probability only
        let goSols = [];
        try {
          const raw = localStorage.getItem("scc_screener_results_v1");
          if (raw) goSols = JSON.parse(raw).filter(r =>
            r.verdict === "GO" &&
            (r.winProbabilityPct == null || r.winProbabilityPct >= 70) &&
            (r.supplier_restrictions || "").toLowerCase() !== "restricted"
          );
        } catch {}
        if (!goSols.length) {
          addLog("AUTO ▶ No qualifying GO sols (need ≥70% win rate + unrestricted sourcing).", "info");
          return;
        }
        addLog("AUTO ▶ " + goSols.length + " qualifying sol(s) — unrestricted, ≥70% win rate.", "info");

        // DB vendors — top 3 per FSC lane, exclude OEM/approved-manufacturer tags
        // (DB may have thousands; cap per lane to keep blast manageable)
        const dbAll = (window.SCC_DIST && window.SCC_DIST.DISTRIBUTORS) || [];
        const seenNames = new Set();
        const blastVendors = [];

        // Collect GO sol FSC codes so we only pull vendors for relevant lanes
        const goFscs = new Set(goSols.map(s => String(s.fsc || (s.nsn || "").replace(/\D/g,"").slice(0,4))).filter(Boolean));

        // Per-FSC cap: pick tier-1 first, then tier-2; cap is user-controlled
        const fscVendorCount = {};
        const DB_CAP_PER_FSC = blastCapRef.current || 3;
        const eligible = dbAll
          .filter(d => d.email && !d.is_dns && !(d.tags || []).includes("approved-manufacturer"))
          .sort((a, b) => (a.tier || 9) - (b.tier || 9));

        for (const d of eligible) {
          const dFscs = (d.fsc || []).map(String).filter(f => goFscs.has(f));
          if (!dFscs.length) continue; // vendor has no lanes matching today's GO sols
          const underCap = dFscs.some(f => (fscVendorCount[f] || 0) < DB_CAP_PER_FSC);
          if (!underCap) continue;
          const key = (d.name || "").toUpperCase().trim();
          if (seenNames.has(key)) continue;
          seenNames.add(key);
          dFscs.forEach(f => { fscVendorCount[f] = (fscVendorCount[f] || 0) + 1; });
          blastVendors.push({ id: d.id, name: d.name, email: d.email, cage: d.cage || "", fsc: d.fsc || [], nsns: d.known_nsns || [], tags: d.tags || [], source: "db" });
        }

        // Intel FSC lane companies — same 3-per-FSC cap as DB vendors
        // Skip approved-manufacturer (OEMs), large primes (>$10M), already-seen names
        try {
          const raw = localStorage.getItem("scc_intel_pending_v1");
          if (raw) {
            JSON.parse(raw)
              .filter(v =>
                v.email && !v.is_dns &&
                !(v.tags || []).includes("approved-manufacturer") &&
                (v.totalAward == null || v.totalAward <= 10000000)
              )
              .forEach(v => {
                const vFsc = String(v.fsc || "");
                if (!vFsc || !goFscs.has(vFsc)) return; // only lanes in today's GO sols
                if ((fscVendorCount[vFsc] || 0) >= DB_CAP_PER_FSC) return; // cap hit for this lane
                const key = (v.name || "").toUpperCase().trim();
                if (seenNames.has(key)) return;
                seenNames.add(key);
                fscVendorCount[vFsc] = (fscVendorCount[vFsc] || 0) + 1;
                blastVendors.push(v);
              });
          }
        } catch {}

        if (!blastVendors.length) {
          addLog("AUTO ▶ No blast vendors available — DB vendors have no email or intel sweep hasn't run.", "info");
          return;
        }

        const isLive = liveModeRef.current;
        addLog("AUTO ▶ Matching " + blastVendors.length + " vendors to " + goSols.length + " qualifying sol(s)…", "info");

        // Match each vendor to qualifying GO sols by NSN or FSC lane
        const plan = [];
        for (const vendor of blastVendors) {
          const vendorNsns = new Set((vendor.nsns || []).map(n => n.replace(/\D/g, "")));
          const vendorFscs = new Set(Array.isArray(vendor.fsc) ? vendor.fsc : [vendor.fsc].filter(Boolean));

          const matchedSols = goSols.filter(sol => {
            const solNsn = (sol.nsn || "").replace(/\D/g, "");
            const solFsc = sol.fsc || (sol.nsn || "").replace(/\D/g, "").slice(0, 4);
            return (solNsn && vendorNsns.has(solNsn)) || (solFsc && vendorFscs.has(solFsc));
          });

          if (!matchedSols.length) continue;

          const recs = matchedSols.map(buildRecord);

          // Skip if total opportunity < $1,000 — not worth the outreach
          const totalExt = recs.reduce((s, r) => s + (parseFloat(r.unit_price || 0) * parseFloat(r.quantity || 1) || parseFloat(r.ext_price || 0) || 0), 0);
          if (totalExt < 1000) continue;

          // Risk-adjusted value: ext $ × avg win probability — used for sort order
          const winPcts = recs.map(r => parseFloat(r.win_probability || 0)).filter(n => n > 0);
          const avgWin = winPcts.length ? winPcts.reduce((a, b) => a + b, 0) / winPcts.length : 50;
          const expectedValue = totalExt * (avgWin / 100);

          const dist = {
            id: vendor.id || vendor.cage || vendor.name,
            name: vendor.name,
            email: vendor.email,
            cage: vendor.cage || "",
            fsc: Array.isArray(vendor.fsc) ? vendor.fsc : [vendor.fsc].filter(Boolean),
            tags: vendor.tags || [],
          };
          plan.push({
            dist,
            records: recs,
            overflow: [],
            reasons: (vendor.tags || []).slice(0, 2),
            to: isLive ? vendor.email : "tu2kel.lg@gmail.com",
            subject: (isLive ? "" : "[TEST] ") + "RFQ - " + (recs.length === 1 ? recs[0].item_name + " | " + recs[0].sol_number : recs.length + " Items Needed") + " | Imperio Federal Logistics",
            totalExt,
            avgWin,
            expectedValue,
          });
        }

        if (!plan.length) {
          addLog("AUTO ▶ Intel vendors don't overlap with current GO sol NSNs/FSCs — sweep may need to run again after new batch.", "info");
          return;
        }

        // Sort by risk-adjusted expected value — high $ + high win % first
        // Deprioritizes big $ with low win (OEM-locked, restricted, blockers)
        plan.sort((a, b) => b.expectedValue - a.expectedValue);

        setPendingBlast({ plan, isLive, idx: 0 });
        addLog("AUTO ▶ " + plan.length + " email draft(s) ready — review and approve below ↓", "ok");
      };

      window.addEventListener("scc:auto_blast", handler);
      return () => window.removeEventListener("scc:auto_blast", handler);
    }, []); // eslint-disable-line

    // ── Toast ──
    const toast_ = useCallback((msg, err = false) => {
      setToast({ msg, err });
      setTimeout(() => setToast(null), 4000);
    }, []);

    const refreshBlastLog = useCallback(() => {
      if (window.SCC_AUTO_RFQ && window.SCC_AUTO_RFQ.getBlastLog) {
        setBlastLog(window.SCC_AUTO_RFQ.getBlastLog());
      }
    }, []);

    // ── Agent health check ──
    const checkAgent = useCallback(async () => {
      try {
        const r = await fetch(AGENT_URL + "/health", {
          signal: AbortSignal.timeout(3000),
        });
        const d = await r.json();
        setAgentAlive(d.ok === true);
      } catch {
        setAgentAlive(false);
      }
    }, []);

    useEffect(() => {
      checkAgent();
      refreshBlastLog();
      if (window.SCC_AUTO_RFQ && window.SCC_AUTO_RFQ.loadPNQueue) {
        const q = window.SCC_AUTO_RFQ.loadPNQueue();
        if (q) setPNQueue(q);
      }
    }, [checkAgent, refreshBlastLog]);

    // ── Auto-run on open if not run today ──
    const autoRunRef = useRef(false);
    useEffect(() => {
      if (mode !== "auto" || autoRunRef.current) return;
      const today = new Date().toLocaleDateString();
      const lastDate = scrapeDate ? new Date(scrapeDate).toLocaleDateString() : "";
      if (lastDate === today) return;
      autoRunRef.current = true;
      const t = setTimeout(() => {
        setLog([]);
        runScrape();
      }, 4000); // 4s delay — lets agent finish startup
      return () => clearTimeout(t);
    }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps


    // ── SCRAPE ────────────────────────────────────────────────────────
    const addLog = useCallback((line, type = "info") => {
      setLog((prev) => [...prev, { line, type, ts: Date.now() }]);
    }, []);

    // ── PN QUEUE RELEASE — fires the held batch after all P/Ns resolved ──
    const handleQueueRelease = useCallback(async (resolvedRecords, savedOpts) => {
      if (!window.SCC_AUTO_RFQ) return;
      window.SCC_AUTO_RFQ.clearPNQueue();
      setPNQueue(null);
      const testMode = !!(savedOpts && savedOpts.testMode);
      const isLive   = !testMode;
      addLog("PN Queue ▶ Building email plan for approval…", "info");
      try {
        const r = await window.SCC_AUTO_RFQ.runBatch(
          resolvedRecords,
          testMode
            ? { dryRun: true, testMode: true, onLog: (m) => addLog(m, "info") }
            : { dryRun: true, onLog: (m) => addLog(m, "info") }
        );
        if (r.queued) {
          addLog("PN Queue ▶ Batch re-queued — resolve remaining part numbers.", "info");
        } else if (r.dryRun && r.plan && r.plan.length > 0) {
          setPendingBlast({ plan: r.plan, isLive, idx: 0 });
          addLog("PN Queue ▶ " + r.plan.length + " vendor email(s) ready — approve each one below.", "info");
        } else {
          addLog("PN Queue ▶ No vendors matched any GO sols.", "info");
        }
      } catch (e) {
        addLog("PN Queue ▶ Error: " + e.message, "err");
      }
    }, [addLog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── SEND ONE BATCH — fires a single vendor email from the step-through panel ──
    const handleSendOneBatch = useCallback(async () => {
      if (!pendingBlast || !window.SCC_AUTO_RFQ) return;
      const { plan, isLive, idx } = pendingBlast;
      const entry = plan[idx];
      setBlasting(true);
      addLog("AUTO ▶ Sending to " + entry.dist.name + "…", "info");
      try {
        await window.SCC_AUTO_RFQ.sendOneVendorBatch(entry, isLive ? {} : { testMode: true });
        addLog("✓ " + entry.dist.name + (isLive ? " <" + entry.dist.email + ">" : " [TEST → tu2kel.lg@gmail.com]") + " · " + entry.records.length + " item(s) sent.", "ok");
        refreshBlastLog();
      } catch (e) {
        addLog("✗ " + entry.dist.name + ": " + e.message, "err");
      }
      const nextIdx = idx + 1;
      if (nextIdx < plan.length) {
        setPendingBlast({ plan, isLive, idx: nextIdx });
      } else {
        setPendingBlast(null);
        setShowBlastLog(true);
        addLog("AUTO ▶ All batches processed.", "ok");
      }
      setBlasting(false);
    }, [pendingBlast, addLog, refreshBlastLog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── BLAST ALL — fires every remaining vendor email without step-through ──
    const handleBlastAll = useCallback(async () => {
      if (!pendingBlast || !window.SCC_AUTO_RFQ) return;
      const { plan, isLive, idx } = pendingBlast;
      const remaining = plan.slice(idx);
      if (!window.confirm("Blast all " + remaining.length + " remaining vendor email(s) " + (isLive ? "LIVE" : "to test inbox") + "?\n\nThis will fire them all without individual approval.")) return;
      setBlasting(true);
      let sent = 0, failed = 0;
      for (let i = 0; i < remaining.length; i++) {
        const entry = remaining[i];
        addLog("AUTO ▶ [" + (i + 1) + "/" + remaining.length + "] Sending to " + entry.dist.name + "…", "info");
        try {
          await window.SCC_AUTO_RFQ.sendOneVendorBatch(entry, isLive ? {} : { testMode: true });
          addLog("✓ " + entry.dist.name + (isLive ? " <" + (entry.dist.email || entry.to) + ">" : " [TEST]") + " · " + entry.records.length + " item(s).", "ok");
          sent++;
        } catch (e) {
          addLog("✗ " + entry.dist.name + ": " + e.message, "err");
          failed++;
        }
      }
      refreshBlastLog();
      setPendingBlast(null);
      setShowBlastLog(true);
      addLog("AUTO ▶ Blast complete — " + sent + " sent, " + failed + " failed.", sent > 0 ? "ok" : "err");
      setBlasting(false);
    }, [pendingBlast, addLog, refreshBlastLog]);

    const handleSkipBatch = useCallback(() => {
      if (!pendingBlast) return;
      const { plan, isLive, idx } = pendingBlast;
      addLog("AUTO ▶ Skipped " + plan[idx].dist.name + ".", "info");
      const nextIdx = idx + 1;
      if (nextIdx < plan.length) {
        setPendingBlast({ plan, isLive, idx: nextIdx });
      } else {
        setPendingBlast(null);
        addLog("AUTO ▶ All batches reviewed.", "info");
      }
    }, [pendingBlast, addLog]);

    // ── AUTO CHAIN — analyze → push GO → RFQ blast (no user interaction) ──
    const autoChain = useCallback(async (scrapedSols) => {
      const isLive       = liveModeRef.current; // capture once so analyze + blast share the same mode
      const TEST_SOL_CAP = 30; // max sols to analyze in test mode — keeps Claude calls fast
      const TEST_GO_CAP  = 3;  // max GOs to stage in test dry-run — no need to wait for 5+

      const solsToAnalyze = isLive ? scrapedSols : scrapedSols.slice(0, TEST_SOL_CAP);
      addLog("AUTO ▶ Analyzing " + solsToAnalyze.length + " sol(s)" + (isLive ? "" : " [TEST — capped at " + TEST_SOL_CAP + "]") + "…", "info");
      setAnalyzing(true);
      try {
        let results;
        try {
          results = await analyzeWithClaude(solsToAnalyze, addLog);
        } catch (claudeErr) {
          if (claudeErr.message.toLowerCase().includes("credit")) {
            addLog("AUTO ▶ Claude credits depleted — switching to local value/AMSC filter.", "info");
            results = analyzeLocal(solsToAnalyze, addLog);
          } else {
            throw claudeErr;
          }
        }
        const go = [], verify = [], reject = [];
        for (const res of results) {
          const orig = solsToAnalyze.find((s) => s.sol_number === res.sol_number) || {};
          const merged = { ...orig, ...res };
          if (res.verdict === "GO")           go.push(merged);
          else if (res.verdict === "VERIFY FIRST") verify.push(merged);
          else                                reject.push(merged);
        }
        go.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));
        verify.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));
        setAnalysis({ go, verify, reject });
        setSelected(new Set(go.map((r) => r.sol_number)));
        setBwsScores({});
        autoScoreGO(go); // fire-and-forget — demotes OEM-locked sols as scores arrive
        addLog("AUTO ▶ " + go.length + " GO · " + verify.length + " VERIFY · " + reject.length + " REJECT", "ok");

        if (go.length === 0) {
          addLog("AUTO ▶ No GO sols today.", "info");
          setAnalyzing(false);
          return;
        }

        // In test mode cap GO list — don't make them wait for a live-size batch
        const cappedGo = isLive ? go : go.slice(0, TEST_GO_CAP);
        if (!isLive && go.length > TEST_GO_CAP) {
          addLog("AUTO ▶ TEST — staging " + TEST_GO_CAP + " of " + go.length + " GO sols.", "info");
        }

        // Dry-run first — build vendor plan and surface for approval before any email fires
        const blastRecs = cappedGo.map(buildRecord);
        if (window.SCC_AUTO_RFQ) {
          addLog("AUTO ▶ Building blast plan for " + blastRecs.length + " GO sol(s)…", "info");
          window.SCC_AUTO_RFQ.runBatch(blastRecs, isLive
            ? { dryRun: true, onLog: (m) => addLog(m, "info"), onQueue: (q) => { setPNQueue(q); addLog("AUTO ▶ ⏸ Batch held — resolve part numbers in PN Queue below.", "info"); } }
            : { dryRun: true, testMode: true, onLog: (m) => addLog(m, "info"), onQueue: (q) => { setPNQueue(q); addLog("AUTO ▶ ⏸ Batch held — resolve part numbers in PN Queue below.", "info"); } })
            .then((r) => {
              if (r.dryRun && r.plan && r.plan.length > 0) {
                setPendingBlast({ plan: r.plan, isLive, idx: 0 });
                addLog("AUTO ▶ " + r.plan.length + " vendor email(s) staged — review below and approve to send.", "info");
              } else if (r.dryRun && (!r.plan || r.plan.length === 0)) {
                addLog("AUTO ▶ No vendors matched any GO sols — check rolodex FSC coverage.", "info");
              } else if (!r.queued) {
                addLog("AUTO ▶ Done.", "ok");
              }
            })
            .catch((e) => addLog("AUTO ▶ RFQ error — " + e.message, "err"));
        }
      } catch (e) {
        addLog("AUTO ▶ Analysis failed: " + e.message, "err");
      }
      setAnalyzing(false);
    }, [addLog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── AN/MS 30-DAY SWEEP ────────────────────────────────────────────────
    const runAnMsSweep = useCallback(async () => {
      if (anmsSweeping || running) return;
      setAnmsSweeping(true);
      setLog([]);
      setAnalysis(null);
      setSelected(new Set());

      addLog("AN/MS Sweep — checking agent…", "info");
      try {
        const hRes = await fetch(AGENT_URL + "/health", { signal: AbortSignal.timeout(4000) });
        const hData = await hRes.json();
        if (!hData.ok) throw new Error("Agent not ready");
        addLog("Agent online ✓", "ok");
      } catch {
        addLog("Agent offline — start the agent first.", "err");
        setAnmsSweeping(false);
        return;
      }

      addLog("Launching 30-day AN + MS sweep…", "info");
      try {
        const resp = await fetch(AGENT_URL + "/navigator/anms-sweep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(900000),
        });

        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("event-stream")) {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const evt = JSON.parse(payload);
                if (evt.type === "log") addLog(evt.msg, evt.level || "info");
                if (evt.type === "result") {
                  if (evt.ok && Array.isArray(evt.sols)) {
                    const sd = new Date().toLocaleString();
                    const prevSols = storeLoad().sols || [];
                    const mergedMap = new Map(prevSols.map(s => [s.sol_number, s]));
                    for (const s of evt.sols) if (!mergedMap.has(s.sol_number)) mergedMap.set(s.sol_number, s);
                    const merged = Array.from(mergedMap.values());
                    setSols(merged);
                    setScrapeDate(sd);
                    storeSave({ mode: modeRef.current, sols: merged, scrapeDate: sd, analysis: null });
                    addLog("✓ AN/MS sweep: " + evt.an + " AN · " + evt.ms + " MS · " + evt.count + " total — analyzing…", "ok");
                    await autoChain(evt.sols);
                  } else {
                    addLog("Sweep failed: " + (evt.error || "unknown"), "err");
                  }
                }
              } catch {}
            }
          }
        } else {
          const data = await resp.json();
          if (data.ok && Array.isArray(data.sols)) {
            const sd = new Date().toLocaleString();
            const prevSols = storeLoad().sols || [];
            const mergedMap = new Map(prevSols.map(s => [s.sol_number, s]));
            for (const s of data.sols) if (!mergedMap.has(s.sol_number)) mergedMap.set(s.sol_number, s);
            const merged = Array.from(mergedMap.values());
            setSols(merged);
            setScrapeDate(sd);
            storeSave({ mode: modeRef.current, sols: merged, scrapeDate: sd, analysis: null });
            addLog("✓ AN/MS sweep: " + data.an + " AN · " + data.ms + " MS · " + data.count + " total — analyzing…", "ok");
            await autoChain(data.sols);
          } else {
            addLog("Sweep failed: " + (data.error || "unknown"), "err");
          }
        }
      } catch (e) {
        addLog("Sweep error: " + e.message, "err");
      }

      setAnmsSweeping(false);
    }, [anmsSweeping, running, addLog, setTab]); // eslint-disable-line react-hooks/exhaustive-deps

    const runScrape = useCallback(async () => {
      if (running) return;
      setRunning(true);
      abortRef.current = false;
      setLog([]);
      setSols([]);
      setAnalysis(null);
      setSelected(new Set());
      setPushLog([]);
      setBlastPlan(null);
      setBlastView(false);
      setAnalyzeErr("");

      addLog("Checking agent…", "info");

      // Health check
      try {
        const hRes = await fetch(AGENT_URL + "/health", {
          signal: AbortSignal.timeout(4000),
        });
        const hData = await hRes.json();
        if (!hData.ok) throw new Error("Agent not ready");
        setAgentAlive(true);
        addLog("Agent online ✓", "ok");
      } catch (e) {
        setAgentAlive(false);
        addLog("Agent offline — run start-agent.bat on your PC first, then try again.", "err");
        addLog("Tip: drop start-agent.bat into your Windows Startup folder to auto-launch on boot.", "info");
        setRunning(false);
        return;
      }

      addLog("Triggering Navigator scrape…", "info");

      try {
        // SSE stream — agent sends progress lines then final JSON
        const resp = await fetch(AGENT_URL + "/navigator/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stream: true, ...(modeRef.current === "auto" && !liveModeRef.current ? { testMode: true, maxSols: 40 } : {}) }),
          signal: AbortSignal.timeout(300000), // 5 min max
        });

        if (!resp.ok) {
          throw new Error("Agent returned " + resp.status);
        }

        const contentType = resp.headers.get("content-type") || "";

        // ── Streaming path (text/event-stream) ──
        if (contentType.includes("event-stream")) {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const evt = JSON.parse(payload);
                if (evt.type === "log") addLog(evt.msg, evt.level || "info");
                if (evt.type === "result") {
                  if (evt.ok && Array.isArray(evt.sols)) {
                    const sd = new Date().toLocaleString();
                    setSols(evt.sols);
                    setScrapeDate(sd);
                    storeSave({ mode: modeRef.current, sols: evt.sols, scrapeDate: sd, analysis: null });
                    if (modeRef.current === "auto") {
                      await autoChain(evt.sols);
                    } else {
                      localStorage.removeItem("scc_auto_analyzed");
                      addLog("✓ Scraped " + evt.sols.length + " sols — heading to Screener…", "ok");
                      setTimeout(() => setTab && setTab("screener"), 1200);
                    }
                  } else {
                    addLog("Scrape failed: " + (evt.error || "unknown"), "err");
                  }
                }
              } catch {}
            }
          }
        } else {
          // ── Non-streaming fallback (plain JSON) ──
          const data = await resp.json();
          if (data.ok && Array.isArray(data.sols)) {
            data.sols.forEach((msg) => addLog(msg, "info"));
            const sd = new Date().toLocaleString();
            setSols(data.sols);
            setScrapeDate(sd);
            storeSave({ mode: modeRef.current, sols: data.sols, scrapeDate: sd, analysis: null });
            if (modeRef.current === "auto") {
              await autoChain(data.sols);
            } else {
              localStorage.removeItem("scc_auto_analyzed");
              addLog("✓ Scraped " + data.sols.length + " sols — heading to Screener…", "ok");
              setTimeout(() => setTab && setTab("screener"), 1200);
            }
          } else {
            addLog("Scrape failed: " + (data.error || "unknown"), "err");
          }
        }
      } catch (e) {
        addLog("Error: " + e.message, "err");
      }

      setRunning(false);
    }, [running, addLog]);

    // ── AUTO NSN SCORE — runs after analysis, scores all GO NSNs in background ──
    // Catches OEM lock-in, low demand, and sole-source signals that AMSC alone misses.
    const autoScoreGO = useCallback(async (goSols) => {
      const fetchFn = window.SCC_TABS && window.SCC_TABS.fetchAwardHistory;
      const scoreFn = window.SCC_TABS && window.SCC_TABS.calcNSNScore;
      if (!fetchFn || !scoreFn) return;

      const nsns = [...new Set(goSols.map((s) => s.nsn).filter(Boolean))];
      if (!nsns.length) return;

      setBwsLoading(true);
      const results = {};

      await Promise.all(
        nsns.map((nsn, i) =>
          new Promise((res) =>
            setTimeout(async () => {
              try {
                // Check localStorage cache first (6h TTL)
                const cacheKey = "scc_bws_" + nsn.replace(/-/g, "");
                const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
                const BWS_TTL = 6 * 60 * 60 * 1000;
                if (cached && cached.score != null && Date.now() - cached.ts < BWS_TTL) {
                  results[nsn] = { score: cached.score, label: cached.label, color: cached.color };
                  setBwsScores((prev) => ({ ...prev, [nsn]: results[nsn] }));
                  return res();
                }
                const { results: awards } = await fetchFn(nsn);
                const s = scoreFn(awards, "");
                const entry = { score: s.score, label: s.label, color: s.color };
                results[nsn] = entry;
                try { localStorage.setItem(cacheKey, JSON.stringify({ ...entry, ts: Date.now() })); } catch (_) {}
                setBwsScores((prev) => ({ ...prev, [nsn]: entry }));
              } catch (_) {}
              res();
            }, i * 160)
          )
        )
      );

      setBwsLoading(false);
    }, []);

    // ── ANALYZE ───────────────────────────────────────────────────────
    const runAnalysis = useCallback(async () => {
      if (!sols.length || analyzing) return;
      setAnalyzing(true);
      setAnalyzeErr("");
      setAnalysis(null);
      setSelected(new Set());
      setPushLog([]);

      try {
        let results;
        try {
          results = await analyzeWithClaude(sols, addLog);
        } catch (claudeErr) {
          const isCredits = claudeErr.message.toLowerCase().includes("credit");
          if (isCredits) {
            addLog("Claude credits depleted — switching to local value/AMSC filter.", "info");
            results = analyzeLocal(sols, addLog);
          } else {
            throw claudeErr;
          }
        }

        const go = [];
        const verify = [];
        const reject = [];

        for (const res of results) {
          const original = sols.find((s) => s.sol_number === res.sol_number) || {};
          const merged = { ...original, ...res };
          if (res.verdict === "GO") go.push(merged);
          else if (res.verdict === "VERIFY FIRST") verify.push(merged);
          else reject.push(merged);
        }

        go.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));
        verify.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));

        setAnalysis({ go, verify, reject });
        setSelected(new Set(go.map((r) => r.sol_number)));
        setResultTab("GO");
        setBwsScores({});
        autoScoreGO(go); // fire-and-forget background scoring
        toast_(`Analysis complete — ${go.length} GO · ${verify.length} VERIFY · ${reject.length} REJECT`);
      } catch (e) {
        setAnalyzeErr(e.message);
        toast_("Analysis failed: " + e.message, true);
      }

      setAnalyzing(false);
    }, [sols, analyzing, toast_, addLog]);

    // ── PUSH TO PIPELINE ──────────────────────────────────────────────
    const pushToPipeline = useCallback(async () => {
      if (!selected.size || !analysis) return;
      const { dbSave, dbGetAll } = window.SCC_DB;
      const existing = await dbGetAll();
      const existingSet = new Set(existing.map((r) => r.sol_number));

      setPushing(true);
      const log_ = [];
      const allRecs = [...analysis.go, ...analysis.verify];

      const savedRecords = [];
      for (const rec of allRecs) {
        if (!selected.has(rec.sol_number)) continue;
        if (existingSet.has(rec.sol_number)) {
          log_.push({ sol: rec.sol_number, status: "skip", note: "already exists" });
          continue;
        }
        try {
          const built = buildRecord(rec);
          await dbSave(built);
          savedRecords.push(built);
          log_.push({ sol: rec.sol_number, status: "saved", note: rec.verdict });
        } catch (e) {
          log_.push({ sol: rec.sol_number, status: "err", note: e.message });
        }
      }

      // NSN watch — register every pushed NSN to MongoDB for Railway agent to check
      try {
        const today = new Date().toISOString().slice(0, 10);
        const watchItems = savedRecords
          .filter(r => r.nsn)
          .map(r => ({
            nsn:            r.nsn,
            fsc:            r.fsc,
            item_name:      r.item_name,
            sol_number:     r.sol_number,
            last_unit_price: parseFloat(r.unit_price) || null,
            date_added:     today,
          }));
        if (watchItems.length) {
          fetch("/.netlify/functions/scc-nsn-watch", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ action: "nsnWatchUpsert", payload: { items: watchItems } }),
          }).catch(() => {});
        }
      } catch {}

      setPushLog(log_);
      setPushing(false);
      const saved_ = log_.filter((l) => l.status === "saved").length;
      const skips  = log_.filter((l) => l.status === "skip").length;
      toast_(
        "Pushed " + saved_ + " sols to pipeline" + (skips ? " · " + skips + " skipped (duplicate)" : "") + " · NSNs added to watch",
      );
      window.dispatchEvent(new CustomEvent("scc:pipeline:reload"));
    }, [selected, analysis, toast_]);

    // ── MANUAL BLAST GO ───────────────────────────────────────────────
    // Fires RFQ blast from current GO analysis without pushing to pipeline.
    // Pipeline stays clean until vendor quote arrives — same hygiene as AUTO mode.
    const blastGO = useCallback(async () => {
      if (!analysis || !analysis.go.length || blasting) return;
      const recs = analysis.go.map(buildRecord);
      const isLive = liveModeRef.current;
      setBlasting(true);
      addLog("BLAST ▶ " + recs.length + " GO sols → " + (isLive ? "real vendors [LIVE]" : "test inbox [TEST]") + "…", "info");
      const queueHandler = (q) => { setPNQueue(q); addLog("BLAST ▶ ⏸ Batch held — resolve part numbers in PN Queue below.", "info"); };
      try {
        const r = await window.SCC_AUTO_RFQ.runBatch(recs, isLive
          ? { onLog: (m) => addLog(m, "info"), onQueue: queueHandler }
          : { testMode: true, onLog: (m) => addLog(m, "info"), onQueue: queueHandler });
        if (!r.queued) {
          addLog("BLAST ▶ Done. Check blast log for details.", "ok");
          refreshBlastLog();
          setShowBlastLog(true);
        }
      } catch (e) {
        addLog("BLAST ▶ Error: " + e.message, "err");
      }
      setBlasting(false);
    }, [analysis, blasting, addLog, refreshBlastLog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── BUILD BLAST PLAN ──────────────────────────────────────────────
    const buildBlast = useCallback(() => {
      if (!analysis) return;
      const goSols = analysis.go.filter((r) => selected.has(r.sol_number));
      if (!goSols.length) {
        toast_("Select GO sols first.");
        return;
      }

      const SCC_DIST = window.SCC_DIST;
      if (!SCC_DIST) {
        toast_("Distributor DB not loaded.", true);
        return;
      }

      // Group sols by FSC
      const byFSC = {};
      for (const sol of goSols) {
        const fsc = sol.fsc || "0000";
        if (!byFSC[fsc]) byFSC[fsc] = [];
        byFSC[fsc].push(sol);
      }

      // For each FSC, get matching distributors
      const plan = {};
      for (const [fsc, fscSols] of Object.entries(byFSC)) {
        const dists = SCC_DIST.getDistsByFSC(fsc).slice(0, 5); // top 5
        plan[fsc] = { sols: fscSols, dists };
      }

      setBlastPlan(plan);
      setBlastView(true);
    }, [analysis, selected, toast_]);

    // ── STYLES ────────────────────────────────────────────────────────
    const S = {
      card: {
        background: "var(--card-bg)",
        border: "1px solid rgba(201,168,76,.12)",
        padding: "18px 20px",
        marginBottom: "14px",
      },
      cardTitle: {
        fontFamily: "Cinzel,serif",
        fontSize: "11px",
        letterSpacing: ".14em",
        color: "var(--gold-solid)",
        textTransform: "uppercase",
        marginBottom: "12px",
      },
      btn: (color = "var(--gold-solid)", bg = "transparent") => ({
        fontFamily: "Cinzel,serif",
        fontSize: "10px",
        letterSpacing: ".1em",
        textTransform: "uppercase",
        padding: "8px 18px",
        border: "1px solid " + color,
        background: bg,
        color: color,
        cursor: "pointer",
        transition: "all .15s",
        whiteSpace: "nowrap",
      }),
      mono: {
        fontFamily: "JetBrains Mono,monospace",
        fontSize: "11px",
      },
    };

    // ── RENDER ────────────────────────────────────────────────────────
    return h(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },

      // ── HEADER ──
      h(
        "div",
        { className: "pipe-header" },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h("div", { className: "pipe-title" }, "DIBBS Daily"),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14px",
                fontStyle: "italic",
                color: "var(--body-faint)",
              },
            },
            "Navigator → Analyze → Pipeline → Blast",
          ),
        ),
        // Agent status pill + restart button
        h(
          "div",
          { style: { display: "flex", gap: "6px", alignItems: "center" } },
          h(
            "div",
            {
              style: {
                ...S.mono,
                fontSize: "10px",
                color:
                  agentAlive === true
                    ? "var(--accent-green)"
                    : agentAlive === false
                      ? "#e74c3c"
                      : "var(--body-faint)",
                padding: "4px 12px",
                border:
                  "1px solid " +
                  (agentAlive === true
                    ? "rgba(61,214,140,.3)"
                    : agentAlive === false
                      ? "rgba(231,76,60,.3)"
                      : "rgba(201,168,76,.12)"),
                cursor: "pointer",
              },
              onClick: checkAgent,
              title: "Click to recheck agent",
            },
            agentAlive === true
              ? "● Agent Online"
              : agentAlive === false
                ? "● Agent Offline"
                : "● Checking…",
          ),
          agentAlive === false &&
            h("button", {
              title: "Start the DIBBS agent",
              style: {
                ...S.mono, fontSize: "10px",
                background: "rgba(231,76,60,.1)",
                border: "1px solid rgba(231,76,60,.35)",
                color: "#e74c3c", padding: "4px 12px", cursor: "pointer",
              },
              onClick: async () => {
                try {
                  const r = await fetch("http://127.0.0.1:3101/start", { method: "POST" });
                  if (!r.ok) throw new Error("launcher returned " + r.status);
                  toast_("Agent starting…");
                  setTimeout(checkAgent, 3000);
                } catch (e) {
                  toast_("Could not reach launcher (port 3101). Run agent-launcher.js first.", true);
                }
              },
            }, "▶ Start Agent"),
          agentAlive === true &&
            h("button", {
              title: "Restart agent (picks up .env changes)",
              style: {
                ...S.mono, fontSize: "10px",
                background: "transparent",
                border: "1px solid rgba(61,214,140,.25)",
                color: "rgba(61,214,140,.6)",
                padding: "4px 10px", cursor: "pointer",
              },
              onClick: async () => {
                try {
                  await fetch(AGENT_URL + "/restart", { method: "POST" });
                  setAgentAlive(null);
                  toast_("Agent restarting…");
                  setTimeout(checkAgent, 3000);
                } catch (e) {
                  toast_("Restart failed: " + e.message, true);
                }
              },
            }, "↺ Restart"),
        ),
      ),

      // ── CONTROL PANEL ──
      h(
        "div",
        { style: S.card },
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "12px",
              alignItems: "center",
              flexWrap: "wrap",
            },
          },

          // Mode toggle
          h(
            "div",
            {
              style: {
                display: "flex",
                border: "1px solid rgba(201,168,76,.2)",
                overflow: "hidden",
              },
            },
            ["manual", "auto"].map((m) =>
              h(
                "button",
                {
                  key: m,
                  onClick: () => setMode(m),
                  style: {
                    ...S.btn(
                      mode === m ? "#111" : "var(--body-faint)",
                      mode === m ? "var(--gold-solid)" : "transparent",
                    ),
                    border: "none",
                    padding: "7px 16px",
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".12em",
                  },
                },
                m.toUpperCase(),
              ),
            ),
          ),

          // Vendors-per-FSC cap control
          h("div", {
            style: { display: "flex", alignItems: "center", gap: "6px" },
            title: "Max vendors emailed per FSC lane. Raise if you want broader coverage from one company.",
          },
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "rgba(245,240,232,.3)", letterSpacing: ".08em", textTransform: "uppercase" } }, "Cap/FSC"),
            h("input", {
              type: "number", min: 1, max: 20, value: blastCapPerFsc,
              onChange: e => setBlastCapPerFsc(Math.max(1, parseInt(e.target.value) || 1)),
              style: {
                width: "46px", textAlign: "center", padding: "5px 4px",
                fontFamily: "JetBrains Mono,monospace", fontSize: "12px",
                background: "rgba(201,168,76,.08)", color: "rgba(201,168,76,.9)",
                border: "1px solid rgba(201,168,76,.3)", borderRadius: "3px",
                outline: "none",
              },
            }),
          ),

          // LIVE toggle — OFF = test emails only, ON = real vendor blast
          h(
            "button",
            {
              onClick: () => {
                if (!liveMode) {
                  if (!window.confirm("Enable LIVE mode?\n\nAUTO and MANUAL blasts will send real emails to real vendors. Make sure your distributor list and email templates are verified first.")) return;
                  setLiveMode(true);
                } else {
                  setLiveMode(false);
                }
              },
              title: liveMode ? "LIVE — real vendor emails. Click to switch to test-only." : "TEST ONLY — emails go to tu2kel.lg@gmail.com. Click to go live.",
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".12em",
                textTransform: "uppercase",
                padding: "7px 16px",
                border: liveMode ? "1px solid rgba(231,76,60,.7)" : "1px solid rgba(245,158,11,.5)",
                background: liveMode ? "rgba(231,76,60,.12)" : "rgba(245,158,11,.08)",
                color: liveMode ? "#e74c3c" : "rgba(245,158,11,.9)",
                cursor: "pointer",
                transition: "all .15s",
              },
            },
            liveMode ? "● LIVE" : "○ TEST ONLY",
          ),

          // Run button
          h(
            "button",
            {
              onClick: runScrape,
              disabled: running,
              style: {
                ...S.btn(
                  "var(--accent-green)",
                  running ? "rgba(61,214,140,.06)" : "rgba(61,214,140,.1)",
                ),
                border: "1px solid rgba(61,214,140,.4)",
                opacity: running ? 0.7 : 1,
                fontSize: "11px",
                fontFamily: "Cinzel,serif",
                letterSpacing: ".1em",
              },
            },
            running ? "⟳ Running…" : "▶ Run Batch",
          ),

          // Test blast — fires immediately from existing GO sols, no re-scrape
          h(
            "button",
            {
              onClick: () => {
                if (!analysis || !analysis.go || !analysis.go.length) {
                  toast_("Run a batch first — no GO sols loaded yet.", true);
                  return;
                }
                const testRecs = analysis.go.slice(0, 10).map(buildRecord);
                addLog("TEST ▶ Blasting " + testRecs.length + " GO sols → tu2kel.lg@gmail.com…", "info");
                if (window.SCC_AUTO_RFQ) {
                  window.SCC_AUTO_RFQ.runBatch(testRecs, {
                    testMode: true,
                    onLog: (m) => addLog(m, "info"),
                    onQueue: (q) => { setPNQueue(q); addLog("TEST ▶ ⏸ Batch held — resolve part numbers in PN Queue below.", "info"); },
                  })
                    .then((r) => { if (!r.queued) { addLog("TEST ▶ Done — check tu2kel.lg@gmail.com", "ok"); refreshBlastLog(); setShowBlastLog(true); } })
                    .catch((e) => addLog("TEST ▶ Error — " + e.message, "err"));
                }
              },
              disabled: !analysis || !analysis.go || !analysis.go.length,
              title: "Fire test blast from current GO sols → tu2kel.lg@gmail.com (no re-scrape)",
              style: {
                ...S.btn("rgba(245,158,11,.6)", "transparent"),
                border: "1px solid rgba(245,158,11,.25)",
                fontSize: "9px",
                fontFamily: "Cinzel,serif",
                letterSpacing: ".1em",
                padding: "7px 14px",
                opacity: (!analysis || !analysis.go || !analysis.go.length) ? 0.4 : 1,
              },
            },
            "TEST",
          ),

          // AN/MS 30-day sweep button
          h(
            "button",
            {
              onClick: runAnMsSweep,
              disabled: anmsSweeping || running,
              title: "30-day sweep for Piece Part No AN and MS — runs once, routes to Screener for manual review",
              style: {
                ...S.btn("var(--gold-dim)", "transparent"),
                border: "1px solid rgba(201,168,76,.25)",
                fontSize: "9px",
                fontFamily: "Cinzel,serif",
                letterSpacing: ".1em",
                padding: "7px 14px",
                opacity: (anmsSweeping || running) ? 0.5 : 1,
              },
            },
            anmsSweeping ? "⟳ AN/MS…" : "AN/MS SWEEP",
          ),

          // Last scrape timestamp
          scrapeDate &&
            h(
              "span",
              {
                style: {
                  ...S.mono,
                  fontSize: "10px",
                  color: "var(--body-faint)",
                },
              },
              "Last: " + scrapeDate,
            ),

          // Clear batch button — resets sols + analysis so a fresh run starts clean
          (sols.length > 0 || analysis) &&
            h(
              "button",
              {
                onClick: () => {
                  setSols([]);
                  setAnalysis(null);
                  setScrapeDate("");
                  setSelected(new Set());
                  setPushLog([]);
                  setLog([]);
                  storeSave({ mode, sols: [], scrapeDate: "", analysis: null });
                },
                style: {
                  ...S.mono,
                  fontSize: "10px",
                  background: "transparent",
                  border: "1px solid rgba(231,76,60,.3)",
                  color: "rgba(231,76,60,.7)",
                  padding: "4px 10px",
                  borderRadius: "3px",
                  cursor: "pointer",
                },
              },
              "✕ Clear Batch",
            ),
        ),

      ),

      // ── PN QUEUE PANEL ──
      pnQueue && window.SCC_TABS && window.SCC_TABS.PNQueuePanel &&
        h(window.SCC_TABS.PNQueuePanel, {
          queue:     pnQueue,
          onRelease: handleQueueRelease,
          onDismiss: () => {
            if (window.SCC_AUTO_RFQ) window.SCC_AUTO_RFQ.clearPNQueue();
            setPNQueue(null);
            toast_("PN Queue discarded.");
          },
        }),

      // ── RIGHT-SIDE BRIEF DRAWER ──────────────────────────────────────────
      h("div", {
        style: {
          position: "fixed",
          top: 0,
          right: 0,
          width: pendingBlast ? "1140px" : "0px",
          height: "100vh",
          zIndex: 9000,
          transition: "width .32s cubic-bezier(.4,0,.2,1)",
          overflow: "hidden",
          boxShadow: pendingBlast ? "-8px 0 48px rgba(0,0,0,.7), -1px 0 0 rgba(201,168,76,.15)" : "none",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(160deg, rgba(12,9,5,1) 0%, rgba(18,14,8,1) 100%)",
        },
      },
        pendingBlast && h("div", {
          style: {
            width: "1140px",
            height: "100vh",
            overflowY: "auto",
            overflowX: "hidden",
            display: "flex",
            flexDirection: "column",
          },
        },
          h(PendingBlastPanel, {
            entry:      pendingBlast.plan[pendingBlast.idx],
            idx:        pendingBlast.idx,
            total:      pendingBlast.plan.length,
            isLive:     pendingBlast.isLive,
            sending:    blasting,
            selectedCount: selected.size,
            onSend:     handleSendOneBatch,
            onSkip:     handleSkipBatch,
            onBlastAll: handleBlastAll,
            onPipeline: pushToPipeline,
            onCancel:   () => { setPendingBlast(null); addLog("AUTO ▶ Remaining batches cancelled.", "info"); },
            onGoLive:   () => {
              if (!window.confirm("Switch this batch to LIVE?\n\nAll remaining sends will go to real vendor emails. This cannot be undone for emails already sent.")) return;
              setPendingBlast(function (p) {
                // Rewrite entry.to on every plan entry to the vendor's real email
                var newPlan = p.plan.map(function (e) {
                  return Object.assign({}, e, { to: e.dist.email || e.to });
                });
                return Object.assign({}, p, { isLive: true, plan: newPlan });
              });
              setLiveMode(true);
              addLog("⬤ Switched to LIVE — remaining batches will send to real vendors.", "warn");
            },
          }),
        ),
      ),

      // ── LIVE LOG ──
      log.length > 0 &&
        h(
          "div",
          {
            style: {
              ...S.card,
              padding: "12px 16px",
              maxHeight: "180px",
              overflowY: "auto",
              background: "rgba(0,0,0,.45)",
            },
          },
          h(
            "div",
            { style: { ...S.cardTitle, marginBottom: "8px" } },
            analyzing ? "⟳ Analyzing…" : "Log",
          ),
          ...log.map((entry, i) =>
            h(
              "div",
              {
                key: i,
                style: {
                  ...S.mono,
                  fontSize: "10px",
                  padding: "1px 0",
                  color:
                    entry.type === "ok"
                      ? "var(--accent-green)"
                      : entry.type === "err"
                        ? "#e74c3c"
                        : "var(--body-dim)",
                },
              },
              entry.line,
            ),
          ),
        ),

      // ── RAW RESULTS TABLE ──
      sols.length > 0 &&
        h(
          "div",
          { style: S.card },
          h(
            "div",
            {
              style: {
                ...S.cardTitle,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              },
            },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "10px" } },
              h("span", null, "Raw Results — " + sols.length + " sols"),
              h(
                "div",
                {
                  style: {
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                  },
                },
                h("input", {
                  type: "text",
                  placeholder: "Search FSC, item, sol#, NSN…",
                  value: rawSearch,
                  onChange: (e) => {
                    setRawSearch(e.target.value);
                    if (e.target.value) setRawExpanded(true);
                  },
                  style: {
                    background: "var(--inset-bg)",
                    border: "1px solid rgba(201,168,76,.2)",
                    color: "var(--alabaster)",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "10px",
                    padding: "4px 24px 4px 8px",
                    width: "180px",
                    outline: "none",
                  },
                }),
                rawSearch &&
                  h(
                    "button",
                    {
                      onClick: () => setRawSearch(""),
                      style: {
                        position: "absolute",
                        right: "6px",
                        background: "none",
                        border: "none",
                        color: "rgba(201,168,76,.6)",
                        cursor: "pointer",
                        fontSize: "12px",
                        lineHeight: 1,
                        padding: 0,
                      },
                    },
                    "×",
                  ),
              ),
            ),
            h(
              "div",
              { style: { display: "flex", gap: "8px" } },
              h(
                "button",
                {
                  onClick: () => setRawExpanded((e) => !e),
                  style: { ...S.btn(), padding: "4px 12px", fontSize: "9px" },
                },
                rawExpanded ? "Collapse" : "Expand",
              ),
              h(
                "button",
                {
                  onClick: () => setTab && setTab("screener"),
                  style: {
                    ...S.btn("var(--accent-green)", "rgba(61,214,140,.08)"),
                    border: "1px solid rgba(61,214,140,.3)",
                    fontSize: "9px", padding: "4px 14px",
                  },
                },
                "→ Screener",
              ),
            ),
          ),

          rawExpanded &&
            h(
              "div",
              { style: { overflowX: "auto" } },
              h(
                "table",
                {
                  style: {
                    width: "100%",
                    borderCollapse: "collapse",
                    ...S.mono,
                    fontSize: "10px",
                  },
                },
                h(
                  "thead",
                  null,
                  h(
                    "tr",
                    null,
                    ...[
                      "",
                      "Sol Number",
                      "NSN",
                      "FSC",
                      "Item",
                      "Qty",
                      "Unit $",
                      "Ext $",
                      "Quote Due",
                      "Set-Aside",
                    ].map((col) =>
                      h(
                        "th",
                        {
                          key: col,
                          style: {
                            textAlign: "left",
                            padding: "5px 10px",
                            fontFamily: "Cinzel,serif",
                            fontSize: "8px",
                            letterSpacing: ".1em",
                            textTransform: "uppercase",
                            color: "var(--gold-dim)",
                            borderBottom: "1px solid rgba(201,168,76,.12)",
                            whiteSpace: "nowrap",
                          },
                        },
                        col,
                      ),
                    ),
                  ),
                ),
                h(
                  "tbody",
                  null,
                  ...sols
                    .filter(
                      (s) =>
                        !rawSearch ||
                        Object.values(s).some((v) =>
                          String(v || "")
                            .toLowerCase()
                            .includes(rawSearch.toLowerCase()),
                        ),
                    )
                    .map((s, i) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const due = s.quote_due ? new Date(s.quote_due) : null;
                      const isDueToday =
                        due && due.toDateString() === today.toDateString();
                      const isPastDue = due && due < today;
                      const rowBg = isDueToday
                        ? "rgba(255,200,0,.1)"
                        : isPastDue
                          ? "rgba(231,76,60,.07)"
                          : i % 2 === 0
                            ? "transparent"
                            : "rgba(255,255,255,.02)";
                      return h(
                        "tr",
                        {
                          key: s.sol_number,
                          style: { background: rowBg },
                        },
                        h(
                          "td",
                          { style: { padding: "2px 6px", width: "24px" } },
                          h(
                            "button",
                            {
                              onClick: (e) => {
                                e.stopPropagation();
                                setSols((prev) =>
                                  prev.filter(
                                    (r) => r.sol_number !== s.sol_number,
                                  ),
                                );
                              },
                              title: "Remove from batch",
                              style: {
                                background: "none",
                                border: "none",
                                color: "rgba(231,76,60,.5)",
                                cursor: "pointer",
                                fontSize: "14px",
                                lineHeight: 1,
                                padding: 0,
                              },
                            },
                            "×",
                          ),
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--gold-dim)",
                              whiteSpace: "nowrap",
                            },
                          },
                          h(
                            "a",
                            {
                              href:
                                "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=" +
                                s.sol_number,
                              target: "_blank",
                              rel: "noopener noreferrer",
                              style: {
                                color: "var(--gold-solid)",
                                textDecoration: "none",
                              },
                            },
                            s.sol_number,
                          ),
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--body-dim)",
                            },
                          },
                          s.nsn || "—",
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--body-dim)",
                            },
                          },
                          s.fsc || "—",
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--alabaster)",
                              maxWidth: "240px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            },
                          },
                          s.item_name || "—",
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--body-dim)",
                              whiteSpace: "nowrap",
                            },
                          },
                          s.qty
                            ? s.qty + (s.unit_issue ? " " + s.unit_issue : "")
                            : "—",
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--body-dim)",
                              whiteSpace: "nowrap",
                            },
                          },
                          fmtD(s.unit_price),
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--accent-yellow)",
                              whiteSpace: "nowrap",
                            },
                          },
                          fmtD(s.ext_price),
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--body-faint)",
                              whiteSpace: "nowrap",
                            },
                          },
                          s.quote_due || "—",
                        ),
                        h(
                          "td",
                          {
                            style: {
                              padding: "5px 10px",
                              color: "var(--body-faint)",
                            },
                          },
                          s.set_aside || "—",
                        ),
                      );
                    }),
                ),
              ),
            ),

          !rawExpanded &&
            h(
              "div",
              {
                style: {
                  ...S.mono,
                  fontSize: "10px",
                  color: "var(--body-faint)",
                  padding: "4px 0",
                },
              },
              "Click Expand to view table · " +
                (analysis
                  ? "Analysis complete — see results below"
                  : "Click Analyze to triage"),
            ),

          analyzeErr &&
            h(
              "div",
              {
                style: {
                  ...S.mono,
                  fontSize: "10px",
                  color: "#e74c3c",
                  marginTop: "8px",
                },
              },
              "⚠ " + analyzeErr,
            ),
        ),

      // ── ANALYSIS RESULTS ──
      analysis &&
        h(
          "div",
          null,

          // ── Result summary banner ──
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "24px",
                padding: "14px 20px",
                marginBottom: "12px",
                background: "rgba(61,214,140,.06)",
                border: "1px solid rgba(61,214,140,.25)",
                borderRadius: "4px",
              },
            },
            h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", letterSpacing: ".1em", color: "var(--accent-green)" } }, "✓ ANALYSIS COMPLETE"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "12px", color: "var(--accent-green)" } }, analysis.go.length + " GO"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "12px", color: "var(--accent-yellow)" } }, analysis.verify.length + " VERIFY"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "12px", color: "#e74c3c" } }, analysis.reject.length + " REJECT"),
            mode === "auto"
              ? h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: liveMode ? "var(--accent-green)" : "rgba(245,158,11,.9)", marginLeft: "auto" } },
                  liveMode ? "✓ AUTO complete — RFQs blasted to vendors · pipeline clear until quotes arrive"
                            : "✓ AUTO complete — TEST only · emails → tu2kel.lg@gmail.com · flip to LIVE when ready")
              : h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px", color: "var(--body-faint)", marginLeft: "auto" } }, "Select sols below → Push to Pipeline → RFQ Blast"),
          ),

          // Bucket tabs + action bar
          h(
            "div",
            {
              style: {
                display: "flex",
                gap: "1px",
                marginBottom: "12px",
                flexWrap: "wrap",
                alignItems: "center",
              },
            },
            // Bucket tabs
            ...[
              {
                id: "GO",
                color: "var(--accent-green)",
                count: analysis.go.length,
              },
              {
                id: "VERIFY FIRST",
                color: "var(--accent-yellow)",
                count: analysis.verify.length,
              },
              { id: "REJECT", color: "#e74c3c", count: analysis.reject.length },
            ].map((b) =>
              h(
                "button",
                {
                  key: b.id,
                  onClick: () => setResultTab(b.id),
                  style: {
                    ...S.btn(
                      b.color,
                      resultTab === b.id
                        ? "rgba(201,168,76,.06)"
                        : "transparent",
                    ),
                    border:
                      "1px solid " +
                      (resultTab === b.id ? b.color : "rgba(201,168,76,.1)"),
                  },
                },
                b.id + " (" + b.count + ")",
              ),
            ),

            h("div", { style: { flex: 1 } }),

            // Select all / clear / push / blast — hidden in AUTO (already done)
            mode !== "auto" && resultTab !== "REJECT" &&
              h(
                "button",
                {
                  onClick: () => {
                    const recs =
                      resultTab === "GO" ? analysis.go : analysis.verify;
                    setSelected(new Set(recs.map((r) => r.sol_number)));
                  },
                  style: { ...S.btn("var(--body-dim)"), padding: "6px 14px" },
                },
                "Select All",
              ),

            mode !== "auto" && selected.size > 0 &&
              resultTab !== "REJECT" &&
              h(
                "button",
                {
                  onClick: () => setSelected(new Set()),
                  style: { ...S.btn("var(--body-faint)"), padding: "6px 14px" },
                },
                "Clear",
              ),

            // Push to pipeline
            mode !== "auto" && selected.size > 0 &&
              h(
                "button",
                {
                  onClick: pushToPipeline,
                  disabled: pushing,
                  style: {
                    ...S.btn("var(--accent-green)", "rgba(61,214,140,.1)"),
                    border: "1px solid rgba(61,214,140,.35)",
                    opacity: pushing ? 0.6 : 1,
                  },
                },
                pushing ? "Pushing…" : "→ Pipeline (" + selected.size + ")",
              ),

            // BLAST GO — sends vendor-grouped RFQs without pipeline push
            mode !== "auto" && analysis.go.length > 0 &&
              h(
                "button",
                {
                  onClick: blastGO,
                  disabled: blasting,
                  title: "Send batched RFQ emails to matched vendors — one email per vendor with all their matched items",
                  style: {
                    ...S.btn(
                      liveModeRef.current ? "#e74c3c" : "rgba(245,158,11,.9)",
                      liveModeRef.current ? "rgba(231,76,60,.1)" : "rgba(245,158,11,.08)",
                    ),
                    border: "1px solid " + (liveModeRef.current ? "rgba(231,76,60,.5)" : "rgba(245,158,11,.4)"),
                    opacity: blasting ? 0.6 : 1,
                  },
                },
                blasting ? "⟳ Blasting…" : (liveModeRef.current ? "BLAST GO [LIVE]" : "BLAST GO [TEST]") + " (" + analysis.go.length + ")",
              ),

            // Blast log toggle
            mode !== "auto" && blastLog.length > 0 &&
              h(
                "button",
                {
                  onClick: () => setShowBlastLog((v) => !v),
                  title: "View blast history",
                  style: {
                    ...S.btn("var(--body-faint)"),
                    padding: "6px 12px",
                    fontSize: "9px",
                  },
                },
                (showBlastLog ? "▲" : "▼") + " Blast Log (" + blastLog.length + ")",
              ),
          ),

          // Blast log panel
          showBlastLog && blastLog.length > 0 &&
            h(
              "div",
              {
                style: {
                  ...S.card,
                  padding: "12px 16px",
                  marginBottom: "10px",
                  maxHeight: "260px",
                  overflowY: "auto",
                  background: "rgba(0,0,0,.4)",
                  border: "1px solid rgba(201,168,76,.15)",
                },
              },
              h("div", { style: { ...S.cardTitle, marginBottom: "10px" } }, "Blast Log — " + blastLog.length + " entries"),
              ...blastLog.map((entry, i) =>
                h(
                  "div",
                  {
                    key: i,
                    style: {
                      borderBottom: "1px solid rgba(201,168,76,.07)",
                      padding: "6px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    },
                  },
                  h(
                    "div",
                    { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
                    h("span", {
                      style: {
                        ...S.mono, fontSize: "9px",
                        color: entry.sent ? "var(--accent-green)" : "#e74c3c",
                        padding: "1px 6px",
                        border: "1px solid " + (entry.sent ? "rgba(61,214,140,.3)" : "rgba(231,76,60,.3)"),
                      },
                    }, entry.sent ? "✓ SENT" : "✗ FAIL"),
                    h("span", { style: { ...S.mono, fontSize: "9px", color: entry.live ? "#e74c3c" : "rgba(245,158,11,.7)" } },
                      entry.live ? "LIVE" : "TEST"),
                    h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "10px", color: "var(--alabaster)" } },
                      entry.vendor),
                    h("span", { style: { ...S.mono, fontSize: "10px", color: "var(--gold-dim)" } },
                      entry.email),
                    h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)", marginLeft: "auto" } },
                      new Date(entry.ts).toLocaleString()),
                  ),
                  h(
                    "div",
                    { style: { ...S.mono, fontSize: "10px", color: "var(--body-dim)", paddingLeft: "4px" } },
                    entry.item_count + " item(s): " + (entry.items || entry.sol_numbers || []).slice(0, 4).join(", ") +
                    (entry.item_count > 4 ? " +" + (entry.item_count - 4) + " more" : ""),
                  ),
                  entry.match_reason &&
                    h("div", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)", paddingLeft: "4px" } },
                      "Match: " + entry.match_reason),
                  entry.error &&
                    h("div", { style: { ...S.mono, fontSize: "9px", color: "#e74c3c", paddingLeft: "4px" } },
                      "Error: " + entry.error),
                ),
              ),
            ),

          // Push log
          pushLog.length > 0 &&
            h(
              "div",
              {
                style: {
                  ...S.card,
                  padding: "10px 16px",
                  marginBottom: "10px",
                  maxHeight: "100px",
                  overflowY: "auto",
                },
              },
              ...pushLog.map((l, i) =>
                h(
                  "div",
                  {
                    key: i,
                    style: {
                      ...S.mono,
                      fontSize: "10px",
                      padding: "1px 0",
                      color:
                        l.status === "saved"
                          ? "var(--accent-green)"
                          : l.status === "err"
                            ? "#e74c3c"
                            : "var(--body-faint)",
                    },
                  },
                  (l.status === "saved"
                    ? "✓"
                    : l.status === "err"
                      ? "✗"
                      : "—") +
                    " " +
                    l.sol +
                    " — " +
                    l.note,
                ),
              ),
            ),

          // Value floor filter bar (GO tab only)
          resultTab === "GO" && h("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 14px",
              background: "rgba(201,168,76,.04)",
              border: "1px solid rgba(201,168,76,.12)",
              borderRadius: "4px",
              marginBottom: "8px",
              flexWrap: "wrap",
            },
          },
            h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em", color: "var(--gold-dim)", textTransform: "uppercase" } }, "Value Floor"),
            h("div", { style: { display: "flex", gap: "4px" } },
              ...[ [0,"All"], [500,"$500"], [1000,"$1k"], [5000,"$5k"], [10000,"$10k"] ].map(([v, label]) =>
                h("button", {
                  key: v,
                  onClick: () => setMinValue(v),
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "9px",
                    padding: "3px 8px",
                    background: minValue === v ? "rgba(201,168,76,.2)" : "transparent",
                    border: "1px solid " + (minValue === v ? "rgba(201,168,76,.5)" : "rgba(201,168,76,.15)"),
                    borderRadius: "3px",
                    color: minValue === v ? "var(--gold-solid)" : "var(--body-dim)",
                    cursor: "pointer",
                  },
                }, label)
              ),
            ),
            // Score loading indicator
            bwsLoading && h("span", {
              style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--gold-dim)", animation: "pulse 1s infinite" },
            }, "⟳ scoring…"),
            h("span", {
              style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-faint)", marginLeft: "auto" },
            },
              (() => {
                const hiddenVal   = analysis.go.filter((r) => (parseFloat(r.ext_price) || 0) < minValue).length;
                const hiddenScore = analysis.go.filter((r) => {
                  const s = bwsScores[r.nsn] || bwsScores[(r.nsn||"").replace(/-/g,"")];
                  return s && s.score < minScore;
                }).length;
                const parts = [];
                if (hiddenVal   > 0) parts.push(hiddenVal   + " below $" + minValue.toLocaleString());
                if (hiddenScore > 0) parts.push(hiddenScore + " Avoid-rated");
                return parts.length ? parts.join(" · ") + " hidden" : analysis.go.length + " sols";
              })()
            ),
          ),

          // Min score filter strip (GO tab only)
          resultTab === "GO" && h("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "6px 14px",
              background: "rgba(231,76,60,.03)",
              border: "1px solid rgba(231,76,60,.1)",
              borderRadius: "4px",
              marginBottom: "8px",
              flexWrap: "wrap",
            },
          },
            h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em", color: "rgba(232,116,116,.7)", textTransform: "uppercase" } }, "Min Score"),
            h("div", { style: { display: "flex", gap: "4px" } },
              ...[ [0,"All"], [30,"30+"], [50,"50+"], [70,"70+"] ].map(([v, label]) =>
                h("button", {
                  key: v,
                  onClick: () => setMinScore(v),
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "9px",
                    padding: "3px 8px",
                    background: minScore === v ? "rgba(232,116,116,.18)" : "transparent",
                    border: "1px solid " + (minScore === v ? "rgba(232,116,116,.45)" : "rgba(232,116,116,.15)"),
                    borderRadius: "3px",
                    color: minScore === v ? "#e87474" : "var(--body-dim)",
                    cursor: "pointer",
                  },
                }, label)
              ),
            ),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-faint)" } },
              "hides Avoid/low-demand NSNs · scores load automatically after analysis"
            ),
          ),

          // Sol rows for active bucket
          (() => {
            const allBucket = (
              resultTab === "GO"
                ? analysis.go
                : resultTab === "VERIFY FIRST"
                  ? analysis.verify
                  : analysis.reject
            );
            // Apply value floor + score floor to GO tab, then sort: Avoid-rated sinks below passing rows
            let bucketRecs = allBucket;
            if (resultTab === "GO") {
              if (minValue > 0) bucketRecs = bucketRecs.filter((r) => (parseFloat(r.ext_price) || 0) >= minValue);
              if (minScore > 0) {
                bucketRecs = bucketRecs.filter((r) => {
                  const s = bwsScores[r.nsn] || bwsScores[(r.nsn||"").replace(/-/g,"")];
                  return !s || s.score >= minScore; // keep unscored (still loading) + passing
                });
              }
              // Sort: passing score first (by value), then unscored (still loading) at bottom
              bucketRecs = [...bucketRecs].sort((a, b) => {
                const sa = bwsScores[a.nsn] || bwsScores[(a.nsn||"").replace(/-/g,"")] || null;
                const sb = bwsScores[b.nsn] || bwsScores[(b.nsn||"").replace(/-/g,"")] || null;
                const aOk = !sa || sa.score >= 30;
                const bOk = !sb || sb.score >= 30;
                if (aOk !== bOk) return aOk ? -1 : 1;
                return (parseFloat(b.ext_price) || 0) - (parseFloat(a.ext_price) || 0);
              });
            }
            const bucketColor =
              resultTab === "GO"
                ? "var(--accent-green)"
                : resultTab === "VERIFY FIRST"
                  ? "var(--accent-yellow)"
                  : "#e74c3c";

            return bucketRecs.length === 0
              ? h(
                  "div",
                  { className: "empty" },
                  "No solicitations in this bucket.",
                )
              : bucketRecs.map((rec) =>
                  h(
                    "div",
                    {
                      key: rec.sol_number,
                      style: {
                        ...S.card,
                        background: selected.has(rec.sol_number)
                          ? "rgba(61,214,140,.03)"
                          : "var(--card-bg)",
                        border:
                          "1px solid " +
                          (selected.has(rec.sol_number)
                            ? "rgba(61,214,140,.25)"
                            : "rgba(201,168,76,.1)"),
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        padding: "10px 14px",
                        cursor: resultTab !== "REJECT" ? "pointer" : "default",
                      },
                      onClick:
                        resultTab !== "REJECT"
                          ? () =>
                              setSelected((prev) => {
                                const n = new Set(prev);
                                n.has(rec.sol_number)
                                  ? n.delete(rec.sol_number)
                                  : n.add(rec.sol_number);
                                return n;
                              })
                          : undefined,
                    },
                    // Checkbox
                    resultTab !== "REJECT" &&
                      h("input", {
                        type: "checkbox",
                        checked: selected.has(rec.sol_number),
                        onChange: (e) => {
                          e.stopPropagation();
                          setSelected((prev) => {
                            const n = new Set(prev);
                            n.has(rec.sol_number)
                              ? n.delete(rec.sol_number)
                              : n.add(rec.sol_number);
                            return n;
                          });
                        },
                        onClick: (e) => e.stopPropagation(),
                        style: {
                          flexShrink: 0,
                          accentColor: "var(--gold-solid)",
                          marginTop: "2px",
                        },
                      }),

                    h(
                      "div",
                      { style: { flex: 1, minWidth: 0 } },
                      // Top line
                      h(
                        "div",
                        {
                          style: {
                            display: "flex",
                            gap: "10px",
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginBottom: "4px",
                          },
                        },
                        h(
                          "span",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "8px",
                              letterSpacing: ".1em",
                              textTransform: "uppercase",
                              color: bucketColor,
                              padding: "1px 7px",
                              border: "1px solid " + bucketColor,
                              flexShrink: 0,
                            },
                          },
                          resultTab,
                        ),
                        rec.winProbabilityPct != null &&
                          h(
                            "span",
                            {
                              style: {
                                ...S.mono,
                                fontSize: "10px",
                                color: bucketColor,
                                flexShrink: 0,
                              },
                            },
                            rec.winProbabilityPct + "%",
                          ),
                        // BWS Intel Score badge — live state (updates as autoScoreGO completes)
                        (() => {
                          if (!rec.nsn) return null;
                          const nsnKey = (rec.nsn||"").replace(/-/g, "");
                          // Live state first, localStorage fallback
                          const bws = bwsScores[rec.nsn] || bwsScores[nsnKey] || (() => {
                            try {
                              return JSON.parse(localStorage.getItem("scc_bws_" + nsnKey) || "null") ||
                                     JSON.parse(localStorage.getItem("scc_bws_" + rec.nsn) || "null");
                            } catch (_) { return null; }
                          })();
                          if (!bws || bws.score == null) return null;
                          const action = bws.score >= 70 ? "BID" : bws.score >= 45 ? "CHECK" : "SKIP";
                          return h("span", {
                            title: "Intel Score " + bws.score + "/100 — " + bws.label,
                            style: {
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "9px",
                              padding: "2px 6px",
                              background: bws.color + "18",
                              border: "1px solid " + bws.color + "45",
                              borderRadius: "3px",
                              color: bws.color,
                              flexShrink: 0,
                            },
                          },
                            h("span", { style: { fontWeight: 700, fontSize: "10px" } }, bws.score),
                            h("span", { style: { letterSpacing: ".1em", fontFamily: "Cinzel,serif", fontSize: "8px" } }, action),
                          );
                        })(),
                        h(
                          "a",
                          {
                            href:
                              "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=" +
                              rec.sol_number,
                            target: "_blank",
                            rel: "noopener noreferrer",
                            style: {
                              ...S.mono,
                              fontSize: "11px",
                              color: "var(--gold-solid)",
                              flexShrink: 0,
                              textDecoration: "none",
                            },
                            onClick: (e) => e.stopPropagation(),
                          },
                          rec.sol_number,
                        ),
                        h(
                          "span",
                          {
                            style: {
                              fontFamily: "Cormorant Garamond,serif",
                              fontSize: "13px",
                              color: "var(--alabaster)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                            },
                          },
                          rec.item_name || "—",
                        ),
                        h(
                          "span",
                          {
                            style: {
                              ...S.mono,
                              fontSize: "10px",
                              color: "var(--body-dim)",
                              flexShrink: 0,
                            },
                          },
                          "FSC " + (rec.fsc || "—"),
                        ),
                        h(
                          "span",
                          {
                            style: {
                              ...S.mono,
                              fontSize: "10px",
                              color: "var(--accent-yellow)",
                              flexShrink: 0,
                            },
                          },
                          fmtD(rec.ext_price),
                        ),
                      ),
                      // Reason
                      rec.reason &&
                        h(
                          "div",
                          {
                            style: {
                              ...S.mono,
                              fontSize: "10px",
                              color: "var(--body-dim)",
                              marginTop: "2px",
                            },
                          },
                          rec.reason,
                        ),
                      // Sourcing path
                      rec.sourcing_path &&
                        h(
                          "div",
                          {
                            style: {
                              ...S.mono,
                              fontSize: "10px",
                              color: "var(--accent-green)",
                              marginTop: "2px",
                            },
                          },
                          "↳ " + rec.sourcing_path,
                        ),
                    ),
                    h(
                      "button",
                      {
                        onClick: (e) => {
                          e.stopPropagation();
                          // Remove from analysis state directly — analysis is persisted,
                          // so this survives reload (unlike the old in-memory dismissed Set)
                          setAnalysis((prev) => ({
                            ...prev,
                            go:     prev.go.filter((r) => r.sol_number !== rec.sol_number),
                            verify: prev.verify.filter((r) => r.sol_number !== rec.sol_number),
                            reject: prev.reject.filter((r) => r.sol_number !== rec.sol_number),
                          }));
                          setSelected((prev) => {
                            const n = new Set(prev);
                            n.delete(rec.sol_number);
                            return n;
                          });
                        },
                        title: "Dismiss sol",
                        style: {
                          flexShrink: 0,
                          background: "none",
                          border: "none",
                          color: "rgba(201,168,76,.3)",
                          cursor: "pointer",
                          fontSize: "16px",
                          lineHeight: 1,
                          padding: "0 2px",
                          alignSelf: "flex-start",
                        },
                      },
                      "×",
                    ),
                  ),
                );
          })(),
        ),

      // ── RFQ BLAST VIEW ──
      blastView &&
        blastPlan &&
        h(
          "div",
          null,
          h(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              },
            },
            h(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "13px",
                  letterSpacing: ".1em",
                  color: "var(--gold-solid)",
                  textTransform: "uppercase",
                },
              },
              "RFQ Blast Plan",
            ),
            h(
              "button",
              {
                onClick: () => setBlastView(false),
                style: {
                  ...S.btn("var(--body-faint)"),
                  padding: "4px 12px",
                  fontSize: "9px",
                },
              },
              "✕ Close",
            ),
          ),

          ...Object.entries(blastPlan).map(([fsc, { sols: fscSols, dists }]) =>
            h(
              "div",
              { key: fsc, style: { ...S.card, marginBottom: "16px" } },
              h(
                "div",
                { style: S.cardTitle },
                fscName(fsc) +
                  " (FSC " +
                  fsc +
                  ") — " +
                  fscSols.length +
                  " sol" +
                  (fscSols.length !== 1 ? "s" : ""),
              ),

              // Sol list for this FSC
              h(
                "div",
                {
                  style: {
                    ...S.mono,
                    fontSize: "10px",
                    color: "var(--body-dim)",
                    marginBottom: "12px",
                  },
                },
                fscSols.map((s) => s.sol_number).join(" · "),
              ),

              dists.length === 0
                ? h(
                    "div",
                    {
                      style: { ...S.mono, fontSize: "10px", color: "#e74c3c" },
                    },
                    "No distributors in rolodex for FSC " +
                      fsc +
                      " — add via Rolodex tab.",
                  )
                : dists.map((dist) => {
                    const email = dist.email || dist.Email || "";
                    const name = dist.name || dist.Company || "Distributor";
                    const subject =
                      "RFQ – " +
                      fscName(fsc) +
                      " | Government Requirement | Imperio Federal Logistics";
                    const body = buildRFQEmail(dist, fscSols);

                    return h(
                      "div",
                      {
                        key: dist.id || name,
                        style: {
                          borderTop: "1px solid rgba(201,168,76,.08)",
                          padding: "10px 0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "12px",
                          flexWrap: "wrap",
                        },
                      },
                      h(
                        "div",
                        null,
                        h(
                          "div",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "10px",
                              letterSpacing: ".08em",
                              color: "var(--alabaster)",
                              marginBottom: "2px",
                            },
                          },
                          name,
                        ),
                        h(
                          "div",
                          {
                            style: {
                              ...S.mono,
                              fontSize: "10px",
                              color: "var(--body-dim)",
                            },
                          },
                          email || "no email on file",
                        ),
                        dist.geography &&
                          h(
                            "div",
                            {
                              style: {
                                ...S.mono,
                                fontSize: "9px",
                                color: "var(--gold-dim)",
                              },
                            },
                            dist.geography,
                          ),
                      ),

                      h(
                        "div",
                        { style: { display: "flex", gap: "8px" } },
                        email &&
                          h(
                            "button",
                            {
                              onClick: () =>
                                openGmailCompose(email, subject, body),
                              style: {
                                ...S.btn(
                                  "var(--accent-green)",
                                  "rgba(61,214,140,.08)",
                                ),
                                border: "1px solid rgba(61,214,140,.3)",
                                fontSize: "9px",
                              },
                            },
                            "✉ Gmail Compose",
                          ),

                        h(
                          "button",
                          {
                            onClick: () => {
                              navigator.clipboard
                                .writeText(subject + "\n\n" + body)
                                .then(() => toast_("Email copied to clipboard"))
                                .catch(() =>
                                  toast_("Clipboard unavailable", true),
                                );
                            },
                            style: {
                              ...S.btn(),
                              fontSize: "9px",
                              padding: "6px 12px",
                            },
                          },
                          "Copy",
                        ),
                      ),
                    );
                  }),
            ),
          ),
        ),

      // ── TOAST ──
      toast &&
        h(
          "div",
          {
            className: "toast show",
            style: {
              borderColor: toast.err ? "#e74c3c" : "rgba(201,168,76,.45)",
              color: toast.err ? "#e74c3c" : "#C9A84C",
            },
          },
          toast.msg,
        ),
    );
  }

  // ── EXPOSE ────────────────────────────────────────────────────────────
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DibbsTab = DibbsTab;
})();
