// netlify/functions/scc-dibbs-pn.js
// Fetch P/N candidates for a DLA solicitation directly from DIBBS HTML.
// Handles the DoD consent banner via plain HTTP (no Puppeteer needed).
// Action: lookupPN — returns { candidates: string[], suppliers: [{name,cage,pn}] }

const DIBBS = "https://www.dibbs.bsm.dla.mil";
const UA    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

// ── Banner dance — single request chain, no persistent cookie jar ──────────
async function fetchWithBanner(path) {
  const bannerPath = `/dodwarning.aspx?goto=${encodeURIComponent(path)}`;
  const bannerUrl  = DIBBS + bannerPath;

  // 1. GET banner page — get ASP.NET session cookie + VIEWSTATE
  const bannerRes = await fetch(bannerUrl, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  const bannerHtml = await bannerRes.text();
  const setCookies  = bannerRes.headers.get("set-cookie") || "";

  // Build cookie string from all set-cookie headers
  // node-fetch returns a single header value; in Netlify runtime it may be csv
  const cookieStr = setCookies.split(/,(?=\s*\w+=)/).map(c => c.split(";")[0].trim()).join("; ");
  const cookies   = cookieStr + "; DodWarningAccepted=true; dodwarningaccepted=true";

  // If already past the banner (no btnOK), just fetch the target
  if (!bannerHtml.includes("btnOK")) {
    return fetch(DIBBS + path, {
      headers: { "User-Agent": UA, Cookie: cookies },
      redirect: "follow",
    });
  }

  // 2. Extract ASP.NET hidden fields
  const vs  = (bannerHtml.match(/id="__VIEWSTATE"\s+value="([^"]+)"/)         || [])[1] || "";
  const vsg = (bannerHtml.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || "";
  const ev  = (bannerHtml.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/)    || [])[1] || "";

  // 3. POST to accept the banner — capture any new cookies
  const postBody = new URLSearchParams({
    __VIEWSTATE:          vs,
    __VIEWSTATEGENERATOR: vsg,
    __EVENTVALIDATION:    ev,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    btnOK: "OK",
  }).toString();

  const postRes = await fetch(bannerUrl, {
    method:   "POST",
    headers:  { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies, Referer: bannerUrl },
    body:     postBody,
    redirect: "manual", // don't follow — just grab the cookies
  });

  const postCookies = (postRes.headers.get("set-cookie") || "")
    .split(/,(?=\s*\w+=)/)
    .map(c => c.split(";")[0].trim())
    .join("; ");

  const finalCookies = [cookies, postCookies, "DodWarningAccepted=true"].filter(Boolean).join("; ");

  // 4. Fetch the actual target page with all cookies
  return fetch(DIBBS + path, {
    headers: { "User-Agent": UA, Cookie: finalCookies },
    redirect: "follow",
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────
function stripTags(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function clean(s)         { return (s || "").replace(/\s+/g, " ").trim(); }

function parseSuppliers(html) {
  const suppliers = [];
  const lower = html.toLowerCase();
  const markers = ["approved source", "mfr cage", "cage code", "supplier"];
  let sectionStart = -1;
  for (const m of markers) {
    const idx = lower.indexOf(m);
    if (idx > 0 && (sectionStart < 0 || idx < sectionStart)) sectionStart = idx;
  }
  const relevantHtml = sectionStart > 0 ? html.slice(sectionStart) : html;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(relevantHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const t = stripTags(cellMatch[1]);
      if (t) cells.push(t);
    }
    if (cells.length < 2) continue;
    if (cells.every(c => /^(cage|name|part number|company|manufacturer|source|#)$/i.test(c))) continue;
    const cageIdx = cells.findIndex(c => /^[A-Z0-9]{5}$/.test(c.trim()));
    if (cageIdx === -1) continue;
    let name, cage, pn;
    if (cageIdx === 0) {
      cage = cells[0].trim();
      name = cells[1] ? cells[1].trim() : "";
      pn   = cells[2] ? cells[2].trim() : "";
    } else {
      name = cells.slice(0, cageIdx).join(" ").trim();
      cage = cells[cageIdx].trim();
      pn   = cells.slice(cageIdx + 1).join(" ").trim();
    }
    if (!name || name.length < 2) continue;
    if (/^(cage|name|part|supplier|manufacturer|approved)$/i.test(name)) continue;
    suppliers.push({ name: clean(name), cage, pn: clean(pn) });
    if (suppliers.length >= 30) break;
  }
  const seen = new Set();
  return suppliers.filter(s => { if (seen.has(s.cage)) return false; seen.add(s.cage); return true; });
}

// ── Handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, headers, body: "Bad JSON" }; }

  const { sol_number } = payload;
  if (!sol_number) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: "sol_number required" }) };

  const ok   = d => ({ statusCode: 200, headers, body: JSON.stringify({ ok: true,  ...d }) });
  const fail = m => ({ statusCode: 200, headers, body: JSON.stringify({ ok: false, error: m }) });

  try {
    const solPath = `/rfq/rfqrec.aspx?sn=${encodeURIComponent(sol_number.trim().toUpperCase())}`;
    const res = await fetchWithBanner(solPath);

    if (!res.ok) return fail("DIBBS returned " + res.status);

    const html = await res.text();
    if (html.length < 500) return fail("Empty or redirected response from DIBBS");

    const suppliers = parseSuppliers(html);
    const candidates = [...new Set(
      suppliers
        .map(s => s.pn)
        .filter(pn => pn && pn.length > 1 && pn.length < 30)
    )];

    return ok({ candidates, suppliers });
  } catch (e) {
    return fail("DIBBS fetch failed: " + e.message);
  }
};
