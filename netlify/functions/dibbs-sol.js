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

  // Debug: log a slice of the raw text so we can see page structure
  console.log("[DIBBS Parser] HTML length:", html.length);
  console.log(
    "[DIBBS Parser] First 500 chars of stripped text:",
    text.slice(0, 500),
  );
  // Find where supplier section might be
  const lowerText = text.toLowerCase();
  const markers = [
    "approved source",
    "supplier list",
    "manufacturer",
    "cage",
    "solicitation",
    "rfq",
  ];
  markers.forEach((m) => {
    const idx = lowerText.indexOf(m);
    if (idx > 0)
      console.log(
        `[DIBBS Parser] Found "${m}" at index ${idx}:`,
        text.slice(Math.max(0, idx - 20), idx + 80),
      );
  });

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

  // ── Route through browserless-scrape to bypass DIBBS IP blocking ──
  const rfqUrl = `https://www.dibbs.bsm.dla.mil/rfq/rqdetail.aspx?rfqno=${encodeURIComponent(sol_number.trim())}`;
  const scrapeUrl = `${process.env.URL || "https://thehouseofkel.com"}/.netlify/functions/browserless-scrape`;

  let html = "";
  const usedUrl = rfqUrl;

  try {
    console.log("[DIBBS Sol] Fetching via browserless-scrape:", rfqUrl);
    const scrapeRes = await fetch(scrapeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: rfqUrl }),
      signal: AbortSignal.timeout(35000),
    });

    const scrapeData = await scrapeRes.json();

    if (!scrapeData.ok || !scrapeData.results?.[0]?.html) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error:
            "Browserless failed: " + (scrapeData.error || "no HTML returned"),
          url: rfqUrl,
          method: "browserless",
        }),
      };
    }

    html = scrapeData.results[0].html;
    console.log("[DIBBS Sol] Got HTML via browserless, length:", html.length);
  } catch (err) {
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "Browserless scrape error: " + err.message,
        url: rfqUrl,
        method: "browserless",
      }),
    };
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

  console.log("[DIBBS Parser] Final result:", {
    item: sol.item_description,
    nsn: sol.nsn,
    suppliersFound: sol.suppliers.length,
    suppliers: sol.suppliers,
    fob: sol.fob,
    award: sol.anticipated_award,
  });

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol, url: usedUrl }),
  };
};
