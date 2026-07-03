// src/dibbs-puppet-fetcher.js — Puppeteer-based DIBBS daily listing scraper
// Uses a real Chrome browser to bypass WAF TLS/JS-challenge blocks.
// Set SOL_SOURCE=dibbs-puppet in Railway env to activate.

const puppeteer = require("puppeteer-core");
const pdfParse  = require("pdf-parse");

const DIBBS_WWW  = "https://www.dibbs.bsm.dla.mil";
const DIBBS2_PDF = "https://dibbs2.bsm.dla.mil";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--single-process",
  "--no-zygote",
];

function info(...a) { console.log("[dibbs-puppet]", ...a); }
function fail(...a) { console.error("[dibbs-puppet] ❌", ...a); }

function dibbsDate(d) {
  return (d.getMonth() + 1).toString().padStart(2, "0") + "-" +
    d.getDate().toString().padStart(2, "0") + "-" + d.getFullYear();
}

// DOM-based table extraction — runs inside the browser so innerText gives
// actual rendered cell values (not raw HTML with form-field placeholders).
async function extractTableSolsFromDom(page, dateStr) {
  return await page.evaluate((www, date) => {
    const seen = new Set();
    const sols = [];

    // Find the table that has PDF download links — DIBBS GridView or first matching table
    const tables = Array.from(document.querySelectorAll("table"));
    let targetTable = null;
    for (const t of tables) {
      if (/GridView/i.test(t.id || "")) { targetTable = t; break; }
      if (t.querySelector('a[href*="dibbs2.bsm.dla.mil/Downloads/RFQ/"]')) {
        if (!targetTable || t.rows.length > targetTable.rows.length) targetTable = t;
      }
    }
    if (!targetTable) return [];

    // Detect column layout from header row
    const headerRow = targetTable.rows[0];
    const headers = headerRow
      ? Array.from(headerRow.cells).map(c => c.innerText.trim().toUpperCase())
      : [];

    let colName = -1, colDate = -1, colNsn = -1;
    for (let i = 0; i < headers.length; i++) {
      if (/NOMENCLATURE|DESCRIPTION|ITEM|NAME/.test(headers[i])) colName = i;
      if (/DATE|CLOSE|DUE|RETURN/.test(headers[i])) colDate = i;
      if (/NSN|NATIONAL\s*STOCK/.test(headers[i])) colNsn = i;
    }

    // Helper: normalize a date cell to YYYY-MM-DD
    function normalizeDate(raw) {
      if (!raw) return null;
      // MM/DD/YYYY
      let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
      // YYYY-MM-DD already
      m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return raw;
      // MM-DD-YYYY
      m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) return m[3] + "-" + m[1] + "-" + m[2];
      return null;
    }

    for (let r = 1; r < targetTable.rows.length; r++) {
      const row = targetTable.rows[r];
      const pdfLink = row.querySelector('a[href*="dibbs2.bsm.dla.mil/Downloads/RFQ/"]');
      if (!pdfLink) continue;

      const pdfUrl = pdfLink.href;
      const solMatch = pdfUrl.match(/\/([^\/]+)\.PDF$/i);
      if (!solMatch) continue;
      const sol_number = solMatch[1].toUpperCase();
      if (!/^SP[A-Z0-9]/i.test(sol_number) || seen.has(sol_number)) continue;
      seen.add(sol_number);

      const cells = Array.from(row.cells).map(c => c.innerText.trim());
      const rowText = row.innerText || "";

      // item_name: use detected column first, then scan for Fed-catalog pattern (NOUN,MODIFIER)
      let item_name = colName >= 0 ? cells[colName] : null;
      if (!item_name || item_name.length < 3) {
        for (const c of cells) {
          if (c.length >= 4 && /^[A-Z][A-Z0-9,\-\s]{3,}$/.test(c) &&
              !/^\d/.test(c) && !/^SP[A-Z0-9]/i.test(c) && !/^\d{4}-\d/.test(c)) {
            item_name = c; break;
          }
        }
      }

      // quote_due: use detected column first, then scan cells for a date pattern
      let quote_due = colDate >= 0 ? normalizeDate(cells[colDate]) : null;
      if (!quote_due) {
        for (const c of cells) {
          const nd = normalizeDate(c);
          if (nd) { quote_due = nd; break; }
        }
      }

      // NSN from row text
      const nsnM = rowText.match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
      const nsn = nsnM ? nsnM[1] : "";

      sols.push({
        sol_number,
        nsn,
        fsc:            nsn ? nsn.replace(/-/g, "").slice(0, 4) : "",
        item_name:      item_name || "",
        quantity:       "",
        quote_due:      quote_due || "",
        pdf_direct_url: pdfUrl,
        sol_url:        www + "/RFQ/RFQRec.aspx?sn=" + sol_number,
        source:         "dibbs-puppet",
        issue_date:     date,
        sam_resource_links: [],
      });
    }
    return sols;
  }, DIBBS_WWW, dateStr);
}

// Parse PDF buffer — quantity and part details only.
// item_name and quote_due come from the listing table DOM (they are AcroForm
// fields in the PDF that pdf-parse cannot read; the listing table has them).
async function parsePdf(buffer, sol_number) {
  try {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").replace(/\s+/g, " ");

    function extract(re) {
      const m = text.match(re);
      return m ? m[1].trim() : null;
    }

    const qty =
      extract(/([\d,]+(?:\.\d+)?)\s+(?:EA|EACH)\b/i) ||
      extract(/\bEA\s+([\d,]+(?:\.\d+)?)/i) ||
      extract(/\bQUANTITY[:\s]+([\d,]+)/i) ||
      extract(/\bQTY[:\s]+([\d,]+)/i);

    const refPn = extract(/PIECE\s+PART\s+(?:NO|NUMBER)[:\s]+([A-Z0-9\-]+)/i) ||
      extract(/PART\s+(?:NO|NUMBER)[:\s]+([A-Z0-9\-]+)/i);

    const histPrice = extract(/HIST(?:ORICAL)?\s+(?:UNIT\s+)?PRICE[:\s]*\$?([\d,]+\.?\d*)/i);
    const unitPrice = extract(/UNIT\s+PRICE[:\s]*\$?([\d,]+\.?\d*)/i);

    return {
      quantity:        qty ? qty.replace(/,/g, "") : null,
      ref_part_number: refPn || null,
      hist_price:      histPrice ? parseFloat(histPrice.replace(/,/g, "")) : null,
      unit_price:      unitPrice ? parseFloat(unitPrice.replace(/,/g, "")) : null,
      pdf_parsed:      true,
    };
  } catch (e) {
    info("PDF parse failed for " + sol_number + ": " + e.message);
    return { pdf_parsed: false };
  }
}

async function fetchDibbsDailySols({ lookbackDays = 1 } = {}) {
  let browser;
  const allSols = [];
  const seen = new Set();

  try {
    // Use system Chromium installed via nixpacks — puppeteer-core doesn't bundle its own
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "chromium";
    info("Launching Chrome: " + executablePath);
    browser = await puppeteer.launch({ executablePath, headless: "new", args: LAUNCH_ARGS });
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Set a real Chrome UA
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    for (let i = 0; i < lookbackDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = dibbsDate(d);
      const listUrl = DIBBS_WWW + "/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=" + dateStr;

      info("Navigating to listing: " + listUrl);
      try {
        await page.goto(listUrl, { waitUntil: "networkidle2", timeout: 60000 });
      } catch (e) {
        fail("Navigation failed for " + dateStr + ": " + e.message);
        continue;
      }

      // Accept DoD banner if it appears
      try {
        const bannerBtn = await page.waitForSelector("#butAgree", { timeout: 8000 });
        if (bannerBtn) {
          info("Banner found — clicking OK...");
          // After banner POST, DIBBS fires an ASP.NET UpdatePanel AJAX call to load results.
          // Wait for networkidle2 so the table has time to populate.
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }),
            page.click("#butAgree"),
          ]);
          info("✅ Banner accepted — landed on: " + page.url());
          // After banner, navigate directly to the listing URL again —
          // the banner POST may redirect to a different page than expected.
          await page.goto(listUrl, { waitUntil: "networkidle2", timeout: 60000 });
          info("Re-navigated to listing — now on: " + page.url());
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch {
        info("No banner — session active or already accepted");
      }

      // Wait for the results table or a known element on the listing page
      try {
        await page.waitForSelector("table, #ctl00_ContentPlaceHolder1_GridView1, .ms-listviewtable", { timeout: 10000 });
        info("Results table element found");
      } catch {
        info("No table selector found — grabbing content anyway");
      }

      const pageLen = (await page.content()).length;
      info("Listing HTML: " + pageLen + " chars");

      if (pageLen < 500) {
        fail("Listing too short (" + pageLen + " chars) — WAF likely still blocking");
        info("Response snippet: " + (await page.content()).slice(0, 300));
        continue;
      }

      // Log detected table headers so we can verify column mapping
      const headers = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll("table"));
        for (const t of tables) {
          if (t.querySelector('a[href*="dibbs2.bsm.dla.mil/Downloads/RFQ/"]')) {
            const hr = t.rows[0];
            return hr ? Array.from(hr.cells).map(c => c.innerText.trim()) : [];
          }
        }
        return [];
      });
      info("Table headers: " + JSON.stringify(headers));

      const daySols = (await extractTableSolsFromDom(page, dateStr))
        .filter(s => !seen.has(s.sol_number));
      daySols.forEach(s => seen.add(s.sol_number));
      allSols.push(...daySols);
      info(dateStr + " — " + daySols.length + " sols found");
      if (daySols.length) {
        info("Sample: " + daySols[0].sol_number + " | " + (daySols[0].item_name || "no name") +
             " | due " + (daySols[0].quote_due || "no date"));
      }
    }

    // ── Parallel detail-page price fetch ─────────────────────────────────────
    // All detail pages are on www.dibbs (same session already established).
    // Use page.evaluate(Promise.all(fetch(...))) — 32 parallel same-origin requests
    // instead of 32 sequential page.goto() calls. Same trick as PDF downloads.
    if (allSols.length) {
      info("Fetching detail page prices (" + allSols.length + " in parallel)...");
      try {
        const priceResults = await page.evaluate(async (solList) => {
          return Promise.all(solList.map(async ({ sol_number, sol_url }) => {
            if (!sol_url) return { sol_number, price: null };
            try {
              const r = await fetch(sol_url, { credentials: "include" });
              const html = await r.text();
              // Match "Purchase Unit Price", "Historical Unit Price", "Unit Price" near a dollar amount
              const m = html.match(/(?:PURCHASE|HIST(?:ORICAL)?)\s+UNIT\s+PRICE[^$\d\n]{0,40}\$?([\d,]+\.?\d{2})/i)
                     || html.match(/\bUNIT\s+PRICE[^$\d\n]{0,40}\$?([\d,]+\.?\d{2})/i);
              const price = m ? parseFloat(m[1].replace(/,/g, "")) : null;
              return { sol_number, price: price && price > 0 ? price : null };
            } catch {
              return { sol_number, price: null };
            }
          }));
        }, allSols.map(s => ({ sol_number: s.sol_number, sol_url: s.sol_url })));

        let priced = 0;
        for (const { sol_number, price } of priceResults) {
          if (!price) continue;
          const sol = allSols.find(s => s.sol_number === sol_number);
          if (!sol) continue;
          sol.unit_price = price;
          sol.hist_price = price;
          const qty = parseFloat(String(sol.quantity || "0").replace(/,/g, "")) || 0;
          if (qty) sol.ext_price = Math.round(price * qty * 100) / 100;
          priced++;
          info("💰 " + sol_number + " $" + price + (sol.ext_price ? " | ext $" + sol.ext_price : ""));
        }
        info("Prices found: " + priced + "/" + allSols.length);
      } catch (e) {
        info("Detail price fetch failed: " + e.message);
      }
    }

    // Open a dedicated dibbs2 page for PDF fetching.
    // page.goto() on a PDF URL causes ERR_ABORTED because headless Chrome tries to
    // open the built-in PDF viewer and aborts the navigation. Instead, open a page
    // ON the dibbs2 domain and use page.evaluate(fetch()) — same-origin, no viewer.
    info("Fetching PDFs for " + allSols.length + " sols...");
    let parsed = 0;

    if (allSols.length) {
      let pdfPage;
      try {
        pdfPage = await browser.newPage();
        await pdfPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );

        // Land on dibbs2 domain to establish session + accept its banner
        info("Establishing dibbs2 session...");
        await pdfPage.goto("https://dibbs2.bsm.dla.mil/", { waitUntil: "networkidle2", timeout: 30000 });
        try {
          await pdfPage.waitForSelector("#butAgree", { timeout: 6000 });
          await Promise.all([
            pdfPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
            pdfPage.click("#butAgree"),
          ]);
          info("✅ dibbs2 banner accepted");
        } catch {
          info("dibbs2 no banner — session ready");
        }

        for (const sol of allSols) {
          if (!sol.pdf_direct_url) continue;
          try {
            // Same-origin fetch from within the dibbs2 page — no PDF viewer, no CORS
            const base64 = await pdfPage.evaluate(async (url) => {
              const r = await fetch(url, { credentials: "include" });
              if (!r.ok) return null;
              const ct = r.headers.get("content-type") || "";
              if (!ct.includes("pdf") && !ct.includes("octet")) return null;
              const ab = await r.arrayBuffer();
              const bytes = new Uint8Array(ab);
              let str = "";
              for (const b of bytes) str += String.fromCharCode(b);
              return btoa(str);
            }, sol.pdf_direct_url);

            if (base64) {
              const buffer = Buffer.from(base64, "base64");
              const fields = await parsePdf(buffer, sol.sol_number);
              // Merge PDF fields — only fill in missing fields; listing values win
              for (const [k, v] of Object.entries(fields)) {
                if (v !== null && v !== undefined && v !== "" && !sol[k]) sol[k] = v;
              }
              parsed++;
              info("✅ " + sol.sol_number + " | " + (sol.item_name || "no item name") +
                   " | qty " + (sol.quantity || "?") + " | due " + (sol.quote_due || "?"));
            } else {
              info(sol.sol_number + " — PDF fetch null (skipping qty)");
            }
          } catch (e) {
            info(sol.sol_number + " PDF fetch failed: " + e.message);
          }
        }
      } finally {
        if (pdfPage) try { await pdfPage.close(); } catch {}
      }
    }

    info("PDFs parsed: " + parsed + "/" + allSols.length);

  } catch (e) {
    fail("Fatal: " + e.message);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }

  info("Total sols: " + allSols.length);
  return allSols;
}

module.exports = { fetchDibbsDailySols };
