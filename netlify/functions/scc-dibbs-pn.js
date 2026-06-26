// netlify/functions/scc-dibbs-pn.js
// Fetch P/N candidates for a DLA solicitation directly from DIBBS HTML.
// Handles the DoD consent banner via plain HTTP — no Puppeteer needed.

const DIBBS = "https://www.dibbs.bsm.dla.mil";
const UA    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

// Safe multi-cookie extractor — uses getSetCookie() (Node 18+) when available,
// falls back to splitting the combined header on safe boundaries.
function parseCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().map(c => c.split(";")[0].trim());
  }
  const raw = headers.get("set-cookie") || "";
  if (!raw) return [];
  // Split on ", " only when followed by a cookie name (word=)
  return raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/).map(c => c.split(";")[0].trim());
}

// ── Banner dance ────────────────────────────────────────────────────────────
async function fetchWithBanner(path) {
  const bannerPath = `/dodwarning.aspx?goto=${encodeURIComponent(path)}`;
  const bannerUrl  = DIBBS + bannerPath;
  const CONSENT    = "DodWarningAccepted=true; dodwarningaccepted=true";

  // 1. Try the sol page directly with consent cookies already set
  const directRes = await fetch(DIBBS + path, {
    headers: { "User-Agent": UA, Cookie: CONSENT },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  const directHtml = await directRes.text();

  // If no banner, we're in
  if (!directHtml.includes("btnOK") && directHtml.length > 500) {
    return { ok: true, html: directHtml };
  }

  // 2. Banner is present — GET it to collect ASP.NET session cookie
  const bannerRes = await fetch(bannerUrl, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  const bannerHtml = await bannerRes.text();
  const cookies1   = parseCookieHeaders(bannerRes.headers);

  if (!bannerHtml.includes("btnOK")) {
    // Banner gone after following redirect — session was set
    const solRes  = await fetch(DIBBS + path, {
      headers: { "User-Agent": UA, Cookie: [...cookies1, CONSENT].join("; ") },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    return { ok: solRes.ok, html: await solRes.text() };
  }

  // 3. Extract ASP.NET hidden fields and POST acceptance
  const vs  = (bannerHtml.match(/id="__VIEWSTATE"\s+value="([^"]*)"/)         || [])[1] || "";
  const vsg = (bannerHtml.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/) || [])[1] || "";
  const ev  = (bannerHtml.match(/id="__EVENTVALIDATION"\s+value="([^"]*)"/)    || [])[1] || "";

  const postBody = new URLSearchParams({
    __VIEWSTATE: vs, __VIEWSTATEGENERATOR: vsg, __EVENTVALIDATION: ev,
    __EVENTTARGET: "", __EVENTARGUMENT: "", btnOK: "OK",
  }).toString();

  const cookieHeader1 = [...cookies1, CONSENT].join("; ");
  const postRes = await fetch(bannerUrl, {
    method:  "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded",
               Cookie: cookieHeader1, Referer: bannerUrl },
    body:    postBody,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const cookies2      = parseCookieHeaders(postRes.headers);
  const cookieHeader2 = [...cookies1, ...cookies2, CONSENT].join("; ");

  // 4. Fetch the actual sol page
  const solRes = await fetch(DIBBS + path, {
    headers: { "User-Agent": UA, Cookie: cookieHeader2 },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  return { ok: solRes.ok, html: await solRes.text() };
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
      cage = cells[0].trim(); name = cells[1] ? cells[1].trim() : ""; pn = cells[2] ? cells[2].trim() : "";
    } else {
      name = cells.slice(0, cageIdx).join(" ").trim(); cage = cells[cageIdx].trim();
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
    const result = await fetchWithBanner(solPath);

    if (!result.ok) return fail("DIBBS returned error status");
    if (!result.html || result.html.length < 500) return fail("Empty DIBBS response — sol may be closed or DIBBS blocked this IP");
    if (result.html.includes("btnOK")) return fail("DIBBS banner could not be dismissed from Netlify IP");

    const suppliers  = parseSuppliers(result.html);
    const candidates = [...new Set(
      suppliers.map(s => s.pn).filter(pn => pn && pn.length > 1 && pn.length < 30)
    )];

    // Include a debug snippet so we can verify what DIBBS returned if empty
    const debug = candidates.length ? undefined : result.html.slice(0, 400);

    return ok({ candidates, suppliers, debug });
  } catch (e) {
    return fail("DIBBS fetch failed: " + e.message);
  }
};
