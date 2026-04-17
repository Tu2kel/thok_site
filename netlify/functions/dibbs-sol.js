// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Scraper v2.2
// Strategy cascade:
//   1. Direct fetch (fast)
//   2. Browserless escalation (headless bypass for F5 ASM)

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BROWSERLESS_CONTENT = "https://production-sfo.browserless.io/content";

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractField(text, ...labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "[:\\s]+([^\\n<]{1,300})", "i");
    const m = text.match(re);
    if (m) {
      const val = clean(m[1]);
      if (val && val.length > 0 && val.length < 280) return val;
    }
  }
  return "";
}

// ── BLOCK DETECTION (The Fix) ────────────────────────────────────────────────
/**
 * Detects F5 ASM block pages, login redirects, or empty responses.
 */
function checkIsBlocked(html, solNumber) {
  if (!html || html.length < 500) return true;
  const lc = html.toLowerCase();
  const solLc = solNumber.toLowerCase();

  return (
    lc.includes("access denied") ||
    lc.includes("login required") ||
    lc.includes("cac required") ||
    lc.includes("support id") || // F5 ASM signature
    lc.includes("the requested url was rejected") ||
    (lc.includes("<title") && !lc.includes(solLc.slice(0, 6)))
  );
}

// ── SUPPLIER PARSER ───────────────────────────────────────────────────────────
function parseSuppliers(html) {
  const suppliers = [];
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

  const relevantHtml = sectionStart > 0 ? html.slice(sectionStart) : html;

  // Strategy 1: Table Parse
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(relevantHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const t = clean(
        cellMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&nbsp;/g, " "),
      );
      if (t) cells.push(t);
    }

    if (cells.length < 2) continue;
    const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
    if (cageIdx < 0) continue;

    const cage = cells[cageIdx].trim();
    const name = cells.slice(0, cageIdx).join(" ").trim();
    const pn = clean(cells[cageIdx + 1] || "");

    if (!name || /^(cage|name|part|supplier|mfr|mfg|source)$/i.test(name))
      continue;

    if (!suppliers.find((s) => s.cage === cage)) {
      suppliers.push({ name: clean(name), cage, pn });
    }
    if (suppliers.length >= 25) break;
  }

  // Strategy 2: Regex Scan Fallback
  if (suppliers.length === 0) {
    const stripped = relevantHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
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
    .replace(/<[^>]+>/g, ""); // FIXED: Now properly strips HTML comments

  const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const sol = {
    contract_number: solNumber,
    contract_type: extractField(text, "Contract Type"),
    pr_number: extractField(text, "PR Number", "PR#"),
    date_issued: extractField(text, "Date Issued", "Posted Date"),
    nsn: "",
    part_numbers: [],
    due_date: extractField(text, "Quote Due", "Due Date"),
    item_description: extractField(text, "Nomenclature", "Item Description"),
    drawing_info: extractField(text, "Drawing Number", "Dwg"),
    fob: extractField(text, "F.O.B. Point", "FOB"),
    anticipated_award: extractField(
      text,
      "Anticipated Award",
      "Estimated Value",
    ),
    packaging: extractField(text, "Preservation", "Packaging"),
    set_aside: extractField(text, "Set Aside", "Socioeconomic"),
    qty: extractField(text, "Quantity", "Qty"),
    unit_issue: extractField(text, "Unit of Issue", "UOI"),
    delivery_days: extractField(text, "Delivery Days", "Days ARO"),
    hist_unit_price: extractField(text, "Historical Unit Price", "Hist Price"),
    unit_price: extractField(text, "Unit Price"),
    suppliers: parseSuppliers(html),
    source: "dibbs-hybrid",
  };

  const nsnMatch = text.match(/\b(\d{4}[- ]\d{2}[- ]\d{3}[- ]\d{4}|\d{13})\b/);
  if (nsnMatch) sol.nsn = nsnMatch[1].replace(/[- ]/g, "");

  const pnField = extractField(text, "Part Number", "Ref Part Number", "P/N");
  if (pnField)
    sol.part_numbers = pnField
      .split(/[,;\/]/)
      .map(clean)
      .filter(Boolean)
      .slice(0, 10);

  return sol;
}

// ── FETCHERS ──────────────────────────────────────────────────────────────────
async function fetchDirect(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchBrowserless(url, apiKey) {
  const res = await fetch(
    `${BROWSERLESS_CONTENT}?token=${apiKey}&stealth=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        waitFor: 3000,
        gotoOptions: { waitUntil: "networkidle2", timeout: 20000 },
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) throw new Error(`Browserless Error: ${res.status}`);
  return await res.text();
}

// ── HANDLER (The Full Loop) ──────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers: HEADERS, body: "" };

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

  const solClean = sol_number?.trim().toUpperCase();
  if (!solClean)
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "sol_number required" }),
    };

  const rfqUrl = `https://www.dibbs.bsm.dla.mil/rfq/rqdetail.aspx?rfqno=${encodeURIComponent(solClean)}`;
  const apiKey = process.env.BROWSERLESS_API_KEY;

  let html = "";
  let method = "direct";

  try {
    html = await fetchDirect(rfqUrl);
  } catch (err) {
    console.warn("[dibbs-sol] Direct fetch fail:", err.message);
  }

  if (checkIsBlocked(html, solClean)) {
    if (!apiKey) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "DIBBS Blocked. Need BROWSERLESS_API_KEY.",
          method: "direct-blocked",
        }),
      };
    }
    try {
      html = await fetchBrowserless(rfqUrl, apiKey);
      method = "browserless";
    } catch (err) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "Browserless failed: " + err.message,
        }),
      };
    }
  }

  if (checkIsBlocked(html, solClean)) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "Security Block persistent. Try again later.",
        method,
      }),
    };
  }

  const sol = parseSolPage(html, solClean);
  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol, url: rfqUrl, method }),
  };
};
