// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Detail Fetcher
// POST body: { sol_number: "SPE7L226T0368" }
// Returns: { ok, sol: { contract_number, nsn, part_numbers[], due_date,
//   item_description, fob, qty, unit_issue, delivery_days,
//   hist_unit_price, unit_price, set_aside, suppliers: [{name,cage,pn}] } }
//
// DIBBS page structure (confirmed from live page):
//   Row: "Solicitation # Status Issue Date Return By"
//   Row: "SPE7L2-26-T-0368  Open  04-10-2026  04-20-2026"
//   Row: "# NSN/Part No. Nomenclature Technical Documents Purchase Request QTY"
//   Row: "1  5310-01-721-2111  NUT, PLAIN, EXTENDED  None  7016287028  Qty: 7143"
//   ... supplier rows further down

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripTags(html) {
  return clean(html.replace(/<[^>]+>/g, " "));
}

// Extract all <tr> rows as plain text
function extractRows(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const t = stripTags(m[1]);
    if (t.length > 2) rows.push(t);
  }
  return rows;
}

// Parse supplier rows from the approved source section.
// DIBBS supplier columns: Company Name | CAGE | Part Number (or CAGE-first)
function parseSuppliers(html) {
  const suppliers = [];

  const lower = html.toLowerCase();
  const markers = ["approved source", "mfr cage", "cage code", "supplier"];
  let sectionStart = -1;
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx > 0 && (sectionStart < 0 || idx < sectionStart)) {
      sectionStart = idx;
    }
  }

  const relevantHtml = sectionStart > 0 ? html.slice(sectionStart) : html;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(relevantHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const t = stripTags(cellMatch[1]);
      if (t) cells.push(t);
    }

    if (cells.length < 2) continue;

    // Skip header rows
    if (
      cells.every((c) =>
        /^(cage|name|part number|company|manufacturer|source|#)$/i.test(c),
      )
    )
      continue;

    // Find 5-char CAGE in any cell
    const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
    if (cageIdx === -1) continue;

    let name, cage, pn;

    if (cageIdx === 0) {
      cage = cells[0].trim();
      name = cells[1] ? cells[1].trim() : "";
      pn = cells[2] ? cells[2].trim() : "";
    } else {
      name = cells.slice(0, cageIdx).join(" ").trim();
      cage = cells[cageIdx].trim();
      pn = cells
        .slice(cageIdx + 1)
        .join(" ")
        .trim();
    }

    if (!name || name.length < 2) continue;
    if (/^(cage|name|part|supplier|manufacturer|approved)$/i.test(name))
      continue;

    suppliers.push({ name: clean(name), cage, pn: clean(pn) });
    if (suppliers.length >= 30) break;
  }

  // Deduplicate by CAGE
  const seen = new Set();
  return suppliers.filter((s) => {
    if (seen.has(s.cage)) return false;
    seen.add(s.cage);
    return true;
  });
}

function parseSolPage(html, solNumber) {
  const sol = {
    contract_number: solNumber,
    nsn: "",
    part_numbers: [],
    due_date: "",
    issue_date: "",
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

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const rows = extractRows(cleaned);
  const fullText = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // ── Sol number row — dates in MM-DD-YYYY format ──
  for (const row of rows) {
    if (/SPE[A-Z0-9\-]{6,}/i.test(row)) {
      const dates = [...row.matchAll(/(\d{2}-\d{2}-\d{4})/g)].map((m) => m[1]);
      if (dates.length >= 1) sol.issue_date = dates[0];
      if (dates.length >= 2) sol.due_date = dates[1];
      if (/\bopen\b/i.test(row)) sol.status = "Open";
      else if (/\bclosed\b/i.test(row)) sol.status = "Closed";
      break;
    }
  }

  // ── NSN + Item Description + Qty ──
  // Confirmed row format: "1  5310-01-721-2111  NUT, PLAIN, EXTENDED  None  PR#  Qty: N"
  for (const row of rows) {
    const nsnMatch = row.match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
    if (nsnMatch) {
      sol.nsn = nsnMatch[1].replace(/-/g, "");

      // Item: text after NSN, up to "None", "Technical", or a 7+ digit purchase request number
      const afterNsn = row
        .slice(row.indexOf(nsnMatch[1]) + nsnMatch[1].length)
        .trim();
      const itemMatch = afterNsn.match(
        /^([A-Z][A-Z,\.\-\s]+?)(?:\s+None\b|\s+Technical|\s+\d{7,}|\s*$)/i,
      );
      if (itemMatch) sol.item_description = clean(itemMatch[1]);

      // Qty: "Qty: 7143" format confirmed from live page
      const qtyMatch =
        row.match(/Qty:\s*([\d,]+)\s*([A-Z]{2})?/i) ||
        row.match(
          /\b([\d,]+)\s+(EA|LT|BX|DZ|PR|FT|GL|LB|PK|RL|SE|ST|SH|VI|CY|GR|TH|YD)\b/i,
        );
      if (qtyMatch) {
        sol.qty = qtyMatch[1].replace(/,/g, "");
        if (qtyMatch[2]) sol.unit_issue = qtyMatch[2].toUpperCase();
      }
      break;
    }

    // Fallback: raw 13-digit NSN
    const nsnRaw = row.match(/\b(\d{13})\b/);
    if (nsnRaw && !sol.nsn) sol.nsn = nsnRaw[1];
  }

  // ── Unit Price / Historical Unit Price ──
  const unitPriceMatch = fullText.match(
    /[Uu]nit\s+[Pp]rice[^$\d]{0,20}\$?([\d,]+\.\d{2,4})/,
  );
  if (unitPriceMatch) sol.unit_price = unitPriceMatch[1].replace(/,/g, "");

  const histPriceMatch = fullText.match(
    /[Hh]ist(?:orical)?\s+(?:[Uu]nit\s+)?[Pp]rice[^$\d]{0,20}\$?([\d,]+\.\d{2,4})/,
  );
  if (histPriceMatch) sol.hist_unit_price = histPriceMatch[1].replace(/,/g, "");

  // ── Delivery Days ──
  const delMatch =
    fullText.match(/[Dd]elivery\s+[Dd]ays?[^0-9]{0,10}(\d{1,3})\b/) ||
    fullText.match(/(\d{1,3})\s+[Dd]ays?\s+ARO/i);
  if (delMatch) sol.delivery_days = delMatch[1];

  // ── FOB ──
  if (/FOB[:\s]+Dest/i.test(fullText)) sol.fob = "Dest.";
  else if (/FOB[:\s]+Orig/i.test(fullText)) sol.fob = "Orig.";

  // ── Set Aside ──
  const saMatch = fullText.match(
    /[Ss]et[\s\-][Aa]side[:\s]+([A-Za-z][A-Za-z\s]{1,40})(?:\s{2}|<)/,
  );
  if (saMatch) sol.set_aside = clean(saMatch[1]).slice(0, 40);

  // ── Packaging ──
  const pkgMatch = fullText.match(/(ASTM\s+[A-Z]\d+\w*|MIL-STD-\d+\w*)/i);
  if (pkgMatch) sol.packaging = pkgMatch[1];

  // ── Anticipated Award ──
  const awardMatch = fullText.match(
    /[Ee]stimated\s+[Vv]alue[^$\d]{0,20}\$?([\d,]+(?:\.\d{2})?)/,
  );
  if (awardMatch) sol.anticipated_award = "$" + awardMatch[1];

  // ── Suppliers ──
  sol.suppliers = parseSuppliers(cleaned);

  console.log("[DIBBS Parser] Result:", {
    nsn: sol.nsn,
    item: sol.item_description,
    qty: sol.qty + " " + sol.unit_issue,
    due: sol.due_date,
    unitPrice: sol.unit_price,
    histPrice: sol.hist_unit_price,
    delivery: sol.delivery_days,
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
  const rfqUrl = `https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=${encodeURIComponent(solClean)}`;

  const fetchOpts = {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
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
        error: "Empty page — sol may be closed or not found",
        url: rfqUrl,
      }),
    };
  }

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
        error: "Solicitation not found — may be removed or awarded",
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
