(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PERSISTENCE LAYER
  //  Primary:  Netlify function → MongoDB Atlas (cloud, cross-device)
  //  Fallback: localStorage (offline / function unreachable)
  //  Keys are fixed forever — never rename or data orphans.
  // ═══════════════════════════════════════════════════════════════════════

  const API = "/.netlify/functions/scc-db";

  const LS_SOLS = "imperio_scc_solicitations";
  const LS_VI   = "imperio_scc_vendor_intel";
  const LS_ARC  = "imperio_scc_archive";

  // ── Call the Netlify function ──
  async function api(action, payload = {}) {
    const res = await fetch(API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action, payload }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Unknown API error");
    return data.result;
  }

  // ── localStorage helpers (fallback) ──
  function lsGet(key, def = []) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); }
    catch { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch { alert("Storage full — export a backup and clear old data."); }
  }

  // ── Solicitations CRUD ──
  async function dbSave(record) {
    try { return await api("dbSave", { record }); }
    catch {
      const arr = lsGet(LS_SOLS);
      const idx = arr.findIndex(r => r.sol_number === record.sol_number);
      if (idx >= 0) arr[idx] = record; else arr.push(record);
      lsSet(LS_SOLS, arr);
      return true;
    }
  }
  async function dbGetAll() {
    try { return await api("dbGetAll"); }
    catch { return lsGet(LS_SOLS); }
  }
  async function dbDelete(sol_number) {
    try { return await api("dbDelete", { sol_number }); }
    catch {
      lsSet(LS_SOLS, lsGet(LS_SOLS).filter(r => r.sol_number !== sol_number));
      return true;
    }
  }

  // ── Archive CRUD ──
  async function dbArchive(sol_number, reason) {
    try { return await api("dbArchive", { sol_number, reason }); }
    catch {
      const arr = lsGet(LS_SOLS);
      const rec = arr.find(r => r.sol_number === sol_number);
      if (!rec) return false;
      const archived = { ...rec, archived: true, archive_reason: reason || "expired",
        archive_date: new Date().toLocaleDateString() };
      const arc = lsGet(LS_ARC);
      const idx = arc.findIndex(r => r.sol_number === sol_number);
      if (idx >= 0) arc[idx] = archived; else arc.push(archived);
      lsSet(LS_ARC, arc);
      lsSet(LS_SOLS, arr.filter(r => r.sol_number !== sol_number));
      return true;
    }
  }
  async function dbGetArchive() {
    try { return await api("dbGetArchive"); }
    catch {
      return lsGet(LS_ARC).sort((a, b) => new Date(b.archive_date) - new Date(a.archive_date));
    }
  }
  async function dbRestoreFromArchive(sol_number) {
    try { return await api("dbRestoreFromArchive", { sol_number }); }
    catch {
      const arc = lsGet(LS_ARC);
      const rec = arc.find(r => r.sol_number === sol_number);
      if (!rec) return false;
      const { archived, archive_reason, archive_date, ...restored } = rec;
      await dbSave(restored);
      lsSet(LS_ARC, arc.filter(r => r.sol_number !== sol_number));
      return true;
    }
  }
  async function dbDeleteFromArchive(sol_number) {
    try { return await api("dbDeleteFromArchive", { sol_number }); }
    catch {
      lsSet(LS_ARC, lsGet(LS_ARC).filter(r => r.sol_number !== sol_number));
      return true;
    }
  }

  // ── Vendor Intel CRUD ──
  async function viSave(rec) {
    try { return await api("viSave", { rec }); }
    catch {
      const arr = lsGet(LS_VI);
      const idx = arr.findIndex(r => r.id === rec.id);
      if (idx >= 0) arr[idx] = rec; else arr.push(rec);
      lsSet(LS_VI, arr);
      return true;
    }
  }
  async function viGetAll() {
    try { return await api("viGetAll"); }
    catch { return lsGet(LS_VI); }
  }
  async function viDelete(id) {
    try { return await api("viDelete", { id }); }
    catch {
      lsSet(LS_VI, lsGet(LS_VI).filter(r => r.id !== id));
      return true;
    }
  }
  async function viGetByNSN(nsn) {
    try { return await api("viGetByNSN", { nsn }); }
    catch {
      const rank = { confirmed: 0, quoted: 1, pending: 2, no_stock: 3 };
      return lsGet(LS_VI)
        .filter(r => r.nsn === nsn)
        .sort((a, b) =>
          (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
          (parseFloat(a.unit_price) || 999) - (parseFloat(b.unit_price) || 999)
        );
    }
  }

  // ── Export / Import backup ──
  async function exportAllData() {
    try {
      const data = await api("exportAll");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "imperio_backup_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
    } catch {
      // Fallback: export from localStorage
      const blob = new Blob([JSON.stringify({
        version: 4, exported: new Date().toISOString(),
        solicitations: lsGet(LS_SOLS), vendor_intel: lsGet(LS_VI), archive: lsGet(LS_ARC),
      }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "imperio_backup_ls_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
    }
  }
  async function importAllData(jsonText, onDone) {
    try {
      const data = JSON.parse(jsonText);
      const sols = data.solicitations || [];
      const vi   = data.vendor_intel  || [];
      const arc  = data.archive       || [];
      try {
        const { solCount, viCount } = await api("importAll", { solicitations: sols, vendor_intel: vi, archive: arc });
        if (onDone) onDone(solCount, viCount);
      } catch {
        // Fallback: merge into localStorage
        const existing = lsGet(LS_SOLS);
        const merged = [...existing];
        sols.forEach(r => { if (!merged.find(x => x.sol_number === r.sol_number)) merged.push(r); });
        lsSet(LS_SOLS, merged);
        const existingVI = lsGet(LS_VI);
        const mergedVI = [...existingVI];
        vi.forEach(r => { if (!mergedVI.find(x => x.id === r.id)) mergedVI.push(r); });
        lsSet(LS_VI, mergedVI);
        const existingArc = lsGet(LS_ARC);
        const mergedArc = [...existingArc];
        arc.forEach(r => { if (!mergedArc.find(x => x.sol_number === r.sol_number)) mergedArc.push(r); });
        lsSet(LS_ARC, mergedArc);
        if (onDone) onDone(sols.length, vi.length);
      }
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
