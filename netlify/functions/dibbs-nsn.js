// netlify/functions/dibbs-nsn.js
// DIBBS NSN Intelligence proxy — returns AMSC, approved sources, nomenclature
// Tries DIBBS APIs directly; falls back through ScraperAPI if cloud-IP blocked.
// POST body: { nsn: "5320-01-590-9052" }
// Returns: { ok, nsn, nomenclature, amsc, amscDesc, amscOpen, approvedSources: [{cage, partNumber, companyName}] }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const DIBBS_BASE = "https://www.dibbs.bsm.dla.mil";

// DLA AMSC reference — affects bid eligibility
const AMSC_MAP = {
  A: { desc: "No special requirements — open competition", open: true },
  B: { desc: "No competitive restrictions", open: true },
  C: { desc: "Approved sources required — verify your CAGE", open: false },
  D: { desc: "Sole source", open: false },
  E: { desc: "Sole source — new acquisition", open: false },
  F: { desc: "One approved source only", open: false },
  G: { desc: "Two approved sources", open: false },
  K: { desc: "Does not meet qualification requirements", open: false },
  R: { desc: "Restricted to approved sources only — must appear on approved source list", open: false },
  V: { desc: "Not procured from commercial sources", open: false },
};

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp("<" + tag + "[^>]*>([^<]*)</" + tag + ">", "i"));
  return m ? m[1].trim() : "";
}

function xmlBlocks(xml, tag) {
  const blocks = [];
  const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "gi");
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
  return blocks;
}

async function directFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/xml, text/xml, */*",
      "User-Agent": "Mozilla/5.0 (compatible; gobierno-procurement-tool/1.0)",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}

async function scraperFetch(url) {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error("SCRAPER_API_KEY not set");
  const proxyUrl =
    "https://api.scraperapi.com?api_key=" + key + "&url=" + encodeURIComponent(url) + "&render=false&country_code=us";
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error("ScraperAPI HTTP " + res.status);
  return await res.text();
}

function parseXML(xml) {
  const nomenclature =
    xmlTag(xml, "Nomenclature") ||
    xmlTag(xml, "ItemName") ||
    xmlTag(xml, "NOMENCLATURE") ||
    "";

  const amscRaw =
    xmlTag(xml, "AMSC") ||
    xmlTag(xml, "Amsc") ||
    xmlTag(xml, "amsc") ||
    "";
  const amsc = amscRaw.toUpperCase().trim().slice(0, 1);
  const amscInfo = AMSC_MAP[amsc] || { desc: "Code " + amsc + " — research required", open: null };

  // Try multiple possible tag names for approved source blocks
  let sourceBlocks = xmlBlocks(xml, "Source");
  if (!sourceBlocks.length) sourceBlocks = xmlBlocks(xml, "ApprovedSource");
  if (!sourceBlocks.length) sourceBlocks = xmlBlocks(xml, "VENDOR");

  const approvedSources = sourceBlocks
    .map((block) => ({
      cage: xmlTag(block, "CAGE") || xmlTag(block, "Cage") || xmlTag(block, "cage") || "",
      partNumber:
        xmlTag(block, "PartNumber") ||
        xmlTag(block, "Part_Number") ||
        xmlTag(block, "PARTNUMBER") ||
        xmlTag(block, "PN") ||
        "",
      companyName:
        xmlTag(block, "CompanyName") ||
        xmlTag(block, "Company") ||
        xmlTag(block, "COMPANYNAME") ||
        "",
    }))
    .filter((s) => s.cage || s.partNumber);

  return { nomenclature, amsc, amscDesc: amscInfo.desc, amscOpen: amscInfo.open, approvedSources };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: HEADERS, body: "" };
  }

  let nsn;
  try {
    const body = JSON.parse(event.body || "{}");
    nsn = (body.nsn || "").trim().replace(/\s+/g, "");
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: "Bad request body" }),
    };
  }

  if (!nsn) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: "nsn required" }),
    };
  }

  // Normalize
  const nsnDashed = nsn.includes("-")
    ? nsn
    : nsn.replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4");
  const nsnRaw = nsn.replace(/-/g, "");
  const niin = nsnRaw.slice(4); // last 9 digits

  // Candidate API URLs — DIBBS APIs endpoint and fallback formats
  const urls = [
    DIBBS_BASE + "/APIs/NSNData/GetNSNPartInfo?nsn=" + encodeURIComponent(nsnDashed),
    DIBBS_BASE + "/APIs/NSNData/GetNSNPartInfo?nsn=" + nsnRaw,
    DIBBS_BASE + "/APIs/NSNData/GetNSNPartInfo?niin=" + niin,
  ];

  let xml = null;
  let usedProxy = false;

  // Try direct first
  for (const url of urls) {
    try {
      const text = await directFetch(url);
      if (text.includes("<") && !text.toLowerCase().includes("access denied") && !text.toLowerCase().includes("error")) {
        xml = text;
        break;
      }
    } catch (_) {}
  }

  // Fallback through ScraperAPI
  if (!xml) {
    try {
      xml = await scraperFetch(urls[0]);
      if (xml.includes("<")) usedProxy = true;
      else xml = null;
    } catch (e) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "DIBBS NSN API unreachable — " + e.message,
        }),
      };
    }
  }

  if (!xml) {
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: "No valid XML response from DIBBS" }),
    };
  }

  const parsed = parseXML(xml);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ok: true,
      nsn: nsnDashed,
      ...parsed,
      usedProxy,
    }),
  };
};
