(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOL RECORDS (IndexedDB)
  //  Permanent file + note storage per solicitation. 4-year retention.
  //  Exports: window.SCC_RECORDS
  // ═══════════════════════════════════════════════════════════════════════

  const DB_NAME    = "scc_sol_records";
  const DB_VERSION = 1;
  const STORE      = "records";

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("sol_number", "sol_number", { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Save a record. data can be ArrayBuffer (files) or null (notes).
  // Returns the new record id.
  async function addRecord(sol_number, { type, name, data, notes }) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).add({
        sol_number,
        type:   type || "note",   // "pdf" | "image" | "doc" | "note"
        name:   name || "",
        data:   data || null,
        notes:  notes || "",
        added:  new Date().toISOString(),
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function getRecords(sol_number) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index("sol_number");
      const req   = index.getAll(sol_number);
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.added.localeCompare(a.added)));
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function removeRecord(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Update notes field on an existing record
  async function updateNotes(id, notes) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get   = store.get(id);
      get.onsuccess = () => {
        const rec = get.result;
        if (!rec) return resolve();
        rec.notes = notes;
        const put = store.put(rec);
        put.onsuccess = () => resolve();
        put.onerror   = e => reject(e.target.error);
      };
      get.onerror = e => reject(e.target.error);
    });
  }

  window.SCC_RECORDS = { addRecord, getRecords, removeRecord, updateNotes };
})();
