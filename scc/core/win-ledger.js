(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — WIN LEDGER
  //  Tracks NSNs/PNs we've won and who supplied them.
  //  When that NSN surfaces again the system flags it with the go-to vendor.
  //  Exports: window.SCC_WIN_LEDGER
  // ═══════════════════════════════════════════════════════════════════════

  const LS_KEY = "scc_win_ledger";

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
  }
  function save(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {}
  }

  function logWin(entry) {
    // entry: { nsn, pn, item_name, vendor_name, vendor_id, price, bid_price, qty, sol_number, date, notes }
    const arr = load();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    arr.push({ id, ...entry, logged: new Date().toISOString().slice(0, 10) });
    save(arr);
    return id;
  }

  function removeWin(id) {
    save(load().filter(w => w.id !== id));
  }

  // Returns all wins matching an NSN or part number (case-insensitive)
  function lookup(nsn, pn) {
    const n = (nsn || "").trim().toUpperCase();
    const p = (pn  || "").trim().toUpperCase();
    return load().filter(w => {
      if (n && (w.nsn || "").trim().toUpperCase() === n) return true;
      if (p && (w.pn  || "").trim().toUpperCase() === p) return true;
      return false;
    }).sort((a, b) => (b.logged || "").localeCompare(a.logged || ""));
  }

  // Quick boolean — used by pipeline table to show badge
  function hasWin(nsn, pn) {
    return lookup(nsn, pn).length > 0;
  }

  // Returns the most recent win entry (for badge tooltip)
  function bestWin(nsn, pn) {
    return lookup(nsn, pn)[0] || null;
  }

  // Returns { days, color, label } for display
  function winAge(w) {
    const d = new Date(w.date || w.logged);
    if (isNaN(d)) return null;
    const days = Math.floor((Date.now() - d) / 86400000);
    if (days < 90)  return { days, color: "#4caf50", label: days + "d" };
    if (days < 180) return { days, color: "#ffc107", label: days + "d" };
    return { days, color: "#ef5350", label: days + "d ⚠" };
  }

  // Net per unit after estimated FE (default 5% = 30-day standard)
  function netAfterFE(bid_price, cost, fe_pct) {
    const fe = (fe_pct != null ? fe_pct : 5) / 100;
    if (bid_price == null || cost == null) return null;
    return +((bid_price * (1 - fe)) - cost).toFixed(4);
  }

  window.SCC_WIN_LEDGER = { logWin, removeWin, lookup, hasWin, bestWin, load, winAge, netAfterFE };
})();
