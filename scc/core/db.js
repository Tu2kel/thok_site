(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PERSISTENCE LAYER
  //  Keys are fixed forever — never rename or data orphans.
  // ═══════════════════════════════════════════════════════════════════════

  const LS_SOLS = "imperio_scc_solicitations";
  const LS_VI = "imperio_scc_vendor_intel";
  const LS_ARC = "imperio_scc_archive"; // ← never rename
  const LS_AWARDS = "imperio_scc_awards"; // contract records + sales orders + invoices
  const LS_VOID = "imperio_scc_void_log"; // retired/deleted document numbers — never recycled
  const LS_SEQ = "imperio_scc_doc_sequence"; // sequential counter per entity+year
  const LS_FY_HISTORY = "imperio_scc_fy_history"; // closed FY summary records — never deleted
  const LS_ACTIVE_FY = "imperio_scc_active_fy"; // current active fiscal year (number)

  // ── Raw localStorage helpers ──
  function lsGetSols() {
    try {
      return JSON.parse(localStorage.getItem(LS_SOLS) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSaveSols(arr) {
    try {
      localStorage.setItem(LS_SOLS, JSON.stringify(arr));
    } catch (e) {
      alert("Storage full — export a backup and clear old data.");
    }
  }
  function lsGetVI() {
    try {
      return JSON.parse(localStorage.getItem(LS_VI) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSaveVI(arr) {
    try {
      localStorage.setItem(LS_VI, JSON.stringify(arr));
    } catch (e) {}
  }
  function lsGetArc() {
    try {
      return JSON.parse(localStorage.getItem(LS_ARC) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSaveArc(arr) {
    try {
      localStorage.setItem(LS_ARC, JSON.stringify(arr));
    } catch (e) {
      alert("Storage full — export a backup.");
    }
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

  async function dbClearAll() {
    lsSaveSols([]);
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
    const rec = arr.find((r) => r.sol_number === sol_number);
    if (!rec) return false;
    const archived = {
      ...rec,
      archived: true,
      archive_reason: reason || "expired",
      archive_date: new Date().toLocaleDateString(),
    };
    // Save to archive table
    const arc = lsGetArc();
    const idx = arc.findIndex((r) => r.sol_number === sol_number);
    if (idx >= 0) arc[idx] = archived;
    else arc.push(archived);
    lsSaveArc(arc);
    // Remove from active pipeline
    lsSaveSols(arr.filter((r) => r.sol_number !== sol_number));
    return true;
  }
  async function dbGetArchive() {
    return lsGetArc().sort(
      (a, b) => new Date(b.archive_date) - new Date(a.archive_date),
    );
  }
  async function dbRestoreFromArchive(sol_number) {
    const arc = lsGetArc();
    const rec = arc.find((r) => r.sol_number === sol_number);
    if (!rec) return false;
    // Strip archive flags and restore to active pipeline
    const { archived, archive_reason, archive_date, ...restored } = rec;
    await dbSave(restored);
    lsSaveArc(arc.filter((r) => r.sol_number !== sol_number));
    return true;
  }
  async function dbDeleteFromArchive(sol_number) {
    lsSaveArc(lsGetArc().filter((r) => r.sol_number !== sol_number));
    return true;
  }

  async function exportAllData() {
    const sols = lsGetSols();
    const vi = lsGetVI();
    const arc = lsGetArc();
    const awards = lsGetAwards();
    const voidLog = lsGetVoidLog();
    const seq = lsGetSeq();
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 5,
            exported: new Date().toISOString(),
            solicitations: sols,
            vendor_intel: vi,
            archive: arc,
            awards,
            void_log: voidLog,
            doc_sequence: seq,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      "imperio_backup_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
  }
  async function importAllData(jsonText, onDone) {
    try {
      const data = JSON.parse(jsonText);
      const sols = data.solicitations || [];
      const vi = data.vendor_intel || [];
      const arc = data.archive || [];
      const awards = data.awards || [];
      const voidLog = data.void_log || [];
      const seq = data.doc_sequence || {};
      const existing = lsGetSols();
      const merged = [...existing];
      sols.forEach((r) => {
        if (!merged.find((x) => x.sol_number === r.sol_number)) merged.push(r);
      });
      lsSaveSols(merged);
      const existingVI = lsGetVI();
      const mergedVI = [...existingVI];
      vi.forEach((r) => {
        if (!mergedVI.find((x) => x.id === r.id)) mergedVI.push(r);
      });
      lsSaveVI(mergedVI);
      const existingArc = lsGetArc();
      const mergedArc = [...existingArc];
      arc.forEach((r) => {
        if (!mergedArc.find((x) => x.sol_number === r.sol_number))
          mergedArc.push(r);
      });
      lsSaveArc(mergedArc);
      const existingAwards = lsGetAwards();
      const mergedAwards = [...existingAwards];
      awards.forEach((r) => {
        if (!mergedAwards.find((x) => x.award_id === r.award_id))
          mergedAwards.push(r);
      });
      lsSaveAwards(mergedAwards);
      // Merge void log
      const existingVoid = lsGetVoidLog();
      const mergedVoid = [...existingVoid];
      voidLog.forEach((r) => {
        if (
          !mergedVoid.find(
            (x) => x.doc_number === r.doc_number && x.void_date === r.void_date,
          )
        )
          mergedVoid.push(r);
      });
      lsSaveVoidLog(mergedVoid);
      // Merge sequence — take the MAX of each key to avoid number collision
      const existingSeq = lsGetSeq();
      const mergedSeq = { ...existingSeq };
      Object.entries(seq).forEach(([k, v]) => {
        mergedSeq[k] = Math.max(mergedSeq[k] || 0, v);
      });
      lsSaveSeq(mergedSeq);
      if (onDone) onDone(sols.length, vi.length);
    } catch (e) {
      alert("Import failed: " + e.message);
    }
  }

  // ── Award Records CRUD ──────────────────────────────────────────────
  // Document number format: TYPE-ENTITY-YEAR-NNNN  e.g. INV-IMP-2026-0042
  // Counter is global per entity+year — never recycles, gaps are intentional.

  function lsGetAwards() {
    try {
      return JSON.parse(localStorage.getItem(LS_AWARDS) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSaveAwards(arr) {
    try {
      localStorage.setItem(LS_AWARDS, JSON.stringify(arr));
    } catch (e) {
      alert("Storage full — export a backup and clear old data.");
    }
  }
  function lsGetVoidLog() {
    try {
      return JSON.parse(localStorage.getItem(LS_VOID) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSaveVoidLog(arr) {
    try {
      localStorage.setItem(LS_VOID, JSON.stringify(arr));
    } catch (e) {}
  }
  function lsGetSeq() {
    try {
      return JSON.parse(localStorage.getItem(LS_SEQ) || "{}");
    } catch (e) {
      return {};
    }
  }
  function lsSaveSeq(obj) {
    try {
      localStorage.setItem(LS_SEQ, JSON.stringify(obj));
    } catch (e) {}
  }

  // Generate next sequential document number — never recycles
  // type: 'PO' | 'SO' | 'INV'   entity: 'IMP' | 'THOK' etc.
  function nextDocNumber(type, entity) {
    entity = (entity || "IMP").toUpperCase();
    const year = new Date().getFullYear();
    const key = entity + "_" + year;
    const seq = lsGetSeq();
    const next = (seq[key] || 0) + 1;
    seq[key] = next;
    lsSaveSeq(seq);
    const padded = String(next).padStart(4, "0");
    return type.toUpperCase() + "-" + entity + "-" + year + "-" + padded;
  }

  // Peek at what the next number will be without consuming it
  function peekDocNumber(type, entity) {
    entity = (entity || "IMP").toUpperCase();
    const year = new Date().getFullYear();
    const key = entity + "_" + year;
    const seq = lsGetSeq();
    const next = (seq[key] || 0) + 1;
    const padded = String(next).padStart(4, "0");
    return type.toUpperCase() + "-" + entity + "-" + year + "-" + padded;
  }

  // Save a new award record (contract + sales order + invoice as one document)
  async function awardSave(record) {
    const arr = lsGetAwards();
    const idx = arr.findIndex((r) => r.award_id === record.award_id);
    if (idx >= 0) arr[idx] = record;
    else arr.push(record);
    lsSaveAwards(arr);
    return true;
  }

  async function awardGetAll() {
    return lsGetAwards().sort(
      (a, b) => new Date(b.award_date || 0) - new Date(a.award_date || 0),
    );
  }

  async function awardGetBySol(sol_number) {
    return lsGetAwards().find((r) => r.sol_number === sol_number) || null;
  }

  // Void an award record — retires all doc numbers, logs them, removes from active
  async function awardVoid(award_id, reason) {
    const arr = lsGetAwards();
    const rec = arr.find((r) => r.award_id === award_id);
    if (!rec) return false;
    const voidLog = lsGetVoidLog();
    // Retire each document number that was generated
    ["po_number", "so_number", "inv_number"].forEach((field) => {
      if (rec[field]) {
        voidLog.push({
          doc_number: rec[field],
          award_id: award_id,
          sol_number: rec.sol_number,
          void_date: new Date().toISOString(),
          void_reason: reason || "voided by user",
        });
      }
    });
    lsSaveVoidLog(voidLog);
    lsSaveAwards(arr.filter((r) => r.award_id !== award_id));
    return true;
  }

  async function awardGetVoidLog() {
    return lsGetVoidLog().sort(
      (a, b) => new Date(b.void_date) - new Date(a.void_date),
    );
  }

  // ── FISCAL YEAR MANAGEMENT ───────────────────────────────────────────────
  // FY history: array of closed year summaries. Never deleted, grows one row/year.
  // Active FY: the year currently open for business. Defaults to current calendar year.

  function lsGetFYHistory() {
    try {
      return JSON.parse(localStorage.getItem(LS_FY_HISTORY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSaveFYHistory(arr) {
    try {
      localStorage.setItem(LS_FY_HISTORY, JSON.stringify(arr));
    } catch (e) {}
  }
  function getActiveFY() {
    const stored = localStorage.getItem(LS_ACTIVE_FY);
    return stored ? parseInt(stored) : new Date().getFullYear();
  }
  function setActiveFY(year) {
    localStorage.setItem(LS_ACTIVE_FY, String(year));
  }
  function getFYHistory() {
    return lsGetFYHistory();
  }

  // Derive FY from an award_date string (M/D/YY or M/D/YYYY or ISO)
  function fyFromDate(dateStr) {
    if (!dateStr) return null;
    // Try ISO first
    const iso = new Date(dateStr);
    if (!isNaN(iso)) return iso.getFullYear();
    // Try M/D/YY
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const y = parseInt(parts[2]);
      return y < 100 ? 2000 + y : y;
    }
    return null;
  }

  // ── FY CLOSE — the big one ───────────────────────────────────────────────
  // Steps:
  //  1. Force a full backup download (cannot skip)
  //  2. Tag all awards for closing year with fy field
  //  3. Tag and archive all closed pipeline rows (Awarded/Lost/No Bid) with fy
  //  4. Tag and archive closed ESBD bids with fy
  //  5. Write FY summary record to history
  //  6. Advance active FY to next year
  //  Returns: { ok, summary } or throws

  async function closeFiscalYear(year, onBackupDone) {
    year = parseInt(year);
    if (!year || isNaN(year)) throw new Error("Invalid fiscal year");

    // ── Step 1: Force backup ──────────────────────────────────────────────
    const sols = lsGetSols();
    const vi = lsGetVI();
    const arc = lsGetArc();
    const awards = lsGetAwards();
    const voidLog = lsGetVoidLog();
    const seq = lsGetSeq();
    const fyHist = lsGetFYHistory();
    const esbdRaw = (() => {
      try {
        return JSON.parse(localStorage.getItem("imperio_esbd_bids") || "[]");
      } catch (e) {
        return [];
      }
    })();

    const backupPayload = JSON.stringify(
      {
        version: 6,
        exported: new Date().toISOString(),
        fy_close_year: year,
        solicitations: sols,
        vendor_intel: vi,
        archive: arc,
        awards,
        esbd_bids: esbdRaw,
        void_log: voidLog,
        doc_sequence: seq,
        fy_history: fyHist,
      },
      null,
      2,
    );

    const blob = new Blob([backupPayload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      "imperio_FY" +
      year +
      "_close_backup_" +
      new Date().toISOString().slice(0, 10) +
      ".json";
    a.click();

    if (onBackupDone) onBackupDone();

    // ── Step 2: Tag awards with FY ────────────────────────────────────────
    let awardRevenue = 0,
      awardGP = 0,
      awardNet = 0,
      awardCount = 0;
    const updatedAwards = awards.map((a) => {
      const afy = fyFromDate(a.award_date) || year;
      if (afy === year) {
        awardRevenue += parseFloat(a.bid_total || 0);
        awardGP += parseFloat(a.gross_profit || 0);
        awardNet += parseFloat(a.net_take || 0);
        awardCount++;
        return { ...a, fy: year };
      }
      return a;
    });
    lsSaveAwards(updatedAwards);

    // ── Step 3: Archive closed DIBBS pipeline rows ────────────────────────
    const closedStatuses = [
      "Awarded",
      "Lost",
      "No Source",
      "No Bid",
      "On Hold",
    ];
    const remaining = [];
    const toArchive = [];
    sols.forEach((r) => {
      if (closedStatuses.includes(r.status)) {
        toArchive.push({
          ...r,
          archived: true,
          archive_reason: "fy_close_" + year,
          archive_date: new Date().toLocaleDateString(),
          fy: year,
        });
      } else {
        remaining.push(r);
      }
    });
    const newArc = [...arc];
    toArchive.forEach((r) => {
      const idx = newArc.findIndex((x) => x.sol_number === r.sol_number);
      if (idx >= 0) newArc[idx] = r;
      else newArc.push(r);
    });
    lsSaveSols(remaining);
    lsSaveArc(newArc);

    // ── Step 4: Archive closed ESBD bids ─────────────────────────────────
    const closedEsbd = ["Awarded", "Lost", "No Bid"];
    const esbdRemaining = [];
    const esbdClosed = [];
    let esbdRevenue = 0,
      esbdCount = 0;
    esbdRaw.forEach((b) => {
      if (closedEsbd.includes(b.status)) {
        esbdClosed.push({ ...b, fy: year, archived: true });
        esbdRevenue += parseFloat(b.bid_total || 0);
        if (b.status === "Awarded") esbdCount++;
      } else {
        esbdRemaining.push(b);
      }
    });
    try {
      localStorage.setItem("imperio_esbd_bids", JSON.stringify(esbdRemaining));
      // Store closed ESBD in its own archive key
      const esbdArcKey = "imperio_esbd_archive";
      const existingEsbdArc = (() => {
        try {
          return JSON.parse(localStorage.getItem(esbdArcKey) || "[]");
        } catch (e) {
          return [];
        }
      })();
      localStorage.setItem(
        esbdArcKey,
        JSON.stringify([...existingEsbdArc, ...esbdClosed]),
      );
    } catch (e) {}

    // ── Step 5: Write FY summary to history ───────────────────────────────
    const summary = {
      fy: year,
      closed_date: new Date().toISOString(),
      dibbs_awards: awardCount,
      dibbs_revenue: +awardRevenue.toFixed(2),
      dibbs_gp: +awardGP.toFixed(2),
      dibbs_net: +awardNet.toFixed(2),
      esbd_awards: esbdCount,
      esbd_revenue: +esbdRevenue.toFixed(2),
      total_revenue: +(awardRevenue + esbdRevenue).toFixed(2),
      total_net: +awardNet.toFixed(2),
      dibbs_archived: toArchive.length,
      esbd_archived: esbdClosed.length,
      active_carried: remaining.length,
    };
    const hist = lsGetFYHistory();
    const hidx = hist.findIndex((h) => h.fy === year);
    if (hidx >= 0) hist[hidx] = summary;
    else hist.push(summary);
    hist.sort((a, b) => b.fy - a.fy);
    lsSaveFYHistory(hist);

    // ── Step 6: Advance active FY ─────────────────────────────────────────
    setActiveFY(year + 1);

    return { ok: true, summary };
  }

  // Awards filtered by FY (for dashboard year selector)
  async function awardGetByFY(year) {
    const all = lsGetAwards();
    if (!year || year === "all") return all;
    return all.filter((a) => {
      const afy = a.fy || fyFromDate(a.award_date);
      return afy === parseInt(year);
    });
  }

  // ── Expose globally
  window.SCC_DB = {
    dbSave,
    dbGetAll,
    dbDelete,
    dbClearAll,
    dbArchive,
    dbGetArchive,
    dbRestoreFromArchive,
    dbDeleteFromArchive,
    viSave,
    viGetAll,
    viDelete,
    viGetByNSN,
    exportAllData,
    importAllData,
    awardSave,
    awardGetAll,
    awardGetBySol,
    awardVoid,
    awardGetVoidLog,
    awardGetByFY,
    nextDocNumber,
    peekDocNumber,
    closeFiscalYear,
    getActiveFY,
    setActiveFY,
    getFYHistory,
    fyFromDate,
  };
})();
