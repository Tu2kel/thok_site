(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — BID MATH ENGINE v2
  //  Factoring Express fee structure — time-based, worst-case 7.5%
  //  All pricing calculations live here. No UI dependencies.
  // ═══════════════════════════════════════════════════════════════════════

  const TIER_MARGINS = {
    Standard: 0.275,
    "Fast Award": 0.35,
    "Low Hanging Fruit": 0.4,
    "Small Business Set-Aside": 0.3,
    "Floor 8%": 0.08,
    "Floor 10%": 0.1,
    "Floor 15%": 0.15,
  };

  const STATUSES = [
    "New",
    "Researching",
    "Sourcing",
    "Bid Submitted",
    "Pending Award",
    "Awarded",
    "Lost",
    "No Source",
    "On Hold",
  ];

  // ── FACTORING EXPRESS FEE CONSTANTS ─────────────────────────────────────
  // Factoring: 1.67% first 20 days, then 0.833% per each additional 10 days
  // PO Funding: 2.50% of PO amount flat
  // Worst case (day 60): 1.67 + (4 × 0.833) = 5.002% factoring + 2.50% PO = 7.502%
  const FE = {
    ADVANCE_RATE: 0.8, // 80% advance
    RESERVE_RATE: 0.2, // 20% held in reserve
    FACTOR_BASE_PCT: 1.67, // % for first 20 days
    FACTOR_BASE_DAYS: 20, // base window
    FACTOR_EXTRA_PCT: 0.833, // % per additional 10-day period
    FACTOR_EXTRA_DAYS: 10, // increment
    PO_FEE_PCT: 2.5, // % of PO amount
    PO_OVERRUN_PCT: 1.0, // % per extra 10-day period if no invoice within 30d
    WORST_CASE_COMBINED: 7.5, // worst case factoring + PO (day 60)
  };

  // ── FE FEE CALCULATOR ────────────────────────────────────────────────────
  // payDay: expected day DLA pays (20–60). Returns combined % of invoice.
  function calcFEFees(invoiceAmt, payDay, usePOFunding) {
    payDay = Math.max(1, Math.min(60, parseInt(payDay) || 60));

    // Factoring fee (applied to invoice amount)
    let factorPct = FE.FACTOR_BASE_PCT;
    if (payDay > FE.FACTOR_BASE_DAYS) {
      const extraPeriods = Math.ceil(
        (payDay - FE.FACTOR_BASE_DAYS) / FE.FACTOR_EXTRA_DAYS,
      );
      factorPct += extraPeriods * FE.FACTOR_EXTRA_PCT;
    }
    const factorFee = +((invoiceAmt * factorPct) / 100).toFixed(2);

    // PO funding fee (applied to invoice/PO amount)
    const poFee = usePOFunding
      ? +((invoiceAmt * FE.PO_FEE_PCT) / 100).toFixed(2)
      : 0;

    const totalFee = +(factorFee + poFee).toFixed(2);
    const totalPct = invoiceAmt > 0 ? (totalFee / invoiceAmt) * 100 : 0;
    const advanceAmt = +(invoiceAmt * FE.ADVANCE_RATE).toFixed(2);
    const reserveAmt = +(invoiceAmt * FE.RESERVE_RATE).toFixed(2);

    return {
      factorPct,
      factorFee,
      poFee,
      totalFee,
      totalPct,
      advanceAmt,
      reserveAmt,
      payDay,
    };
  }

  // Currency formatter
  const fmt = (n) =>
    n != null
      ? "$" +
        parseFloat(n).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

  // Tier → CSS class
  const tierClass = (t) =>
    t?.includes("Hanging")
      ? "tier-lhf"
      : t?.includes("Fast")
        ? "tier-fast"
        : "tier-std";

  // Auto-tier based on urgency
  function calcPricing(unitPrice, quoteDue, postedDate) {
    let tier = "Standard",
      targetMargin = 0.3;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const parseD = (s) => {
        const [m, d, y] = s.split("/");
        return new Date(2000 + parseInt(y), m - 1, d);
      };
      const due = parseD(quoteDue);
      const posted = postedDate ? parseD(postedDate) : today;
      const daysLeft = Math.round((due - today) / 86400000);
      const window_ = Math.round((due - posted) / 86400000);
      if (daysLeft < 0) {
        tier = "Low Hanging Fruit";
        targetMargin = 0.425;
      } else if (window_ <= 3) {
        tier = "Fast Award";
        targetMargin = 0.4;
      }
    } catch (e) {}
    const bidPrice = unitPrice ? +unitPrice.toFixed(2) : null;
    const estCost = unitPrice ? +(unitPrice * 0.7).toFixed(2) : null;
    return { tier, targetMargin, bid_price: bidPrice, est_cost: estCost };
  }

  // Core bid math — Factoring Express aware
  // payDay: expected DLA payment day (default 60 = worst case)
  // usePOFunding: true if using FE PO advance
  // selfFunded: true if deal is ≤$10K, no SSC fees
  function calcBidMath(
    supplierUnit,
    qty,
    tierMargin,
    factoring,
    pofunding,
    shipping,
    payDay,
    usePOFunding,
    selfFunded,
  ) {
    const costUnit = parseFloat(supplierUnit) || 0;
    const bidUnit =
      costUnit > 0 ? +(costUnit / (1 - tierMargin)).toFixed(2) : 0;
    const bidTotal = +(bidUnit * qty).toFixed(2);
    const cogs = +(costUnit * qty + (parseFloat(shipping) || 0)).toFixed(2);
    const gp = +(bidTotal - cogs).toFixed(2);
    const gpPct = bidTotal > 0 ? (gp / bidTotal) * 100 : 0;

    let dedAmt = 0;
    let feDetail = null;

    if (selfFunded) {
      // Self-funded: no SSC fees
      dedAmt = 0;
    } else if (usePOFunding !== undefined) {
      // New FE fee model
      const pd = payDay || 60;
      feDetail = calcFEFees(bidTotal, pd, !!usePOFunding);
      dedAmt = feDetail.totalFee;
    } else {
      // Legacy flat % fallback (old callers pass factoring/pofunding as %)
      dedAmt = +(
        (bidTotal *
          ((parseFloat(factoring) || 0) + (parseFloat(pofunding) || 0))) /
        100
      ).toFixed(2);
    }

    const net = +(gp - dedAmt).toFixed(2);
    const netPct = bidTotal > 0 ? (net / bidTotal) * 100 : 0;

    return {
      bidUnit,
      bidTotal,
      cogs,
      gp,
      gpPct,
      dedAmt,
      net,
      netPct,
      feDetail,
    };
  }

  // Expose globally
  window.SCC_MATH = {
    TIER_MARGINS,
    STATUSES,
    FE,
    fmt,
    tierClass,
    calcPricing,
    calcBidMath,
    calcFEFees,
  };
})();
