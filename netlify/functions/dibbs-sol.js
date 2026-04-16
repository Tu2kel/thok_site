// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Scraper
// Replaces manual DIBBS Navigator lookups.
// POST body: { sol_number: "SPE4A7-25-T-795A" }
// Returns: { ok, sol: { contract_number, contract_type, pr_number, date_issued,
//   nsn, part_numbers[], due_date, item_description, drawing_info, fob,
//   anticipated_award, packaging, set_aside, qty, unit_issue, delivery_days,
//   hist_unit_price, suppliers: [{name, cage, pn}] } }
//
// Strategy:
//   1. Hit DIBBS RFQ detail page directly — no auth required for public RFQ data
//   2. Use Browserless /content endpoint (full page HTML) — cheaper than /scrape
//   3. Parse HTML server-side with regex — no DOM dependency
//   4. Fall back to /scrape with body selector if /content fails

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BL_BASE = "https://production-sfo.browserless.io";

// ── Clean a raw text cell ──────────────────────────────────────────────────
function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// ── Extract a labelled field from page text ────────────────────────────────
// Looks for "Label\s*Value" patterns in the raw text dump
function extractField(text, ...labels) {
  for (const label of labels) {
    const re = new RegExp(
      label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "[:\\s]*([^\\n]{1,200})",
      "i"
    );
    const m = text.match(re);
    if (m) {
      const val = clean(m[1]);
      if (val && val.length > 0) return val;
    }
  }
  return "";
}

// ── Parse suppliers table from raw HTML ───────────────────────────────────
// DIBBS approved sources table: rows contain Name | CAGE | P/N
function parseSuppliers(html) {
  const suppliers = [];
  // Look for table rows in the Approved Sources / Supplier List section
  // DIBBS uses various table structures — try to catch them all
  const tableRe =
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let tableMatch;
  let inSupplierSection = false;
  const htmlLower = html.toLowerCase();
  const supplierIdx = Math.max(
    htmlLower.indexOf("approved source"),
    htmlLower.indexOf("supplier list"),
    htmlLower.indexOf("manufacturer"),
  );

  // Only parse rows after the supplier section heading
  const relevantHtml =
    supplierIdx > 0 ? html.slice(supplierIdx) : html;

  while ((tableMatch = tableRe.exec(relevantHtml)) !== null) {
    const row = tableMatch[1];
    const cells = [];
    let cellMatch;
    const cellRe2 = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    while ((cellMatch = cellRe2.exec(row)) !== null) {
      const text = clean(cellMatch[1].replace(/<[^>]+>/g, " "));
      if (text) cells.push(text);
    }
    if (cells.length >= 2) {
      // Heuristic: CAGE codes are 5 alphanumeric chars
      const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
      if (cageIdx > 0) {
        const name = cells.slice(0, cageIdx).join(" ");
        const cage = cells[cageIdx].trim();
        const pn = cells[cageIdx + 1] || "";
        if (name && cage && !/cage|name|part|supplier|manufacturer/i.test(name)) {
          suppliers.push({ name: clean(name), cage, pn: clean(pn) });
        }
      }
    }
    // Stop after 20 rows past the section — avoid parsing unrelated tables
    if (suppliers.length >= 20) break;
  }
  return suppliers;
}

// ── Parse text-format supplier block (DIBBS sometimes renders as text) ────
function parseSuppliersFromText(text) {
  const suppliers = [];
  // Pattern: lines with CAGE code (5 alphanumeric) somewhere
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cageMatch = line.match(/\b([A-Z0-9]{5})\b/);
    if (cageMatch) {
      const cage = cageMatch[1];
      // Skip obvious non-cage matches
      if (/^(ORIGIN|DEST|MILPR|NAICS)$/.test(cage)) continue;
      const name = clean(line.replace(cage, "").replace(/[|·\-]/g, " "));
      const pn = clean(lines[i + 1] || "");
      if (name.length > 2 && name.length < 80) {
        suppliers.push({ name, cage, pn });
      }
    }
  }
  return suppliers.slice(0, 20);
}

// ── Build DIBBS URL from sol number ──────────────────────────────────────
function dibbsUrl(solNumber) {
  // DIBBS RFQ search by solicitation number
  const encoded = encodeURIComponent(solNumber.trim());
  return `https://www.dibbs.bsm.dla.mil/rfq/rqdetail.aspx?rfqno=${encoded}`;
}

// ── Fetch page HTML via Browserless /content ──────────────────────────────
async function fetchPageContent(url, apiKey) {
  const endpoint = `${BL_BASE}/content?token=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      waitFor: 4000,
      rejectResourceTypes: ["image", "stylesheet", "font", "media"],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Browserless /content ${res.status}`);
  return await res.text(); // returns full page HTML
}

// ── Fetch via /scrape as fallback ─────────────────────────────────────────
async function fetchPageScrape(url, apiKey) {
  const endpoint = `${BL_BASE}/scrape?token=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      elements: [{ selector: "body", timeout: 6000 }],
      waitFor: 4000,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Browserless /scrape ${res.status}`);
  const data = await res.json();
  const bodyEl = (data?.data || [])[0];
  return bodyEl?.text || bodyEl?.html || "";
}

// ── Main parser — takes raw HTML, returns structured sol object ────────────
function parseSolPage(html, solNumber) {
  // Strip scripts/styles for text extraction
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Get plain text version
  const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const sol = {
    contract_number: solNumber,
    contract_type: "",
    pr_number: "",
    date_issued: "",
    nsn: "",
    part_numbers: [],
    due_date: "",
    item_description: "",
    drawing_info: "",
    fob: "",
    anticipated_award: "",
    packaging: "",
    set_aside: "",
    qty: "",
    unit_issue: "",
    delivery_days: "",
    hist_unit_price: "",
    unit_price: "",
    suppliers: [],
    source: "dibbs-scrape",
  };

  // ── Contract fields ──
  sol.contract_type = extractField(text, "Contract Type", "Type");
  sol.pr_number = extractField(text, "PR Number", "Purchase Request");
  sol.date_issued = extractField(text, "Date Issued", "Issue Date", "Posted Date");
  sol.due_date = extractField(text, "Due Date", "Quote Due", "Closing Date");
  sol.item_description = extractField(
    text,
    "Item Description",
    "Description",
    "Nomenclature"
  );
  sol.drawing_info = extractField(text, "Drawing", "Drawing Information", "Drawing Number");
  sol.fob = extractField(text, "FOB Point", "FOB", "Shipping");
  sol.anticipated_award = extractField(
    text,
    "Anticipated Award Amount",
    "Award Amount",
    "Estimated Value"
  );
  sol.packaging = extractField(text, "Packaging", "Pack", "Packing");
  sol.set_aside = extractField(text, "Set Aside", "Set-Aside", "Setaside");
  sol.qty = extractField(text, "Quantity", "Qty");
  sol.unit_issue = extractField(text, "Unit of Issue", "Unit Issue", "UOI");
  sol.delivery_days = extractField(text, "Delivery Days", "Delivery", "ARO");
  sol.hist_unit_price = extractField(
    text,
    "Historical Unit Price",
    "Hist Unit Price",
    "Hist Price",
    "Historical Price"
  );
  sol.unit_price = extractField(text, "Unit Price", "Price");

  // ── NSN ──
  const nsnMatch = text.match(/\b(\d{4}-\d{2}-\d{3}-\d{4}|\d{13})\b/);
  if (nsnMatch) sol.nsn = nsnMatch[1].replace(/-/g, "");

  // ── Part numbers ──
  const pnSection = extractField(text, "Part Number", "P/N");
  if (pnSection) {
    sol.part_numbers = pnSection
      .split(/[,;]/)
      .map((p) => clean(p))
      .filter(Boolean);
  }

  // ── Suppliers — try HTML table first, then text parse ──
  sol.suppliers = parseSuppliers(html);
  if (!sol.suppliers.length) {
    sol.suppliers = parseSuppliersFromText(text);
  }

  return sol;
}

// ── HANDLER ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "BROWSERLESS_API_KEY not configured" }),
    };
  }

  let sol_number;
  try {
    ({ sol_number } = JSON.parse(event.body || "{}"));
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!sol_number) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "sol_number required" }),
    };
  }

  const url = dibbsUrl(sol_number);

  let html = "";
  let method = "content";

  try {
    html = await fetchPageContent(url, apiKey);
  } catch (err) {
    // Fallback to /scrape
    method = "scrape";
    try {
      html = await fetchPageScrape(url, apiKey);
    } catch (err2) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "Both fetch methods failed: " + err2.message,
        }),
      };
    }
  }

  if (!html || html.length < 500) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "Page returned empty — sol may be closed or not found",
        url,
      }),
    };
  }

  const sol = parseSolPage(html, sol_number);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol, method, url }),
  };
};
