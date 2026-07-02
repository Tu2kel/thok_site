// src/dibbs-fetcher.js — DIBBS PDF fetcher + parser
// 1. Plain fetch POSTs the DoD banner agreement (no browser/Puppeteer needed)
// 2. Plain fetch downloads each PDF using the captured session cookie
// 3. pdf-parse extracts all procurement fields

const pdfParse = require("pdf-parse");

const DIBBS2_BASE = "https://dibbs2.bsm.dla.mil";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _sessionCookie = null;

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

// Parse all Set-Cookie headers into a flat cookie string
function parseCookies(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]+=)/)
    .map(c => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

// Accept DoD banner via plain fetch — no browser required
// DIBBS2 is ASP.NET WebForms: GET banner page → POST #butAgree form → session cookie
async function acceptBannerAndGetCookie() {
  info("Accepting DoD banner via fetch (no browser)…");
  const testUrl = pdfUrl("SPE4A726T529C");

  // Step 1: hit PDF URL — DIBBS2 redirects to the DoD warning banner
  const res1 = await ft(testUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,application/pdf,*/*" },
  });
  const ct1 = res1.headers.get("content-type") || "";
  // If PDF came back directly, no banner needed
  if (ct1.includes("pdf")) {
    info("PDF accessible directly — no banner");
    return parseCookies(res1);
  }

  let cookies = parseCookies(res1);
  const bannerHtml = await res1.text();
  const bannerUrl  = res1.url || testUrl;

  // Parse ASP.NET WebForms hidden fields
  const qs = (id) => {
    const m = bannerHtml.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"', "i"))
           || bannerHtml.match(new RegExp('name="' + id + '"[^>]*value="([^"]*)"', "i"));
    return m ? m[1] : "";
  };
  const viewstate    = qs("__VIEWSTATE");
  const vsgen        = qs("__VIEWSTATEGENERATOR");
  const evval        = qs("__EVENTVALIDATION");
  const formActionM  = bannerHtml.match(/<form[^>]+action="([^"]+)"/i);
  const formAction   = formActionM ? formActionM[1] : bannerUrl;
  const absAction    = formAction.startsWith("http") ? formAction : new URL(formAction, DIBBS2_BASE).href;

  info("Banner at: " + bannerUrl + " → posting agreement to " + absAction);

  // Step 2: POST #butAgree (ASP.NET submit button — name=butAgree included in body)
  const body = new URLSearchParams({
    __VIEWSTATE:          viewstate,
    __VIEWSTATEGENERATOR: vsgen,
    __EVENTVALIDATION:    evval,
    __EVENTTARGET:        "",
    __EVENTARGUMENT:      "",
    butAgree:             "I Agree",
  });

  const res2 = await ft(absAction, {
    method:  "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer":      bannerUrl,
      Cookie:         cookies,
    },
    body: body.toString(),
  });

  const moreCookies = parseCookies(res2);
  if (moreCookies) cookies = [cookies, moreCookies].filter(Boolean).join("; ");

  info("✅ DoD banner accepted via fetch — " + cookies.split(";").length + " cookie(s)");
  return cookies;
}

// Ensure we have a valid session cookie
async function ensureSession() {
  if (!_sessionCookie) {
    _sessionCookie = await acceptBannerAndGetCookie();
  }
  return _sessionCookie;
}

// Download PDF buffer for a sol number
async function fetchPdfBuffer(sol_number) {
  const cookie = await ensureSession();
  const url = pdfUrl(sol_number);

  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/pdf,*/*",
    },
    redirect: "follow",
  });

  // If we get redirected to banner again, re-accept and retry once
  if (!res.ok || res.headers.get("content-type")?.includes("text/html")) {
    info("Session expired — re-accepting banner…");
    _sessionCookie = null;
    const cookie2 = await ensureSession();
    const res2 = await fetch(url, {
      headers: { Cookie: cookie2, "User-Agent": "Mozilla/5.0", Accept: "application/pdf,*/*" },
      redirect: "follow",
    });
    if (!res2.ok) throw new Error("PDF fetch failed: " + res2.status + " for " + sol_number);
    return Buffer.from(await res2.arrayBuffer());
  }

  return Buffer.from(await res.arrayBuffer());
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

// Full fetch + parse for one sol
async function fetchSolDetails(sol) {
  const { sol_number, nsn, fsc } = sol;
  info("Fetching PDF: " + sol_number);

  try {
    const buffer = await fetchPdfBuffer(sol_number);
    const parsed = await pdfParse(buffer);
    const fields = parsePdfText(parsed.text, sol_number, nsn, fsc);
    info("✅ " + sol_number + " — " + (fields.item_name || "no item name") + " | $" + (fields.unit_price || "?") + " | qty " + (fields.quantity || "?"));
    return { ...sol, ...fields };
  } catch (e) {
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
