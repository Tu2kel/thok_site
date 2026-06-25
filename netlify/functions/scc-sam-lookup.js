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

// SBA DSBS fallback — no API key required, returns contact name + email from certifications search
async function sbaLookup(name) {
  try {
    const params = new URLSearchParams({
      keywords: name,
      type:     "vendor",
      size:     "5",
    });
    const res  = await fetch(SBA_BASE + "?" + params.toString(), {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Response shape: { hits: { hits: [ { _source: { ... } } ] } }
    const hits = data?.hits?.hits || data?.results || data?.data || [];
    if (!hits.length) return null;

    // Find closest name match
    const target = name.toUpperCase();
    hits.sort((a, b) => {
      const src = h => (h._source || h);
      const na  = (src(a).legalBusinessName || src(a).businessName || src(a).name || "").toUpperCase();
      const nb  = (src(b).legalBusinessName || src(b).businessName || src(b).name || "").toUpperCase();
      const da  = na === target ? 0 : na.startsWith(target.split(" ")[0]) ? 1 : 2;
      const db  = nb === target ? 0 : nb.startsWith(target.split(" ")[0]) ? 1 : 2;
      return da - db;
    });

    const src = (hits[0]._source || hits[0]);

    // Contact fields vary — try common keys
    const fullName  = (src.primaryContactName || src.contactName || src.contactPerson ||
                       [src.contactFirstName, src.contactLastName].filter(Boolean).join(" ") || "").trim();
    const firstName = (src.contactFirstName || fullName.split(" ")[0] || "").trim();
    const email     = (src.primaryContactEmail || src.contactEmail || src.email || "").trim().toLowerCase();

    if (!fullName && !email) return null;

    return {
      poc_first:   firstName  || null,
      poc_last:    (src.contactLastName || "").trim() || null,
      poc_name:    fullName   || null,
      poc_email:   email      || null,
      poc_source:  "sba",
    };
  } catch {
    return null;
  }
}

// Full lookup: SAM.gov first, SBA DSBS fallback if no contact found
async function lookupPOC(name, cage) {
  const samResult = await samLookup(name, cage);
  if (samResult && samResult.poc_name) return { ...samResult, poc_source: "sam" };

  // SAM found the entity but no POC, or nothing found — try SBA
  const sbaResult = await sbaLookup(name);
  if (sbaResult) {
    // Preserve any CAGE/UEI/sam_name from SAM even if POC came from SBA
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
