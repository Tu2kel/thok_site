// src/dibbs-fetcher.js — DIBBS PDF fetcher + parser
// 1. Puppeteer accepts DoD banner once → captures session cookie
// 2. plain fetch downloads each PDF using that cookie
// 3. pdf-parse extracts all procurement fields

const puppeteer = require("puppeteer-core");
const pdfParse  = require("pdf-parse");

const DIBBS2_BASE = "https://dibbs2.bsm.dla.mil";

let _sessionCookie = null;

function info(...a) { console.log("[dibbs-fetcher]", ...a); }
function fail(...a) { console.error("[dibbs-fetcher] ❌", ...a); }

// PDF URL pattern: last character of sol number = subfolder
function pdfUrl(sol_number) {
  const lastChar = sol_number.slice(-1).toUpperCase();
  return DIBBS2_BASE + "/Downloads/RFQ/" + lastChar + "/" + sol_number + ".PDF";
}

// Accept DoD banner with Puppeteer, return session cookie string
async function acceptBannerAndGetCookie() {
  const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
  info("Launching browser to accept DoD banner…");

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    // Hit a known PDF URL — this triggers the banner redirect
    const testSol = "SPE4A726T529C";
    const url = pdfUrl(testSol);
    info("Navigating to trigger banner: " + url);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Accept the DoD banner
    try {
      await page.waitForSelector("#butAgree", { timeout: 10000 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.click("#butAgree"),
      ]);
      info("✅ DoD banner accepted");
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      info("No banner found — session may already be active");
    }

    // Grab cookies
    const cookies = await page.cookies();
    const cookieStr = cookies.map(c => c.name + "=" + c.value).join("; ");
    info("Captured " + cookies.length + " cookie(s) from dibbs2");

    await browser.close();
    return cookieStr;
  } catch (e) {
    try { await browser.close(); } catch {}
    throw e;
  }
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
function parsePdfText(text, sol_number, nsn, fsc) {
  const t = text.replace(/\s+/g, " ");

  // Helper: extract value after a label
  const after = (label, len = 80) => {
    const idx = t.indexOf(label);
    if (idx === -1) return null;
    return t.slice(idx + label.length, idx + label.length + len).trim();
  };

  const extract = (pattern) => {
    const m = t.match(pattern);
    return m ? m[1]?.trim() : null;
  };

  // Unit price — look for "$X.XX" or "UNIT PRICE" patterns
  const unitPrice = extract(/UNIT PRICE[:\s]+\$?([\d,]+\.?\d*)/i)
    || extract(/EST(?:IMATED)? PRICE[:\s]+\$?([\d,]+\.?\d*)/i)
    || extract(/\$\s*([\d,]+\.\d{2})(?:\s|\/)/);

  // Quantity
  const qty = extract(/QUANTITY[:\s]+([\d,]+)/i)
    || extract(/QTY[:\s]+([\d,]+)/i);

  // Delivery days
  const deliveryDays = extract(/DELIVER(?:Y)?\s+(?:WITHIN\s+)?([\d]+)\s+DAYS?/i)
    || extract(/(\d+)\s+DAYS?\s+ARO/i);

  // Quote / return by date
  const quoteDue = extract(/RETURN BY[:\s]+([\d\-\/]+)/i)
    || extract(/QUOTE DUE[:\s]+([\d\-\/]+)/i)
    || extract(/OFFERS DUE[:\s]+([\d\-\/]+)/i);

  // Part numbers
  const partNum = extract(/(?:PART NO|PIECE PART|P\/N)[.:\s]+([A-Z0-9\-\/]+)/i);

  // Set-aside
  const setAside = extract(/SET[ -]ASIDE[:\s]+([A-Z\s]+?)(?:\s{2}|$)/i)
    || (t.match(/SMALL BUSINESS SET-ASIDE/i) ? "Small Business Set-Aside" : null)
    || (t.match(/SDVOSB/i) ? "SDVOSB" : null)
    || (t.match(/WOSB/i) ? "WOSB" : null);

  // Supplier restrictions / source control
  const supplierRestrictions = t.match(/SOURCE CONTROL/i) ? "Source Control"
    : t.match(/SOLE SOURCE/i) ? "Sole Source"
    : t.match(/APPROVED SOURCE/i) ? "Approved Source"
    : null;

  // Item name — usually near "NOMENCLATURE" or "DESCRIPTION"
  const itemName = extract(/NOMENCLATURE[:\s]+([A-Z][A-Z ,\-]+?)(?:\s{2}|\n|NSN)/i)
    || extract(/ITEM DESCRIPTION[:\s]+([^\n]{3,60})/i);

  // FOB
  const fob = extract(/FOB[:\s]+([A-Z]+)/i);

  return {
    sol_number,
    nsn,
    fsc: fsc || (nsn || "").replace(/-/g, "").slice(0, 4),
    item_name:             itemName || null,
    ref_part_number:       partNum || null,
    quantity:              qty ? qty.replace(/,/g, "") : null,
    unit_price:            unitPrice ? parseFloat(unitPrice.replace(/,/g, "")) || null : null,
    quote_due:             quoteDue || null,
    delivery_days:         deliveryDays ? parseInt(deliveryDays) : null,
    set_aside:             setAside || null,
    supplier_restrictions: supplierRestrictions || null,
    fob:                   fob || null,
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
