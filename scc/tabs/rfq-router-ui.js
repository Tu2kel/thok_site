// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — RFQ ROUTER UI MODULE
// Wires RFQSeedRouter into the SCC app
// UI flow: Paste batch → Analyze → View routing plan → Generate RFQ emails
// ═══════════════════════════════════════════════════════════════════════

const RFQRouterUI = (() => {
  let router = null;
  let currentAnalysis = null;
  let containerEl = null;

  // ── INIT ────────────────────────────────────────────────────────────
  function init(rolodex, config = {}) {
    router = RFQSeedRouter.init(rolodex, config);
    containerEl = document.getElementById("rfq-router-container");

    if (!containerEl) {
      console.error("[RFQRouterUI] Container #rfq-router-container not found");
      return;
    }

    renderUI();
  }

  // ── MAIN UI ─────────────────────────────────────────────────────────
  function renderUI() {
    containerEl.innerHTML = `
      <div style="padding: 20px; background: #f5f0e8; border-radius: 8px;">
        <h2 style="color: #1a0a12; margin: 0 0 20px 0;">RFQ Seed Router</h2>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 10px; font-weight: bold;">Paste Solicitation Batch:</label>
          <textarea 
            id="rfq-paste-input" 
            placeholder="Paste sol numbers (SPE4A526T120D, SPE7LX26U7245) or full batch (NSN/FSC/Qty lines)"
            style="width: 100%; height: 120px; padding: 10px; font-family: monospace; border: 1px solid #c9a84c;"
          ></textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
          <button 
            id="rfq-analyze-btn"
            style="padding: 10px 20px; background: #c9a84c; color: #111012; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
            Analyze Batch
          </button>
          <button 
            id="rfq-clear-btn"
            style="padding: 10px 20px; background: #7a5000; color: #f5f0e8; border: none; border-radius: 4px; cursor: pointer;">
            Clear
          </button>
        </div>

        <div id="rfq-results-container"></div>
      </div>
    `;

    // Bind events
    document.getElementById("rfq-analyze-btn").addEventListener("click", handleAnalyze);
    document.getElementById("rfq-clear-btn").addEventListener("click", handleClear);
  }

  // ── PARSE BATCH INPUT ──────────────────────────────────────────────
  function parseBatchInput(raw) {
    const lines = raw.split(/\n/);
    const sols = [];
    const seen = new Set();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to extract sol number (e.g., SPE4A526T120D)
      const solMatch = trimmed.match(/\b([A-Z]{2,4}\d+[A-Z0-9]{6,})\b/i);
      if (!solMatch) continue;

      const solNumber = solMatch[1].toUpperCase();
      if (seen.has(solNumber)) continue;
      seen.add(solNumber);

      // Try to extract FSC (4 digits)
      const fscMatch = trimmed.match(/\b(\d{4})\b/);
      const fsc = fscMatch ? fscMatch[1] : "";

      // Try to extract NSN (13 digits)
      const nsnMatch = trimmed.match(/\b(\d{4}-\d{2}-\d{3}-\d{4}|\d{13})\b/);
      const nsn = nsnMatch ? nsnMatch[1] : "";

      // Try to extract qty (number with EA)
      const qtyMatch = trimmed.match(/(\d+)\s*EA/i);
      const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

      // Try to extract unit price ($X.XX)
      const priceMatch = trimmed.match(/\$(\d+\.?\d*)/);
      const unitPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;

      // Try to extract delivery days (XX days)
      const deliveryMatch = trimmed.match(/(\d+)\s*day/i);
      const deliveryDays = deliveryMatch ? parseInt(deliveryMatch[1]) : 30;

      sols.push({
        sol_number: solNumber,
        fsc: fsc,
        nsn: nsn,
        item_name: trimmed.split(/[\d\s]+/)[0] || solNumber,
        qty: qty,
        unit_price: unitPrice,
        delivery_days: deliveryDays,
      });
    }

    return sols;
  }

  // ── HANDLE ANALYZE ──────────────────────────────────────────────────
  function handleAnalyze() {
    const input = document.getElementById("rfq-paste-input").value;
    if (!input.trim()) {
      alert("Please paste a batch first");
      return;
    }

    const sols = parseBatchInput(input);
    if (sols.length === 0) {
      alert("No solicitations found in input. Try pasting sol numbers or a batch table.");
      return;
    }

    console.log(`[RFQRouter] Analyzing ${sols.length} solicitations...`);
    currentAnalysis = router.analyzeBatch(sols);

    console.log(
      `[RFQRouter] Analysis complete: ${currentAnalysis.summary.go} GO, ${currentAnalysis.summary.locked} LOCKED, ${currentAnalysis.summary.unmatched} UNMATCHED`
    );

    renderResults();
  }

  // ── HANDLE CLEAR ────────────────────────────────────────────────────
  function handleClear() {
    document.getElementById("rfq-paste-input").value = "";
    document.getElementById("rfq-results-container").innerHTML = "";
    currentAnalysis = null;
  }

  // ── RENDER RESULTS ──────────────────────────────────────────────────
  function renderResults() {
    const { go, locked, unmatched, byDistributor, summary } = currentAnalysis;

    let html = `
      <div style="margin-top: 20px;">
        <h3 style="color: #1a0a12; margin-bottom: 15px;">Analysis Summary</h3>
        
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 20px;">
          <div style="background: #fff; padding: 15px; border-radius: 4px; border-left: 4px solid #c9a84c;">
            <div style="font-size: 12px; color: #7a5000;">Total</div>
            <div style="font-size: 24px; font-weight: bold; color: #1a0a12;">${summary.total}</div>
          </div>
          <div style="background: #fff; padding: 15px; border-radius: 4px; border-left: 4px solid #2d8a1a;">
            <div style="font-size: 12px; color: #0a5a28;">🟢 GO</div>
            <div style="font-size: 24px; font-weight: bold; color: #0a5a28;">${summary.go}</div>
            <div style="font-size: 10px; color: #7a5000;">${summary.goRate}%</div>
          </div>
          <div style="background: #fff; padding: 15px; border-radius: 4px; border-left: 4px solid #b4291e;">
            <div style="font-size: 12px; color: #8a1a1a;">🔒 Locked</div>
            <div style="font-size: 24px; font-weight: bold; color: #8a1a1a;">${summary.locked}</div>
          </div>
          <div style="background: #fff; padding: 15px; border-radius: 4px; border-left: 4px solid #7a5000;">
            <div style="font-size: 12px; color: #7a5000;">⚠️ Unmatched</div>
            <div style="font-size: 24px; font-weight: bold; color: #7a5000;">${summary.unmatched}</div>
          </div>
          <div style="background: #fff; padding: 15px; border-radius: 4px; border-left: 4px solid #c9a84c;">
            <div style="font-size: 12px; color: #c9a84c;">Distributors</div>
            <div style="font-size: 24px; font-weight: bold; color: #1a0a12;">${summary.distributorCount}</div>
          </div>
        </div>

        ${renderGOSection(go, byDistributor)}
        ${renderLockedSection(locked)}
        ${renderUnmatchedSection(unmatched)}
      </div>
    `;

    document.getElementById("rfq-results-container").innerHTML = html;
  }

  // ── RENDER GO SECTION ──────────────────────────────────────────────
  function renderGOSection(go, byDistributor) {
    if (go.length === 0) {
      return `<h3 style="color: #8a1a1a;">🟢 GO (0 routable solicitations)</h3>`;
    }

    let html = `
      <h3 style="color: #0a5a28; margin-top: 30px;">🟢 GO — ROUTABLE SOLICITATIONS (${go.length})</h3>
      <div style="margin-bottom: 20px;">
    `;

    for (const [distName, plan] of Object.entries(byDistributor)) {
      const dist = plan.distributor;
      const sols = plan.sols;

      html += `
        <div style="background: #f0f8f4; border: 1px solid #2d8a1a; border-radius: 4px; padding: 15px; margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div>
              <h4 style="margin: 0; color: #0a5a28;">${distName}</h4>
              <small style="color: #7a5000;">FSC Lanes: ${plan.fscLanes.join(", ")} | ${sols.length} sols</small>
            </div>
            <div style="text-align: right;">
              ${dist.Phone ? `<div><strong>☎️</strong> ${dist.Phone}</div>` : ""}
              ${dist.Email ? `<div><strong>📧</strong> ${dist.Email}</div>` : ""}
            </div>
          </div>

          <div style="background: #fff; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px; max-height: 100px; overflow-y: auto;">
            ${sols.map((s) => `<div>• ${s.item_name} (${s.qty} EA)</div>`).join("")}
          </div>

          <button 
            class="gen-email-btn" 
            data-dist="${distName}"
            style="padding: 8px 15px; background: #2d8a1a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">
            📧 Generate RFQ Email
          </button>
        </div>
      `;
    }

    html += `</div>`;

    return html;
  }

  // ── RENDER LOCKED SECTION ──────────────────────────────────────────
  function renderLockedSection(locked) {
    if (locked.length === 0) return "";

    return `
      <h3 style="color: #8a1a1a; margin-top: 30px;">🔒 SOURCE LOCKS (${locked.length})</h3>
      <div style="background: #fef0f0; border: 1px solid #8a1a1a; border-radius: 4px; padding: 15px;">
        ${locked
          .map(
            (l) => `
          <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #c9a84c;">
            <strong>${l.sol_number}</strong> — ${l.item_name}
            <br/>
            <span style="color: #8a1a1a; font-size: 12px;">🔒 ${l.sourceLock.reason} ${l.sourceLock.severity === "hard" ? "(HARD)" : "(soft)"}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;
  }

  // ── RENDER UNMATCHED SECTION ───────────────────────────────────────
  function renderUnmatchedSection(unmatched) {
    if (unmatched.length === 0) return "";

    return `
      <h3 style="color: #7a5000; margin-top: 30px;">⚠️ UNMATCHED (${unmatched.length})</h3>
      <div style="background: #fef8f0; border: 1px solid #7a5000; border-radius: 4px; padding: 15px; font-size: 12px;">
        <p style="margin: 0 0 10px 0; color: #7a5000;">
          <strong>No distributors in rolodex for these FSC lanes:</strong>
        </p>
        ${unmatched
          .map(
            (u) => `
          <div style="margin-bottom: 5px;">
            • <strong>${u.sol_number}</strong> (FSC ${u.fsc}) — ${u.item_name}
          </div>
        `
          )
          .join("")}
        <p style="margin: 10px 0 0 0; color: #7a5000; font-size: 11px;">
          <em>These need manual sourcing. Add suppliers to rolodex for these FSC lanes to automate.</em>
        </p>
      </div>
    `;
  }

  return {
    init,
    renderUI,
    analyzeBatch: (sols) => (currentAnalysis = router.analyzeBatch(sols)),
  };
})();
