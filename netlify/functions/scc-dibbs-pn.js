// netlify/functions/scc-dibbs-pn.js
// Fetch approved-source part numbers from the DIBBS NSN page.
// URL format: https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx?value={nsn}&category=&Scope=
// This page is public — no DoD banner required.
// Returns { candidates: string[], suppliers: [{cage, pn, name}] }

const NSN_BASE = "https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

function stripTags(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

// Parse the "Approved Source Data" table from the NSN page.
// Column order on DIBBS NSN page: CAGE | Part Number | Company Name
function parseNsnPage(html) {
  const suppliers = [];
  const lower     = html.toLowerCase();

  // Find the approved source section
  const idx = lower.indexOf("approved source");
  if (idx === -1) return suppliers;
  const section = html.slice(idx);

  // Find header row to determine column order dynamically
  let cageCol = 0, pnCol = 1, nameCol = 2; // defaults for known DIBBS layout
  const headerMatch = section.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (headerMatch) {
    const headers = [];
    const cellRe  = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m;
    while ((m = cellRe.exec(headerMatch[1])) !== null) {
      headers.push(stripTags(m[1]).toLowerCase());
    }
    const ci = headers.findIndex(h => /\bcage\b/.test(h));
    const pi = headers.findIndex(h => /part.*number|p\/n/.test(h));
    const ni = headers.findIndex(h => /company|name|manufacturer/.test(h));
    if (ci !== -1) cageCol  = ci;
    if (pi !== -1) pnCol    = pi;
    if (ni !== -1) nameCol  = ni;
  }

  // Extract data rows
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(section)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length < 2) continue;

    const cage = (cells[cageCol] || "").trim();
    const pn   = (cells[pnCol]   || "").trim();
    const name = (cells[nameCol] || "").trim();

    // CAGE must be 5 alphanumeric chars
    if (!/^[A-Z0-9]{5}$/i.test(cage)) continue;
    // Skip header rows
    if (/^(cage|code)$/i.test(cage)) continue;
    if (!pn || pn.length < 2 || pn.length > 30) continue;
    if (/part.*number|p\/n/i.test(pn)) continue; // skip header cell

    suppliers.push({ cage, pn, name });
    if (suppliers.length >= 20) break;
  }

  // Deduplicate by CAGE
  const seen = new Set();
  return suppliers.filter(s => { if (seen.has(s.cage)) return false; seen.add(s.cage); return true; });
}

// ── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, headers, body: "Bad JSON" };
  }

  const { nsn, sol_number } = payload;
  const nsnClean = (nsn || "").replace(/\D/g, ""); // strip dashes/spaces

  const ok   = d => ({ statusCode: 200, headers, body: JSON.stringify({ ok: true,  ...d }) });
  const fail = m => ({ statusCode: 200, headers, body: JSON.stringify({ ok: false, error: m }) });

  if (!nsnClean) return fail("nsn required");

  try {
    const url = NSN_BASE + "?value=" + encodeURIComponent(nsnClean) + "&category=&Scope=";
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal:   AbortSignal.timeout(10000),
    });

    if (!res.ok) return fail("DIBBS NSN page returned " + res.status);

    const html       = await res.text();
    const suppliers  = parseNsnPage(html);
    const candidates = [...new Set(suppliers.map(s => s.pn).filter(Boolean))];

    return ok({ candidates, suppliers, nsn: nsnClean, sol_number });
  } catch (e) {
    return fail("Fetch failed: " + e.message);
  }
};
