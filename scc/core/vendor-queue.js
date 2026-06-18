// scc/core/vendor-queue.js
// Per-vendor sol cap, overflow queue, and sent suppression.
// Exports: window.SCC_VENDOR_QUEUE
(function () {
  var OVERFLOW_KEY = "scc_overflow_v1";
  var SENT_KEY     = "scc_sent_v1";
  var SOL_CAP      = 10;

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (_) { return {}; }
  }
  function save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
  }

  function parseDue(raw) {
    if (!raw) return null;
    var m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    var yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return new Date(yr, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }

  function today0() {
    var d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }

  function isExpired(sol) {
    var d = parseDue(sol.quote_due);
    return d !== null && d < today0();
  }

  function solKey(sol) {
    return sol.sol_number || sol.id || "";
  }

  function sortSols(sols) {
    return sols.slice().sort(function (a, b) {
      var ea = Number(a.ext || a.ext_price || 0);
      var eb = Number(b.ext || b.ext_price || 0);
      if (eb !== ea) return eb - ea;
      var da = parseDue(a.quote_due);
      var db = parseDue(b.quote_due);
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    });
  }

  // Build the capped batch for a vendor.
  // Returns { batch: Sol[], overflow: Sol[] }
  function buildVendorBatch(vendorKey, newSols) {
    var overflowData = load(OVERFLOW_KEY);
    var sentData     = load(SENT_KEY);
    var sentNums     = new Set(((sentData[vendorKey] || {}).solNumbers) || []);

    // Previous overflow: drop expired and already-sent
    var prevOverflow = ((overflowData[vendorKey] || {}).sols || []).filter(function (s) {
      return !isExpired(s) && !sentNums.has(solKey(s));
    });

    // New matches: drop already-sent
    var fresh = (newSols || []).filter(function (s) {
      return !sentNums.has(solKey(s));
    });

    // Merge + dedupe (overflow first so it preserves original order before re-sort)
    var seen     = new Set();
    var combined = [];
    var pool     = prevOverflow.concat(fresh);
    for (var i = 0; i < pool.length; i++) {
      var k = solKey(pool[i]);
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      combined.push(pool[i]);
    }

    // Full re-sort of combined pool: ext desc, then quote_due asc
    var sorted   = sortSols(combined);
    var batch    = sorted.slice(0, SOL_CAP);
    var overflow = sorted.slice(SOL_CAP);
    return { batch: batch, overflow: overflow };
  }

  // Call immediately after a vendor email is confirmed sent.
  function markSent(vendorKey, sentSols, remainingOverflow) {
    // Sent tracker
    var sentData = load(SENT_KEY);
    if (!sentData[vendorKey]) sentData[vendorKey] = { solNumbers: [] };
    var nums = new Set(sentData[vendorKey].solNumbers);
    for (var i = 0; i < sentSols.length; i++) nums.add(solKey(sentSols[i]));
    sentData[vendorKey].solNumbers = Array.from(nums);
    sentData[vendorKey].lastSent   = new Date().toISOString();
    save(SENT_KEY, sentData);

    // Overflow store
    var overflowData = load(OVERFLOW_KEY);
    if (remainingOverflow && remainingOverflow.length > 0) {
      overflowData[vendorKey] = { sols: remainingOverflow, savedAt: new Date().toISOString() };
    } else {
      delete overflowData[vendorKey];
    }
    save(OVERFLOW_KEY, overflowData);
  }

  function getOverflowCount(vendorKey) {
    var od = load(OVERFLOW_KEY);
    return ((od[vendorKey] || {}).sols || []).length;
  }

  function getTotalOverflow() {
    var od = load(OVERFLOW_KEY);
    return Object.values(od).reduce(function (s, v) { return s + ((v.sols || []).length); }, 0);
  }

  function clearVendorQueue(vendorKey) {
    var od = load(OVERFLOW_KEY); delete od[vendorKey]; save(OVERFLOW_KEY, od);
    var sd = load(SENT_KEY);     delete sd[vendorKey]; save(SENT_KEY, sd);
  }

  window.SCC_VENDOR_QUEUE = {
    SOL_CAP: SOL_CAP,
    buildVendorBatch: buildVendorBatch,
    markSent: markSent,
    getOverflowCount: getOverflowCount,
    getTotalOverflow: getTotalOverflow,
    clearVendorQueue: clearVendorQueue,
    sortSols: sortSols,
    parseDue: parseDue,
    isExpired: isExpired,
  };
})();
