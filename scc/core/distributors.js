(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DISTRIBUTOR DATABASE
  //  MongoDB-backed · In-memory cache · Same SCC_DIST API as before
  //  source.js calls scoreAndRank / getDistsByFSC synchronously — those
  //  read from _cache which is populated on init via Mongo fetch.
  // ═══════════════════════════════════════════════════════════════════════

  const FUNC_URL = "/.netlify/functions/scc-distributors";

  // ── Internal cache (populated from MongoDB on load) ───────────────────
  let _cache = []; // full distributor array
  let _fscMap = {}; // fsc → [id, id, ...]  rebuilt from cache
  let _byId = {};   // id → record  for O(1) lookup
  let _ready = false;
  let _readyCbs = [];
  let _needsSeed = false;

  function onReady(cb) {
    if (_ready) {
      cb();
      return;
    }
    _readyCbs.push(cb);
  }
  function _setReady() {
    _ready = true;
    _readyCbs.forEach((cb) => cb());
    _readyCbs = [];
  }

  // ── Rebuild lookup structures from live cache ─────────────────────────
  function _rebuildFscMap() {
    const map = {};
    const byId = {};
    _cache.forEach((d) => {
      byId[d.id] = d;
      const seen = new Set();
      (d.fsc || []).forEach((code) => {
        if (!map[code]) map[code] = [];
        if (!seen.has(code)) { map[code].push(d.id); seen.add(code); }
      });
    });
    _fscMap = map;
    _byId = byId;
  }

  // ── API call helper ───────────────────────────────────────────────────
  async function _call(action, payload = {}) {
    const res = await fetch(FUNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "scc-distributors error");
    return data.result;
  }

  // ── Initialize: load page 1 → render app → stream remaining pages ───────
  async function _init() {
    const pageSize = 5000;
    try {
      const first = await _call("distGetAll", { page: 1, pageSize });
      const firstRecords = Array.isArray(first) ? first : (first.records || []);
      if (firstRecords.length > 0) {
        _cache = firstRecords;
        _rebuildFscMap();
        console.log(`[SCC_DIST] Page 1 ready — ${_cache.length} distributors`);
      } else {
        _needsSeed = true;
      }
    } catch (err) {
      _needsSeed = true;
      console.warn("[SCC_DIST] MongoDB unavailable:", err.message);
    }

    _setReady(); // App renders now — no more blank page

    // Stream remaining pages in background without blocking UI
    if (!_needsSeed) {
      (async () => {
        let page = 2;
        while (page <= 50) {
          try {
            const data = await _call("distGetAll", { page, pageSize });
            if (Array.isArray(data)) break;
            if (!data.records?.length) break;
            _cache.push(...data.records);
            _rebuildFscMap();
            console.log(`[SCC_DIST] +${data.records.length} — total ${_cache.length}`);
            if (!data.hasMore) break;
          } catch { break; }
          page++;
        }
      })();
    }
  }

  // ── Reload used after mutations — loads all pages ─────────────────────
  async function _loadAllPages(pageSize = 5000) {
    const all = [];
    let page = 1;
    while (page <= 50) {
      const data = await _call("distGetAll", { page, pageSize });
      if (Array.isArray(data)) return data;
      all.push(...(data.records || []));
      if (!data.hasMore) break;
      page++;
    }
    return all;
  }

  // ── FSC lane labels ───────────────────────────────────────────────────
  const FSC_LANES_MAP = {
    5305: "Screws & Bolts",
    5306: "Bolts",
    5310: "Nuts & Washers",
    5315: "Pins & Rivets",
    5320: "Rivets",
    5340: "Hardware & Chain",
    5360: "Springs",
    5365: "Rings & Spacers",
    5855: "Night Vision",
    5961: "Semiconductors",
    5962: "Microelectronics",
    5935: "Connectors",
    5905: "Resistors",
    5975: "Electrical Hardware",
    5998: "PCBs",
    6150: "Wire & Cable",
    6510: "Medical/Surgical",
    6515: "Medical/EMS/Field",
    6520: "Dental",
    6530: "Hospital Furniture",
    6810: "Chemicals",
    6840: "Pest Control",
    6850: "Chemical Products",
    7110: "Office Furniture",
    7125: "Storage/Shelving",
    7930: "Cleaning Compounds",
    8030: "Adhesives",
    8040: "Sealants",
    8115: "Boxes/Cartons",
    8415: "Individual Equipment",
    8430: "Footwear",
    8455: "Badges & Insignia",
    8465: "Carrying Equipment",
    8470: "Armor",
    8520: "Toiletries",
    9150: "Oils & Greases",
    9510: "Iron & Steel",
    9520: "Steel Materials",
    9535: "Metal Bar/Sheet",
    1005: "Guns Through 30mm",
    1095: "Misc Weapons",
    4240: "Safety/Rescue PPE",
    4730: "Hose/Pipe/Fittings",
    5110: "Hand Tools",
    5120: "Power Tools",
    4910: "Shop Equipment",
    4940: "Maintenance Equipment",
    1730: "Aircraft Ground Servicing",
    1740: "Airfield Specialized Trucks",
    1080: "Aerial Delivery/Parachute",
    1650: "Aircraft Hydraulic/Vacuum",
    1660: "Aircraft Air Conditioning",
    2320: "Military Trucks/Vehicles",
    2530: "Vehicle Brake/Steering/Axle",
    2540: "Motor Vehicle Components",
    2910: "Engine Fuel System",
    2940: "Engine Cooling/Filters",
  };

  // ── Synchronous helpers (read from cache) ─────────────────────────────

  function getDistsByFSC(fsc) {
    const key = String(fsc);
    const ids = _fscMap[key] || [];
    const raw = (ids.length
      ? ids.map((id) => _byId[id]).filter(Boolean)
      : _cache.filter((d) => (d.fsc || []).includes(key))
    ).filter((d) => !d.is_dns);
    // Preferred-alts first, sub-sorted by priority (1=highest), then legacy
    const preferred = raw
      .filter((d) => (d.tags || []).includes("preferred-alt"))
      .sort((a, b) => (a.priority || 9) - (b.priority || 9));
    const others = raw.filter((d) => !(d.tags || []).includes("preferred-alt"));
    return [...preferred, ...others];
  }

  function scoreAndRank(query, fsc, partNum) {
    const fscKey = String(fsc || "");
    const hasInput = !!(fscKey || partNum || (query || "").trim());
    if (!hasInput) return [];

    const partPrefix = partNum
      ? partNum.toUpperCase().match(/^([A-Z]+)/)?.[1]
      : null;

    return _cache
      .map((d) => {
        let score = 0;
        let relevanceHits = 0;
        const q = (query || "").toLowerCase().trim();

        const fscMapIds = fscKey ? _fscMap[fscKey] || [] : [];
        if (fscKey && fscMapIds.includes(d.id)) {
          score += 150;
          relevanceHits++;
        }
        if (fscKey && (d.fsc || []).includes(fscKey)) {
          score += 80;
          relevanceHits++;
        }

        if (partNum && partPrefix && (d.part_prefixes || []).length > 0) {
          if (
            d.part_prefixes.some(
              (p) => partPrefix === p || partPrefix.startsWith(p),
            )
          ) {
            score += 180;
            relevanceHits++;
          }
        }

        // NSN match in known_nsns
        if (query && (d.known_nsns || []).includes(query.trim())) {
          score += 200;
          relevanceHits++;
        }

        if (q) {
          if (d.name.toLowerCase().includes(q)) {
            score += 60;
            relevanceHits++;
          }
          if ((d.tags || []).some((t) => t.includes(q))) {
            score += 35;
            relevanceHits++;
          }
          if ((d.id || "").toLowerCase().includes(q)) {
            score += 25;
            relevanceHits++;
          }
        }

        if (!partNum && fscKey && (d.tags || []).includes("all-open")) {
          score += 20;
          relevanceHits++;
        }

        // Preferred-alt bonus — surfaces above same-tier legacy companies
        if ((d.tags || []).includes("preferred-alt")) {
          score += 40;
        }

        if (relevanceHits > 0) {
          if (d.tier === 1) score += 25;
          if (d.friction === "low") score += 20;
          if (d.friction === "medium") score += 7;
          if (d.friction === "high") score -= 10;
        }

        // Flag if supplier already passed on this specific P/N
        const pnUpper = (partNum || "").trim().toUpperCase();
        const qUpper  = (query  || "").trim().toUpperCase();
        const passed  = (d.passed_pns || []).some(
          (p) => p.toUpperCase() === pnUpper || (qUpper && p.toUpperCase() === qUpper),
        );
        if (passed) score -= 500; // sink to bottom but keep visible

        return { ...d, score, relevanceHits, passed };
      })
      .filter((d) => d.relevanceHits > 0)
      .sort((a, b) => b.score - a.score);
  }

  // ── Async write operations (used by intake tool / chat parser) ─────────

  async function distSave(record) {
    const result = await _call("distSave", { record });
    // Update cache
    const idx = _cache.findIndex((d) => d.id === record.id);
    if (idx >= 0) {
      _cache[idx] = {
        ..._cache[idx],
        ...record,
        known_nsns: [
          ...new Set([
            ...(_cache[idx].known_nsns || []),
            ...(record.known_nsns || []),
          ]),
        ],
        part_prefixes: [
          ...new Set([
            ...(_cache[idx].part_prefixes || []),
            ...(record.part_prefixes || []),
          ]),
        ],
        fsc: [...new Set([...(_cache[idx].fsc || []), ...(record.fsc || [])])],
        tags: [
          ...new Set([...(_cache[idx].tags || []), ...(record.tags || [])]),
        ],
      };
    } else {
      _cache.push(record);
    }
    _rebuildFscMap();
    return result;
  }

  async function distBatch(records) {
    const result = await _call("distBatch", { records });
    const fresh = await _loadAllPages();
    if (Array.isArray(fresh)) { _cache = fresh; _rebuildFscMap(); }
    return result;
  }

  async function distAddNSN(id, nsn, part_numbers = []) {
    const result = await _call("distAddNSN", { id, nsn, part_numbers });
    // Patch cache
    const d = _cache.find((x) => x.id === id);
    if (d) {
      if (nsn && !d.known_nsns?.includes(nsn))
        (d.known_nsns = d.known_nsns || []).push(nsn);
      part_numbers.forEach((p) => {
        if (!(d.part_prefixes || []).includes(p))
          (d.part_prefixes = d.part_prefixes || []).push(p);
      });
    }
    return result;
  }

  async function distLogOutreach(id, entry) {
    const result = await _call("distLogOutreach", { id, entry });
    const d = _cache.find((x) => x.id === id);
    if (d) {
      (d.outreach_log = d.outreach_log || []).push(entry);
      if (entry.response === "no_bid") {
        if (!(d.passed_pns || []).includes(entry.pn))
          (d.passed_pns = d.passed_pns || []).push(entry.pn);
      }
    }
    return result;
  }

  async function distDelete(id) {
    const result = await _call("distDelete", { id });
    _cache = _cache.filter((d) => d.id !== id);
    _rebuildFscMap();
    return result;
  }

  async function distGetByNSN(nsn) {
    return _call("distGetByNSN", { nsn });
  }

  async function distReloadCache() {
    const fresh = await _loadAllPages();
    if (Array.isArray(fresh)) { _cache = fresh; _rebuildFscMap(); }
    return _cache;
  }

  async function distPurge() {
    const result = await _call("distPurge", {});
    _cache = [];
    _fscMap = {};
    _byId = {};
    return result;
  }

  // ── Expose public API ─────────────────────────────────────────────────
  window.SCC_DIST = {
    // Read — synchronous (from cache)
    get needsSeed() {
      return _needsSeed;
    },
    get DISTRIBUTORS() {
      return _cache;
    },
    get FSC_DIST_MAP() {
      return _fscMap;
    },
    FSC_LANES_MAP,
    getDistsByFSC,
    scoreAndRank,
    onReady,

    // Write — async (to MongoDB + cache)
    distSave,
    distBatch,
    distAddNSN,
    distLogOutreach,
    distDelete,
    distGetByNSN,
    distReloadCache,
    distPurge,
  };

  // ── Boot ──────────────────────────────────────────────────────────────
  _init();
})();
