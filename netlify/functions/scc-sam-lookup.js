// netlify/functions/scc-sam-lookup.js
// SAM.gov POC enrichment for distributor DB — SBA DSBS fallback when SAM has no contact
// Actions: lookupPOC (single vendor) | enrichAll (bulk, batched)

const { MongoClient } = require("mongodb");

const SAM_KEY    = process.env.SAM_API_KEY;
const SAM_BASE   = "https://api.sam.gov/entity-information/v3/entities";
const SBA_BASE   = "https://search.certifications.sba.gov/api/public/search";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME    = "scc_db";

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Search SAM.gov by legal business name or CAGE code
async function samLookup(name, cage) {
  const params = new URLSearchParams({
    api_key:          SAM_KEY,
    includeSections:  "entityRegistration,pointsOfContact",
    registrationStatus: "A",
  });

  // Try CAGE first (most precise), fall back to name
  if (cage) {
    params.set("cageCode", cage);
  } else {
    // Exact name first
    params.set("legalBusinessName", name);
  }

  let res  = await fetch(SAM_BASE + "?" + params.toString());
  let data = await res.json();

  // If no results with exact name, try first-word wildcard
  if (!cage && (!data.entityData || !data.entityData.length)) {
    const firstWord = name.split(/[\s,]/)[0];
    if (firstWord && firstWord.length >= 3) {
      params.set("legalBusinessName", firstWord + "%");
      res  = await fetch(SAM_BASE + "?" + params.toString());
      data = await res.json();
    }
  }

  if (!data.entityData || !data.entityData.length) return null;

  // Pick closest name match if multiple results
  const entities = data.entityData;
  const target   = name.toUpperCase();
  entities.sort((a, b) => {
    const na = (a.entityRegistration?.legalBusinessName || "").toUpperCase();
    const nb = (b.entityRegistration?.legalBusinessName || "").toUpperCase();
    const da = na === target ? 0 : na.startsWith(target.split(" ")[0]) ? 1 : 2;
    const db = nb === target ? 0 : nb.startsWith(target.split(" ")[0]) ? 1 : 2;
    return da - db;
  });

  const entity = entities[0];
  const reg    = entity.entityRegistration || {};
  const poc    = entity.pointsOfContact || {};

  // Prefer Government Business POC, fall back to Electronic Business POC
  const contact = poc.governmentBusinessPOC || poc.electronicBusinessPOC || poc.pastPerformancePOC || null;

  if (!contact) return { cage_code: reg.cageCode || null, uei: reg.ueiSAM || null, sam_name: reg.legalBusinessName || null };

  const firstName = (contact.firstName || "").trim();
  const lastName  = (contact.lastName  || "").trim();
  const fullName  = [firstName, lastName].filter(Boolean).join(" ");

  return {
    poc_first:  firstName  || null,
    poc_last:   lastName   || null,
    poc_name:   fullName   || null,
    poc_title:  (contact.title || "").trim() || null,
    poc_email:  (contact.email || "").trim().toLowerCase() || null,
    poc_phone:  (contact.phoneNumber || "").trim() || null,
    cage_code:  reg.cageCode     || null,
    uei:        reg.ueiSAM       || null,
    sam_name:   reg.legalBusinessName || null,
  };
}

// SBA DSBS fallback — no API key required
// NOTE: SBA_BASE endpoint is provisional. On first run, sba_debug is returned
// in the lookupPOC response so we can see the actual shape and correct field names.
async function sbaLookup(name) {
  try {
    // Try two common endpoint patterns — first one that returns JSON wins
    const candidates = [
      SBA_BASE + "?" + new URLSearchParams({ keywords: name, size: "5" }),
      "https://search.certifications.sba.gov/api/search?" + new URLSearchParams({ q: name, pageSize: "5" }),
      "https://search.certifications.sba.gov/api/businesses?" + new URLSearchParams({ keyword: name, page: "0", size: "5" }),
    ];

    let data = null;
    let usedUrl = null;
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("json")) continue;
        data = await r.json();
        usedUrl = url;
        break;
      } catch { continue; }
    }

    if (!data) return { _sba_debug: "all candidates failed or returned non-JSON" };

    // Flatten whatever shape the API returns into a hits array
    const hits = data?.hits?.hits
      || data?.results
      || data?.data
      || data?.businesses
      || data?.items
      || (Array.isArray(data) ? data : []);

    if (!hits.length) return { _sba_debug: "no hits", _sba_url: usedUrl, _sba_raw: JSON.stringify(data).slice(0, 500) };

    // Find closest name match
    const target = name.toUpperCase();
    hits.sort((a, b) => {
      const getN = x => ((x._source || x).legalBusinessName || (x._source || x).businessName || (x._source || x).name || "").toUpperCase();
      const na = getN(a), nb = getN(b);
      const score = n => n === target ? 0 : n.startsWith(target.split(" ")[0]) ? 1 : 2;
      return score(na) - score(nb);
    });

    const src = hits[0]._source || hits[0];

    const fullName  = (
      src.primaryContactName || src.contactName || src.contactPerson ||
      [src.contactFirstName, src.contactLastName].filter(Boolean).join(" ") ||
      src.poc || ""
    ).trim();
    const firstName = (src.contactFirstName || fullName.split(" ")[0] || "").trim();
    const email     = (src.primaryContactEmail || src.contactEmail || src.email || src.pocEmail || "").trim().toLowerCase();
    const phone     = (src.primaryContactPhone || src.contactPhone || src.pocPhone || src.phone || "").trim();

    // Always return debug info on first call so we can verify field names
    const result = {
      poc_first:  firstName || null,
      poc_last:   (src.contactLastName || "").trim() || null,
      poc_name:   fullName  || null,
      poc_email:  email     || null,
      poc_phone:  phone     || null,
      poc_source: "sba",
      _sba_debug: { url: usedUrl, name_field: src.legalBusinessName || src.businessName || src.name || "?", raw_keys: Object.keys(src).slice(0, 20) },
    };

    if (!fullName && !email) return { _sba_debug: result._sba_debug, _sba_raw_src: JSON.stringify(src).slice(0, 500) };
    return result;
  } catch (e) {
    return { _sba_debug: "exception: " + e.message };
  }
}

// Full lookup: SAM.gov first, SBA DSBS fallback if no contact found
async function lookupPOC(name, cage) {
  const samResult = await samLookup(name, cage);
  if (samResult && samResult.poc_name) return { ...samResult, poc_source: "sam" };

  // SAM found the entity but no POC, or nothing found — try SBA
  const sbaResult = await sbaLookup(name);

  // If SBA returned debug-only (endpoint probe failed), surface it
  if (sbaResult && sbaResult._sba_debug && !sbaResult.poc_name) {
    return { ...(samResult || {}), _sba_debug: sbaResult._sba_debug, _sba_raw: sbaResult._sba_raw_src };
  }

  if (sbaResult && (sbaResult.poc_name || sbaResult.poc_email)) {
    return {
      ...(samResult || {}),
      ...sbaResult,
    };
  }

  return samResult; // may be null or entity-only (no POC)
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { action } = payload;
  const ok   = (d) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true,  result: d }) });
  const fail = (m) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error:  m }) });

  if (!SAM_KEY) return fail("SAM_API_KEY not set in Netlify env vars");

  // ── lookupPOC — single vendor ──────────────────────────────────────────
  if (action === "lookupPOC") {
    const { name, cage, distId } = payload;
    if (!name && !cage) return fail("name or cage required");

    try {
      const result = await lookupPOC(name, cage);
      if (!result) return ok({ found: false });

      // Save to MongoDB if distId provided
      if (distId) {
        const db = await getDb();
        await db.collection("distributors").updateOne(
          { id: distId },
          { $set: {
            poc_name:  result.poc_name  || null,
            poc_first: result.poc_first || null,
            poc_last:  result.poc_last  || null,
            poc_title: result.poc_title || null,
            poc_email: result.poc_email || null,
            poc_phone: result.poc_phone || null,
            cage_code: result.cage_code || null,
            uei:       result.uei       || null,
            sam_name:  result.sam_name  || null,
            sam_enriched_at: new Date().toISOString(),
          }},
        );
      }

      return ok({ found: true, ...result });
    } catch (e) {
      return fail("SAM lookup failed: " + e.message);
    }
  }

  // ── enrichAll — batch enrich all distributors missing POC ──────────────
  if (action === "enrichAll") {
    const db    = await getDb();
    const dists = await db.collection("distributors")
      .find({ is_dns: { $ne: true }, poc_name: { $in: [null, undefined, ""] } })
      .project({ id: 1, name: 1, cage_code: 1 })
      .limit(payload.limit || 50)
      .toArray();

    const results = { enriched: 0, not_found: 0, failed: 0, total: dists.length };

    for (const d of dists) {
      try {
        const result = await lookupPOC(d.name, d.cage_code);
        if (result) {
          await db.collection("distributors").updateOne(
            { id: d.id },
            { $set: {
              poc_name:  result.poc_name  || null,
              poc_first: result.poc_first || null,
              poc_last:  result.poc_last  || null,
              poc_title: result.poc_title || null,
              poc_email: result.poc_email || null,
              poc_phone: result.poc_phone || null,
              cage_code: result.cage_code || d.cage_code || null,
              uei:       result.uei       || null,
              sam_name:  result.sam_name  || null,
              sam_enriched_at: new Date().toISOString(),
            }},
          );
          results.enriched++;
        } else {
          results.not_found++;
        }
      } catch {
        results.failed++;
      }
      await sleep(120); // ~8 req/sec — under the 10/sec limit
    }

    return ok(results);
  }

  return fail("Unknown action: " + action);
};
