// src/sam-fetcher.js — SAM.gov Opportunities API → DLA RFQ sol list
// Queries active DLA solicitations by FSC lane, returns stub objects that
// fetchAllSolDetails (dibbs-fetcher) enriches via PDF download + parse.

const SAM_API = "https://api.sam.gov/opportunities/v2/search";
const DELAY_MS = 600; // between per-FSC requests to respect rate limit

function info(...a) { console.log("[sam-fetcher]", ...a); }
function fail(...a) { console.error("[sam-fetcher] ❌", ...a); }

function samDate(d) {
  return (d.getMonth() + 1).toString().padStart(2, "0") + "/" +
    d.getDate().toString().padStart(2, "0") + "/" +
    d.getFullYear();
}

function extractNsn(text) {
  const m = (text || "").match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
  return m ? m[1] : null;
}

// One SAM API page — returns { opps[], total }
async function fetchPage(apiKey, queryParams, offset = 0) {
  const p = new URLSearchParams({ ...queryParams, api_key: apiKey, limit: "1000", offset: String(offset) });
  const url = SAM_API + "?" + p.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000); // 60s timeout

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === "AbortError" ? "SAM API timeout (30s)" : e.message);
  }
  clearTimeout(timer);

  const body = await res.text();
  if (!res.ok) throw new Error("SAM API " + res.status + ": " + body.slice(0, 300));

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("SAM API non-JSON response: " + body.slice(0, 200));
  }

  return {
    opps:  data.opportunitiesData || [],
    total: data.totalRecords      || 0,
  };
}

// Fetch all pages for a single query (SAM caps at 1000/page)
async function fetchAllPages(apiKey, queryParams) {
  const first = await fetchPage(apiKey, queryParams, 0);
  let opps = [...first.opps];
  let offset = 1000;
  while (opps.length < first.total && first.total > 1000) {
    await new Promise(r => setTimeout(r, DELAY_MS));
    const next = await fetchPage(apiKey, queryParams, offset);
    opps = opps.concat(next.opps);
    offset += 1000;
  }
  return opps;
}

// Map one SAM opportunity record → our sol stub
function mapOpp(opp) {
  const solNum = (opp.solicitationNumber || "").trim().toUpperCase();
  if (!solNum) return null;
  // DLA sol numbers: SPE... or SPRRA / SPRBL / SP450 etc.
  if (!/^SP[A-Z0-9]/i.test(solNum)) return null;

  const title   = (opp.title || "").trim();
  const nsn     = extractNsn(title) || extractNsn(opp.description || "");
  const fsc     = opp.classificationCode || (nsn ? nsn.replace(/-/g, "").slice(0, 4) : "");
  const dueRaw  = opp.responseDeadLine;
  const quoteDue = dueRaw ? dueRaw.slice(0, 10) : ""; // ISO → YYYY-MM-DD

  return {
    sol_number: solNum,
    nsn:        nsn || "",
    fsc:        fsc || "",
    item_name:  title.replace(/\s+NSN\s+[\d-]+/i, "").trim() || title,
    quote_due:  quoteDue,
    sol_url:    opp.uiLink || ("https://sam.gov/opp/" + (opp.noticeId || "") + "/view"),
    source:     "sam-api",
  };
}

// Main export — returns array of sol stubs ready for fetchAllSolDetails
async function fetchSamSols({ lookbackDays = 3, fscLanes = [] } = {}) {
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) throw new Error("SAM_API_KEY env var not set");

  const now  = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - lookbackDays);

  // No organizationName filter — causes slow full-table scans and timeouts.
  // classificationCode (FSC) narrows results; DLA sol numbers filtered via SP prefix in mapOpp.
  const baseParams = {
    active:     "Yes",
    postedFrom: samDate(from),
    postedTo:   samDate(now),
  };

  let rawOpps = [];

  if (fscLanes.length) {
    for (const fsc of fscLanes) {
      info("Querying SAM — FSC " + fsc + " …");
      try {
        const opps = await fetchAllPages(apiKey, { ...baseParams, classificationCode: fsc });
        info("FSC " + fsc + ": " + opps.length + " record(s)");
        rawOpps.push(...opps);
      } catch (e) {
        fail("FSC " + fsc + " failed: " + e.message);
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  } else {
    info("Querying SAM — all DLA (no FSC filter)…");
    rawOpps = await fetchAllPages(apiKey, baseParams);
    info("All DLA: " + rawOpps.length + " record(s)");
  }

  // Deduplicate, map, filter nulls
  const seen = new Set();
  const sols = [];
  for (const opp of rawOpps) {
    const stub = mapOpp(opp);
    if (!stub || seen.has(stub.sol_number)) continue;
    seen.add(stub.sol_number);
    sols.push(stub);
  }

  info("SAM fetch complete — " + sols.length + " unique DLA RFQs");
  return sols;
}

module.exports = { fetchSamSols };
