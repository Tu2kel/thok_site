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
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
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
      approved_sources: [],
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
        return lines.join("\n");
      })
      .join("\n\n");

    return [
      "Hi " + (dist.name || dist.Company || "Team") + ",",
      "",
      "My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting active DLA requirements and have an immediate procurement need in your lane.",
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
    const [rawExpanded, setRawExpanded] = useState(false);
    const [rawSearch, setRawSearch] = useState("");
    const [liveMode, setLiveMode] = useState(saved.liveMode === true ? true : false);
    const [blasting, setBlasting] = useState(false);
    const [blastLog, setBlastLog] = useState([]);
    const [showBlastLog, setShowBlastLog] = useState(false);

    const abortRef   = useRef(false);
    const modeRef     = useRef(mode);
    useEffect(() => { modeRef.current = mode; }, [mode]);
    const liveModeRef = useRef(liveMode);
    useEffect(() => { liveModeRef.current = liveMode; }, [liveMode]);

    // ── Persist ──
    useEffect(() => {
      storeSave({ mode, sols, scrapeDate, analysis, liveMode });
    }, [mode, sols, scrapeDate, analysis, liveMode]);

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

    // ── AUTO CHAIN — analyze → push GO → RFQ blast (no user interaction) ──
    const autoChain = useCallback(async (scrapedSols) => {
      addLog("AUTO ▶ Analyzing " + scrapedSols.length + " sols…", "info");
      setAnalyzing(true);
      try {
        const results = await analyzeWithClaude(scrapedSols, addLog);
        const go = [], verify = [], reject = [];
        for (const res of results) {
          const orig = scrapedSols.find((s) => s.sol_number === res.sol_number) || {};
          const merged = { ...orig, ...res };
          if (res.verdict === "GO")           go.push(merged);
          else if (res.verdict === "VERIFY FIRST") verify.push(merged);
          else                                reject.push(merged);
        }
        go.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));
        verify.sort((a, b) => (b.ext_price || 0) - (a.ext_price || 0));
        setAnalysis({ go, verify, reject });
        setSelected(new Set(go.map((r) => r.sol_number)));
        addLog("AUTO ▶ " + go.length + " GO · " + verify.length + " VERIFY · " + reject.length + " REJECT", "ok");

        if (go.length === 0) {
          addLog("AUTO ▶ No GO sols today.", "info");
          setAnalyzing(false);
          return;
        }

        // Blast GO sols — pipeline NOT updated yet (vendor quote required first)
        const blastRecs = go.map(buildRecord);
        if (window.SCC_AUTO_RFQ) {
          const isLive = liveModeRef.current;
          addLog("AUTO ▶ Firing RFQ blast to " + blastRecs.length + " GO sols" + (isLive ? " [LIVE]" : " [TEST → tu2kel.lg@gmail.com]") + "…", "info");
          window.SCC_AUTO_RFQ.runBatch(blastRecs, isLive ? {} : { testMode: true })
            .then(() => {
              addLog("AUTO ▶ RFQ blast complete" + (isLive ? " — real vendor emails sent." : " — test emails sent to tu2kel.lg@gmail.com.") + " Pipeline stays clean until quotes arrive.", "ok");
              refreshBlastLog();
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
      setSols([]);
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
                    setSols(evt.sols);
                    setScrapeDate(new Date().toLocaleString());
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
            setSols(data.sols);
            setScrapeDate(new Date().toLocaleString());
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
          body: JSON.stringify({ stream: true }),
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
                    setSols(evt.sols);
                    setScrapeDate(new Date().toLocaleString());
                    if (modeRef.current === "auto") {
                      await autoChain(evt.sols);
                    } else {
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
            setSols(data.sols);
            setScrapeDate(new Date().toLocaleString());
            if (modeRef.current === "auto") {
              await autoChain(data.sols);
            } else {
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

    // ── ANALYZE ───────────────────────────────────────────────────────
    const runAnalysis = useCallback(async () => {
      if (!sols.length || analyzing) return;
      setAnalyzing(true);
      setAnalyzeErr("");
      setAnalysis(null);
      setSelected(new Set());
      setPushLog([]);

      try {
        const results = await analyzeWithClaude(sols, addLog);

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
          log_.push({
            sol: rec.sol_number,
            status: "skip",
            note: "already exists",
          });
          continue;
        }
        try {
          const built = buildRecord(rec);
          await dbSave(built);
          savedRecords.push(built);
          log_.push({
            sol: rec.sol_number,
            status: "saved",
            note: rec.verdict,
          });
        } catch (e) {
          log_.push({ sol: rec.sol_number, status: "err", note: e.message });
        }
      }

      setPushLog(log_);
      setPushing(false);
      const saved_ = log_.filter((l) => l.status === "saved").length;
      const skips = log_.filter((l) => l.status === "skip").length;
      toast_(
        "Pushed " + saved_ + " sols to pipeline" + (skips ? " · " + skips + " skipped (duplicate)" : "") + " — use BLAST GO to send RFQs",
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
      try {
        await window.SCC_AUTO_RFQ.runBatch(recs, isLive ? { onLog: (m) => addLog(m, "info") } : { testMode: true, onLog: (m) => addLog(m, "info") });
        addLog("BLAST ▶ Done. Check blast log for details.", "ok");
        refreshBlastLog();
        setShowBlastLog(true);
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
                  window.SCC_AUTO_RFQ.runBatch(testRecs, { testMode: true, onLog: (m) => addLog(m, "info") })
                    .then(() => { addLog("TEST ▶ Done — check tu2kel.lg@gmail.com", "ok"); refreshBlastLog(); setShowBlastLog(true); })
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

          // Sol rows for active bucket
          (() => {
            const bucketRecs = (
              resultTab === "GO"
                ? analysis.go
                : resultTab === "VERIFY FIRST"
                  ? analysis.verify
                  : analysis.reject
            );
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
