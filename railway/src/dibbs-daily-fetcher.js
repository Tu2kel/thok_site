// src/dibbs-daily-fetcher.js — Public DIBBS daily listing → all RFQs issued on a date
//
// URL pattern: https://www.dibbs.bsm.dla.mil/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=MM-DD-YYYY
//
// The www site requires the same DoD banner acceptance as dibbs2 (ASP.NET VIEWSTATE form).
// After one banner acceptance we can page through multiple dates with the same session.
// Each listing row has a direct href to the dibbs2 PDF — no URL guessing needed.

const DIBBS_WWW = "https://www.dibbs.bsm.dla.mil";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _wwwCookie  = null;
let _wwwPromise = null;

function info(...a) { console.log("[dibbs-daily]", ...a); }
function fail(...a) { console.error("[dibbs-daily] ❌", ...a); }

// ── fetch helpers (mirrors dibbs-fetcher.js) ────────────────────────────────

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

async function fetchManual(startUrl, opts = {}, maxRedirects = 8) {
  let url     = startUrl;
  let cookies = opts.cookies || "";
  let reqOpts = { ...opts };
  let lastRes = null;
  let html    = null;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await ft(url, {
      ...reqOpts,
      headers: { ...(reqOpts.headers || {}), Cookie: cookies },
      redirect: "manual",
    });
    cookies = mergeCookies(cookies, parseCookies(res));
    lastRes = res;

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
    if (ct.includes("text") || ct.includes("html")) html = await res.text();
    break;
  }

  if (lastRes && lastRes.status >= 300 && lastRes.status < 400) {
    throw new Error("too many redirects starting at " + startUrl);
  }

  return { res: lastRes, cookies, html };
}

// ── banner acceptance for www.dibbs.bsm.dla.mil ─────────────────────────────

async function acceptWwwBanner(targetUrl) {
  info("Accepting www.dibbs DoD banner…");
  const pUrl      = new URL(targetUrl);
  const path      = pUrl.pathname + pUrl.search;
  const bannerUrl = DIBBS_WWW + "/dodwarning.aspx?goto=" + encodeURIComponent(path);

  const { cookies: getCookies, html: bannerHtml } = await fetchManual(bannerUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });

  info("Banner: " + (bannerHtml || "").length + " chars | hasVS: " + (bannerHtml || "").includes("__VIEWSTATE"));
  if (!(bannerHtml || "").includes("__VIEWSTATE")) {
    throw new Error("www.dibbs banner returned no VIEWSTATE (" + (bannerHtml || "").length + " chars)");
  }

  const hiddenFields = {};
  const hiddenRe = /<input[^>]+\btype\s*=\s*["']?hidden["']?[^>]*>/gi;
  let hm;
  while ((hm = hiddenRe.exec(bannerHtml || "")) !== null) {
    const nameM  = hm[0].match(/\bname\s*=\s*["']([^"']*)["']/i);
    const valueM = hm[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i);
    if (nameM) hiddenFields[nameM[1]] = valueM ? valueM[1] : "";
  }

  const formActionMatch = (bannerHtml || "").match(/<form[^>]+\baction\s*=\s*["']([^"']+)["']/i);
  let postUrl = bannerUrl;
  if (formActionMatch) {
    const action = formActionMatch[1];
    postUrl = action.startsWith("http") ? action
            : action.startsWith("/")    ? DIBBS_WWW + action
            : DIBBS_WWW + "/" + action;
  }

  const formBody = new URLSearchParams({
    ...hiddenFields,
    __EVENTTARGET:   "",
    __EVENTARGUMENT: "",
    butAgree:        "OK",
  }).toString();

  const { cookies: finalCookies } = await fetchManual(postUrl, {
    method:  "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:        bannerUrl,
    },
    body:    formBody,
    cookies: getCookies,
  });

  info("✅ www.dibbs banner accepted");
  return finalCookies;
}

async function ensureWwwSession(url) {
  if (_wwwCookie) return _wwwCookie;
  if (!_wwwPromise) {
    _wwwPromise = acceptWwwBanner(url)
      .then(c  => { _wwwCookie = c;  _wwwPromise = null; return c; })
      .catch(e => { _wwwPromise = null; throw e; });
  }
  return _wwwPromise;
}

// ── date helper ─────────────────────────────────────────────────────────────

function dibbsDate(d) {
  return (d.getMonth() + 1).toString().padStart(2, "0") + "-" +
    d.getDate().toString().padStart(2, "0") + "-" + d.getFullYear();
}

// ── extract NSN from a text chunk near each row ──────────────────────────────

function extractNsn(text) {
  const m = (text || "").match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
  return m ? m[1] : null;
}

// ── main export ─────────────────────────────────────────────────────────────

async function fetchDibbsDailySols({ lookbackDays = 3 } = {}) {
  const sols = [];
  const seen = new Set();

  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr  = dibbsDate(d);
    const listUrl  = DIBBS_WWW + "/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=" + dateStr;

    let cookie;
    try {
      cookie = await ensureWwwSession(listUrl);
    } catch (e) {
      fail("Banner acceptance failed: " + e.message);
      break;
    }

    let html;
    try {
      const res = await ft(listUrl, {
        headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/html,*/*" },
        redirect: "follow",
      }, 30000);
      if (!res.ok) { fail("Listing HTTP " + res.status + " for " + dateStr); continue; }
      html = await res.text();
    } catch (e) {
      fail("Listing fetch failed for " + dateStr + ": " + e.message);
      continue;
    }

    // Split HTML into row chunks so we can associate NSN with the right sol
    // Each row contains the PDF link AND an NSN in adjacent cells
    const rowChunks = html.split(/<tr[\s>]/i);

    let dayCount = 0;
    for (const chunk of rowChunks) {
      const pdfMatch = chunk.match(/href="(https?:\/\/dibbs2\.bsm\.dla\.mil\/Downloads\/RFQ\/[^"]+\.PDF)"/i);
      if (!pdfMatch) continue;

      const pdfDirectUrl = pdfMatch[1];
      const solMatch     = pdfDirectUrl.match(/\/([^\/]+)\.PDF$/i);
      if (!solMatch) continue;

      const sol_number = solMatch[1].toUpperCase();
      if (seen.has(sol_number)) continue;
      seen.add(sol_number);
      if (!/^SP[A-Z0-9]/i.test(sol_number)) continue;

      const nsn = extractNsn(chunk);
      const fsc = nsn ? nsn.replace(/-/g, "").slice(0, 4) : "";

      sols.push({
        sol_number,
        nsn:           nsn || "",
        fsc:           fsc || "",
        item_name:     "",
        quote_due:     "",
        pdf_direct_url: pdfDirectUrl,
        sol_url:       DIBBS_WWW + "/RFQ/RFQRec.aspx?sn=" + sol_number,
        source:        "dibbs-daily",
        issue_date:    dateStr,
        sam_resource_links: [],
      });
      dayCount++;
    }

    info(dateStr + " — " + dayCount + " SP* sols");
  }

  info("Total: " + sols.length + " sol(s) across " + lookbackDays + " day(s)");
  return sols;
}

module.exports = { fetchDibbsDailySols };
