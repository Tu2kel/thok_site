(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PERSISTENCE LAYER
  //  Keys are fixed forever — never rename or data orphans.
  // ═══════════════════════════════════════════════════════════════════════

  const LS_SOLS = "imperio_scc_solicitations";
  const LS_VI   = "imperio_scc_vendor_intel";
  const LS_ARC  = "imperio_scc_archive";       // ← never rename

  // ── Raw localStorage helpers ──
  function lsGetSols() {
    try { return JSON.parse(localStorage.getItem(LS_SOLS) || "[]"); } catch(e) { return []; }
  }
  function lsSaveSols(arr) {
    try { localStorage.setItem(LS_SOLS, JSON.stringify(arr)); }
    catch(e) { alert("Storage full — export a backup and clear old data."); }
  }
  function lsGetVI() {
    try { return JSON.parse(localStorage.getItem(LS_VI) || "[]"); } catch(e) { return []; }
  }
  function lsSaveVI(arr) {
    try { localStorage.setItem(LS_VI, JSON.stringify(arr)); } catch(e) {}
  }
  function lsGetArc() {
    try { return JSON.parse(localStorage.getItem(LS_ARC) || "[]"); } catch(e) { return []; }
  }
  function lsSaveArc(arr) {
    try { localStorage.setItem(LS_ARC, JSON.stringify(arr)); }
    catch(e) { alert("Storage full — export a backup."); }
  }

  // ── Solicitations CRUD ──
  async function dbSave(record) {
    const arr = lsGetSols();
    const idx = arr.findIndex((r) => r.sol_number === record.sol_number);
    if (idx >= 0) arr[idx] = record;
    else arr.push(record);
    lsSaveSols(arr);
    return true;
  }
  async function dbGetAll() {
    return lsGetSols();
  }
  async function dbDelete(sol_number) {
    lsSaveSols(lsGetSols().filter((r) => r.sol_number !== sol_number));
    return true;
  }

  // ── Vendor Intel CRUD ──
  async function viSave(rec) {
    const arr = lsGetVI();
    const idx = arr.findIndex((r) => r.id === rec.id);
    if (idx >= 0) arr[idx] = rec;
    else arr.push(rec);
    lsSaveVI(arr);
    return true;
  }
  async function viGetAll() {
    return lsGetVI();
  }
  async function viDelete(id) {
    lsSaveVI(lsGetVI().filter((r) => r.id !== id));
    return true;
  }
  async function viGetByNSN(nsn) {
    return lsGetVI()
      .filter((r) => r.nsn === nsn)
      .sort((a, b) => {
        const rank = { confirmed: 0, quoted: 1, pending: 2, no_stock: 3 };
        return (
          (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
          (parseFloat(a.unit_price) || 999) - (parseFloat(b.unit_price) || 999)
        );
      });
  }

  // ── Archive CRUD ──
  // Moves a sol out of active pipeline into archive — all data preserved.
  // Vendor intel (keyed by NSN/part number) stays in its own table untouched.
  async function dbArchive(sol_number, reason) {
    const arr = lsGetSols();
    const rec = arr.find(r => r.sol_number === sol_number);
    if (!rec) return false;
    const archived = {
      ...rec,
      archived:        true,
      archive_reason:  reason || 'expired',
      archive_date:    new Date().toLocaleDateString(),
    };
    // Save to archive table
    const arc = lsGetArc();
    const idx = arc.findIndex(r => r.sol_number === sol_number);
    if (idx >= 0) arc[idx] = archived; else arc.push(archived);
    lsSaveArc(arc);
    // Remove from active pipeline
    lsSaveSols(arr.filter(r => r.sol_number !== sol_number));
    return true;
  }
  async function dbGetArchive() {
    return lsGetArc().sort((a, b) =>
      new Date(b.archive_date) - new Date(a.archive_date)
    );
  }
  async function dbRestoreFromArchive(sol_number) {
    const arc = lsGetArc();
    const rec = arc.find(r => r.sol_number === sol_number);
    if (!rec) return false;
    // Strip archive flags and restore to active pipeline
    const { archived, archive_reason, archive_date, ...restored } = rec;
    await dbSave(restored);
    lsSaveArc(arc.filter(r => r.sol_number !== sol_number));
    return true;
  }
  async function dbDeleteFromArchive(sol_number) {
    lsSaveArc(lsGetArc().filter(r => r.sol_number !== sol_number));
    return true;
  }

  // ── Export / Import backup ──
  async function exportAllData() {
    const sols = lsGetSols();
    const vi   = lsGetVI();
    const arc  = lsGetArc();
    const blob = new Blob(
      [JSON.stringify({ version: 4, exported: new Date().toISOString(),
          solicitations: sols, vendor_intel: vi, archive: arc }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "imperio_backup_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
  }
  async function importAllData(jsonText, onDone) {
    try {
      const data = JSON.parse(jsonText);
      const sols = data.solicitations || [];
      const vi   = data.vendor_intel  || [];
      const arc  = data.archive       || [];
      const existing = lsGetSols();
      const merged = [...existing];
      sols.forEach(r => { if (!merged.find(x => x.sol_number === r.sol_number)) merged.push(r); });
      lsSaveSols(merged);
      const existingVI = lsGetVI();
      const mergedVI = [...existingVI];
      vi.forEach(r => { if (!mergedVI.find(x => x.id === r.id)) mergedVI.push(r); });
      lsSaveVI(mergedVI);
      const existingArc = lsGetArc();
      const mergedArc = [...existingArc];
      arc.forEach(r => { if (!mergedArc.find(x => x.sol_number === r.sol_number)) mergedArc.push(r); });
      lsSaveArc(mergedArc);
      if (onDone) onDone(sols.length, vi.length);
    } catch (e) {
      alert("Import failed: " + e.message);
    }
  }

  // Expose globally
  window.SCC_DB = {
    dbSave, dbGetAll, dbDelete,
    dbArchive, dbGetArchive, dbRestoreFromArchive, dbDeleteFromArchive,
    viSave, viGetAll, viDelete, viGetByNSN,
    exportAllData, importAllData,
  };
})();
