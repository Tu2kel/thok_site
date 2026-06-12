// ═══════════════════════════════════════════════════════════════════════
// IMPERIO SCC — RFQ SEED ROUTER v1.1 (PATCHED)
// Fixes applied:
//   [1] Geography sort now uses dist.tags (tx-local/tx-state/usa), not dist.Type
//   [2] Competitor density sort added (low → high, suppresses high from primary blast)
//   [3] Combined geo + density score drives final blast order
// ═══════════════════════════════════════════════════════════════════════

const RFQSeedRouter = (() => {
  // ── SOURCE LOCK DETECTION ───────────────────────────────────────────
  const SOURCE_LOCK_PATTERNS = {
    oem: /\b(OEM|Manufacturer|Direct Only|Government Standard)\b/i,
    proprietary: /\b(Proprietary|Controlled|Restricted|Sole Source|Exclusive)\b/i,
    amscLock: /\b(AMSC:\s*[GBA]|AMSC[GBA])\b/i,
    blockedOEMs: /\b(SureFire|Streamlight|Furuno|SAIC|Boeing|Lockheed|Raytheon)\b/i,
    blockedCAGEs: /\b(07482|062W0|81SA7|R9004|75Q65)\b/,
    jcpRequired: /\b(JCP Required|cFolders|Technical Data Required)\b/i,
    manufacturing: /\b(Machining|Fabrication|Custom|Made-to-Order|Manufacture)\b/i,
  };

  // ── MASTER CONFIG ───────────────────────────────────────────────────
  const DEFAULT_CONFIG = {
    blockedCAGEs: ["07482", "062W0", "81SA7", "R9004", "75Q65"],
    blockedOEMs: ["SUREFIRE", "STREAMLIGHT", "FURUNO"],
    blockedNSNs: [],
    unmatched: { action: "flag" },
    // FIX [1]: priority is now applied via tags in getGeoScore(), not this map.
    // Kept for backward compat but not used in sort.
    distributorPriority: {
      "Local TX": 1,
      Texas: 2,
      USA: 3,
      Catalog: 4,
    },
  };

  let config = { ...DEFAULT_CONFIG };
  let rolodex = [];
  let fscMap = {};

  // ── INIT ────────────────────────────────────────────────────────────
  function init(rolodexArray, userConfig = {}) {
    config = { ...DEFAULT_CONFIG, ...userConfig };
    rolodex = rolodexArray || [];

    fscMap = {};
    for (const dist of rolodex) {
      const fscs = parseFSCList(dist.FSCs || dist.fsc || "");
      for (const fsc of fscs) {
        if (!fscMap[fsc]) fscMap[fsc] = [];
        fscMap[fsc].push(dist);
      }
    }

    console.log(
      `[RFQRouter] Init: ${rolodex.length} distributors, ${Object.keys(fscMap).length} FSC lanes mapped`
    );

    return {
      analyzeBatch,
      analyzeSol,
      detectSourceLock,
      matchDistributors,
      generateRFQEmails,
      getRolodex: () => rolodex,
      getConfig: () => config,
    };
  }

  // ── PARSE FSC LIST ──────────────────────────────────────────────────
  function parseFSCList(fscStr) {
    if (!fscStr) return [];
    return fscStr
      .split(/[,;]/)
      .map((f) => f.trim().replace(/[^\d]/g, ""))
      .filter((f) => f.length === 4);
  }

  // ── FIX [1]: GEO SCORE — reads dist.tags, not dist.Type ─────────────
  // dist-seed schema uses tags: ["tx-local"], ["tx-state"], ["usa"]
  function getGeoScore(dist) {
    const tags = (dist.tags || dist.Tags || []).map((t) =>
      typeof t === "string" ? t.toLowerCase() : ""
    );
    if (tags.includes("tx-local")) return 1;
    if (tags.includes("tx-state")) return 2;
    if (tags.includes("usa")) return 3;
    return 4; // catalog / unknown
  }

  // ── FIX [2]: DENSITY SCORE — low density blasts first ───────────────
  // Requires dist.competitor_density field in rolodex (set when building bench).
  // High-density suppliers (Fastenal, Dialogic) are deprioritized;
  // only included in blast if no low/medium supplier returned a quote.
  function getDensityScore(dist) {
    const d = (dist.competitor_density || "unknown").toLowerCase();
    const map = {
      low: 1,
      "low-medium": 2,
      medium: 3,
      "medium-high": 4,
      high: 5,
      unknown: 6,
    };
    return map[d] ?? 6;
  }

  // ── FIX [3]: COMBINED SORT SCORE ────────────────────────────────────
  // Geo is primary (weight 10), density secondary (weight 1).
  // Result: local-TX + low-density always sorts first.
  function getSortScore(dist) {
    return getGeoScore(dist) * 10 + getDensityScore(dist);
  }

  // ── DETECT SOURCE LOCK ──────────────────────────────────────────────
  function detectSourceLock(sol) {
    const itemName = (sol.item_name || "").toUpperCase();
    const nsn = sol.nsn || "";
    const cage = (sol.supplier_restrictions || "").toUpperCase();
    const drawingStatus = (sol.drawings_available || "").toLowerCase();

    for (const blockedCage of config.blockedCAGEs) {
      if (cage.includes(blockedCage.toUpperCase())) {
        return { isLock: true, severity: "hard", reason: `Blocked CAGE: ${blockedCage}` };
      }
    }

    for (const blockedOem of config.blockedOEMs) {
      if (itemName.includes(blockedOem.toUpperCase())) {
        return { isLock: true, severity: "hard", reason: `Blocked OEM: ${blockedOem}` };
      }
    }

    if (config.blockedNSNs.includes(nsn)) {
      return { isLock: true, severity: "hard", reason: `Blocked NSN: ${nsn}` };
    }

    if (SOURCE_LOCK_PATTERNS.amscLock.test(itemName)) {
      return { isLock: true, severity: "hard", reason: "AMSC:G/B/A (government drawing)" };
    }

    if (
      drawingStatus === "restricted" &&
      !SOURCE_LOCK_PATTERNS.manufacturing.test(itemName)
    ) {
      return { isLock: true, severity: "soft", reason: "Restricted drawings (no COTS path found)" };
    }

    // JCP cert is active (152U4) — JCP/cFolders items are now open bids
    if (SOURCE_LOCK_PATTERNS.proprietary.test(itemName)) {
      return { isLock: true, severity: "soft", reason: "Proprietary/sole-source indicator" };
    }

    return { isLock: false };
  }

  // ── MATCH DISTRIBUTORS FOR ONE SOL ──────────────────────────────────
  // FIX [1+3]: sort by combined geo+density score, not dist.Type
  function matchDistributors(sol) {
    const fsc = (sol.fsc || "").replace(/[^\d]/g, "");
    if (!fsc || fsc.length !== 4) {
      return { matched: [], reason: `Invalid FSC: ${sol.fsc}` };
    }

    const matches = fscMap[fsc] || [];
    if (matches.length === 0) {
      return { matched: [], reason: `No distributors in rolodex for FSC ${fsc}` };
    }

    // Primary blast: exclude high-density suppliers unless they're the only option
    const primaryPool = matches.filter(
      (d) => !["high"].includes((d.competitor_density || "").toLowerCase())
    );
    const fallbackPool = matches.filter((d) =>
      ["high"].includes((d.competitor_density || "").toLowerCase())
    );

    // Use primary pool if it has entries; otherwise fall back to all
    const pool = primaryPool.length > 0 ? primaryPool : matches;

    // Sort by combined geo + density score
    const sorted = pool
      .slice()
      .sort((a, b) => getSortScore(a) - getSortScore(b));

    // Attach fallback flag so caller knows these were deprioritized
    if (primaryPool.length > 0 && fallbackPool.length > 0) {
      sorted._highDensityFallback = fallbackPool
        .slice()
        .sort((a, b) => getSortScore(a) - getSortScore(b));
    }

    return {
      matched: sorted,
      count: sorted.length,
      highDensityFallback: sorted._highDensityFallback || [],
    };
  }

  // ── ANALYZE SINGLE SOL ──────────────────────────────────────────────
  function analyzeSol(sol) {
    const lock = detectSourceLock(sol);
    const distMatch = matchDistributors(sol);

    return {
      sol_number: sol.sol_number,
      fsc: sol.fsc,
      item_name: sol.item_name,
      qty: sol.qty,
      unit_price: sol.unit_price,
      delivery_days: sol.delivery_days,
      sourceLock: lock,
      distributors: distMatch.matched,
      distributorCount: distMatch.count,
      highDensityFallback: distMatch.highDensityFallback || [],
      routable: !lock.isLock && distMatch.count > 0,
      verdict: lock.isLock
        ? `LOCKED — ${lock.reason}`
        : distMatch.count > 0
        ? `GO — Route to ${distMatch.count} distributors`
        : `UNMATCHED — No distributors for FSC ${sol.fsc}`,
    };
  }

  // ── ANALYZE BATCH ────────────────────────────────────────────────────
  function analyzeBatch(sols) {
    const results = {
      go: [],
      locked: [],
      unmatched: [],
      byDistributor: {},
      summary: {},
    };

    for (const sol of sols) {
      const analysis = analyzeSol(sol);

      if (analysis.sourceLock.isLock) {
        results.locked.push({ ...analysis, severity: analysis.sourceLock.severity });
        continue;
      }

      if (analysis.distributorCount === 0) {
        results.unmatched.push(analysis);
        continue;
      }

      results.go.push(analysis);

      for (const dist of analysis.distributors) {
        const distKey = dist.Company || dist.name;
        if (!results.byDistributor[distKey]) {
          results.byDistributor[distKey] = {
            distributor: dist,
            sols: [],
            fscLanes: new Set(),
            geoScore: getGeoScore(dist),
            densityScore: getDensityScore(dist),
            sortScore: getSortScore(dist),
          };
        }
        results.byDistributor[distKey].sols.push(analysis);
        results.byDistributor[distKey].fscLanes.add(analysis.fsc);
      }
    }

    // Convert Set to Array
    for (const distKey in results.byDistributor) {
      results.byDistributor[distKey].fscLanes = Array.from(
        results.byDistributor[distKey].fscLanes
      );
    }

    // Sort byDistributor output by combined sort score (lowest = first to blast)
    const sortedByDist = Object.fromEntries(
      Object.entries(results.byDistributor).sort(
        ([, a], [, b]) => a.sortScore - b.sortScore
      )
    );
    results.byDistributor = sortedByDist;

    results.summary = {
      total: sols.length,
      go: results.go.length,
      locked: results.locked.length,
      unmatched: results.unmatched.length,
      distributorCount: Object.keys(results.byDistributor).length,
      goRate: ((results.go.length / sols.length) * 100).toFixed(1),
    };

    return results;
  }

  // ── GENERATE RFQ EMAIL DRAFTS ────────────────────────────────────────
  function generateRFQEmails(batchAnalysis) {
    const emails = [];

    for (const [distName, plan] of Object.entries(batchAnalysis.byDistributor)) {
      const dist = plan.distributor;
      const sols = plan.sols;

      const itemLines = sols
        .map((s) => `• ${s.item_name} — Qty: ${s.qty} EA`)
        .join("\n");

      const maxDeliveryDays = Math.max(...sols.map((s) => s.delivery_days || 0));
      const deliveryStr = maxDeliveryDays > 0 ? `${maxDeliveryDays} days` : "As specified";

      const govEmail = dist.Email || dist.email || `sales@${dist.Website || ""}`;
      const phone = dist.Phone || dist.phone || "N/A";

      const subject = `Bulk Quote Request — ${plan.fscLanes.join("/")} (Govt Reseller)`;
      const body = `Hi ${dist.Company || dist.name},

I'm a federal supply contractor (SDVOSB) working on active DLA solicitations. We need a bulk quote on the following items:

${itemLines}

Delivery Window: ${deliveryStr}

Terms:
• We'll issue a PO same-day upon award
• Direct-to-government shipment (FOB destination)
• We use Factoring Express for payment (third-party PO funding accepted)

Can you provide pricing on this batch? Please reply with unit costs and delivery confirmation.

Thanks,
Anthony Kelley
SDVOSB | VetHUB
Imperio Federal Logistics
(254) 265-9335
anthony@ifedlog.com`;

      emails.push({
        distributor: distName,
        phone,
        email: govEmail,
        fscLanes: plan.fscLanes,
        solCount: sols.length,
        geoScore: plan.geoScore,
        densityScore: plan.densityScore,
        sortScore: plan.sortScore,
        subject,
        body,
        itemLines,
        copy: { subject, body, To: govEmail, Phone: phone },
      });
    }

    // Emails already ordered by sortScore from analyzeBatch
    return emails;
  }

  return {
    init,
    analyzeBatch,
    analyzeSol,
    detectSourceLock,
    matchDistributors,
    generateRFQEmails,
  };
})();

if (typeof window !== "undefined") {
  window.RFQSeedRouter = RFQSeedRouter;
}
