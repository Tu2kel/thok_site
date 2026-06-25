// netlify/functions/scc-sam-lookup.js
// SAM.gov POC enrichment for distributor DB — SBA DSBS fallback when SAM has no contact
// Actions: lookupPOC (single vendor) | enrichAll (bulk, batched)

const { MongoClient } = require("mongodb");

const SAM_KEY    = process.env.SAM_API_KEY;
const SAM_BASE   = "https://api.sam.gov/entity-information/v3/entities";
const SBA_SEARCH = "https://search.certifications.sba.gov/search";
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

// Title-case a string like "DWANE DUNGAN" → "Dwane Dungan"
function toTitleCase(str) {
  return (str || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// SBA DSBS fallback — POST to certifications search, no API key required
// Response shape confirmed: { status: 200, results: [ { contact_person, email, phone,
//   legal_business_name, cage_code, uei, current_principals: "Name - Title" } ] }
async function sbaLookup(name) {
  try {
    const body = {
      searchProfiles:          { searchTerm: name },
      annualRevenue:           { relationOperator: "at-least", annualGrossRevenue: "" },
      bondingLevels:           { constructionIndividual: "", constructionAggregate: "", serviceIndividual: "", serviceAggregate: "" },
      businessSize:            { relationOperator: "at-least", numberOfEmployees: "" },
      entityDetailId:          "",
      keywords:                { list: [], operatorType: "Or" },
      lastUpdated:             { date: { label: "Anytime", value: "anytime" } },
      location:                { states: [], zipCodes: [], counties: [], districts: [], msas: [] },
      naics:                   { codes: [], isPrimary: false, operatorType: "Or" },
      qualityAssuranceStandards: { qas: [] },
      samStatus:               { isActiveSAM: false },
      sbaCertifications:       { activeCerts: [], isPreviousCert: false, operatorType: "Or" },
      selfCertifications:      { certifications: [], operatorType: "Or" },
    };

    const res = await fetch(SBA_SEARCH, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      body:    JSON.stringify(body),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) return null;

    // Find closest legal_business_name match
    const target = name.toUpperCase();
    results.sort((a, b) => {
      const na = (a.legal_business_name || "").toUpperCase();
      const nb = (b.legal_business_name || "").toUpperCase();
      const score = n => n === target ? 0 : n.startsWith(target.split(" ")[0]) ? 1 : 2;
      return score(na) - score(nb);
    });

    const r = results[0];

    const rawName   = (r.contact_person || "").trim();
    const fullName  = toTitleCase(rawName);                        // "DWANE DUNGAN" → "Dwane Dungan"
    const nameParts = fullName.split(" ");
    const firstName = nameParts[0] || null;
    const lastName  = nameParts.slice(1).join(" ") || null;
    const email     = (r.email || "").trim().toLowerCase() || null;
    const phone     = (r.phone || "").trim() || null;

    // Extract title from "Dwane Dungan - Managing Partner"
    let title = null;
    if (r.current_principals) {
      const m = r.current_principals.match(/-\s*(.+)$/);
      if (m) title = m[1].trim();
    }

    if (!fullName && !email) return null;

    const website = (r.website || r.additional_website || "").trim() || null;

    return {
      poc_first:   firstName,
      poc_last:    lastName,
      poc_name:    fullName  || null,
      poc_title:   title,
      poc_email:   email,
      poc_phone:   phone,
      sba_website: website,
      cage_code:   r.cage_code || null,
      uei:         r.uei       || null,
      sam_name:    r.legal_business_name || null,
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

  // ── Shared: build $set and conditionally auto-fill email ─────────────────
  async function applyPocToDb(db, distId, result, existing = {}) {
    const set = {
      poc_name:        result.poc_name   || null,
      poc_first:       result.poc_first  || null,
      poc_last:        result.poc_last   || null,
      poc_title:       result.poc_title  || null,
      poc_email:       result.poc_email  || null,
      poc_phone:       result.poc_phone  || null,
      poc_source:      result.poc_source || null,
      cage_code:       result.cage_code  || existing.cage_code || null,
      uei:             result.uei        || null,
      sam_name:        result.sam_name   || null,
      sam_enriched_at: new Date().toISOString(),
    };
    // Auto-fill email if card has none
    if (result.poc_email && !existing.email) set.email = result.poc_email;
    // Auto-fill website if card has none
    if (result.sba_website && !existing.website) set.website = result.sba_website;
    await db.collection("distributors").updateOne({ id: distId }, { $set: set });
    return set;
  }

  // ── lookupPOC — single vendor ──────────────────────────────────────────
  if (action === "lookupPOC") {
    const { name, cage, distId } = payload;
    if (!name && !cage) return fail("name or cage required");

    try {
      const result = await lookupPOC(name, cage);
      if (!result) return ok({ found: false });

      if (distId) {
        const db = await getDb();
        // Fetch existing doc so we know what's already set
        const existing = await db.collection("distributors").findOne(
          { id: distId }, { projection: { email: 1, website: 1, cage_code: 1 } }
        );
        const saved = await applyPocToDb(db, distId, result, existing || {});
        return ok({ found: true, email_autofilled: !!saved.email, ...result });
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
      .project({ id: 1, name: 1, cage_code: 1, email: 1, website: 1 })
      .limit(payload.limit || 50)
      .toArray();

    const results = { enriched: 0, not_found: 0, failed: 0, total: dists.length, emails_filled: 0 };

    for (const d of dists) {
      try {
        const result = await lookupPOC(d.name, d.cage_code);
        if (result) {
          const saved = await applyPocToDb(db, d.id, result, d);
          results.enriched++;
          if (saved.email   && !d.email)   results.emails_filled++;
          if (saved.website && !d.website) results.websites_filled = (results.websites_filled || 0) + 1;
        } else {
          results.not_found++;
        }
      } catch {
        results.failed++;
      }
      await sleep(120);
    }

    return ok(results);
  }

  return fail("Unknown action: " + action);
};
