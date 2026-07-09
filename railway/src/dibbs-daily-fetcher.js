// src/dibbs-daily-fetcher.js — Public DIBBS daily listing → all RFQs issued on a date
//
// URL pattern: https://www.dibbs.bsm.dla.mil/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=MM-DD-YYYY
//
// Flow: navigate to listing → server redirects to dodwarning.aspx banner →
//   wait for banner form to populate (Timer 1) → POST butAgree=OK →
//   wait for listing to load (Timer 2) → parse rows for PDF hrefs

const DIBBS_WWW = "https://www.dibbs.bsm.dla.mil";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WAIT_BANNER_MS  = 2500; // Timer 1: pause after landing on banner page so form populates
const WAIT_LISTING_MS = 2000; // Timer 2: pause after POST so listing page fully loads

let _wwwCookie      = null;
let _wwwPromise     = null;
let _cachedListing  = {};    // dateStr → html (avoids re-fetch on same date)

function info(...a) { console.log("[dibbs-daily]", ...a); }
function fail(...a) { console.error("[dibbs-daily] ❌", ...a); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── fetch helpers ────────────────────────────────────────────────────────────

async function ft(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw new Error(e.name === "AbortError" ? "timeout (" + timeoutMs + "ms): " + url : e.message);
  }
}

function parseCookies(res) {
  const headers = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]+=)/);
  return headers.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

function mergeCookies(base, incoming) {
  const map = new Map();
  for (const c of (base || "").split("; ").filter(Boolean)) {
    const k = c.split("=")[0]; if (k) map.set(k, c);
  }
  for (const c of (incoming || "").split("; ").filter(Boolean)) {
    const k = c.split("=")[0]; if (k) map.set(k, c);
  }
  return [...map.values()].join("; ");
}

// Follow redirects manually, accumulating cookies.
// Also handles <meta http-equiv="refresh"> — the DIBBS banner landing page can
// return a short loading page (~245 chars) before the actual form appears.
// Returns { res, cookies, html, finalUrl }
async function fetchManual(startUrl, opts = {}, maxRedirects = 12) {
  let url     = startUrl;
  let cookies = opts.cookies || "";
  let reqOpts = { ...opts };
  let lastRes = null;
  let html    = null;
  let finalUrl = startUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await ft(url, {
      ...reqOpts,
      headers: { ...(reqOpts.headers || {}), Cookie: cookies },
      redirect: "manual",
    });
    cookies  = mergeCookies(cookies, parseCookies(res));
    lastRes  = res;
    finalUrl = url;

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      url = loc.startsWith("http") ? loc : DIBBS_WWW + loc;
      if ((res.status === 302 || res.status === 303) && reqOpts.method === "POST") {
        reqOpts = { ...reqOpts, method: "GET" };
        delete reqOpts.body;
      }
      continue;
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text") || ct.includes("html")) {
      html = await res.text();

      // Handle <meta http-equiv="refresh" content="N; url=..."> —
      // the DIBBS banner landing page does this to load the actual form.
      const mr = (html || "").match(
        /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]+content\s*=\s*["']?\s*(\d+)\s*;\s*url\s*=\s*([^"'\s>]+)/i
      ) || (html || "").match(
        /<meta[^>]+content\s*=\s*["']?\s*(\d+)\s*;\s*url\s*=\s*([^"'\s>]+)[^>]*http-equiv\s*=\s*["']?refresh/i
      );
      if (mr && i < maxRedirects) {
        const delaySec = parseInt(mr[1], 10) || 0;
        const refreshHref = mr[2].replace(/["']/g, "").trim();
        url  = refreshHref.startsWith("http") ? refreshHref : DIBBS_WWW + refreshHref;
        html = null;
        if (delaySec > 0) await sleep(Math.min(delaySec * 1000, 5000));
        continue;
      }
    }
    break;
  }

  if (lastRes && lastRes.status >= 300 && lastRes.status < 400) {
    throw new Error("too many redirects starting at " + startUrl);
  }

  return { res: lastRes, cookies, html, finalUrl };
}

// ── banner acceptance ────────────────────────────────────────────────────────

function extractHiddenFields(html) {
  const fields = {};
  const re = /<input[^>]+\btype\s*=\s*["']?hidden["']?[^>]*>/gi;
  let m;
  while ((m = re.exec(html || "")) !== null) {
    const nameM  = m[0].match(/\bname\s*=\s*["']([^"']*)["']/i);
    const valueM = m[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i);
    if (nameM) fields[nameM[1]] = valueM ? valueM[1] : "";
  }
  return fields;
}

// Navigate to listingUrl, follow whatever redirect chain www.dibbs uses to get
// to the DoD banner, accept it, then return the session cookies + listing HTML.
async function acceptBannerAndFetchListing(listingUrl) {
  // ── Stage 1: Navigate to the listing URL — server redirects to banner ────
  info("Stage 1: navigating to listing → expect banner redirect…");
  let step = await fetchManual(listingUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "en-US,en;q=0.9" },
  });
  info("Stage 1 result: " + (step.html || "").length + " chars | finalUrl: " + step.finalUrl);

  // If listing came through directly (session already valid or no banner needed)
  if ((step.html || "").includes("dibbs2.bsm.dla.mil/Downloads")) {
    info("✅ Listing loaded with no banner");
    return { cookies: step.cookies, html: step.html };
  }

  // If we got a short page (loading/intermediate), Timer 1: wait then retry
  if (!(step.html || "").includes("__VIEWSTATE")) {
    info("Short response (" + (step.html || "").length + " chars) — Timer 1: waiting " + WAIT_BANNER_MS + "ms for banner to populate…");
    await sleep(WAIT_BANNER_MS);
    step = await fetchManual(step.finalUrl || listingUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
      cookies: step.cookies,
    });
    info("After Timer 1: " + (step.html || "").length + " chars | hasVS: " + (step.html || "").includes("__VIEWSTATE"));
  }

  if (!(step.html || "").includes("__VIEWSTATE")) {
    throw new Error("Banner form never appeared (" + (step.html || "").length + " chars after wait). HTML: " + (step.html || "").slice(0, 200));
  }

  // ── Stage 2: POST the OK button ──────────────────────────────────────────
  info("Stage 2: banner form found — posting butAgree=OK…");
  const hiddenFields = extractHiddenFields(step.html);
  info("Hidden fields: " + Object.keys(hiddenFields).join(", "));

  const formActionMatch = (step.html || "").match(/<form[^>]+\baction\s*=\s*["']([^"']+)["']/i);
  let postUrl = step.finalUrl || listingUrl;
  if (formActionMatch) {
    const action = formActionMatch[1];
    postUrl = action.startsWith("http") ? action
            : action.startsWith("/")    ? DIBBS_WWW + action
            : DIBBS_WWW + "/" + action;
  }
  info("POST target: " + postUrl);

  const formBody = new URLSearchParams({
    ...hiddenFields,
    __EVENTTARGET:   "",
    __EVENTARGUMENT: "",
    butAgree:        "OK",
  }).toString();

  const postStep = await fetchManual(postUrl, {
    method:  "POST",
    headers: {
      "User-Agent":    UA,
      "Content-Type":  "application/x-www-form-urlencoded",
      Referer:         step.finalUrl || listingUrl,
      Accept:          "text/html,*/*",
    },
    body:    formBody,
    cookies: step.cookies,
  });
  info("POST complete — " + postStep.finalUrl + " | " + (postStep.html || "").length + " chars");

  // ── Stage 3: Timer 2 — wait for listing to populate ─────────────────────
  if (!(postStep.html || "").includes("dibbs2.bsm.dla.mil/Downloads")) {
    info("Timer 2: waiting " + WAIT_LISTING_MS + "ms for listing to load after banner clear…");
    await sleep(WAIT_LISTING_MS);

    const listStep = await fetchManual(listingUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      cookies: postStep.cookies,
    });
    info("✅ Listing after timer: " + (listStep.html || "").length + " chars");
    return { cookies: listStep.cookies, html: listStep.html };
  }

  info("✅ Listing came back with POST response");
  return { cookies: postStep.cookies, html: postStep.html };
}

async function ensureWwwSession(listingUrl) {
  if (_wwwCookie) return _wwwCookie;
  if (!_wwwPromise) {
    _wwwPromise = acceptBannerAndFetchListing(listingUrl)
      .then(({ cookies }) => { _wwwCookie = cookies; _wwwPromise = null; return cookies; })
      .catch(e => { _wwwPromise = null; throw e; });
  }
  return _wwwPromise;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function dibbsDate(d) {
  return (d.getMonth() + 1).toString().padStart(2, "0") + "-" +
    d.getDate().toString().padStart(2, "0") + "-" + d.getFullYear();
}

function extractNsn(text) {
  const m = (text || "").match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
  return m ? m[1] : null;
}

function stripTags(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function parseListingHtml(html) {
  const sols = [];
  const rowChunks = (html || "").split(/<tr[\s>]/i);
  for (const chunk of rowChunks) {
    const pdfMatch = chunk.match(/href="(https?:\/\/dibbs2\.bsm\.dla\.mil\/Downloads\/RFQ\/[^"]+\.PDF)"/i);
    if (!pdfMatch) continue;
    const pdfDirectUrl = pdfMatch[1];
    const solMatch = pdfDirectUrl.match(/\/([^\/]+)\.PDF$/i);
    if (!solMatch) continue;
    const sol_number = solMatch[1].toUpperCase();
    if (!/^SP[A-Z0-9]/i.test(sol_number)) continue;
    const nsn = extractNsn(chunk);

    // Pull cells in order — DIBBS table is <td>...</td> delimited
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(chunk)) !== null) cells.push(stripTags(cm[1]));

    // Extract key column values by content matching (column order varies by user prefs)
    const getText = (pattern) => { const c = cells.find(x => pattern.test(x)); return c || null; };
    const nomenclature = cells.find(c => /[A-Z]{3,},[A-Z]/.test(c) && c.length > 4) || "";
    const quoteDueCell = cells.find(c => /^\d{2}\/\d{2}\/\d{2,4}$/.test(c.trim())) || "";
    const postedCell   = cells.find((c, i) => /^\d{2}\/\d{2}\/\d{2,4}$/.test(c.trim()) && i > cells.indexOf(quoteDueCell)) || "";
    const qtyCell      = cells.find(c => /^[\d,]+$/.test(c.trim()) && parseInt(c.replace(/,/g,"")) > 0) || "";
    const naicsCell    = cells.find(c => /^\d{5,6}$/.test(c.trim())) || "";
    const jcpCell      = cells.find(c => /^[YN]$/.test(c.trim()) && cells.indexOf(c) > 5) || "";
    const amscCell     = cells.find(c => /^[A-Z]$/.test(c.trim()) && c.length === 1 && cells.indexOf(c) > 10) || "";
    const restrictedFlag = /Restricted/i.test(chunk) ? "Restricted" : null;
    const techDocsFlag   = cells.find(c => /^Yes$/i.test(c.trim())) ? true : null;

    // Buyer info often appears in a title/tooltip attribute
    const buyerMatch = chunk.match(/(?:title|alt)="([^"]*(?:Name|Buyer|Tel)[^"]*)"/i);
    const buyerRaw   = buyerMatch ? buyerMatch[1] : null;
    const buyerName  = buyerRaw ? (buyerRaw.match(/Name:\s*([^,\n]+)/i) || [])[1]?.trim() : null;
    const buyerPhone = buyerRaw ? (buyerRaw.match(/Tel:\s*([\d\-\(\) ]+)/i) || [])[1]?.trim() : null;
    const buyerEmail = buyerRaw ? (buyerRaw.match(/Email:\s*([\w.\-]+@[\w.\-]+)/i) || [])[1]?.trim() : null;
    const buyerCode  = buyerRaw ? (buyerRaw.match(/Buyer Code:\s*([A-Z0-9]+)/i) || [])[1]?.trim() : null;

    sols.push({
      sol_number,
      nsn:                  nsn || "",
      fsc:                  nsn ? nsn.replace(/-/g, "").slice(0, 4) : "",
      item_name:            nomenclature || "",
      quote_due:            quoteDueCell || "",
      posted_date:          postedCell || "",
      quantity:             qtyCell || "",
      naics:                naicsCell || "",
      jcp_required:         jcpCell === "Y" ? true : jcpCell === "N" ? false : null,
      amsc:                 amscCell || null,
      supplier_restrictions: restrictedFlag,
      tech_docs:            techDocsFlag,
      buyer_name:           buyerName || null,
      buyer_phone:          buyerPhone || null,
      buyer_email:          buyerEmail || null,
      buyer_code:           buyerCode || null,
      pdf_direct_url:       pdfDirectUrl,
      sol_url:              DIBBS_WWW + "/RFQ/RFQRec.aspx?sn=" + sol_number,
      source:               "dibbs-daily",
      sam_resource_links:   [],
    });
  }
  return sols;
}

// ── main export ──────────────────────────────────────────────────────────────

async function fetchDibbsDailySols({ lookbackDays = 1 } = {}) {
  const allSols = [];
  const seen    = new Set();

  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = dibbsDate(d);
    const listUrl = DIBBS_WWW + "/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=" + dateStr;

    let html;

    if (_cachedListing[dateStr]) {
      html = _cachedListing[dateStr];
    } else {
      try {
        const cookie = await ensureWwwSession(listUrl);

        // Fetch listing with established session
        const res = await fetchManual(listUrl, {
          headers: { "User-Agent": UA, Accept: "text/html,*/*" },
          cookies: cookie,
        });
        html = res.html || "";

        // If still showing banner (session expired mid-run), re-accept
        if (html.includes("__VIEWSTATE") && !html.includes("dibbs2.bsm.dla.mil")) {
          info("Session expired for " + dateStr + " — re-accepting banner");
          _wwwCookie  = null;
          _wwwPromise = null;
          const fresh = await acceptBannerAndFetchListing(listUrl);
          _wwwCookie  = fresh.cookies;
          html = fresh.html || "";
        }

        _cachedListing[dateStr] = html;
      } catch (e) {
        fail("Failed for " + dateStr + ": " + e.message);
        continue;
      }
    }

    const daySols = parseListingHtml(html).filter(s => !seen.has(s.sol_number));
    daySols.forEach(s => { s.issue_date = dateStr; seen.add(s.sol_number); });
    allSols.push(...daySols);
    info(dateStr + " — " + daySols.length + " SP* sols");
  }

  info("Total: " + allSols.length + " sol(s)");
  return allSols;
}

module.exports = { fetchDibbsDailySols };
