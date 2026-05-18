// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — FLOATING CHAT  v1.0
//  Floating assistant with access to live pipeline, rolodex, and scrape data.
//  Mount: add <script src="tabs/scc-chat.js"></script> before closing </body>
//  Requires: window.SCC_DB, window.SCC_DIST, localStorage keys from dibbs-tab
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const AGENT_URL = "http://localhost:3100";
  const STORE_KEY = "scc_dibbs_tab_v1";
  const CHAT_KEY = "scc_chat_history_v1";
  const KEY_STORE = "scc_anthropic_key";

  // ── Inject styles ──────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #scc-chat-fab {
      position: fixed;
      bottom: 72px;
      right: 20px;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1a0a12 0%, #2a1020 100%);
      border: 1px solid rgba(201,168,76,.45);
      color: #c9a84c;
      font-size: 20px;
      cursor: pointer;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 16px rgba(0,0,0,.5);
      transition: border-color .2s, box-shadow .2s;
    }
    #scc-chat-fab:hover {
      border-color: rgba(201,168,76,.8);
      box-shadow: 0 2px 24px rgba(201,168,76,.2);
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
      right: 20px;
      width: 400px;
      height: 560px;
      background: #0d0508;
      border: 1px solid rgba(201,168,76,.2);
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
      border-bottom: 1px solid rgba(201,168,76,.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #scc-chat-header .title {
      font-family: Cinzel,serif;
      font-size: 11px;
      letter-spacing: .14em;
      color: var(--gold-solid, #c9a84c);
      text-transform: uppercase;
    }
    #scc-chat-header .subtitle {
      font-family: JetBrains Mono,monospace;
      font-size: 9px;
      color: rgba(201,168,76,.4);
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
      background: rgba(201,168,76,.1);
      border: 1px solid rgba(201,168,76,.2);
      color: #e8d5a0;
    }
    .scc-msg.assistant {
      align-self: flex-start;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06);
      color: rgba(255,255,255,.78);
    }
    .scc-msg.thinking {
      align-self: flex-start;
      color: rgba(201,168,76,.4);
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
      border-top: 1px solid rgba(201,168,76,.1);
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    #scc-chat-input {
      flex: 1;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(201,168,76,.2);
      color: rgba(255,255,255,.85);
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
      background: rgba(201,168,76,.1);
      border: 1px solid rgba(201,168,76,.3);
      color: #c9a84c;
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

  // ── Mount HTML ─────────────────────────────────────────────────────────
  const fab = document.createElement("button");
  fab.id = "scc-chat-fab";
  fab.title = "SCC Assistant";
  fab.innerHTML = `<span>⌘</span><span class="badge"></span>`;
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "scc-chat-panel";
  panel.innerHTML = `
    <div id="scc-chat-header">
      <div>
        <div class="title">SCC Assistant</div>
        <div class="subtitle">Pipeline · Rolodex · Sols · Bid Math</div>
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

  // ── State ──────────────────────────────────────────────────────────────
  let open = false;
  let thinking = false;
  let history = []; // [{ role, content }]

  const CHIPS = [
    "What are my top 5 open sols by value?",
    "Which FSC lanes have no distributors?",
    "How many GOs from today's batch?",
    "Show me sols due this week",
    "What's my pipeline status summary?",
  ];

  // ── DOM refs ───────────────────────────────────────────────────────────
  const msgBox = document.getElementById("scc-chat-messages");
  const input = document.getElementById("scc-chat-input");
  const sendBtn = document.getElementById("scc-chat-send");
  const chips = document.getElementById("scc-chips");
  const clearBtn = document.getElementById("scc-chat-clear");

  // ── Render suggestion chips ────────────────────────────────────────────
  function renderChips() {
    chips.innerHTML = "";
    if (history.length > 0) return; // hide after first message
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

  // ── Load/save history ──────────────────────────────────────────────────
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

  // ── Append message to UI ───────────────────────────────────────────────
  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "scc-msg " + role;
    div.textContent = text;
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;
    return div;
  }

  // ── Build context from live data ───────────────────────────────────────
  async function buildContext() {
    const parts = [];

    // Pipeline snapshot
    try {
      if (window.SCC_DB) {
        const recs = await window.SCC_DB.dbGetAll();
        if (recs && recs.length) {
          const open = recs.filter(
            (r) => !["Won", "Lost", "Cancelled"].includes(r.status),
          );
          const byStatus = {};
          for (const r of recs)
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
          const topByValue = [...open]
            .sort(
              (a, b) =>
                parseFloat(b.unit_price || 0) * parseFloat(b.quantity || 1) -
                parseFloat(a.unit_price || 0) * parseFloat(a.quantity || 1),
            )
            .slice(0, 10)
            .map(
              (r) =>
                `${r.sol_number} | ${r.item_name} | FSC ${r.fsc} | $${r.unit_price} x ${r.quantity} ${r.unit_issue} | Due: ${r.quote_due} | ${r.status}`,
            );
          parts.push(`PIPELINE (${recs.length} total, ${open.length} open):
Status breakdown: ${JSON.stringify(byStatus)}
Top open sols by unit price:
${topByValue.join("\n")}`);
        }
      }
    } catch (e) {
      parts.push("Pipeline: unavailable (" + e.message + ")");
    }

    // Today's scrape / analysis
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (saved.sols && saved.sols.length) {
        parts.push(
          `LAST SCRAPE: ${saved.sols.length} sols scraped on ${saved.scrapeDate || "unknown date"}`,
        );
      }
      if (saved.analysis) {
        const { go, verify, reject } = saved.analysis;
        const topGO = (go || [])
          .slice(0, 5)
          .map(
            (r) =>
              `${r.sol_number} | ${r.item_name} | FSC ${r.fsc} | $${r.ext_price} | ${r.reason}`,
          );
        parts.push(`LAST ANALYSIS: GO: ${(go || []).length} | VERIFY: ${(verify || []).length} | REJECT: ${(reject || []).length}
Top GOs:
${topGO.join("\n")}`);
      }
    } catch {}

    // Rolodex coverage
    try {
      if (window.SCC_DIST) {
        const dists = window.SCC_DIST._cache || [];
        if (dists.length) {
          const fscCoverage = {};
          for (const d of dists) {
            const fscs = (d.fsc || d.FSCs || "")
              .toString()
              .split(/[,;\s]+/)
              .filter((f) => /^\d{4}$/.test(f));
            for (const f of fscs) fscCoverage[f] = (fscCoverage[f] || 0) + 1;
          }
          parts.push(`ROLODEX: ${dists.length} distributors
FSC coverage: ${Object.entries(fscCoverage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([f, n]) => `${f}(${n})`)
            .join(", ")}`);
        }
      }
    } catch {}

    return parts.join("\n\n");
  }

  // ── Send message ───────────────────────────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (!text || thinking) return;
    input.value = "";
    input.style.height = "38px";

    // Hide chips after first message
    chips.innerHTML = "";

    addMsg("user", text);
    history.push({ role: "user", content: text });

    const thinkingEl = addMsg("thinking", "Thinking…");
    thinking = true;
    sendBtn.disabled = true;

    try {
      const context = await buildContext();
      const apiKey = localStorage.getItem(KEY_STORE) || "";

      if (!apiKey) {
        thinkingEl.remove();
        addMsg(
          "err",
          "No Anthropic API key — paste it in the DIBBS tab key field first.",
        );
        thinking = false;
        sendBtn.disabled = false;
        return;
      }

      const systemPrompt = `You are the SCC Assistant for Imperio Federal Logistics (CAGE 152U4), an SDVOSB DLA DIBBS contractor run by Anthony Kelley.

You have access to live data from the Supply Chain Command system. Use it to answer questions about the pipeline, solicitations, distributors, and bid math.

Be direct and concise. Use numbers when available. Format lists cleanly. No fluff.

LIVE SYSTEM DATA:
${context}

If asked about bid math: gross margin target 27.5%, floor 10%. FE fees: Day 20 = 1.67%, Day 30 = 2.50%, Day 60 = 5.00%. PO funding = 2.50% COGS. Net floor = $500 after worst-case fees.`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: systemPrompt,
          messages: history,
        }),
      });

      thinkingEl.remove();

      if (!resp.ok) {
        const err = await resp.text();
        addMsg("err", "API error " + resp.status + ": " + err.slice(0, 120));
        history.pop();
        thinking = false;
        sendBtn.disabled = false;
        return;
      }

      const data = await resp.json();
      const reply = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      addMsg("assistant", reply);
      history.push({ role: "assistant", content: reply });
      saveHistory();

      // Unread badge if panel closed
      if (!open) fab.classList.add("has-unread");
    } catch (e) {
      thinkingEl.remove();
      addMsg("err", e.message);
      history.pop();
    }

    thinking = false;
    sendBtn.disabled = false;
  }

  // ── Restore history on load ────────────────────────────────────────────
  function restoreHistory() {
    loadHistory();
    for (const m of history) addMsg(m.role, m.content);
    if (history.length === 0) renderChips();
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  // ── Toggle panel ───────────────────────────────────────────────────────
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

  // ── Input handlers ─────────────────────────────────────────────────────
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

  // ── Init ───────────────────────────────────────────────────────────────
  restoreHistory();
})();
