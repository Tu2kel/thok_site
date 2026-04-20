// netlify/functions/dibbs-sol.js
// Imperio SCC — DIBBS Solicitation Parser (browser-fetch architecture)
//
// Browser fetches the DIBBS page directly (avoids server-side IP block),
// sends raw HTML here for parsing.
//
// POST body: { html: "<full page html>", sol_number: "SPE7L226T0368" }
// Returns:   { ok, sol: { contract_number, nsn, due_date, issue_date,
//              item_description, qty, unit_issue, delivery_days,
//              unit_price, hist_unit_price, fob, set_aside, packaging,
//              anticipated_award, suppliers: [{name, cage, pn}] } }

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

function parseSuppliers(html) {
  const suppliers = [];
  const lower = html.toLowerCase();
  const markers = ["approved source", "mfr cage", "cage code", "supplier"];
  let sectionStart = -1;
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx > 0 && (sectionStart < 0 || idx < sectionStart)) sectionStart = idx;
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
    if (
      cells.every((c) =>
        /^(cage|name|part number|company|manufacturer|source|#)$/i.test(c),
      )
    )
      continue;

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

  // ── Dates from sol header row (MM-DD-YYYY confirmed) ──
  for (const row of rows) {
    if (/SPE[A-Z0-9\-]{6,}/i.test(row)) {
      const dates = [...row.matchAll(/(\d{2}-\d{2}-\d{4})/g)].map((m) => m[1]);
      if (dates[0]) sol.issue_date = dates[0];
      if (dates[1]) sol.due_date = dates[1];
      sol.status = /\bopen\b/i.test(row)
        ? "Open"
        : /\bclosed\b/i.test(row)
          ? "Closed"
          : "";
      break;
    }
  }

  // ── NSN + Item + Qty from line item row ──
  for (const row of rows) {
    const nsnMatch = row.match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
    if (nsnMatch) {
      sol.nsn = nsnMatch[1].replace(/-/g, "");
      const afterNsn = row
        .slice(row.indexOf(nsnMatch[1]) + nsnMatch[1].length)
        .trim();
      const itemMatch = afterNsn.match(
        /^([A-Z][A-Z,\.\-\s]+?)(?:\s+None\b|\s+Technical|\s+\d{7,}|\s*$)/i,
      );
      if (itemMatch) sol.item_description = clean(itemMatch[1]);
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
    const nsnRaw = row.match(/\b(\d{13})\b/);
    if (nsnRaw && !sol.nsn) sol.nsn = nsnRaw[1];
  }

  // ── Prices ──
  const unitPriceMatch = fullText.match(
    /[Uu]nit\s+[Pp]rice[^$\d]{0,20}\$?([\d,]+\.\d{2,4})/,
  );
  if (unitPriceMatch) sol.unit_price = unitPriceMatch[1].replace(/,/g, "");

  const histPriceMatch = fullText.match(
    /[Hh]ist(?:orical)?\s+(?:[Uu]nit\s+)?[Pp]rice[^$\d]{0,20}\$?([\d,]+\.\d{2,4})/,
  );
  if (histPriceMatch) sol.hist_unit_price = histPriceMatch[1].replace(/,/g, "");

  // ── Delivery ──
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

  console.log("[DIBBS Parser]", {
    nsn: sol.nsn,
    item: sol.item_description,
    qty: sol.qty + " " + sol.unit_issue,
    due: sol.due_date,
    suppliers: sol.suppliers.length,
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

  let html, sol_number;
  try {
    ({ html, sol_number } = JSON.parse(event.body || "{}"));
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!html || html.length < 500) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "No HTML provided — browser fetch may have failed",
      }),
    };
  }

  if (!sol_number) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "sol_number required" }),
    };
  }

  const sol = parseSolPage(html, sol_number.trim().toUpperCase());

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, sol }),
  };
};
