// netlify/functions/scc-intel.js
// Company lookup proxy — SBA Small Business Search (no key required)
// SAM.gov fallback uses SAM_API_KEY env var if set

const SAM_BASE = "https://api.sam.gov/entity-information/v3/entities";
const SBA_SEARCH = "https://search.certifications.sba.gov/_api/v2/search";

const SBA_BODY_BASE = {
  location: { states: [], zipCodes: [], counties: [], districts: [], msas: [] },
  sbaCertifications: { activeCerts: [], isPreviousCert: false, operatorType: "OR" },
  naics: { codes: [], isPrimary: false, operatorType: "OR" },
  selfCertifications: { certifications: [], operatorType: "OR" },
  keywords: { list: [], operatorType: "OR" },
  lastUpdated: { date: { label: "Anytime", value: "anytime" } },
  samStatus: { isActiveSAM: false },
  qualityAssuranceStandards: { qas: [] },
  bondingLevels: { constructionIndividual: "", constructionAggregate: "", serviceIndividual: "", serviceAggregate: "" },
  businessSize: { relationOperator: "AT_LEAST", numberOfEmployees: "" },
  annualRevenue: { relationOperator: "AT_LEAST", annualGrossRevenue: "" },
};

async function sbaLookup(name) {
  const res = await fetch(SBA_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...SBA_BODY_BASE, searchProfiles: { searchTerm: name } }),
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const results = data.results || [];
  if (!results.length) return null;

  // Pick best match: exact legal_business_name first, then closest
  const nameLower = name.toLowerCase();
  const exact = results.find(r => (r.legal_business_name || "").toLowerCase() === nameLower);
  const best = exact || results[0];

  return {
    uei:     best.uei || null,
    cage:    best.cage_code || null,
    name:    best.legal_business_name || best.dba_name || null,
    dba:     best.dba_name || null,
    email:   best.email || null,
    phone:   best.phone || null,
    contact: best.contact_person || null,
    address: {
      street: best.address_1 || null,
      city:   best.city || null,
      state:  best.state || null,
      zip:    best.zipcode || null,
    },
    naics: best.naics_all_codes || [],
    source: "sba",
  };
}

async function samLookup(name, cage, uei) {
  const key = process.env.SAM_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    api_key: key,
    samRegistered: "Yes",
    registrationStatus: "A",
    includeSections: "entityRegistration,pointsOfContact,assertions",
  });
  if (uei)       params.set("ueiSAM", uei);
  else if (cage) params.set("cageCode", cage);
  else           params.set("q", `"${name}"`);

  const res = await fetch(`${SAM_BASE}?${params}`, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) return null;
  const data = await res.json();
  const entities = data.entityData || [];
  if (!entities.length) return null;

  const entity  = entities[0];
  const reg     = entity.entityRegistration || {};
  const pocs    = entity.pointsOfContact    || {};
  const asserts = entity.assertions         || {};
  const govPOC  = pocs.governmentBusinessPOC         || {};
  const eBizPOC = pocs.electronicBusinessPOC         || {};
  const altPOC  = pocs.alternateGovernmentBusinessPOC|| {};
  const email   = govPOC.email || govPOC.electronicBusinessEmail || eBizPOC.email || altPOC.email || null;
  const phone   = govPOC.phoneNumber || eBizPOC.phoneNumber || altPOC.phoneNumber || null;
  const addr    = reg.physicalAddress || {};
  const naicsL  = (asserts.goodsAndServices && asserts.goodsAndServices.naicsList) || [];

  return {
    uei:     reg.ueiSAM || null,
    cage:    reg.cageCode || null,
    name:    reg.legalBusinessName || reg.dbaName || null,
    dba:     reg.dbaName || null,
    email,
    phone,
    contact: null,
    address: { street: addr.addressLine1 || null, city: addr.city || null, state: addr.stateOrProvinceCode || null, zip: addr.zipCode || null },
    naics:   naicsL.map(n => n.naicsCode || n).filter(Boolean),
    source:  "sam",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Bad JSON" }) }; }

  const { action, payload } = body;

  if (action === "samLookup") {
    const { name, cage, uei } = payload || {};
    if (!name && !cage && !uei) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, result: null }) };
    }

    try {
      // SBA search first (no key needed, has direct email field)
      let result = name ? await sbaLookup(name) : null;

      // SAM.gov fallback if SBA found nothing or has no email
      if ((!result || !result.email) && (name || cage || uei)) {
        const samResult = await samLookup(name, cage, uei);
        if (samResult && samResult.email) result = samResult;
        else if (!result && samResult) result = samResult;
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, result }) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, result: null, error: e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Unknown action: " + action }) };
};
