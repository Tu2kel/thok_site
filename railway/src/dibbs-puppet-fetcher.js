// src/dibbs-puppet-fetcher.js — Puppeteer-based DIBBS daily listing scraper
// Uses a real Chrome browser to bypass WAF TLS/JS-challenge blocks.
// Set SOL_SOURCE=dibbs-puppet in Railway env to activate.

const puppeteer = require("puppeteer");
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

function extractNsn(text) {
  const m = (text || "").match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
  return m ? m[1] : null;
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
    sols.push({
      sol_number,
      nsn:            nsn || "",
      fsc:            nsn ? nsn.replace(/-/g, "").slice(0, 4) : "",
      item_name:      "",
      quantity:       "",
      quote_due:      "",
      pdf_direct_url: pdfDirectUrl,
      sol_url:        DIBBS_WWW + "/RFQ/RFQRec.aspx?sn=" + sol_number,
      source:         "dibbs-puppet",
      sam_resource_links: [],
    });
  }
  return sols;
}

// Parse PDF buffer for procurement fields
async function parsePdf(buffer, sol_number) {
  try {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").replace(/\s+/g, " ");
    info(sol_number + " PDF text[0:400]: " + text.slice(0, 400));

    function extract(re) {
      const m = text.match(re);
      return m ? m[1].trim() : null;
    }

    const itemName =
      extract(/ITEM DESCRIPTION\s+([A-Z][A-Z0-9,\-\.\/]*,[A-Z0-9,\-\.\/]+)/i) ||
      extract(/NOMENCLATURE[:\s]+([A-Z][A-Z0-9,\-]{3,})/i) ||
      extract(/DESCRIPTION OF SUPPLIES[\/\s]+SERVICES[:\s]+([A-Z][A-Z0-9,\-\.\/]{3,})/i) ||
      extract(/ITEM NAME[:\s]+([A-Z][A-Z0-9,\-]{3,})/i);

    const qty =
      extract(/([\d,]+(?:\.\d+)?)\s+(?:EA|EACH)\b/i) ||
      extract(/\bEA\s+([\d,]+)(?:\.\d+)?/i) ||
      extract(/\bQUANTITY[:\s]+([\d,]+)/i) ||
      extract(/\bQTY[:\s]+([\d,]+)/i);

    const quoteDue =
      extract(/QUOTE\s+DUE[:\s]+(\d{4}-\d{2}-\d{2})/i) ||
      extract(/RETURN\s+BY[:\s]+(\d{4}-\d{2}-\d{2})/i) ||
      extract(/RESPONSE\s+DATE[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/i) ||
      extract(/DUE\s+DATE[:\s]+(\d{4}-\d{2}-\d{2})/i);

    const refPn = extract(/PIECE\s+PART\s+(?:NO|NUMBER)[:\s]+([A-Z0-9\-]+)/i) ||
      extract(/PART\s+(?:NO|NUMBER)[:\s]+([A-Z0-9\-]+)/i);

    const histPrice = extract(/HIST(?:ORICAL)?\s+(?:UNIT\s+)?PRICE[:\s]*\$?([\d,]+\.?\d*)/i);
    const unitPrice = extract(/UNIT\s+PRICE[:\s]*\$?([\d,]+\.?\d*)/i);

    return {
      item_name:       itemName || null,
      quantity:        qty ? qty.replace(/,/g, "") : null,
      quote_due:       quoteDue || null,
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
    info("Launching Chrome...");
    browser = await puppeteer.launch({ headless: "new", args: LAUNCH_ARGS });
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
        await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (e) {
        fail("Navigation failed for " + dateStr + ": " + e.message);
        continue;
      }

      // Accept DoD banner if it appears
      try {
        const bannerBtn = await page.waitForSelector("#butAgree", { timeout: 8000 });
        if (bannerBtn) {
          info("Banner found — clicking OK...");
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
            page.click("#butAgree"),
          ]);
          info("✅ Banner accepted");
        }
      } catch {
        info("No banner — session active or already accepted");
      }

      const html = await page.content();
      const pageLen = html.length;
      info("Listing HTML: " + pageLen + " chars");

      if (pageLen < 500) {
        fail("Listing too short (" + pageLen + " chars) — WAF likely still blocking");
        // Log what we got so we can diagnose
        info("Response snippet: " + html.slice(0, 300));
        continue;
      }

      const daySols = parseListingHtml(html).filter(s => !seen.has(s.sol_number));
      daySols.forEach(s => { s.issue_date = dateStr; seen.add(s.sol_number); });
      allSols.push(...daySols);
      info(dateStr + " — " + daySols.length + " sols found");
    }

    // Fetch + parse PDFs for each sol through the same browser session
    info("Fetching PDFs for " + allSols.length + " sols...");
    let parsed = 0;

    for (const sol of allSols) {
      if (!sol.pdf_direct_url) continue;
      try {
        // Use CDP to intercept the PDF response as bytes
        const client = await page.target().createCDPSession();
        await client.send("Page.enable");

        const pdfRes = await page.goto(sol.pdf_direct_url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        if (pdfRes && pdfRes.status() === 200) {
          const contentType = pdfRes.headers()["content-type"] || "";
          if (contentType.includes("pdf") || contentType.includes("octet")) {
            const buffer = await pdfRes.buffer();
            const fields = await parsePdf(buffer, sol.sol_number);
            // Selective merge — never overwrite good data with null
            for (const [k, v] of Object.entries(fields)) {
              if (v !== null && v !== undefined && v !== "") sol[k] = v;
            }
            parsed++;
            info("✅ " + sol.sol_number + " — " + (sol.item_name || "no item name") + " | qty " + (sol.quantity || "?"));
          } else {
            info(sol.sol_number + " — unexpected content-type: " + contentType);
          }
        } else {
          info(sol.sol_number + " — PDF status: " + (pdfRes ? pdfRes.status() : "no response"));
        }

        await client.detach();
      } catch (e) {
        info(sol.sol_number + " PDF fetch failed: " + e.message);
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
