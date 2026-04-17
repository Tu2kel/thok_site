// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Scraper v2
// Strategy cascade:
//   1. Direct fetch (fast, works if DIBBS doesn't block)
//   2. Browserless /content endpoint (headless Chrome, bypasses blocks)
// POST body: { sol_number: "SPE8EE26T0866" }
// Returns: { ok, sol: { contract_number, nsn, part_numbers[], due_date,
//   item_description, fob, anticipated_award, qty, unit_issue,
//   delivery_days, hist_unit_price, suppliers: [{name, cage, pn}] }, method }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── BROWSERLESS CONFIG ────────────────────────────────────────────────────────
// Uses /content endpoint — returns fully rendered HTML after JS execution.
// Much cheaper than /screenshot or /pdf — no image rendering cost.
const BROWSERLESS_CONTENT = "https://production-sfo.browserless.io/content";

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractField(text, ...labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match label followed by colon/whitespace, capture rest of line
    const re = new RegExp(escaped + "[:\\s]+([^\\n<]{1,300})", "i");
    const m = text.match(re);
    if (m) {
      const val = clean(m[1]);
      if (val && val.length > 0 && val.length < 280) return val;
    }
  }
  return "";
}

// ── SUPPLIER PARSER ───────────────────────────────────────────────────────────
// DIBBS approved source tables look like:
//   <table ...> <tr><th>Mfr Name</th><th>CAGE</th><th>Part Number</th></tr>
//               <tr><td>ACME CORP</td><td>1A234</td><td>AC-999</td></tr> ...
// CAGE codes: exactly 5 chars, alphanumeric (digits + uppercase letters).
// Some rows may have the part number in the same cell as extra text.
function parseSuppliers(html) {
  const suppliers = [];

  // Find the section of HTML containing approved sources / supplier list
  const lc = html.toLowerCase();
  const markers = [
    "approved source",
    "sources of supply",
    "supplier list",
    "manufacturer required",
    "source list",
    "approved manufacturer",
  ];

  let sectionStart = -1;
  for (const m of markers) {
    const idx = lc.indexOf(m);
    if (idx > 0) {
      sectionStart = sectionStart < 0 ? idx : Math.min(sectionStart, idx);
    }
  }

  // Use relevant section or full HTML if markers not found
  const relevantHtml = sectionStart > 0 ? html.slice(sectionStart) : html;

  // ── Strategy 1: Parse structured <tr><td> table rows ─────────────────────
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(relevantHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      // Strip all inner HTML tags and decode common entities
      const t = clean(
        cellMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&nbsp;/g, " ")
          .replace(/&#\d+;/g, ""),
      );
      if (t) cells.push(t);
    }

    if (cells.length < 2) continue;

    // Find CAGE column: exactly 5 uppercase alphanumeric chars
    const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
    if (cageIdx < 0) continue;

    const cage = cells[cageIdx].trim();
    const name = cells.slice(0, cageIdx).join(" ").trim();
    const pn = clean(cells[cageIdx + 1] || "");

    // Skip header rows and known non-supplier strings
    if (!name) continue;
    if (
      /^(cage|name|part\s*number|supplier|manufacturer|source|mfr|mfg|company)$/i.test(
        name,
      )
    )
      continue;
    // Skip if name looks like a label/header (very short or all-caps single word used as header)
    if (name.length < 2) continue;

    // Deduplicate by CAGE
    if (!suppliers.find((s) => s.cage === cage)) {
      suppliers.push({ name: clean(name), cage, pn });
    }

    if (suppliers.length >= 25) break;
  }

  // ── Strategy 2: Regex scan for CAGE patterns inline in text ──────────────
  // Fallback if table parse found nothing. Looks for patterns like:
  // "ACME CORPORATION 1A234 AC-9999" in stripped text
  if (suppliers.length === 0) {
    const stripped = relevantHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    // Match: word(s) followed by 5-char CAGE followed by optional P/N
    const inlineRe =
      /([A-Z][A-Z0-9 &,.-]{2,50})\s+([A-Z0-9]{5})\s+([A-Z0-9][A-Z0-9\-\/_.]{0,40})?/g;
    let m;
    while ((m = inlineRe.exec(stripped)) !== null) {
      const name = clean(m[1]);
      const cage = m[2];
      const pn = clean(m[3] || "");
      if (
        !name ||
        /^(cage|part|source|supplier|approved|manufacturer)/i.test(name)
      )
        continue;
      if (!suppliers.find((s) => s.cage === cage)) {
        suppliers.push({ name, cage, pn });
      }
      if (suppliers.length >= 25) break;
    }
  }

  return suppliers;
}

// ── MAIN PAGE PARSER ──────────────────────────────────────────────────────────
function parseSolPage(html, solNumber) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

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
    source: "dibbs-direct",
  };

  sol.contract_type = extractField(text, "Contract Type");
  sol.pr_number = extractField(
    text,
    "PR Number",
    "Purchase Request Number",
    "PR#",
  );
  sol.date_issued = extractField(
    text,
    "Date Issued",
    "Issue Date",
    "Posted Date",
    "Date Posted",
  );
  sol.due_date = extractField(
    text,
    "Quote Due",
    "Due Date",
    "Return By",
    "Closing Date",
    "Response Date",
  );
  sol.item_description = extractField(
    text,
    "Nomenclature",
    "Item Description",
    "Description of Supplies",
  );
  sol.drawing_info = extractField(
    text,
    "Drawing Number",
    "Drawing Information",
    "Dwg",
  );
  sol.fob = extractField(text, "F.O.B. Point", "FOB Point", "FOB");
  sol.anticipated_award = extractField(
    text,
    "Anticipated Award",
    "Award Amount",
    "Estimated Value",
  );
  sol.packaging = extractField(text, "Preservation", "Packaging", "Pack");
  sol.set_aside = extractField(text, "Set Aside", "Set-Aside", "Socioeconomic");
  sol.qty = extractField(text, "Quantity", "Qty");
  sol.unit_issue = extractField(text, "Unit of Issue", "Unit Issue", "UOI");
  sol.delivery_days = extractField(
    text,
    "Delivery Days",
    "Days ARO",
    "Delivery",
    "Required Delivery",
  );
  sol.hist_unit_price = extractField(
    text,
    "Historical Unit Price",
    "Hist Unit Price",
    "Historical Price",
    "Hist Price",
  );
  sol.unit_price = extractField(text, "Unit Price");

  // NSN: standard 13-digit or dash-separated
  const nsnMatch = text.match(/\b(\d{4}[- ]\d{2}[- ]\d{3}[- ]\d{4}|\d{13})\b/);
  if (nsnMatch) sol.nsn = nsnMatch[1].replace(/[- ]/g, "");

  // Part numbers
  const pnField = extractField(text, "Part Number", "Ref Part Number", "P/N");
  if (pnField)
    sol.part_numbers = pnField
      .split(/[,;\/]/)
      .map(clean)
      .filter(Boolean)
      .slice(0, 10);

  // Parse supplier table from raw HTML (before stripping)
  sol.suppliers = parseSuppliers(html);

  return sol;
}

// ── DIRECT FETCH ──────────────────────────────────────────────────────────────
async function fetchDirect(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ── BROWSERLESS FETCH ─────────────────────────────────────────────────────────
// Uses /content endpoint which returns fully rendered HTML after JS runs.
// waitFor: wait for network idle + extra 2s to ensure tables are rendered.
async function fetchBrowserless(url, apiKey) {
  const res = await fetch(
    `${BROWSERLESS_CONTENT}?token=${apiKey}&stealth=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        waitFor: 3000, // ms to wait after page load for JS rendering
        gotoOptions: {
          waitUntil: "networkidle2",
          timeout: 20000,
        },
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Browserless ${res.status}: ${errText.slice(0, 200)}`);
  }
  return await res.text();
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
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

  const solClean = sol_number.trim().toUpperCase();

  // DIBBS RFQ detail URL
  const rfqUrl = `https://www.dibbs.bsm.dla.mil/rfq/rqdetail.aspx?rfqno=${encodeURIComponent(solClean)}`;

  const apiKey = process.env.BROWSERLESS_API_KEY;

  let html = "";
  let method = "";
  let lastError = "";

  // ── Strategy 1: Direct fetch ───────────────────────────────────────────────
  try {
    console.log("[dibbs-sol] Trying direct fetch:", rfqUrl);
    html = await fetchDirect(rfqUrl);
    method = "direct";
    console.log(
      "[dibbs-sol] Direct fetch succeeded, HTML length:",
      html.length,
    );
  } catch (err) {
    lastError = err.message;
    console.warn("[dibbs-sol] Direct fetch failed:", err.message);
  }

  // Check if direct fetch returned a real solicitation page or a login/block page
  const isBlocked =
    !html ||
    html.length < 500 ||
    html.toLowerCase().includes("access denied") ||
    html.toLowerCase().includes("login required") ||
    html.toLowerCase().includes("cac required") ||
    html.toLowerCase().includes("support id") || // F5 ASM block page signature
    html.toLowerCase().includes("the requested url was rejected") ||
    (html.toLowerCase().includes("<title") &&
      !html.toLowerCase().includes(solClean.toLowerCase().slice(0, 6)));

  // ── Strategy 2: Browserless ────────────────────────────────────────────────
  if (isBlocked) {
    if (!apiKey) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error:
            "Direct fetch blocked and BROWSERLESS_API_KEY not configured. Set env var in Netlify.",
          url: rfqUrl,
          method: "direct-blocked",
        }),
      };
    }
    try {
      console.log("[dibbs-sol] Direct blocked — trying Browserless:", rfqUrl);
      html = await fetchBrowserless(rfqUrl, apiKey);
      method = "browserless";
      console.log(
        "[dibbs-sol] Browserless succeeded, HTML length:",
        html.length,
      );
    } catch (err) {
      lastError = err.message;
      console.error("[dibbs-sol] Browserless failed:", err.message);
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "Both fetch strategies failed. Last error: " + err.message,
          url: rfqUrl,
        }),
      };
    }
  }

  if (!html || html.length < 200) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error:
          "Empty page — sol may be closed, awarded, or not found on DIBBS.",
        url: rfqUrl,
        method,
      }),
    };
  }

  const sol = parseSolPage(html, solClean);

  console.log("[dibbs-sol] Parse result:", {
    method,
    item: sol.item_description,
    nsn: sol.nsn,
    suppliersFound: sol.suppliers.length,
    suppliers: sol.suppliers,
    fob: sol.fob,
    due: sol.due_date,
  });

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol, url: rfqUrl, method }),
  };
};
