// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — FLOATING CHAT  v1.0
//  Floating assistant with access to live pipeline, rolodex, and scrape data.
//  Mount: add <script src="tabs/scc-chat.js"></script> before closing </body>
//  Requires: window.SCC_DB, window.SCC_DIST, localStorage keys from dibbs-tab
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const CHAT_API  = "/.netlify/functions/scc-chat";
  const STORE_KEY = "scc_dibbs_tab_v1";
  const CHAT_KEY  = "scc_chat_history_v1";

  const style = document.createElement("style");
  style.textContent = `
    #scc-chat-fab {
      position: fixed;
      bottom: 130px;
      right: 20px;
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background: linear-gradient(135deg, #faf7f2 0%, #ece7db 100%);
      border: 1px solid rgba(201,168,76,.6);
      color: #c9a84c;
      font-size: 20px;
      cursor: pointer;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 16px rgba(0,0,0,.5);
      transition: border-color .2s, box-shadow .2s;
      padding: 0;
      overflow: hidden;
    }
    #scc-chat-fab:hover {
      border-color: rgba(201,168,76,.8);
      box-shadow: 0 2px 24px rgba(201,168,76,.2);
    }
    #scc-chat-fab img {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      object-fit: cover;
    }
    #scc-chat-fab .badge {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #3dd68c;
      border: 2px solid #0d0508;
      display: none;
    }
    #scc-chat-fab.has-unread .badge { display: block; }

    #scc-chat-panel {
      position: fixed;
      bottom: 126px;
      right: 80px;
      width: 420px;
      height: 560px;
      min-height: 300px;
      max-height: 90vh;
      resize: vertical;
      overflow: hidden;
      background: #faf7f2;
      border: 1px solid rgba(160,110,0,.25);
      border-radius: 4px;
      z-index: 9997;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 40px rgba(0,0,0,.7);
      transform: scale(0.95) translateY(10px);
      opacity: 0;
      pointer-events: none;
      transition: transform .18s cubic-bezier(.4,0,.2,1), opacity .18s;
    }
    #scc-chat-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }
    #scc-chat-header {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(160,110,0,.15);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #scc-chat-header .title {
      font-family: Cinzel,serif;
      font-size: 11px;
      letter-spacing: .14em;
      color: #7a5000;
      text-transform: uppercase;
    }
    #scc-chat-header .subtitle {
      font-family: JetBrains Mono,monospace;
      font-size: 9px;
      color: rgba(122,80,0,.5);
      margin-top: 2px;
    }
    #scc-chat-clear {
      background: none;
      border: none;
      color: rgba(201,168,76,.3);
      font-size: 10px;
      cursor: pointer;
      font-family: JetBrains Mono,monospace;
      padding: 2px 6px;
      transition: color .15s;
    }
    #scc-chat-clear:hover { color: #e74c3c; }
    #scc-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #scc-chat-messages::-webkit-scrollbar { width: 4px; }
    #scc-chat-messages::-webkit-scrollbar-track { background: transparent; }
    #scc-chat-messages::-webkit-scrollbar-thumb { background: rgba(201,168,76,.2); border-radius: 2px; }
    .scc-msg {
      max-width: 88%;
      padding: 8px 12px;
      border-radius: 3px;
      font-family: JetBrains Mono,monospace;
      font-size: 11px;
      line-height: 1.55;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .scc-msg.user {
      align-self: flex-end;
      background: rgba(122,80,0,.08);
      border: 1px solid rgba(122,80,0,.2);
      color: #5a3a00;
    }
    .scc-msg.assistant {
      align-self: flex-start;
      background: rgba(26,10,18,.05);
      border: 1px solid rgba(26,10,18,.1);
      color: rgba(26,10,18,.75);
    }
    .scc-msg.thinking {
      align-self: flex-start;
      color: rgba(122,80,0,.5);
      font-style: italic;
      border: none;
      background: none;
      padding: 4px 0;
    }
    .scc-msg.err {
      align-self: flex-start;
      color: #e74c3c;
      border: 1px solid rgba(231,76,60,.2);
      background: rgba(231,76,60,.05);
    }
    #scc-chat-input-row {
      padding: 10px 12px;
      border-top: 1px solid rgba(160,110,0,.15);
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    #scc-chat-input {
      flex: 1;
      background: rgba(26,10,18,.04);
      border: 1px solid rgba(160,110,0,.2);
      color: rgba(26,10,18,.85);
      font-family: JetBrains Mono,monospace;
      font-size: 11px;
      padding: 8px 10px;
      border-radius: 3px;
      resize: none;
      outline: none;
      transition: border-color .15s;
      height: 38px;
      min-height: 38px;
      max-height: 120px;
    }
    #scc-chat-input:focus { border-color: rgba(201,168,76,.5); }
    #scc-chat-send {
      background: rgba(122,80,0,.08);
      border: 1px solid rgba(122,80,0,.3);
      color: #7a5000;
      font-family: Cinzel,serif;
      font-size: 9px;
      letter-spacing: .1em;
      padding: 0 14px;
      cursor: pointer;
      border-radius: 3px;
      transition: background .15s;
      white-space: nowrap;
    }
    #scc-chat-send:hover { background: rgba(201,168,76,.2); }
    #scc-chat-send:disabled { opacity: .4; cursor: default; }
    .scc-suggestion-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 14px 10px;
    }
    .scc-chip {
      font-family: JetBrains Mono,monospace;
      font-size: 9px;
      color: rgba(201,168,76,.6);
      border: 1px solid rgba(201,168,76,.2);
      background: none;
      padding: 3px 8px;
      border-radius: 2px;
      cursor: pointer;
      transition: all .15s;
    }
    .scc-chip:hover { color: #c9a84c; border-color: rgba(201,168,76,.5); background: rgba(201,168,76,.06); }
  `;
  document.head.appendChild(style);

  const fab = document.createElement("button");
  fab.id = "scc-chat-fab";
  fab.title = "SCC Assistant";
  fab.innerHTML = `<img src="../images/ifl_coin.png" alt="IFL" onerror="this.style.display='none';this.parentNode.innerHTML+='<span style=\'font-size:14px;color:#c9a84c\'>IFL</span><span class=\'badge\'></span>'"><span class="badge"></span>`;
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "scc-chat-panel";
  panel.innerHTML = `
    <div id="scc-chat-header">
      <div>
        <div class="title">SCC Assistant</div>
        <div class="subtitle">Pipeline · Distributors · Outreach · Bid Math</div>
      </div>
      <button id="scc-chat-clear" title="Clear history">Clear</button>
    </div>
    <div id="scc-chat-messages"></div>
    <div class="scc-suggestion-chips" id="scc-chips"></div>
    <div id="scc-chat-input-row">
      <textarea id="scc-chat-input" placeholder="Ask about your pipeline, sols, distributors…" rows="1"></textarea>
      <button id="scc-chat-send">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  let open = false;
  let thinking = false;
  let history = [];

  const CHIPS = [
    "NSNs with score ≥ 80",
    "NSNs with score ≥ 90",
    "Pipeline status summary",
    "Which sols are due this week?",
    "Show me all Awaiting Quotes sols",
    "Which FSC lanes have no distributors?",
  ];

  const msgBox = document.getElementById("scc-chat-messages");
  const input = document.getElementById("scc-chat-input");
  const sendBtn = document.getElementById("scc-chat-send");
  const chips = document.getElementById("scc-chips");
  const clearBtn = document.getElementById("scc-chat-clear");

  function renderChips() {
    chips.innerHTML = "";
    if (history.length > 0) return;
    CHIPS.forEach((q) => {
      const btn = document.createElement("button");
      btn.className = "scc-chip";
      btn.textContent = q;
      btn.onclick = () => {
        input.value = q;
        send();
      };
      chips.appendChild(btn);
    });
  }

  function loadHistory() {
    try {
      history = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    } catch {
      history = [];
    }
  }
  function saveHistory() {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(history.slice(-40)));
    } catch {}
  }

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "scc-msg " + role;
    div.textContent = text;
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;
    return div;
  }

  async function buildContext() {
    const parts = [];

    // ── Full pipeline ──────────────────────────────────────────────────
    try {
      if (window.SCC_DB) {
        const recs = await window.SCC_DB.dbGetAll();
        if (recs && recs.length) {
          const CLOSED = ["Won", "Lost", "Cancelled", "Archived", "No Source"];
          const open = recs.filter((r) => !CLOSED.includes(r.status));
          const byStatus = {};
          for (const r of recs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

          const solLines = recs.map((r) =>
            [
              r.sol_number,
              r.item_name,
              "FSC " + (r.fsc || "?"),
              r.nsn ? "NSN " + r.nsn : null,
              r.ref_part_number ? "P/N " + r.ref_part_number : null,
              r.quantity ? r.quantity + " " + (r.unit_issue || "EA") : null,
              r.unit_price ? "$" + r.unit_price : null,
              r.quote_due ? "Due " + r.quote_due : null,
              r.delivery_days ? r.delivery_days + "d" : null,
              r.status,
              r.set_aside || null,
              r.supplier_poc ? "Vendor: " + r.supplier_poc : null,
              r.supplier_quote_price ? "Quote: $" + r.supplier_quote_price : null,
              r.supplier_lead_time ? "Lead: " + r.supplier_lead_time : null,
              r.screener_verdict ? "Screener: " + r.screener_verdict : null,
              r.notes ? "Notes: " + r.notes.slice(0, 120) : null,
            ].filter(Boolean).join(" | "),
          );

          parts.push(
            "PIPELINE (" + recs.length + " total, " + open.length + " open):\n" +
            "Status counts: " + JSON.stringify(byStatus) + "\n\n" +
            solLines.join("\n"),
          );
        }
      }
    } catch (e) {
      parts.push("Pipeline unavailable: " + e.message);
    }

    // ── Distributor DB with outreach logs ──────────────────────────────
    try {
      if (window.SCC_DIST) {
        const dists = window.SCC_DIST.DISTRIBUTORS || [];
        if (dists.length) {
          const distLines = dists.map((d) => {
            const base = [
              d.name,
              d.id,
              d.phone || null,
              d.email || null,
              d.website || null,
              d.tier ? "Tier " + d.tier : null,
              d.fsc && d.fsc.length ? "FSC: " + d.fsc.join(",") : null,
              d.tags && d.tags.length ? "Tags: " + d.tags.join(",") : null,
              d.passed_pns && d.passed_pns.length ? "Passed P/Ns: " + d.passed_pns.join(",") : null,
            ].filter(Boolean).join(" | ");

            const logs = (d.outreach_log || []).map((e) =>
              "  [" + e.date + "] " + e.pn + " → " + e.response.toUpperCase() +
              (e.price != null ? " $" + e.price : "") +
              (e.qty ? " " + e.qty + "EA" : "") +
              (e.lead_time ? " " + e.lead_time : "") +
              (e.notes ? " (" + e.notes + ")" : ""),
            );

            return logs.length ? base + "\n  Outreach log:\n" + logs.join("\n") : base;
          });
          parts.push(
            "DISTRIBUTOR DB (" + dists.length + " distributors):\n" + distLines.join("\n\n"),
          );
        }
      }
    } catch (e) {
      parts.push("Distributor DB unavailable: " + e.message);
    }

    // ── FSC Lane map ───────────────────────────────────────────────────
    try {
      if (window.SCC_DIST && window.SCC_DIST.FSC_LANES_MAP) {
        const lanes = window.SCC_DIST.FSC_LANES_MAP;
        parts.push("FSC LANES: " + JSON.stringify(lanes));
      }
    } catch {}

    // ── Last screener/DIBBS batch ──────────────────────────────────────
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (saved.sols && saved.sols.length) {
        parts.push("LAST DIBBS SCRAPE: " + saved.sols.length + " sols on " + (saved.scrapeDate || "unknown"));
      }
      if (saved.analysis) {
        const { go, verify, reject } = saved.analysis;
        const topGO = (go || []).slice(0, 8).map(
          (r) => r.sol_number + " | " + r.item_name + " | " + r.reason,
        );
        parts.push(
          "LAST ANALYSIS — GO: " + (go || []).length + " | VERIFY: " + (verify || []).length + " | REJECT: " + (reject || []).length +
          "\nTop GOs:\n" + topGO.join("\n"),
        );
      }
    } catch {}

    return parts.join("\n\n---\n\n");
  }

  // ── Local query engine — answers data questions without Claude API ──
  // Returns answer string if handled locally, null if Claude should handle it.
  async function tryLocalQuery(q) {
    const ql = q.toLowerCase();

    // ── NSN Intel score query ──────────────────────────────────────────
    const isScoreQ = ql.includes("score") || ql.includes("intel") || ql.includes("bid worthiness") || ql.includes("nsn");
    const numMatch  = q.match(/(\d+)/);
    if (isScoreQ && numMatch) {
      const threshold = parseInt(numMatch[1], 10);
      if (threshold >= 1 && threshold <= 100) {
        // Harvest all scc_bws_* keys
        const scores = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith("scc_bws_")) continue;
          try {
            const e = JSON.parse(localStorage.getItem(key) || "null");
            if (e && typeof e.score === "number") {
              scores.push({ nsn: key.replace("scc_bws_", ""), score: e.score, label: e.label || "" });
            }
          } catch (_) {}
        }
        if (scores.length === 0) return null; // No cache yet — fall through to Claude

        // Join with pipeline rows for item names
        const nsnToItem = {};
        try {
          const rows = (await window.SCC_DB.dbGetAll()) || [];
          for (const r of rows) {
            if (r.nsn) nsnToItem[r.nsn.replace(/-/g, "")] = r.item_name || "";
          }
        } catch (_) {}

        const matching = scores
          .filter((s) => s.score >= threshold)
          .sort((a, b) => b.score - a.score);

        if (matching.length === 0) {
          return (
            "No NSNs in cache with Intel Score ≥ " + threshold + ".\n" +
            "(Checked " + scores.length + " cached NSN" + (scores.length !== 1 ? "s" : "") + ". " +
            "Open NSN Intel or Pipeline to build the cache.)"
          );
        }

        const lines = matching.map((s) => {
          const clean = s.nsn.replace(/-/g, "");
          const item  = nsnToItem[clean] || nsnToItem[s.nsn] || "";
          const fmt   = clean.length === 13
            ? clean.replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4")
            : s.nsn;
          return fmt + (item ? "  —  " + item : "") + "  ·  " + s.score + "/100  (" + s.label + ")";
        });

        return (
          matching.length + " NSN" + (matching.length !== 1 ? "s" : "") +
          " with Intel Score ≥ " + threshold +
          " (out of " + scores.length + " cached):\n\n" +
          lines.join("\n")
        );
      }
    }

    // ── Pipeline summary ───────────────────────────────────────────────
    if (ql.includes("pipeline") && (ql.includes("summary") || ql.includes("status") || ql.match(/how many sol/))) {
      try {
        const rows = (await window.SCC_DB.dbGetAll()) || [];
        if (rows.length === 0) return "Pipeline is empty.";
        const byStatus = {};
        for (const r of rows) byStatus[r.status || "Unknown"] = (byStatus[r.status || "Unknown"] || 0) + 1;
        const statusLines = Object.entries(byStatus)
          .sort((a, b) => b[1] - a[1])
          .map(([s, c]) => c + "× " + s)
          .join("  |  ");
        return rows.length + " total sols in pipeline.\n" + statusLines;
      } catch (_) {}
    }

    // ── Due this week / today ──────────────────────────────────────────
    if (ql.includes("due") && (ql.includes("week") || ql.includes("today") || ql.includes("tomorrow") || ql.includes("soon"))) {
      try {
        const rows = (await window.SCC_DB.dbGetAll()) || [];
        const now = Date.now();
        const end = now + 7 * 24 * 60 * 60 * 1000;
        const due = rows
          .filter((r) => { const d = new Date(r.quote_due); return r.quote_due && d >= now && d <= end; })
          .sort((a, b) => new Date(a.quote_due) - new Date(b.quote_due));
        if (due.length === 0) return "No open sols due in the next 7 days.";
        return (
          due.length + " sol" + (due.length !== 1 ? "s" : "") + " due this week:\n\n" +
          due.map((r) => r.quote_due + "  —  " + r.sol_number + "  |  " + (r.item_name || "?") + "  |  " + (r.status || "?")).join("\n")
        );
      } catch (_) {}
    }

    return null; // Let Claude handle it
  }

  async function send() {
    const text = input.value.trim();
    if (!text || thinking) return;
    input.value = "";
    input.style.height = "38px";
    chips.innerHTML = "";
    addMsg("user", text);
    history.push({ role: "user", content: text });
    const thinkingEl = addMsg("thinking", "Thinking…");
    thinking = true;
    sendBtn.disabled = true;

    try {
      // Try local data query first — no API credits needed
      const localAnswer = await tryLocalQuery(text);
      if (localAnswer) {
        thinkingEl.remove();
        addMsg("assistant", localAnswer);
        history.push({ role: "assistant", content: localAnswer });
        saveHistory();
        thinking = false;
        sendBtn.disabled = false;
        return;
      }

      const context = await buildContext();

      const systemPrompt = `You are the SCC Assistant for Imperio Federal Logistics (CAGE 152U4), an SDVOSB DLA DIBBS contractor run by Anthony Kelley.

You have access to the full live state of the SCC system below — every pipeline sol, every distributor, every outreach log entry.

RULES:
- Use ONLY the LIVE SYSTEM DATA below. Never invent or supplement with outside knowledge.
- If data is absent, say so plainly — do not guess.
- List distributors with phone/email when available.
- For bid math questions: gross margin target 27.5%, floor 10%. FE fees: Day 20 = 1.67%, Day 30 = 2.50%, Day 60 = 5.00%; PO funding adds 2.50% of invoice. Net floor = $500 after worst-case fees.
- For solicitation questions: quote the sol number, item name, status, and due date.
- For sourcing questions: check distributor FSC codes, outreach logs, and passed_pns before recommending.
- Be direct and concise. No fluff.

TODAY: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

LIVE SYSTEM DATA:
${context}`;

      const resp = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: systemPrompt, messages: history }),
      });

      thinkingEl.remove();

      if (!resp.ok) {
        const err = await resp.text();
        let msg;
        if (err.toLowerCase().includes("credit balance") || err.toLowerCase().includes("credit_balance")) {
          msg = "Anthropic API credits depleted.\n\nFix: go to console.anthropic.com → Billing and add credits.\n\nNote: data queries (scores, pipeline status, due dates) still work without API credits — just ask those directly.";
        } else {
          msg = "API error " + resp.status + ": " + err.slice(0, 200);
        }
        addMsg("err", msg);
        history.pop();
        thinking = false;
        sendBtn.disabled = false;
        return;
      }

      const data = await resp.json();
      if (!data.ok) {
        addMsg("err", data.error || "Unknown error");
        history.pop();
        thinking = false;
        sendBtn.disabled = false;
        return;
      }

      const reply = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      addMsg("assistant", reply);
      history.push({ role: "assistant", content: reply });
      saveHistory();
      if (!open) fab.classList.add("has-unread");
    } catch (e) {
      thinkingEl.remove();
      addMsg("err", e.message);
      history.pop();
    }

    thinking = false;
    sendBtn.disabled = false;
  }

  function restoreHistory() {
    loadHistory();
    for (const m of history) addMsg(m.role, m.content);
    if (history.length === 0) renderChips();
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  fab.addEventListener("click", () => {
    open = !open;
    panel.classList.toggle("open", open);
    if (open) {
      fab.classList.remove("has-unread");
      input.focus();
    }
  });

  clearBtn.addEventListener("click", () => {
    history = [];
    saveHistory();
    msgBox.innerHTML = "";
    renderChips();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "38px";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  sendBtn.addEventListener("click", send);

  restoreHistory();
})();
