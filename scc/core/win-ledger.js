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

  window.SCC_WIN_LEDGER = { logWin, removeWin, lookup, hasWin, bestWin, load };
})();
