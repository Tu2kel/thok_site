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

// ── BLOCK DETECTION ──────────────────────────────────────────────────────────
function checkIsBlocked(html, solNumber) {
  if (!html || html.length < 500) return true;
  const lc = html.toLowerCase();
  const solLc = solNumber.toLowerCase();

  return (
    lc.includes("access denied") ||
    lc.includes("login required") ||
    lc.includes("cac required") ||
    lc.includes("support id") ||
    lc.includes("the requested url was rejected") ||
    (lc.includes("<title") && !lc.includes(solLc.slice(0, 6)))
  );
}

// ── SUPPLIER PARSER ───────────────────────────────────────────────────────────
function parseSuppliers(html) {
  const suppliers = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const t = clean(cellMatch[1].replace(/<[^>]+>/g, " "));
      if (t) cells.push(t);
    }
    const cageIdx = cells.findIndex((c) => /^[A-Z0-9]{5}$/.test(c.trim()));
    if (cageIdx >= 0) {
      const cage = cells[cageIdx].trim();
      if (!suppliers.find((s) => s.cage === cage)) {
        suppliers.push({
          name: cells.slice(0, cageIdx).join(" "),
          cage,
          pn: clean(cells[cageIdx + 1] || ""),
        });
      }
    }
  }
  return suppliers;
}

// ── MAIN PAGE PARSER ──────────────────────────────────────────────────────────
function parseSolPage(html, solNumber) {
  const scriptRe = new RegExp(`<script[\\s\\S]*?<\/script>`, `gi`);
  const styleRe = new RegExp(`<style[\\s\\S]*?<\/style>`, `gi`);
  const text = html
    .replace(scriptRe, "")
    .replace(styleRe, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  return {
    contract_number: solNumber,
    nsn: (text.match(/\b(\d{13})\b/) || ["", ""])[1],
    due_date: extractField(text, "Quote Due", "Due Date"),
    item_description: extractField(text, "Nomenclature", "Item Description"),
    fob: extractField(text, "F.O.B. Point", "FOB"),
    hist_unit_price: extractField(text, "Historical Unit Price", "Hist Price"),
    suppliers: parseSuppliers(html),
    source: "dibbs-hybrid",
  };
}

// ── FETCHERS ──────────────────────────────────────────────────────────────────
async function fetchDirect(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
    },
    signal: AbortSignal.timeout(10000),
  });
  return await res.text();
}

async function fetchBrowserless(url, apiKey) {
  const res = await fetch(
    `${BROWSERLESS_CONTENT}?token=${apiKey}&stealth=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url,
        waitFor: 3000,
        gotoOptions: { waitUntil: "networkidle2", timeout: 20000 },
      }),
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
  } catch (e) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const solClean = sol_number?.trim().toUpperCase();
  const rfqUrl = `https://www.dibbs.bsm.dla.mil/rfq/rqdetail.aspx?rfqno=${encodeURIComponent(solClean)}`;
  const apiKey = process.env.BROWSERLESS_API_KEY;

  let html = "";
  let method = "direct";

  try {
    html = await fetchDirect(rfqUrl);
  } catch (err) {
    console.warn("Direct fail:", err.message);
  }

  if (checkIsBlocked(html, solClean)) {
    if (!apiKey) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "DIBBS Blocked. API Key missing.",
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
          method: "browserless-fail",
        }),
      };
    }
  }

  // Final check
  if (checkIsBlocked(html, solClean)) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "DIBBS Security still persistent.",
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
