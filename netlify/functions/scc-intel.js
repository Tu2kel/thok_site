// netlify/functions/scc-intel.js
// SAM.gov entity lookup proxy — keeps API key server-side
// Set SAM_API_KEY in Netlify environment variables

const SAM_BASE = "https://api.sam.gov/entity-information/v3/entities";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Bad JSON" }) }; }

  const { action, payload } = body;

  if (action === "samLookup") {
    const key = process.env.SAM_API_KEY;
    if (!key) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, result: null, warn: "SAM_API_KEY not set" }) };
    }

    const { name, cage, uei } = payload || {};
    if (!name && !cage && !uei) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, result: null }) };
    }

    try {
      const params = new URLSearchParams({
        api_key: key,
        samRegistered: "Yes",
        registrationStatus: "A",
        includeSections: "entityRegistration,pointsOfContact,assertions",
      });

      if (uei)       params.set("ueiSAM", uei);
      else if (cage) params.set("cageCode", cage);
      else           params.set("q", `"${name}"`);

      const res = await fetch(`${SAM_BASE}?${params}`);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return { statusCode: 200, body: JSON.stringify({ ok: true, result: null, apiError: res.status, detail: errText.slice(0, 200) }) };
      }

      const data = await res.json();
      const entities = data.entityData || [];
      if (!entities.length) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, result: null }) };
      }

      const entity  = entities[0];
      const reg     = entity.entityRegistration   || {};
      const pocs    = entity.pointsOfContact      || {};
      const asserts = entity.assertions           || {};

      // Try multiple POC paths — SAM.gov response structure varies
      const govPOC  = pocs.governmentBusinessPOC  || {};
      const eBizPOC = pocs.electronicBusinessPOC  || {};
      const altPOC  = pocs.alternateGovernmentBusinessPOC || {};

      const email = govPOC.email  || govPOC.electronicBusinessEmail
                 || eBizPOC.email || altPOC.email || null;
      const phone = govPOC.phoneNumber || eBizPOC.phoneNumber || altPOC.phoneNumber || null;

      const addr = reg.physicalAddress || {};
      const naicsList = (asserts.goodsAndServices && asserts.goodsAndServices.naicsList) || [];

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          result: {
            uei:    reg.ueiSAM             || null,
            cage:   reg.cageCode           || null,
            name:   reg.legalBusinessName  || reg.dbaName || null,
            dba:    reg.dbaName            || null,
            email,
            phone,
            address: {
              street: addr.addressLine1 || null,
              city:   addr.city         || null,
              state:  addr.stateOrProvinceCode || null,
              zip:    addr.zipCode      || null,
            },
            status: reg.registrationStatus        || null,
            expiry: reg.registrationExpirationDate|| null,
            naics:  naicsList.map(n => n.naicsCode || n).filter(Boolean),
          },
        }),
      };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, result: null, error: e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Unknown action: " + action }) };
};
