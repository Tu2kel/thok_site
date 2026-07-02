// src/dibbs-fetcher.js — DIBBS PDF fetcher + parser
// 1. Plain fetch POSTs the DoD banner agreement (no browser/Puppeteer needed)
// 2. Plain fetch downloads each PDF using the captured session cookie
// 3. pdf-parse extracts all procurement fields

const pdfParse = require("pdf-parse");

const DIBBS2_BASE = "https://dibbs2.bsm.dla.mil";
const DIBBS_PUB   = "https://www.dibbs.bsm.dla.mil"; // public record site — no auth required
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _sessionCookie = null;
let _sessionPromise = null; // in-flight promise so concurrent fetchers await the same acceptance

function info(...a) { console.log("[dibbs-fetcher]", ...a); }
function fail(...a) { console.error("[dibbs-fetcher] ❌", ...a); }

// PDF URL pattern: last character of sol number = subfolder
function pdfUrl(sol_number) {
  const lastChar = sol_number.slice(-1).toUpperCase();
  return DIBBS2_BASE + "/Downloads/RFQ/" + lastChar + "/" + sol_number + ".PDF";
}

// fetch with AbortController timeout
async function ft(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw new Error(e.name === "AbortError" ? "fetch timeout (" + timeoutMs + "ms): " + url : e.message);
  }
}

// Parse all Set-Cookie headers — use getSetCookie() (Node 18.14+) for correctness
function parseCookies(res) {
  const headers = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]+=)/);
  return headers.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

// Merge cookie strings — later values override same-name keys
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

// Follow a URL manually through redirects, accumulating Set-Cookie at every hop.
// Node.js fetch auto-follow loses cookies set on intermediate 30x responses.
// POST-Redirect-GET: 302/303 after a POST becomes a GET (no body) per HTTP spec.
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
      url = loc.startsWith("http") ? loc : DIBBS2_BASE + loc;
      // POST-Redirect-GET: 302/303 after POST must become GET (body cleared)
      if ((res.status === 302 || res.status === 303) && reqOpts.method === "POST") {
        reqOpts = { ...reqOpts, method: "GET" };
        delete reqOpts.body;
      }
      continue;
    }
    // Non-redirect: read body if text response
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text") || ct.includes("html")) html = await res.text();
    break;
  }

  // Fix #4: throw on redirect exhaustion instead of silently returning incomplete state
  if (lastRes && lastRes.status >= 300 && lastRes.status < 400) {
    throw new Error("fetchManual: too many redirects (" + maxRedirects + ") starting at " + startUrl);
  }

  return { res: lastRes, cookies, html };
}

// Accept DoD banner via plain fetch — no browser required.
// Uses manual redirect following so Set-Cookie on every 30x hop is captured.
// Extracts ALL hidden fields (handles chunked VIEWSTATE like __VIEWSTATE_0).
// POSTs to the form's own action URL (not assumed to be the same as the GET URL).
async function acceptBannerAndGetCookie(targetPdfUrl) {
  info("Accepting DoD banner via fetch (no browser)…");

  const pdfPath   = new URL(targetPdfUrl).pathname;
  const bannerUrl = DIBBS2_BASE + "/dodwarning.aspx?goto=" + encodeURIComponent(pdfPath);

  // Step 1: GET banner form — manual redirects to capture session cookie on every hop
  const { cookies: getCookies, html: bannerHtml } = await fetchManual(bannerUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });

  const hasForm = (bannerHtml || "").includes("__VIEWSTATE");
  info("Banner HTML: " + (bannerHtml || "").length + " chars | hasVS: " + hasForm + " | GET cookies: " + getCookies.length);

  if (!hasForm) {
    // DIBBS2 returned a tiny error page (~245 chars) instead of the warning banner.
    // This means the PDF path doesn't exist on DIBBS2 — not a session issue.
    // Throw a typed error so fetchSolDetails can skip silently without retrying.
    info("No VIEWSTATE (" + (bannerHtml || "").length + " chars) — PDF not on DIBBS2, skipping");
    const e = new Error("PDF_NOT_ON_DIBBS2");
    e.notOnDibbs = true;
    throw e;
  }

  // Extract ALL hidden input fields — handles chunked VIEWSTATE (__VIEWSTATE_0 etc.)
  // and any extra ASP.NET fields we might otherwise miss.
  const hiddenFields = {};
  const hiddenRe = /<input[^>]+\btype\s*=\s*["']?hidden["']?[^>]*>/gi;
  let hm;
  while ((hm = hiddenRe.exec(bannerHtml || "")) !== null) {
    const nameM  = hm[0].match(/\bname\s*=\s*["']([^"']*)["']/i);
    const valueM = hm[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i);
    if (nameM) hiddenFields[nameM[1]] = valueM ? valueM[1] : "";
  }
  info("Hidden fields found: " + Object.keys(hiddenFields).join(", "));
  info("VIEWSTATE: " + (hiddenFields["__VIEWSTATE"] || "").length + "chars | sending GET session in POST");

  // Determine POST target from form's action attribute (may differ from bannerUrl)
  const formActionMatch = (bannerHtml || "").match(/<form[^>]+\baction\s*=\s*["']([^"']+)["']/i);
  let postUrl = bannerUrl;
  if (formActionMatch) {
    const action = formActionMatch[1];
    postUrl = action.startsWith("http") ? action
            : action.startsWith("/")    ? DIBBS2_BASE + action
            : DIBBS2_BASE + "/" + action;
  }
  info("POST target: " + postUrl);

  // Step 2: POST all hidden fields + butAgree=OK with the GET session cookie
  const formBody = new URLSearchParams({
    ...hiddenFields,
    __EVENTTARGET:   "",
    __EVENTARGUMENT: "",
    butAgree:        "OK",
  }).toString();

  const { res: postRes, cookies: finalCookies, html: postHtml } = await fetchManual(postUrl, {
    method:  "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer":      bannerUrl,
    },
    body: formBody,
    cookies: getCookies,
  });

  info("POST status: " + (postRes && postRes.status) + " | final cookies: " + finalCookies.length + " chars");

  // Detect failure: if POST response still contains the banner form, VIEWSTATE was rejected
  if (postHtml && postHtml.includes("__VIEWSTATE")) {
    info("⚠️  Banner POST returned form again — VIEWSTATE rejected. Body[0:300]: " + postHtml.slice(0, 300));
  } else {
    info("✅ DoD banner accepted — session ready");
  }

  return finalCookies;
}

// Ensure we have a valid session cookie.
// Fix #1: Promise-based mutex — concurrent callers await the same acceptance request
// instead of each firing their own, which would cause a race on _sessionCookie.
async function ensureSession(targetUrl) {
  if (_sessionCookie) return _sessionCookie;
  if (!_sessionPromise) {
    _sessionPromise = acceptBannerAndGetCookie(targetUrl)
      .then(c  => { _sessionCookie = c; _sessionPromise = null; return c; })
      .catch(e => { _sessionPromise = null; throw e; });
  }
  // If the shared promise fails because THAT specific PDF isn't on DIBBS2,
  // other concurrent callers should try their own URL independently — their
  // PDFs might exist even though the first one didn't.
  return _sessionPromise.catch(e => {
    if (e.notOnDibbs) {
      return acceptBannerAndGetCookie(targetUrl)
        .then(c => { _sessionCookie = c; return c; });
    }
    throw e;
  });
}

// Step 1 — scrape the public DIBBS record page to confirm the PDF exists and get its exact URL.
// www.dibbs.bsm.dla.mil is open to the internet — no DoD banner, no auth required.
// Returns the dibbs2 PDF URL string, or null if no PDF link found on the record page.
async function findPdfUrlOnPublicDibbs(sol_number) {
  const recordUrl = DIBBS_PUB + "/RFQ/RFQRec.aspx?sn=" + sol_number;
  try {
    const { html } = await fetchManual(recordUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    });
    const m = (html || "").match(/href="(https?:\/\/dibbs2\.bsm\.dla\.mil\/[^"]+\.PDF)"/i);
    if (m) {
      info("Public DIBBS confirmed PDF: " + m[1]);
      return m[1];
    }
    info(sol_number + " — no PDF link on public DIBBS record");
    return null;
  } catch (e) {
    info("Public DIBBS record fetch failed (" + sol_number + "): " + e.message);
    return null;
  }
}

// Step 2 — download PDF from the dibbs2 URL found above.
// Tries a direct GET with Referer set to the public page first (may bypass the DoD banner).
// If DIBBS2 still redirects to the banner, falls through to full banner acceptance.
async function fetchPdfBuffer(sol_number) {
  const pdfLink = await findPdfUrlOnPublicDibbs(sol_number);
  if (!pdfLink) {
    const e = new Error("PDF_NOT_ON_DIBBS2");
    e.notOnDibbs = true;
    throw e;
  }

  const referer = DIBBS_PUB + "/RFQ/RFQRec.aspx?sn=" + sol_number;

  // Attempt 1 — direct GET with Referer (may bypass the DoD banner)
  const res1 = await ft(pdfLink, {
    headers: { "User-Agent": UA, Accept: "application/pdf,*/*", Referer: referer },
    redirect: "follow",
  }, 30000);
  const ct1 = res1.headers.get("content-type") || "";
  if (res1.ok && !ct1.includes("text/html")) {
    info("✅ PDF direct (no banner needed) for " + sol_number);
    return Buffer.from(await res1.arrayBuffer());
  }

  // Attempt 2 — full DoD banner acceptance
  info("Direct fetch returned " + res1.status + " (" + ct1 + ") — accepting banner for " + sol_number);
  const cookie = await ensureSession(pdfLink);
  const res2 = await fetch(pdfLink, {
    headers: { Cookie: cookie, "User-Agent": UA, Accept: "application/pdf,*/*", Referer: referer },
    redirect: "follow",
  });
  const ct2 = res2.headers.get("content-type") || "";
  if (!res2.ok || ct2.includes("text/html")) {
    _sessionCookie = null;
    _sessionPromise = null;
    throw new Error("PDF still returning HTML after banner acceptance for " + sol_number);
  }
  return Buffer.from(await res2.arrayBuffer());
}

// Parse key fields from DIBBS solicitation PDF text
// Calibrated against real DLA SF-18 / continuation sheet format
function parsePdfText(text, sol_number, nsn, fsc) {
  const t = text.replace(/\s+/g, " ");

  const extract = (pattern) => {
    const m = t.match(pattern);
    return m ? (m[1] || "").trim() : null;
  };

  // ── Item name ──────────────────────────────────────────────────────────
  // DLA NSN names use commas not spaces (SCREW,MACHINE / VALVE,CHECK).
  // DLA prints the name twice: compact then spaced-out ("SCREW, MACHINE").
  // Stopping at the first space captures only the compact form — no dedup needed.
  const itemName = extract(/ITEM DESCRIPTION\s+([A-Z][A-Z0-9,\-\.\/]+)/i)
    || extract(/NOMENCLATURE[:\s]+([A-Z][A-Z0-9,\-]+)/i)
    || extract(/ITEM NAME[:\s]+([A-Z][A-Z0-9,\-]+)/i);

  // ── Quantity ───────────────────────────────────────────────────────────
  // CLIN table: "UI QUANTITY UNIT PRICE ... EA 1.000"
  const qty = extract(/\bEA\s+([\d,]+)(?:\.\d+)?\s/i)
    || extract(/\bQUANTITY[:\s]+([\d,]+)/i)
    || extract(/\bQTY[:\s]+([\d,]+)/i);

  // ── Unit price — blank on RFQs, fall back to proc history ─────────────
  const unitPrice = extract(/UNIT PRICE[:\s]+\$?([\d,]+\.\d+)/i)
    || extract(/EST(?:IMATED)? PRICE[:\s]+\$?([\d,]+\.\d+)/i);

  // Procurement history — first (most recent) "Qty  UnitCost  AWDDate  [NY]"
  // e.g. "10.000 2827.03000 20181023 N"
  const histPrice = extract(/\b\d+\.\d{3}\s+([\d,]+\.\d+)\s+\d{8}\s+[NY]/);

  // ── Delivery days ──────────────────────────────────────────────────────
  // "DELIVERY (IN DAYS):0005"
  const deliveryDays = extract(/DELIVERY\s*\(IN DAYS\)[:\s]*(\d+)/i)
    || extract(/DELIVER(?:Y)?\s+(?:WITHIN\s+)?(\d+)\s+DAYS?/i)
    || extract(/(\d+)\s+DAYS?\s+ARO/i);

  // ── Quote due ──────────────────────────────────────────────────────────
  // SF-18 block 10 close-of-business date: "2026 JUL 08"
  const rawDate = extract(/BEFORE CLOSE OF BUSINESS[^]*?(\d{4}\s+[A-Z]{3}\s+\d{1,2})/i)
    || extract(/RETURN BY[:\s]+([\d\-\/]+)/i)
    || extract(/QUOTE DUE[:\s]+([\d\-\/]+)/i)
    || extract(/OFFERS DUE[:\s]+([\d\-\/]+)/i);

  let quoteDue = rawDate;
  if (rawDate) {
    const m = rawDate.match(/(\d{4})\s+([A-Z]{3})\s+(\d{1,2})/i);
    if (m) {
      const mo = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
                   JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
      quoteDue = m[1] + "-" + (mo[m[2].toUpperCase()] || "00") + "-" + m[3].padStart(2,"0");
    }
  }

  // ── Part number ────────────────────────────────────────────────────────
  const partNum = extract(/\bP\/N\s+([A-Z0-9][\w\-\/\.]+)/i)
    || extract(/(?:PART NO|PIECE PART)[.:\s]+([A-Z0-9][\w\-\/]+)/i);

  // ── Manufacturer CAGE (approved source: "BOEING 76301 P/N 68A550811") ─
  const mfrCage = extract(/\b([0-9A-Z]{5})\s+P\/N\s+[A-Z0-9][\w\-\/]+/i);

  // ── Set-aside — use FAR clause citations (unambiguous) ────────────────
  // The SF-18 header always prints both "IS" and "IS NOT" as form labels,
  // so keyword-matching the header checkbox is unreliable.
  // FAR section citations in Section A are definitive.
  let setAside = null;
  if      (/52\.219-27\b/i.test(t))  setAside = "SDVOSB";
  else if (/52\.219-30\b/i.test(t))  setAside = "WOSB";
  else if (/52\.219-29\b/i.test(t))  setAside = "EDWOSB";
  else if (/52\.219-3\b/i.test(t))   setAside = "HUBZone";
  else if (/52\.219-18\b/i.test(t))  setAside = "8(a)";
  else if (/52\.219-6\b/i.test(t))   setAside = "Small Business Set-Aside";

  // ── Supplier restrictions ──────────────────────────────────────────────
  // "APPROVED SOURCE" header OR implicit approval list (CAGE P/N pattern without "IS NOT")
  const hasApprovedSourceHeader = /APPROVED SOURCE/i.test(t);
  const hasImplicitApprovalList = /\b[0-9A-Z]{5}\s+P\/N\s+[A-Z0-9][\w\-\/]+/i.test(t)
    && !/IS NOT.*APPROVED SOURCE/i.test(t);
  const supplierRestrictions = t.match(/CRITICAL APPLICATION ITEM/i) ? "Critical Application Item"
    : t.match(/SOURCE CONTROL/i) ? "Source Control"
    : t.match(/SOLE SOURCE/i)    ? "Sole Source"
    : (hasApprovedSourceHeader || hasImplicitApprovalList) ? "Approved Source"
    : null;

  // ── FOB ────────────────────────────────────────────────────────────────
  const fob = extract(/DELIVER FOB[:\s]+([A-Z]+)/i)
    || extract(/FOB\s+(DESTINATION|ORIGIN)/i);

  // ── Buyer info ─────────────────────────────────────────────────────────
  const buyerEmail = extract(/Email:\s*([\w.\-]+@[\w.\-]+)/i);
  const buyerName  = extract(/Name:\s*([A-Z][a-zA-Z\s]+?)(?:\s+Buyer Code)/i);

  // ── Ship-to (full address) ─────────────────────────────────────────────
  // DLA address block (normalized to single spaces):
  // "PARCEL POST ADDRESS: SW3211 DLA DISTRIBUTION DEPOT OKLAHOMA 3301 F AVE BLDG 506 TINKER AFB OK 73145-8000 US"
  // Groups: (1) DoDAAC  (2) facility name  (3) street  (4) city/state/zip
  const _shm = t.match(/(?:PARCEL POST|FREIGHT SHIPPING) ADDRESS[:\s]+([A-Z0-9]{6})\s+([A-Z][A-Z0-9 ]*?)(?=\s\d)\s+(\d+[A-Z0-9 ]+?)\s+([A-Z][A-Z ]+\s[A-Z]{2}\s\d{5}(?:-\d{4})?)\s+US\b/i);
  const shipToDodaac = _shm ? _shm[1] : null;
  const shipToName   = _shm ? _shm[2].trim() : null;
  const shipToStreet = _shm ? _shm[3].trim() : null;
  const shipToCsz    = _shm ? _shm[4].trim() : null;

  const _mdy = (d) => {
    if (!d) return null;
    const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0") : d;
  };
  const needShipDate  = _mdy(extract(/Need Ship Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  const reqDelivDate  = _mdy(extract(/(?:Original )?Required Delivery Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i));

  // ── Packaging ──────────────────────────────────────────────────────────
  // ASTM D3951 = commercial (easy for most distros)
  // MIL-STD-2073 = mil-spec packaging (harder, needs special capability)
  // MIL-STD-129  = standard marking/labeling (required by virtually all DLA contracts)
  const packagingSpec  = extract(/(?:PACKAGED?|PACKAGING)\s+IN ACCORDANCE WITH\s+((?:ASTM|MIL-STD|MIL-P|PPP)[\s\-][\w\-\.]+)/i);
  const packagingQup   = extract(/(?:PKGING DATA-)?QUP[:\s]*(\d+)/i);
  const packagingType  = /MIL-STD-2073/i.test(t) ? "Mil-Spec"
    : /ASTM D3951/i.test(t) ? "Commercial"
    : /BEST COMMERCIAL PRACTICE|COMMERCIAL PACKAGING/i.test(t) ? "Commercial"
    : null;
  const packagingLabel = /MIL-STD-129/i.test(t) ? "MIL-STD-129" : null;

  // ── CMMC / Cyber ───────────────────────────────────────────────────────
  // 252.240-7997 = NIST SP 800-171 DoD Assessment Requirements (SPRS score needed)
  // 252.204-7012 = Safeguarding CDI (on virtually all DLA contracts, lower bar)
  const requiresNistAssessment = /252\.240-7997|NIST SP 800-171 DOD ASSESSMENT/i.test(t);

  // ── Resolve pricing ────────────────────────────────────────────────────
  const unitPriceNum = unitPrice ? parseFloat(unitPrice.replace(/,/g, "")) || null : null;
  const histPriceNum = histPrice ? parseFloat(histPrice.replace(/,/g, "")) || null : null;
  // RFQ PDFs always have a blank CLIN unit price — plug hist_price in so unit_price is never null
  const effectivePrice = unitPriceNum || histPriceNum;
  const qtyNum  = qty ? parseInt(qty.replace(/,/g, "")) || null : null;
  const extPrice = (effectivePrice && qtyNum) ? effectivePrice * qtyNum : null;

  return {
    sol_number,
    nsn,
    fsc:                   fsc || (nsn || "").replace(/-/g, "").slice(0, 4),
    item_name:             itemName || null,
    ref_part_number:       partNum || null,
    manufacturer_cage:     mfrCage || null,
    quantity:              qtyNum ? String(qtyNum) : null,
    unit_price:            effectivePrice,
    hist_price:            histPriceNum,
    ext_price:             extPrice,
    quote_due:             quoteDue || null,
    delivery_days:         deliveryDays ? parseInt(deliveryDays) : null,
    set_aside:             setAside,
    supplier_restrictions: supplierRestrictions || null,
    fob:                   fob || null,
    buyer_email:           buyerEmail || null,
    buyer_name:            buyerName || null,
    ship_to_dodaac:        shipToDodaac || null,
    ship_to_name:          shipToName || null,
    ship_to_street:        shipToStreet || null,
    ship_to_csz:           shipToCsz || null,
    need_ship_date:        needShipDate || null,
    required_delivery_date: reqDelivDate || null,
    packaging_spec:        packagingSpec || null,
    packaging_type:        packagingType || null,
    packaging_label:       packagingLabel || null,
    packaging_qup:         packagingQup || null,
    requires_nist_assessment: requiresNistAssessment,
    pdf_parsed:            true,
  };
}

// Download a PDF from a known dibbs2 URL (e.g. from the daily listing).
// Tries direct GET with Referer first; falls back to full banner acceptance.
async function fetchPdfFromUrl(pdfLink, sol_number) {
  const referer = DIBBS2_BASE.replace("dibbs2", "www.dibbs") + "/RFQ/RFQRec.aspx?sn=" + sol_number;

  const res1 = await ft(pdfLink, {
    headers: { "User-Agent": UA, Accept: "application/pdf,*/*", Referer: referer },
    redirect: "follow",
  }, 30000);
  const ct1 = res1.headers.get("content-type") || "";
  if (res1.ok && !ct1.includes("text/html")) {
    info("✅ PDF direct (no banner) for " + sol_number);
    return Buffer.from(await res1.arrayBuffer());
  }

  info("Direct → " + res1.status + " (" + ct1 + ") — accepting dibbs2 banner for " + sol_number);
  const cookie = await ensureSession(pdfLink);
  const res2 = await fetch(pdfLink, {
    headers: { Cookie: cookie, "User-Agent": UA, Accept: "application/pdf,*/*", Referer: referer },
    redirect: "follow",
  });
  const ct2 = res2.headers.get("content-type") || "";
  if (!res2.ok || ct2.includes("text/html")) {
    _sessionCookie = null;
    _sessionPromise = null;
    throw new Error("PDF returning HTML after banner for " + sol_number);
  }
  return Buffer.from(await res2.arrayBuffer());
}

// Try downloading a PDF directly from SAM.gov resource links (captured from API response).
// Many modern DLA solicitations store their PDFs on SAM.gov, not DIBBS2.
async function fetchSamPdf(sol) {
  const links = sol.sam_resource_links || [];
  if (!links.length) return null;

  const apiKey = process.env.SAM_API_KEY || "";
  for (const link of links) {
    try {
      const sep = link.includes("?") ? "&" : "?";
      const url = link + sep + "api_key=" + encodeURIComponent(apiKey);
      info("Trying SAM resource: " + link);
      const res = await ft(url, {
        headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      }, 30000);
      if (!res.ok) { info("SAM resource → HTTP " + res.status); continue; }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("pdf") && !ct.includes("octet")) { info("SAM resource not PDF (content-type: " + ct + ")"); continue; }
      info("✅ SAM resource PDF for " + sol.sol_number);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      info("SAM resource failed: " + e.message);
    }
  }
  return null;
}

// Full fetch + parse for one sol
async function fetchSolDetails(sol) {
  const { sol_number, nsn, fsc } = sol;
  info("Fetching PDF: " + sol_number);

  try {
    let buffer = null;

    // Path 1: DIBBS daily listing already gave us the exact PDF URL — use it directly
    if (sol.pdf_direct_url) {
      buffer = await fetchPdfFromUrl(sol.pdf_direct_url, sol_number);
    }

    // Path 2: SAM.gov resource links (captured from SAM API response)
    if (!buffer && sol.sam_resource_links && sol.sam_resource_links.length) {
      buffer = await fetchSamPdf(sol);
    }

    // Path 3: Discover URL via public DIBBS record page + dibbs2 banner
    if (!buffer) {
      buffer = await fetchPdfBuffer(sol_number);
    }
    const parsed = await pdfParse(buffer);
    const fields = parsePdfText(parsed.text, sol_number, nsn, fsc);
    info("✅ " + sol_number + " — " + (fields.item_name || "no item name") + " | $" + (fields.unit_price || "?") + " | qty " + (fields.quantity || "?"));
    return { ...sol, ...fields };
  } catch (e) {
    if (e.notOnDibbs) {
      // SAM-sourced sol has no RFQ PDF on DIBBS2 — silent skip, use SAM metadata
      return { ...sol, pdf_parsed: false };
    }
    fail(sol_number + " PDF failed: " + e.message + " — using email data only");
    return { ...sol, pdf_parsed: false };
  }
}

// Batch fetch with concurrency limit
async function fetchAllSolDetails(sols, { concurrency = 3 } = {}) {
  const results = [];
  for (let i = 0; i < sols.length; i += concurrency) {
    const batch = sols.slice(i, i + concurrency);
    const resolved = await Promise.all(batch.map(s => fetchSolDetails(s)));
    results.push(...resolved);
    if (i + concurrency < sols.length) await new Promise(r => setTimeout(r, 1500));
  }
  return results;
}

module.exports = { fetchAllSolDetails, fetchSolDetails, pdfUrl };
