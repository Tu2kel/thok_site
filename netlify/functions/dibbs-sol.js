// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Detail Fetcher
// POST body: { sol_number: "SPE4A7-25-T-795A" }
// Returns: { ok, sol: { contract_number, nsn, part_numbers[], due_date,
//   item_description, fob, anticipated_award, qty, unit_issue,
//   delivery_days, hist_unit_price, unit_price, set_aside,
//   suppliers: [{name, cage, pn}] } }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Extract inner text from HTML, stripping all tags
function stripTags(html) {
  return clean(html.replace(/<[^>]+>/g, " "));
}

// Pull a labeled field value from the stripped text.
// Looks for "Label: value" or "Label value" patterns in the DIBBS page layout.
function extractLabeled(text, ...labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match "Label:" followed by content up to next newline or pipe
    const re = new RegExp(escaped + "\\s*:?\\s*([^\\n|]{1,300})", "i");
    const m = text.match(re);
    if (m) {
      const val = clean(m[1].split(/\n/)[0]);
      if (val && val.length > 0 && !/^[\s:]+$/.test(val)) return val;
    }
  }
  return "";
}

// Pull cell value that follows a header cell containing the label text.
// DIBBS uses <th> or bold <td> as labels in adjacent table cells.
function extractTableCell(html, ...labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match a th/td containing the label, then grab the next td's content
    const re = new RegExp(
      "<t[dh][^>]*>[^<]*" +
        escaped +
        "[^<]*<\\/t[dh]>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>",
      "i",
    );
    const m = html.match(re);
    if (m) {
      const val = stripTags(m[1]);
      if (val && val.length > 0) return val;
    }
  }
  return "";
}

// Parse supplier rows from the DIBBS approved source / supplier list table.
// DIBBS renders these as rows with: Company Name | CAGE | Part Number
function parseSuppliers(html) {
  const suppliers = [];

  // Find the supplier section — DIBBS marks it with specific headers
  const sectionStart = Math.max(
    html.toLowerCase().indexOf("approved source"),
    html.toLowerCase().indexOf("cage code"),
    html.toLowerCase().indexOf("supplier list"),
    html.toLowerCase().indexOf("mfr cage"),
  );

  const relevantHtml = sectionStart > 0 ? html.slice(sectionStart) : html;

  // Walk every table row in the supplier section
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(relevantHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];

    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const t = stripTags(cellMatch[1]);
      if (t) cells.push(t);
    }

    if (cells.length < 2) continue;

    // Skip header rows
    if (
      /^(cage|name|part|supplier|manufacturer|source|company|mfr)$/i.test(
        cells[0],
      )
    )
      continue;

    // Strategy 1: Look for a 5-char CAGE code in any cell
    const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
    if (cageIdx > 0) {
      const name = cells.slice(0, cageIdx).join(" ").trim();
      const cage = cells[cageIdx].trim();
      const pn = cells
        .slice(cageIdx + 1)
        .join(" ")
        .trim();
      if (name && cage && name.length > 1) {
        suppliers.push({ name: clean(name), cage, pn: clean(pn) });
        if (suppliers.length >= 25) break;
        continue;
      }
    }

    // Strategy 2: CAGE is first cell (some DIBBS layouts flip order)
    if (/^[A-Z0-9]{5}$/.test(cells[0].trim()) && cells.length >= 2) {
      const cage = cells[0].trim();
      const name = cells[1].trim();
      const pn = cells[2] ? cells[2].trim() : "";
      if (name && name.length > 1) {
        suppliers.push({ name: clean(name), cage, pn: clean(pn) });
        if (suppliers.length >= 25) break;
      }
    }
  }

  // Deduplicate by CAGE + PN
  const seen = new Set();
  return suppliers.filter((s) => {
    const key = s.cage + "|" + s.pn;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSolPage(html, solNumber) {
  // Strip scripts and styles before any processing
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const text = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const sol = {
    contract_number: solNumber,
    nsn: "",
    part_numbers: [],
    due_date: "",
    item_description: "",
    fob: "",
    anticipated_award: "",
    qty: "",
    unit_issue: "",
    delivery_days: "",
    hist_unit_price: "",
    unit_price: "",
    set_aside: "",
    packaging: "",
    suppliers: [],
    source: "dibbs-direct",
  };

  // ── Item Description / Nomenclature ──
  // DIBBS labels this "Item Description" or "Nomenclature" in a th/td pair
  sol.item_description =
    extractTableCell(
      cleaned,
      "Item Description",
      "Nomenclature",
      "Description",
    ) || extractLabeled(text, "Item Description", "Nomenclature");

  // ── NSN — 13 consecutive digits or dashed XXXX-XX-XXX-XXXX ──
  const nsnMatch = text.match(/\b(\d{4}[\-]?\d{2}[\-]?\d{3}[\-]?\d{4})\b/);
  if (nsnMatch) {
    sol.nsn = nsnMatch[1].replace(/-/g, "");
  }

  // ── Part Numbers ──
  const pnRaw =
    extractTableCell(cleaned, "Part Number", "Ref Part Number", "P/N") ||
    extractLabeled(text, "Part Number", "P/N", "Ref Part Number");
  if (pnRaw) {
    sol.part_numbers = pnRaw
      .split(/[,;\/]/)
      .map(clean)
      .filter(Boolean);
  }

  // ── Quantity + Unit of Issue ──
  // DIBBS format: "18 EA" or table cell containing "18 EA" or "18" with adjacent "EA"
  const qtyCell =
    extractTableCell(cleaned, "Quantity", "Qty", "Quantity Requested") ||
    extractLabeled(text, "Quantity", "Qty");
  if (qtyCell) {
    const qm = qtyCell.match(/^([\d,]+)\s*([A-Z]{2})?/i);
    if (qm) {
      sol.qty = qm[1].replace(/,/g, "");
      if (qm[2]) sol.unit_issue = qm[2].toUpperCase();
    }
  }
  if (!sol.unit_issue) {
    const uiCell = extractTableCell(
      cleaned,
      "Unit of Issue",
      "UOI",
      "Unit Issue",
    );
    if (uiCell) sol.unit_issue = clean(uiCell).toUpperCase().slice(0, 2);
  }

  // ── Unit Price / Historical Unit Price ──
  const unitPriceRaw =
    extractTableCell(cleaned, "Unit Price", "Estimated Unit Price") ||
    extractLabeled(text, "Unit Price", "Estimated Unit Price");
  if (unitPriceRaw) {
    const pm = unitPriceRaw.match(/\$?([\d,]+\.\d{2,4})/);
    if (pm) sol.unit_price = pm[1].replace(/,/g, "");
  }

  const histPriceRaw =
    extractTableCell(
      cleaned,
      "Historical Unit Price",
      "Hist Unit Price",
      "Historical Price",
    ) ||
    extractLabeled(
      text,
      "Historical Unit Price",
      "Hist Unit Price",
      "Historical Price",
    );
  if (histPriceRaw) {
    const hm = histPriceRaw.match(/\$?([\d,]+\.\d{2,4})/);
    if (hm) sol.hist_unit_price = hm[1].replace(/,/g, "");
  }

  // ── Delivery Days ──
  const delRaw =
    extractTableCell(
      cleaned,
      "Delivery Date",
      "Delivery Days",
      "Days ARO",
      "Required Delivery",
    ) || extractLabeled(text, "Delivery Days", "Days ARO", "Delivery Date");
  if (delRaw) {
    const dm = delRaw.match(/(\d{1,3})/);
    if (dm) sol.delivery_days = dm[1];
  }

  // ── Quote Due Date ──
  const dueRaw =
    extractTableCell(
      cleaned,
      "Quote Due",
      "Closing Date",
      "Due Date",
      "Quotes Due",
    ) || extractLabeled(text, "Quote Due", "Closing Date", "Due Date");
  if (dueRaw) {
    const dateMatch = dueRaw.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    sol.due_date = dateMatch ? dateMatch[1] : clean(dueRaw).slice(0, 20);
  }

  // ── FOB ──
  const fobRaw =
    extractTableCell(cleaned, "FOB Point", "FOB") ||
    extractLabeled(text, "FOB Point", "FOB");
  if (fobRaw) {
    sol.fob = /dest/i.test(fobRaw)
      ? "Dest."
      : /orig/i.test(fobRaw)
        ? "Orig."
        : clean(fobRaw).slice(0, 20);
  }

  // ── Set Aside ──
  const saRaw =
    extractTableCell(cleaned, "Set Aside", "Set-Aside") ||
    extractLabeled(text, "Set Aside", "Set-Aside");
  if (saRaw) sol.set_aside = clean(saRaw).slice(0, 40);

  // ── Anticipated Award Amount ──
  const awardRaw =
    extractTableCell(
      cleaned,
      "Anticipated Award",
      "Estimated Value",
      "Award Amount",
    ) ||
    extractLabeled(
      text,
      "Anticipated Award",
      "Estimated Value",
      "Award Amount",
    );
  if (awardRaw) {
    const am = awardRaw.match(/\$?([\d,]+(?:\.\d{2})?)/);
    if (am) sol.anticipated_award = "$" + am[1];
  }

  // ── Packaging ──
  const pkgRaw =
    extractTableCell(cleaned, "Packaging", "Pack") ||
    extractLabeled(text, "Packaging");
  if (pkgRaw) sol.packaging = clean(pkgRaw).slice(0, 60);

  // ── Suppliers ──
  sol.suppliers = parseSuppliers(cleaned);

  // Debug output — remove after confirming working
  console.log("[DIBBS Parser] Parsed:", {
    nsn: sol.nsn,
    item: sol.item_description,
    qty: sol.qty + " " + sol.unit_issue,
    unitPrice: sol.unit_price,
    histPrice: sol.hist_unit_price,
    delivery: sol.delivery_days,
    due: sol.due_date,
    fob: sol.fob,
    setAside: sol.set_aside,
    suppliersFound: sol.suppliers.length,
    suppliers: sol.suppliers,
  });

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

  const solClean = sol_number.trim().toUpperCase();

  // ── Correct DIBBS RFQ detail endpoint — confirmed from lhf-check.js ──
  const rfqUrl = `https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=${encodeURIComponent(solClean)}`;

  const fetchOpts = {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
    signal: AbortSignal.timeout(20000),
  };

  let html = "";

  try {
    const res = await fetch(rfqUrl, fetchOpts);
    if (!res.ok) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: `DIBBS returned HTTP ${res.status}`,
          url: rfqUrl,
        }),
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "DIBBS fetch failed: " + err.message,
        url: rfqUrl,
      }),
    };
  }

  if (!html || html.length < 500) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error:
          "Empty or minimal page — sol may be closed, removed, or not found",
        url: rfqUrl,
      }),
    };
  }

  // Check for DIBBS "not found" / error page indicators
  if (
    /no solicitation found|rfq not found|invalid solicitation|does not exist/i.test(
      html,
    )
  ) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "Solicitation not found on DIBBS — may be removed or awarded",
        url: rfqUrl,
      }),
    };
  }

  const sol = parseSolPage(html, solClean);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol, url: rfqUrl }),
  };
};
