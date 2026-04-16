// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Scraper
// Hits DIBBS RFQ page directly via Node fetch — no Browserless needed.
// POST body: { sol_number: "SPE4A7-25-T-795A" }
// Returns: { ok, sol: { contract_number, nsn, part_numbers[], due_date,
//   item_description, fob, anticipated_award, qty, unit_issue,
//   delivery_days, hist_unit_price, suppliers: [{name, cage, pn}] } }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractField(text, ...labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "[:\\s]*([^\\n]{1,200})", "i");
    const m = text.match(re);
    if (m) {
      const val = clean(m[1]);
      if (val) return val;
    }
  }
  return "";
}

function parseSuppliers(html) {
  const suppliers = [];
  const supplierIdx = Math.max(
    html.toLowerCase().indexOf("approved source"),
    html.toLowerCase().indexOf("supplier list"),
    html.toLowerCase().indexOf("manufacturer required"),
  );
  const relevantHtml = supplierIdx > 0 ? html.slice(supplierIdx) : html;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(relevantHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const t = clean(cellMatch[1].replace(/<[^>]+>/g, " "));
      if (t) cells.push(t);
    }
    if (cells.length >= 2) {
      const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
      if (cageIdx > 0) {
        const name = cells.slice(0, cageIdx).join(" ");
        const cage = cells[cageIdx].trim();
        const pn = cells[cageIdx + 1] || "";
        if (
          name &&
          cage &&
          !/^(cage|name|part|supplier|manufacturer|source)$/i.test(name.trim())
        ) {
          suppliers.push({ name: clean(name), cage, pn: clean(pn) });
        }
      }
    }
    if (suppliers.length >= 20) break;
  }
  return suppliers;
}

function parseSolPage(html, solNumber) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
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

  sol.contract_type = extractField(text, "Contract Type", "Set Aside");
  sol.pr_number = extractField(text, "PR Number", "Purchase Request");
  sol.date_issued = extractField(
    text,
    "Date Issued",
    "Issue Date",
    "Posted Date",
  );
  sol.due_date = extractField(text, "Due Date", "Quote Due", "Closing Date");
  sol.item_description = extractField(
    text,
    "Item Description",
    "Nomenclature",
    "Description",
  );
  sol.drawing_info = extractField(
    text,
    "Drawing Information",
    "Drawing Number",
  );
  sol.fob = extractField(text, "FOB Point", "FOB");
  sol.anticipated_award = extractField(
    text,
    "Anticipated Award Amount",
    "Award Amount",
    "Estimated Value",
  );
  sol.packaging = extractField(text, "Packaging", "Pack");
  sol.set_aside = extractField(text, "Set Aside", "Set-Aside");
  sol.qty = extractField(text, "Quantity", "Qty");
  sol.unit_issue = extractField(text, "Unit of Issue", "Unit Issue", "UOI");
  sol.delivery_days = extractField(text, "Delivery Days", "Delivery", "ARO");
  sol.hist_unit_price = extractField(
    text,
    "Historical Unit Price",
    "Hist Unit Price",
    "Historical Price",
  );
  sol.unit_price = extractField(text, "Unit Price");

  const nsnMatch = text.match(/\b(\d{4}-\d{2}-\d{3}-\d{4}|\d{13})\b/);
  if (nsnMatch) sol.nsn = nsnMatch[1].replace(/-/g, "");

  const pnSection = extractField(text, "Part Number", "P/N");
  if (pnSection) {
    sol.part_numbers = pnSection.split(/[,;]/).map(clean).filter(Boolean);
  }

  sol.suppliers = parseSuppliers(html);
  return sol;
}

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

  // ── Strategy 1: DIBBS RFQ detail page (direct, no auth) ──
  const rfqUrl = `https://www.dibbs.bsm.dla.mil/rfq/rqdetail.aspx?rfqno=${encodeURIComponent(sol_number.trim())}`;

  // ── Strategy 2: DIBBS contract search fallback ──
  const searchUrl = `https://www.dibbs.bsm.dla.mil/rfq/rqsearch.aspx?q=${encodeURIComponent(sol_number.trim())}`;

  const fetchOpts = {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
    },
    signal: AbortSignal.timeout(15000),
  };

  let html = "";
  let usedUrl = rfqUrl;

  try {
    const res = await fetch(rfqUrl, fetchOpts);
    if (res.ok) {
      html = await res.text();
    } else {
      throw new Error(`DIBBS returned ${res.status}`);
    }
  } catch (err) {
    // Fallback: try search URL
    try {
      const res2 = await fetch(searchUrl, fetchOpts);
      if (res2.ok) {
        html = await res2.text();
        usedUrl = searchUrl;
      } else {
        return {
          statusCode: 502,
          headers: HEADERS,
          body: JSON.stringify({
            ok: false,
            error: "DIBBS unreachable: " + err.message,
          }),
        };
      }
    } catch (err2) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "Both DIBBS endpoints failed: " + err2.message,
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
        error: "Empty page — sol may be closed or not found",
        url: usedUrl,
      }),
    };
  }

  const sol = parseSolPage(html, sol_number);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol, url: usedUrl }),
  };
};
