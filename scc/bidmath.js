(function() {
// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — BID MATH ENGINE
//  All pricing calculations live here. No UI dependencies.
// ═══════════════════════════════════════════════════════════════════════

const TIER_MARGINS = {
  'Fast Award':              0.40,
  'Low Hanging Fruit':       0.425,
  'Standard':                0.30,
  'Small Business Set-Aside':0.35,
};

const STATUSES = [
  'New','Researching','Sourcing','Bid Submitted',
  'Pending Award','Awarded','Lost','On Hold'
];

// Currency formatter
const fmt = n =>
  n != null ? '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

// Tier → CSS class
const tierClass = t =>
  t?.includes('Hanging') ? 'tier-lhf' : t?.includes('Fast') ? 'tier-fast' : 'tier-std';

// Auto-tier based on urgency
function calcPricing(unitPrice, quoteDue, postedDate) {
  let tier = 'Standard', targetMargin = 0.30;
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parseD = s => { const [m, d, y] = s.split('/'); return new Date(2000 + parseInt(y), m - 1, d); };
    const due    = parseD(quoteDue);
    const posted = postedDate ? parseD(postedDate) : today;
    const daysLeft  = Math.round((due - today) / 86400000);
    const window_   = Math.round((due - posted) / 86400000);
    if (daysLeft < 0)    { tier = 'Low Hanging Fruit'; targetMargin = 0.425; }
    else if (window_ <= 3) { tier = 'Fast Award';       targetMargin = 0.40;  }
  } catch(e) {}
  const bidPrice = unitPrice ? +unitPrice.toFixed(2) : null;
  const estCost  = unitPrice ? +(unitPrice * 0.70).toFixed(2) : null;
  return { tier, targetMargin, bid_price: bidPrice, est_cost: estCost };
}

// Core bid math — all financial outputs from a single call
function calcBidMath(supplierUnit, qty, tierMargin, factoring, pofunding, shipping) {
  const margin   = tierMargin;
  const costUnit = parseFloat(supplierUnit) || 0;
  const bidUnit  = costUnit > 0 ? +(costUnit / (1 - margin)).toFixed(2) : 0;
  const bidTotal = +(bidUnit * qty).toFixed(2);
  const cogs     = +(costUnit * qty + (parseFloat(shipping) || 0)).toFixed(2);
  const gp       = +(bidTotal - cogs).toFixed(2);
  const gpPct    = bidTotal > 0 ? (gp / bidTotal) * 100 : 0;
  const dedAmt   = +(bidTotal * ((parseFloat(factoring) || 0) + (parseFloat(pofunding) || 0)) / 100).toFixed(2);
  const net      = +(gp - dedAmt).toFixed(2);
  return { bidUnit, bidTotal, cogs, gp, gpPct, dedAmt, net };
}

// Expose globally
window.SCC_MATH = { TIER_MARGINS, STATUSES, fmt, tierClass, calcPricing, calcBidMath };
})();
