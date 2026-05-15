// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — WIN PROBABILITY ANALYZER v1.1 (PATCHED)
// Fixes applied:
//   [4] hardRejectGate() now checks prime-dominated FSC kill list
//       Pass primeKillFSCs array in config or DEFAULT_CONFIG.
//       Prevents these from sitting in unmatched pile — they hard-reject.
// ═══════════════════════════════════════════════════════════════════════

const NavigatorAnalyzer = (() => {
  // ── PRIME-DOMINATED FSC KILL LIST ───────────────────────────────────
  // FSCs where primes dominate and resale channel doesn't exist.
  // These hard-reject instead of falling to unmatched pile.
  const PRIME_DOMINATED_FSCS = [
    "1560", // Airframe Structural Components
    "1305", // Ammunition, through 30mm
    "1310", // Ammunition, over 30mm up to 75mm
    "1315", // Ammunition, 75mm through 125mm
    "1320", // Ammunition, over 125mm
    "1340", // Rockets, Rocket Ammunition & Rocket Components
    "1350", // Bombs
    "1360", // Cluster Munitions
    "1376", // Bulk Explosives
    "2835", // Gas Turbine/Jet Engines & Components
    "2840", // Gas Turbine/Jet Engine & Component Parts
    "1720", // Aircraft Landing Gear Components
    "1730", // Aircraft Wheel & Brake Systems
    "1680", // Miscellaneous Aircraft Accessories & Components (prime-heavy)
    "6910", // Training Aids (defense-specific)
    "6920", // Armament Training Devices
    "6930", // Armament Trainers
    "5860", // Nuclear Ordnance
    "1081", // Nuclear Bombs
  ];

  const DEFAULT_CONFIG = {
    marginFloor: 0.1,
    marginTarget: 0.275,
    marginStretch: 0.35,
    netFloorDollars: 500,
    costCeilingPct: 0.9,
    feAdvanceRate: 0.9,
    feReserveRate: 0.1,
    fePOFundingFee: 0.025,
    feFactoringDay30: 0.025,
    feFactoringDay60: 0.05,
    winWeights: {
      margin: 25,
      sourcing: 25,
      competition: 20,
      setAside: 15,
      delivery: 10,
      priceCeiling: 5,
    },
    winProbGO: 0.7,
    winProbVerify: 0.5,
    marginExcellent: 0.35,
    marginGood: 0.275,
    marginAcceptable: 0.15,
    deliveryExcellentDays: 30,
    deliveryGoodDays: 60,
    competitionLow: 3,
    competitionMed: 5,
    competitionHigh: 8,
    rejectCAGEs: ["07482", "062W0", "81SA7", "R9004", "75Q65"],
    rejectOEMs: ["SUREFIRE", "STREAMLIGHT", "FURUNO"],
    rejectNSNs: [],
    // FIX [4]: prime-dominated FSC kill list — override to extend/trim
    primeKillFSCs: PRIME_DOMINATED_FSCS,
  };

  // ── HARD REJECT GATE (PATCHED) ───────────────────────────────────────
  // FIX [4]: added prime-dominated FSC check as first gate
  function hardRejectGate(sol, blockedCAGEs = [], blockedOEMs = [], primeKillFSCs = []) {
    // Prime-dominated FSC kill list — hard reject immediately
    if (primeKillFSCs.length > 0) {
      const fsc = (sol.fsc || "").replace(/[^\d]/g, "");
      if (primeKillFSCs.includes(fsc)) {
        return {
          isReject: true,
          reason: `Prime-dominated FSC ${fsc} — no resale channel`,
        };
      }
    }

    // AIDC
    if (sol.item_name && sol.item_name.includes("AIDC")) {
      return { isReject: true, reason: "AIDC — no certification capability" };
    }

    // AMSC: G, B, A
    if (sol.item_name && /\b(AMSC:\s*[GBA]|AMSC[GBA])\b/i.test(sol.item_name)) {
      return { isReject: true, reason: "AMSC:G/B/A — government drawing lock" };
    }

    // Restricted drawings
    if (
      sol.drawings_available &&
      sol.drawings_available.toLowerCase() === "restricted"
    ) {
      return { isReject: true, reason: "Restricted drawings — no COTS path" };
    }

    // Already awarded or removed
    if (
      sol.award_status &&
      (sol.award_status.toLowerCase().includes("awarded") ||
        sol.award_status.toLowerCase().includes("removed"))
    ) {
      return { isReject: true, reason: "Already awarded or removed" };
    }

    // Set-aside ineligibility
    if (
      sol.set_aside &&
      /^(AL|ABILITY|HUBZONE|H|L|E|FG|PO|FI)$/i.test(sol.set_aside)
    ) {
      return { isReject: true, reason: `Set-aside ineligible (${sol.set_aside})` };
    }

    // Blocked CAGEs
    if (sol.supplier_restrictions) {
      const cageStr = sol.supplier_restrictions.toUpperCase();
      for (const cage of blockedCAGEs) {
        if (cageStr.includes(cage.toUpperCase())) {
          return { isReject: true, reason: `Blocked CAGE: ${cage}` };
        }
      }
    }

    // Blocked OEMs
    if (sol.item_name) {
      const itemUpper = sol.item_name.toUpperCase();
      for (const oem of blockedOEMs) {
        if (itemUpper.includes(oem.toUpperCase())) {
          return { isReject: true, reason: `Blocked OEM: ${oem}` };
        }
      }
    }

    return { isReject: false };
  }

  // ── BID MATH ─────────────────────────────────────────────────────────
  function calculateBidMath(unitPrice, qty, historicalPrice, config = DEFAULT_CONFIG) {
    const results = {};
    const margins = [0.1, 0.275, 0.3, 0.4, 0.5, 0.6];

    for (const margin of margins) {
      const cost = historicalPrice * config.costCeilingPct;
      const sellPrice = cost / (1 - margin);

      if (sellPrice < unitPrice) {
        results[`m${Math.round(margin * 100)}`] = {
          margin,
          cost,
          sellPrice,
          gap: unitPrice - sellPrice,
          feasible: false,
        };
        continue;
      }

      const extPrice = unitPrice * qty;
      const grossProfit = extPrice * margin;
      const poFee = extPrice * config.fePOFundingFee;
      const factoringFeeDay60 = extPrice * config.feFactoringDay60;
      const factoringFeeDay30 = extPrice * config.feFactoringDay30;
      const totalFees = poFee + factoringFeeDay60;
      const netProfit = grossProfit - totalFees;

      results[`m${Math.round(margin * 100)}`] = {
        margin,
        extPrice,
        cost,
        sellPrice,
        grossProfit,
        poFee,
        factoringFee: factoringFeeDay60,
        totalFees,
        netProfitDay60: netProfit,
        netProfitDay30: grossProfit - (poFee + factoringFeeDay30),
        netProfitDay20: grossProfit - (poFee + extPrice * 0.0167),
        feasible: true,
        viable: netProfit >= config.netFloorDollars,
      };
    }

    return results;
  }

  // ── WIN PROBABILITY SCORER ───────────────────────────────────────────
  function scoreWinProbability(sol, bidMath, sourcingMap, competitionData, config = DEFAULT_CONFIG) {
    const scores = {};
    let totalScore = 0;

    // 1. MARGIN (25%)
    const marginScore = (() => {
      const m28 = bidMath.m28;
      if (m28 && m28.viable && m28.netProfitDay60 > config.netFloorDollars)
        return config.winWeights.margin;
      const m30 = bidMath.m30;
      if (m30 && m30.viable) return config.winWeights.margin * 0.85;
      const m15 = bidMath.m15;
      if (m15 && m15.viable && m15.netProfitDay60 > config.netFloorDollars)
        return config.winWeights.margin * 0.5;
      return 0;
    })();
    scores.margin = {
      raw: marginScore,
      pct: (marginScore / config.winWeights.margin) * 100,
      rationale: `Achievable margin${marginScore >= config.winWeights.margin * 0.8 ? " at target" : marginScore >= config.winWeights.margin * 0.5 ? " at acceptable level" : " insufficient"}`,
    };
    totalScore += marginScore;

    // 2. SOURCING CONFIDENCE (25%)
    const fscKey = `FSC_${sol.fsc}`;
    const knownSuppliers = sourcingMap[fscKey] || [];
    let sourcingScore;
    if (knownSuppliers.length >= 2) {
      sourcingScore = config.winWeights.sourcing;
      scores.sourcing = { raw: sourcingScore, pct: 100, suppliers: knownSuppliers, rationale: `${knownSuppliers.length} known suppliers in lane` };
    } else if (knownSuppliers.length === 1) {
      sourcingScore = config.winWeights.sourcing * 0.75;
      scores.sourcing = { raw: sourcingScore, pct: 75, suppliers: knownSuppliers, rationale: "1 known supplier, speculative" };
    } else {
      sourcingScore = config.winWeights.sourcing * 0.4;
      scores.sourcing = { raw: sourcingScore, pct: 40, suppliers: [], rationale: "No known suppliers, needs discovery" };
    }
    totalScore += sourcingScore;

    // 3. COMPETITION (20%)
    const compKey = sol.nsn || sol.fsc;
    const compData = competitionData[compKey] || {};
    const avgBidders = compData.avgBidders || config.competitionMed;
    let competitionScore;
    if (avgBidders <= config.competitionLow) {
      competitionScore = config.winWeights.competition;
      scores.competition = { raw: competitionScore, pct: 100, avgBidders, rationale: `Low competition (${avgBidders.toFixed(1)} avg bidders)` };
    } else if (avgBidders <= config.competitionMed) {
      competitionScore = config.winWeights.competition * 0.75;
      scores.competition = { raw: competitionScore, pct: 75, avgBidders, rationale: `Medium competition (${avgBidders.toFixed(1)} avg bidders)` };
    } else if (avgBidders < config.competitionHigh) {
      competitionScore = config.winWeights.competition * 0.5;
      scores.competition = { raw: competitionScore, pct: 50, avgBidders, rationale: `High competition (${avgBidders.toFixed(1)} avg bidders)` };
    } else {
      competitionScore = config.winWeights.competition * 0.25;
      scores.competition = { raw: competitionScore, pct: 25, avgBidders, rationale: `Fierce competition (${avgBidders.toFixed(1)} avg bidders)` };
    }
    totalScore += competitionScore;

    // 4. SET-ASIDE (15%)
    let setAsideScore;
    if (sol.set_aside && /^(Y|R|ST|SB)$/i.test(sol.set_aside)) {
      setAsideScore = config.winWeights.setAside;
      scores.setAside = { raw: setAsideScore, pct: 100, setAside: sol.set_aside, rationale: `SDVOSB/8a/SB eligible (${sol.set_aside})` };
    } else {
      setAsideScore = config.winWeights.setAside * 0.3;
      scores.setAside = { raw: setAsideScore, pct: 30, setAside: sol.set_aside, rationale: "Unrestricted or ineligible set-aside" };
    }
    totalScore += setAsideScore;

    // 5. DELIVERY (10%)
    let deliveryScore;
    if (sol.delivery_days <= config.deliveryExcellentDays) {
      deliveryScore = config.winWeights.delivery;
      scores.delivery = { raw: deliveryScore, pct: 100, days: sol.delivery_days, rationale: `Fast delivery (${sol.delivery_days} days)` };
    } else if (sol.delivery_days <= config.deliveryGoodDays) {
      deliveryScore = config.winWeights.delivery * 0.8;
      scores.delivery = { raw: deliveryScore, pct: 80, days: sol.delivery_days, rationale: `Standard delivery (${sol.delivery_days} days)` };
    } else {
      deliveryScore = config.winWeights.delivery * 0.4;
      scores.delivery = { raw: deliveryScore, pct: 40, days: sol.delivery_days, rationale: `Long delivery window (${sol.delivery_days} days)` };
    }
    totalScore += deliveryScore;

    // 6. PRICE CEILING (5%)
    let priceCeilingScore;
    if (bidMath.m275 && bidMath.m275.feasible && bidMath.m275.sellPrice >= sol.unit_price) {
      priceCeilingScore = config.winWeights.priceCeiling;
      scores.priceCeiling = { raw: priceCeilingScore, pct: 100, rationale: "Historical price supports margin target" };
    } else {
      priceCeilingScore = config.winWeights.priceCeiling * 0.5;
      scores.priceCeiling = { raw: priceCeilingScore, pct: 50, rationale: "Price ceiling tight, margin risky" };
    }
    totalScore += priceCeilingScore;

    // WINNING LANE BONUS (+15 pts) — verified supplier bench exists
    const WINNING_LANES = ["5305","5310","5315","5320","5340","4330","4730","2910","9510"];
    const laneBonusScore = WINNING_LANES.includes(sol.fsc) ? 15 : 0;
    scores.laneBonus = laneBonusScore > 0
      ? { raw: 15, pct: 100, rationale: `Home turf FSC ${sol.fsc} — verified supplier bench` }
      : { raw: 0,  pct: 0,   rationale: `FSC ${sol.fsc} — no verified bench yet` };
    totalScore += laneBonusScore;

    const winProbability = Math.min(totalScore / 115, 1.0); // 115 = 100 base + 15 bonus max
    return { scores, totalScore, winProbability, winProbabilityPct: Math.round(winProbability * 100) };
  }

  // ── MAIN ANALYSIS FUNCTION ───────────────────────────────────────────
  function analyzeNavigatorBatch(sols, rolodex, competitionData = {}, userConfig = {}) {
    const config = { ...DEFAULT_CONFIG, ...userConfig };

    const sourcingMap = {};
    for (const supplier of rolodex) {
      const fscs = (supplier.FSCs || "").split(/[,;]/).map((f) => f.trim());
      for (const fsc of fscs) {
        if (fsc) {
          const key = `FSC_${fsc}`;
          if (!sourcingMap[key]) sourcingMap[key] = [];
          sourcingMap[key].push(supplier.Company);
        }
      }
    }

    const go = [];
    const verify = [];
    const rejected = [];

    for (const sol of sols) {
      // FIX [4]: pass primeKillFSCs into hardRejectGate
      const rejectCheck = hardRejectGate(
        sol,
        config.rejectCAGEs,
        config.rejectOEMs,
        config.primeKillFSCs
      );
      if (rejectCheck.isReject) {
        rejected.push({ sol_number: sol.sol_number, reason: rejectCheck.reason, item_name: sol.item_name });
        continue;
      }

      const historicalPrice = sol.unit_price || 0;
      if (historicalPrice <= 0) {
        rejected.push({ sol_number: sol.sol_number, reason: "No pricing data", item_name: sol.item_name });
        continue;
      }

      const bidMath = calculateBidMath(sol.unit_price, sol.qty, historicalPrice, config);

      const hasViablePath = Object.values(bidMath).some((m) => m.viable === true);
      if (!hasViablePath) {
        rejected.push({ sol_number: sol.sol_number, reason: "No viable margin (all below net floor)", item_name: sol.item_name });
        continue;
      }

      const winCalc = scoreWinProbability(sol, bidMath, sourcingMap, competitionData, config);

      const record = {
        sol_number: sol.sol_number,
        nsn: sol.nsn,
        fsc: sol.fsc,
        item_name: sol.item_name,
        qty: sol.qty,
        unit_price: sol.unit_price,
        ext_price: sol.ext_price,
        delivery_days: sol.delivery_days,
        set_aside: sol.set_aside,
        jcp_status: sol.jcp_status,
        drawings_available: sol.drawings_available,
        quote_due: sol.quote_due,
        bidMath,
        winProbability: winCalc.winProbability,
        winProbabilityPct: winCalc.winProbabilityPct,
        winScores: winCalc.scores,
        totalScore: winCalc.totalScore,
        verdict:
          winCalc.winProbability >= config.winProbGO
            ? "GO"
            : winCalc.winProbability >= config.winProbVerify
            ? "VERIFY FIRST"
            : "REJECT",
      };

      if (record.verdict === "GO") go.push(record);
      else if (record.verdict === "VERIFY FIRST") verify.push(record);
      else rejected.push({ sol_number: record.sol_number, reason: `Low win prob: ${record.winProbabilityPct}%`, item_name: record.item_name });
    }

    go.sort((a, b) => b.winProbability - a.winProbability);
    verify.sort((a, b) => b.winProbability - a.winProbability);

    return {
      go,
      verify,
      rejected,
      summary: {
        total: sols.length,
        go: go.length,
        verify: verify.length,
        rejected: rejected.length,
        goRate: ((go.length / sols.length) * 100).toFixed(1),
        avgWinProbGO:
          go.length > 0
            ? ((go.reduce((sum, r) => sum + r.winProbability, 0) / go.length) * 100).toFixed(1)
            : "N/A",
      },
    };
  }

  return {
    analyzeNavigatorBatch,
    calculateBidMath,
    scoreWinProbability,
    hardRejectGate,
    PRIME_DOMINATED_FSCS,
    DEFAULT_CONFIG,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = NavigatorAnalyzer;
}
