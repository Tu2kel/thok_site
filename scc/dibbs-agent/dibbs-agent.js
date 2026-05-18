// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — DIBBS LOCAL AGENT  v1.0
//  Runs on your Windows machine. Listens on http://localhost:3100
//  Handles: DoD banner POST → cookie jar → sol page → NSN page → PDF
//  SCC calls this via the Netlify relay function (dibbs-local-relay.js)
//
//  START: double-click start-agent.bat
//  STOP:  close the terminal window
// ═══════════════════════════════════════════════════════════════════════

const http = require("http");
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");

const PORT = 3100;
const DIBBS_HOST = "www.dibbs.bsm.dla.mil";
const COOKIE_FILE = path.join(__dirname, "dibbs-cookies.json");

// ── Cookie jar — persists to disk so you don't re-banner every restart ──
let cookieJar = {};

function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      cookieJar = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
      console.log(
        "[agent] Loaded",
        Object.keys(cookieJar).length,
        "saved cookies",
      );
    }
  } catch {
    cookieJar = {};
  }
}

function saveCookies() {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookieJar, null, 2));
  } catch (e) {
    console.warn("[agent] Cookie save failed:", e.message);
  }
}

function parseCookieHeader(setCookieArr) {
  for (const raw of setCookieArr || []) {
    const parts = raw.split(";");
    const kv = parts[0].trim();
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const name = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    if (name) cookieJar[name] = value;
  }
}

function buildCookieHeader() {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ── Generic HTTPS fetch with cookie jar ──────────────────────────────────
function dibbsFetch(reqPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DIBBS_HOST,
      port: 443,
      path: reqPath,
      method: opts.method || "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        Connection: "keep-alive",
        Cookie: buildCookieHeader(),
        ...(opts.headers || {}),
      },
    };

    if (opts.body) {
      options.headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.headers["Content-Length"] = Buffer.byteLength(opts.body);
    }

    const req = https.request(options, (res) => {
      // Absorb cookies
      const setCookies = res.headers["set-cookie"];
      if (setCookies) {
        parseCookieHeader(
          Array.isArray(setCookies) ? setCookies : [setCookies],
        );
        saveCookies();
      }

      // Follow redirects — but never chase back to the banner (infinite loop)
      if (
        (res.statusCode === 302 || res.statusCode === 301) &&
        res.headers.location
      ) {
        const loc = res.headers.location;
        const nextPath = loc.startsWith("http")
          ? new url.URL(loc).pathname + (new url.URL(loc).search || "")
          : loc;
        console.log("[agent] Redirect →", nextPath);
        res.resume();
        // If redirecting back to banner, stop — return empty so caller can handle
        if (nextPath.includes("dodwarning") || nextPath.includes("ErrorPg")) {
          console.log(
            "[agent] Banner redirect detected — stopping redirect chain",
          );
          return resolve({
            status: 302,
            headers: res.headers,
            body: Buffer.from(""),
            bannered: true,
          });
        }
        return dibbsFetch(nextPath, { method: "GET" })
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });

    req.on("error", reject);
    req.setTimeout(25000, () => {
      req.destroy(new Error("timeout"));
    });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── Step 1: Handle DoD consent banner ───────────────────────────────────
// Strategy: inject consent cookies directly. DIBBS banner is ASP.NET but
// the actual gate is a session cookie + consent cookie. We set them manually.
async function dismissBanner(solNumber) {
  // If we already have session + consent cookies, skip entirely
  const hasDodCookie = Object.keys(cookieJar).some((k) =>
    /warn|consent|accept|dod/i.test(k),
  );
  if (hasDodCookie && Object.keys(cookieJar).length > 1) {
    console.log("[agent] Consent cookies present — skipping banner");
    return true;
  }

  const gotoPath = `/rfq/rfqrec.aspx?sn=${encodeURIComponent(solNumber)}`;
  const bannerPath = `/dodwarning.aspx?goto=${encodeURIComponent(gotoPath)}`;

  // GET the banner to establish ASP.NET session cookie
  console.log("[agent] Fetching banner to get session...");
  const bannerRes = await dibbsFetch(bannerPath);
  const bannerHtml = bannerRes.body.toString("utf8");

  if (!bannerHtml.includes("btnOK")) {
    console.log("[agent] No banner present — session active");
    return true;
  }

  // Inject consent cookie directly
  cookieJar["DodWarningAccepted"] = "true";
  cookieJar["dodwarningaccepted"] = "true";
  saveCookies();
  console.log(
    "[agent] Consent cookies injected. Jar size:",
    Object.keys(cookieJar).length,
  );

  // Verify: fetch the sol page — if banner shows again, fall back to form POST
  const verifyRes = await dibbsFetch(
    `/rfq/rfqrec.aspx?sn=${encodeURIComponent(solNumber)}`,
  );
  const verifyHtml = verifyRes.body.toString("utf8");

  if (!verifyHtml.includes("btnOK")) {
    console.log("[agent] Cookie injection worked");
    return true;
  }

  // Fallback: form POST without following redirect (just grab cookies)
  console.log(
    "[agent] Cookie injection insufficient — trying form POST (no redirect)...",
  );
  const vsMatch = bannerHtml.match(/id="__VIEWSTATE"\s+value="([^"]+)"/);
  const vsgMatch = bannerHtml.match(
    /id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/,
  );
  const evMatch = bannerHtml.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/);

  const postBody = new URLSearchParams({
    __VIEWSTATE: vsMatch ? vsMatch[1] : "",
    __VIEWSTATEGENERATOR: vsgMatch ? vsgMatch[1] : "",
    __EVENTVALIDATION: evMatch ? evMatch[1] : "",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    btnOK: "OK",
  }).toString();

  await new Promise((resolve, reject) => {
    const opts = {
      hostname: DIBBS_HOST,
      port: 443,
      path: bannerPath,
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postBody),
        Cookie: buildCookieHeader(),
        Referer: "https://" + DIBBS_HOST + bannerPath,
      },
    };
    const req = https.request(opts, (res) => {
      const sc = res.headers["set-cookie"];
      if (sc) parseCookieHeader(Array.isArray(sc) ? sc : [sc]);
      saveCookies();
      res.resume(); // drain but don't follow redirect
      resolve();
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("POST timeout"));
    });
    req.write(postBody);
    req.end();
  });

  console.log("[agent] POST done. Cookies:", Object.keys(cookieJar).length);
  return true;
}

// ── Step 2: Fetch sol page ───────────────────────────────────────────────
async function fetchSolPage(solNumber) {
  const solPath = `/rfq/rfqrec.aspx?sn=${encodeURIComponent(solNumber)}`;

  // Try up to 3 times — each attempt re-dismisses banner
  for (let attempt = 1; attempt <= 3; attempt++) {
    await dismissBanner(solNumber);
    console.log(
      "[agent] Fetching sol page (attempt " + attempt + "):",
      solPath,
    );
    const res = await dibbsFetch(solPath);

    // If we got bannered (empty body from redirect chain)
    if (res.bannered || res.body.length < 200) {
      console.log(
        "[agent] Got bannered on sol fetch — clearing cookies and retrying...",
      );
      // Clear consent cookies to force re-dismissal
      delete cookieJar["DodWarningAccepted"];
      delete cookieJar["dodwarningaccepted"];
      saveCookies();
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const html = res.body.toString("utf8");

    // Check if we got the banner page instead of the sol
    if (html.includes("btnOK") || html.includes("dodwarning.aspx")) {
      console.log("[agent] Received banner HTML on sol fetch — retrying...");
      delete cookieJar["DodWarningAccepted"];
      delete cookieJar["dodwarningaccepted"];
      saveCookies();
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    console.log("[agent] Sol page received, length:", html.length);
    return html;
  }

  throw new Error("Could not get past DIBBS banner after 3 attempts");
}

// ── Step 3: Fetch NSN detail page ────────────────────────────────────────
async function fetchNsnPage(nsn) {
  if (!nsn) return "";
  // DIBBS NSN page: /RFQ/RFQNsn.aspx?value=XXXXXXXXXXXXXXXXX&category=&Scope=
  const nsnPath = `/RFQ/RFQNsn.aspx?value=${encodeURIComponent(nsn)}&category=&Scope=`;
  console.log("[agent] Fetching NSN page:", nsnPath);
  const res = await dibbsFetch(nsnPath);
  return res.body.toString("utf8");
}

// ── Step 4: Fetch PDF and extract text ──────────────────────────────────
async function fetchPdf(pdfPath) {
  if (!pdfPath) return null;
  const cleanPath = pdfPath.startsWith("/") ? pdfPath : "/" + pdfPath;
  console.log("[agent] Fetching PDF:", cleanPath);
  try {
    const res = await dibbsFetch(cleanPath);
    if (res.status !== 200) return null;
    // Return raw PDF bytes as base64 — SCC will display/process
    return res.body.toString("base64");
  } catch (e) {
    console.warn("[agent] PDF fetch failed:", e.message);
    return null;
  }
}

// ── HTML Parsers (ported from dibbs-sol.js) ─────────────────────────────
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
    amsc: "",
    pdf_path: "",
    source: "local-agent",
  };

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const rows = extractRows(cleaned);
  const fullText = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Dates
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

  // NSN + Item + Qty
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

  // Prices
  const unitPriceMatch = fullText.match(
    /[Uu]nit\s+[Pp]rice[^$\d]{0,20}\$?([\d,]+\.\d{2,4})/,
  );
  if (unitPriceMatch) sol.unit_price = unitPriceMatch[1].replace(/,/g, "");
  const histPriceMatch = fullText.match(
    /[Hh]ist(?:orical)?\s+(?:[Uu]nit\s+)?[Pp]rice[^$\d]{0,20}\$?([\d,]+\.\d{2,4})/,
  );
  if (histPriceMatch) sol.hist_unit_price = histPriceMatch[1].replace(/,/g, "");

  // Delivery / FOB / Set-aside
  const delMatch =
    fullText.match(/[Dd]elivery\s+[Dd]ays?[^0-9]{0,10}(\d{1,3})\b/) ||
    fullText.match(/(\d{1,3})\s+[Dd]ays?\s+ARO/i);
  if (delMatch) sol.delivery_days = delMatch[1];
  if (/FOB[:\s]+Dest/i.test(fullText)) sol.fob = "Dest.";
  else if (/FOB[:\s]+Orig/i.test(fullText)) sol.fob = "Orig.";
  const saMatch = fullText.match(
    /[Ss]et[\s\-][Aa]side[:\s]+([A-Za-z][A-Za-z\s]{1,40})(?:\s{2}|<)/,
  );
  if (saMatch) sol.set_aside = clean(saMatch[1]).slice(0, 40);

  // PDF path — look for .pdf link in the HTML
  const pdfMatch = html.match(/href="([^"]*\.pdf)"/i);
  if (pdfMatch) sol.pdf_path = pdfMatch[1];

  // Suppliers
  sol.suppliers = parseSuppliers(cleaned);

  return sol;
}

function parseNsnPage(html) {
  const result = { amsc: "", approved_sources: [] };
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const fullText = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // AMSC
  const amscMatch = fullText.match(/AMSC[:\s]+([A-Z])\b/);
  if (amscMatch) result.amsc = amscMatch[1];

  // Approved Sources from NSN page (more complete than sol page)
  result.approved_sources = parseSuppliers(cleaned);

  return result;
}

// ── Main handler ─────────────────────────────────────────────────────────
async function handleRequest(body) {
  const { sol_number } = body;
  if (!sol_number) return { ok: false, error: "sol_number required" };

  const solClean = sol_number.trim().toUpperCase();
  console.log("\n[agent] ── Processing:", solClean);

  try {
    // 1. Fetch sol page (handles banner automatically)
    const solHtml = await fetchSolPage(solClean);

    if (!solHtml || solHtml.length < 500) {
      return {
        ok: false,
        error: "Empty sol page — may be closed or removed",
        sol_number: solClean,
      };
    }
    if (/no solicitation found|rfq not found|does not exist/i.test(solHtml)) {
      return {
        ok: false,
        error: "Sol not found on DIBBS",
        sol_number: solClean,
      };
    }

    // 2. Parse sol page
    const sol = parseSolPage(solHtml, solClean);
    console.log("[agent] Parsed:", {
      nsn: sol.nsn,
      item: sol.item_description,
      qty: sol.qty,
      due: sol.due_date,
    });

    // 3. Fetch NSN page for AMSC + fuller approved source list
    if (sol.nsn) {
      try {
        const nsnHtml = await fetchNsnPage(sol.nsn);
        const nsnData = parseNsnPage(nsnHtml);
        if (nsnData.amsc) sol.amsc = nsnData.amsc;
        // Merge NSN-page suppliers (they often have more)
        if (nsnData.approved_sources.length > sol.suppliers.length) {
          sol.suppliers = nsnData.approved_sources;
        }
        console.log(
          "[agent] NSN AMSC:",
          sol.amsc,
          "| Sources:",
          sol.suppliers.length,
        );
      } catch (e) {
        console.warn("[agent] NSN fetch failed (non-fatal):", e.message);
      }
    }

    // 4. Fetch PDF (non-fatal if missing)
    let pdf_base64 = null;
    if (sol.pdf_path) {
      try {
        pdf_base64 = await fetchPdf(sol.pdf_path);
        console.log("[agent] PDF fetched:", pdf_base64 ? "yes" : "no");
      } catch (e) {
        console.warn("[agent] PDF fetch failed (non-fatal):", e.message);
      }
    }

    return { ok: true, sol, pdf_base64 };
  } catch (err) {
    console.error("[agent] Error:", err.message);
    return { ok: false, error: err.message, sol_number: solClean };
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Content-Type": "application/json",
};

loadCookies();

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, CORS);
    res.end(
      JSON.stringify({
        ok: true,
        status: "DIBBS Local Agent running",
        port: PORT,
        cookies: Object.keys(cookieJar).length,
      }),
    );
    return;
  }

  // Clear cookies (force re-banner)
  if (req.method === "POST" && req.url === "/clear-cookies") {
    cookieJar = {};
    saveCookies();
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, message: "Cookies cleared" }));
    return;
  }

  // Set cookies manually from browser session
  // POST body: { cookies: "ASP.NET_SessionId=xxx; othercookie=yyy" }
  if (req.method === "POST" && req.url === "/set-cookies") {
    let rawBody = "";
    req.on("data", (c) => (rawBody += c));
    req.on("end", () => {
      try {
        const { cookies } = JSON.parse(rawBody);
        if (!cookies) {
          res.writeHead(400, CORS);
          res.end(
            JSON.stringify({ ok: false, error: "cookies field required" }),
          );
          return;
        }
        // Parse and merge into jar
        const pairs = cookies.split(";");
        for (const pair of pairs) {
          const eq = pair.indexOf("=");
          if (eq < 0) continue;
          const k = pair.slice(0, eq).trim();
          const v = pair.slice(eq + 1).trim();
          if (k) cookieJar[k] = v;
        }
        saveCookies();
        console.log(
          "[agent] Browser cookies injected. Jar size:",
          Object.keys(cookieJar).length,
          Object.keys(cookieJar),
        );
        res.writeHead(200, CORS);
        res.end(
          JSON.stringify({
            ok: true,
            count: Object.keys(cookieJar).length,
            keys: Object.keys(cookieJar),
          }),
        );
      } catch (e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Main sol fetch endpoint
  if (req.method === "POST" && req.url === "/fetch-sol") {
    let rawBody = "";
    req.on("data", (c) => (rawBody += c));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
        return;
      }

      const result = await handleRequest(body);
      res.writeHead(result.ok ? 200 : 502, CORS);
      res.end(JSON.stringify(result));
    });
    return;
  }

  // ── /navigator/enrich ────────────────────────────────────────────────
  // POST { sols: [...] }
  // Launches Puppeteer, navigates to DIBBS, clicks the DoD banner,
  // then fetches each NSN page in the authenticated browser session.
  // Returns enriched sols with AMSC + approved_sources.
  // Hard-rejects AMSC G/B/A and blocked CAGEs inline.
  // SSE stream — same format as /navigator/scrape so dibbs-tab can log progress.
  if (req.method === "POST" && req.url === "/navigator/enrich") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (payload) => {
      try {
        res.write("data: " + JSON.stringify(payload) + "\n\n");
        // Also log to agent console so terminal shows progress
        if (payload.type === "log") console.log("[enrich]", payload.msg);
      } catch {}
    };

    // Keep-alive ping every 15s
    const keepAlive = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
      } catch {
        clearInterval(keepAlive);
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(keepAlive);
    };
    req.on("close", cleanup);

    let rawBody = "";
    req.on("data", (c) => (rawBody += c));
    req.on("end", async () => {
      let sols;
      try {
        ({ sols } = JSON.parse(rawBody));
        if (!Array.isArray(sols) || !sols.length)
          throw new Error("sols array required");
      } catch (e) {
        send({ type: "result", ok: false, error: e.message });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        return;
      }

      const BLOCKED_CAGES = ["81SA7", "R9004", "07482", "062W0"];
      const BLOCKED_AMSC = ["G", "B", "A"];
      const HARD_SA = /^(FG|PO|FI|H|L|E)$/i;

      let puppeteer, browser;
      try {
        puppeteer = require("puppeteer");
      } catch (e) {
        send({
          type: "result",
          ok: false,
          error: "puppeteer not found: " + e.message,
        });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        return;
      }

      try {
        send({
          type: "log",
          msg: "Launching browser for DIBBS enrichment...",
          level: "info",
        });

        browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        });

        const page = await browser.newPage();
        page.setDefaultTimeout(30000);

        // ── Navigate to DIBBS and accept the DoD banner ──────────────
        send({ type: "log", msg: "Navigating to DIBBS...", level: "info" });
        await page.goto(
          "https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx?value=5940013763668&category=&Scope=",
          { waitUntil: "domcontentloaded", timeout: 60000 },
        );
        send({ type: "log", msg: "DIBBS page loaded", level: "info" });

        // Click banner if present
        try {
          await page.waitForSelector("#butAgree", { timeout: 8000 });
          await Promise.all([
            page.waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 20000,
            }),
            page.click("#butAgree"),
          ]);
          send({ type: "log", msg: "✅ DIBBS banner accepted", level: "ok" });
        } catch {
          send({
            type: "log",
            msg: "No banner — session active",
            level: "info",
          });
        }

        // ── Loop NSN pages ────────────────────────────────────────────
        const results = [];
        let enriched = 0,
          rejected = 0,
          errors = 0;
        const total = sols.length;

        for (let i = 0; i < sols.length; i++) {
          const sol = sols[i];
          const out = { ...sol, amsc: "", approved_sources: [], reject: null };

          // Hard reject: set-aside
          const sa = (sol.set_aside || "").toUpperCase().trim();
          if (HARD_SA.test(sa)) {
            out.reject = "Set-aside ineligible: " + sa;
            rejected++;
            results.push(out);
            continue;
          }

          // Hard reject: AIDC
          if (/AIDC/i.test(sol.supplier_restrictions || "")) {
            out.reject = "AIDC — no certification";
            rejected++;
            results.push(out);
            continue;
          }

          // Need NSN
          if (!sol.nsn || sol.nsn.length < 13) {
            out.reject = "No NSN — cannot enrich";
            rejected++;
            results.push(out);
            continue;
          }

          try {
            const nsnUrl = `https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx?value=${sol.nsn}&category=&Scope=`;
            await page.goto(nsnUrl, {
              waitUntil: "domcontentloaded",
              timeout: 20000,
            });

            // If banner appeared again, click it
            const bannerVisible = await page.$("#butAgree");
            if (bannerVisible) {
              await Promise.all([
                page.waitForNavigation({
                  waitUntil: "domcontentloaded",
                  timeout: 20000,
                }),
                page.click("#butAgree"),
              ]);
            }

            const html = await page.content();

            // Parse AMSC
            const amscMatch = html
              .replace(/<[^>]+>/g, " ")
              .match(/AMSC[:\s]+([A-Z])\b/);
            out.amsc = amscMatch ? amscMatch[1] : "";

            // Parse approved sources
            out.approved_sources = parseSuppliers(html);

            // Hard reject: AMSC lock
            if (BLOCKED_AMSC.includes(out.amsc.toUpperCase())) {
              out.reject =
                "AMSC:" + out.amsc + " — Government drawing/sole source lock";
              rejected++;
              results.push(out);
              continue;
            }

            // Hard reject: blocked CAGE
            const blockedCage = out.approved_sources.find((s) =>
              BLOCKED_CAGES.includes((s.cage || "").toUpperCase()),
            );
            if (blockedCage) {
              out.reject = "Blocked CAGE: " + blockedCage.cage;
              rejected++;
              results.push(out);
              continue;
            }

            enriched++;
            if ((i + 1) % 10 === 0 || i === total - 1) {
              send({
                type: "log",
                msg: `Enriched ${i + 1}/${total} — AMSC: ${out.amsc || "N/A"} | Sources: ${out.approved_sources.length}`,
                level: "info",
              });
            }
          } catch (e) {
            out.enrich_error = e.message;
            errors++;
            console.warn(
              "[agent] NSN fetch failed for",
              sol.sol_number,
              ":",
              e.message,
            );
          }

          results.push(out);
        }

        await browser.close();

        send({
          type: "log",
          msg: `✅ Enrichment complete — ${enriched} enriched · ${rejected} rejected · ${errors} errors`,
          level: "ok",
        });
        send({
          type: "result",
          ok: true,
          sols: results,
          enriched,
          rejected,
          errors,
        });
      } catch (e) {
        if (browser)
          try {
            await browser.close();
          } catch {}
        send({
          type: "log",
          msg: "Enrichment failed: " + e.message,
          level: "err",
        });
        send({ type: "result", ok: false, error: e.message });
      }

      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
    });
    return;
  }

  // ── /navigator/analyze ───────────────────────────────────────────────
  // POST { sols: [...] }
  // Runs Claude Sonnet (with GPT-4o fallback) on the local machine.
  // No Netlify timeout. Reads keys from .env.
  // SSE stream — sends batch progress + final result.
  if (req.method === "POST" && req.url === "/navigator/analyze") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (payload) => {
      try {
        res.write("data: " + JSON.stringify(payload) + "\n\n");
        if (payload.type === "log") console.log("[analyze]", payload.msg);
      } catch {}
    };

    const keepAlive = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
      } catch {
        clearInterval(keepAlive);
      }
    }, 15000);

    const cleanup = () => clearInterval(keepAlive);
    req.on("close", cleanup);

    let rawBody = "";
    req.on("data", (c) => (rawBody += c));
    req.on("end", async () => {
      let sols, body;
      try {
        body = JSON.parse(rawBody);
        sols = body.sols;
        if (!Array.isArray(sols) || !sols.length)
          throw new Error("sols array required");
      } catch (e) {
        send({ type: "result", ok: false, error: e.message });
        res.write("data: [DONE]\n\n");
        res.end();
        cleanup();
        return;
      }

      // ── Load keys from request body (set in SCC UI) or fall back to .env
      const dotenv = require("dotenv");
      dotenv.config();
      const ANTHROPIC_KEY =
        body._anthropic_key || process.env.ANTHROPIC_API_KEY;
      const OPENAI_KEY = body._openai_key || process.env.OPENAI_API_KEY;

      const SYSTEM_PROMPT = `You are a senior procurement analyst for Imperio Federal Logistics (CAGE 152U4), an SDVOSB federal supply contractor specializing in DLA DIBBS COTS resale.

For each solicitation, apply the full procurement protocol:

HARD REJECT (output verdict: REJECT) if ANY of:
- Set-aside codes: AL (AbilityOne), FG, PO, FI, H (HUBZone), L, E — ineligible
- AMSC: G, B, or A — government drawing / sole source lock
- AIDC flag in item name
- Blocked CAGEs in supplier_restrictions: 81SA7, R9004, 07482, 062W0, 75Q65
- Blocked OEMs in item name: SureFire, Streamlight, Furuno TZT9F
- QA = QSL
- Restricted drawings with no COTS path
- Prime-dominated FSCs with no resale channel: 1305,1310,1315,1320,1340,1350,1360,1376,2835,2840,1560,1720,1730,5860

GO (verdict: GO) if:
- Passes all hard reject gates
- Item is sourceable via commercial distributor channel (COTS path exists)
- Historical unit price supports 27.5%+ gross margin at 90% cost ceiling
- Net after worst-case FE fees (7.5%) exceeds $500
- Delivery window is achievable (standard commercial lead times)

VERIFY FIRST (verdict: VERIFY FIRST) if:
- Passes hard rejects but has one of: tight margin, spec-designator risk (MS-/MIL-/NAS-/AN- prefix), single approved source that may have dealer channel, short quote deadline, delivery risk

For each sol output a JSON object with:
{
  "sol_number": "...",
  "verdict": "GO" | "VERIFY FIRST" | "REJECT",
  "reason": "one-line plain English reason",
  "sourcing_path": "brief sourcing note for GO/VERIFY (skip for REJECT)",
  "margin_flag": "ok" | "tight" | "blocked",
  "winProbabilityPct": 0-100
}

Return ONLY a JSON array. No markdown, no preamble, no backticks.`;

      function parseJson(raw) {
        return JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, "").trim());
      }

      function isQuotaErr(status) {
        return (
          status === 429 || status === 529 || status === 503 || status === 402
        );
      }

      async function callClaude(batch) {
        if (!ANTHROPIC_KEY)
          throw Object.assign(new Error("ANTHROPIC_API_KEY not in .env"), {
            status: 500,
          });
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content:
                  "Analyze this batch of DLA DIBBS solicitations:\n\n" +
                  JSON.stringify(batch, null, 2),
              },
            ],
          }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw Object.assign(
            new Error("Claude " + r.status + ": " + t.slice(0, 200)),
            { status: r.status },
          );
        }
        const d = await r.json();
        return parseJson(
          (d.content || [])
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join(""),
        );
      }

      async function callGPT(batch) {
        if (!OPENAI_KEY)
          throw Object.assign(new Error("OPENAI_API_KEY not in .env"), {
            status: 500,
          });
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + OPENAI_KEY,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            max_tokens: 4000,
            temperature: 0,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content:
                  "Analyze this batch of DLA DIBBS solicitations:\n\n" +
                  JSON.stringify(batch, null, 2),
              },
            ],
          }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw Object.assign(
            new Error("OpenAI " + r.status + ": " + t.slice(0, 200)),
            { status: r.status },
          );
        }
        const d = await r.json();
        return parseJson(d.choices?.[0]?.message?.content || "");
      }

      // ── Chunk + run ───────────────────────────────────────────────────
      const CHUNK = 25;
      const chunks = [];
      for (let i = 0; i < sols.length; i += CHUNK)
        chunks.push(sols.slice(i, i + CHUNK));

      send({
        type: "log",
        msg:
          "Sending " +
          sols.length +
          " sols in " +
          chunks.length +
          " batches...",
        level: "info",
      });

      const allResults = [];
      let provider = "claude";

      try {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          send({
            type: "log",
            msg:
              "Batch " +
              (i + 1) +
              "/" +
              chunks.length +
              " (" +
              chunk.length +
              " sols)...",
            level: "info",
          });

          let results;
          try {
            results = await callClaude(chunk);
            provider = "claude";
          } catch (claudeErr) {
            if (!isQuotaErr(claudeErr.status)) throw claudeErr;
            send({
              type: "log",
              msg: "Claude quota — trying GPT-4o...",
              level: "err",
            });
            results = await callGPT(chunk);
            provider = "gpt-4o";
          }

          allResults.push(...results);
          send({
            type: "log",
            msg: "✅ Batch " + (i + 1) + " complete via " + provider,
            level: "ok",
          });
        }

        send({ type: "result", ok: true, results: allResults, provider });
      } catch (e) {
        send({
          type: "log",
          msg: "Analysis failed: " + e.message,
          level: "err",
        });
        send({ type: "result", ok: false, error: e.message });
      }

      res.write("data: [DONE]\n\n");
      res.end();
      cleanup();
    });
    return;
  }

  // ── /navigator/batch ──────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/navigator/batch") {
    let rawBody = "";
    req.on("data", (c) => (rawBody += c));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
        return;
      }
      const sols = body.sols || [];
      if (!sols.length) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: "sols array required" }));
        return;
      }
      const BLOCKED_CAGES = ["81SA7", "R9004", "07482", "062W0"];
      const BLOCKED_AMSC = ["G", "B", "A"];
      const HARD_SA = /^(FG|PO|FI|H|L|E)$/i;
      console.log("[agent] /navigator/batch — enriching", sols.length, "sols");
      const results = [];
      let enriched = 0,
        rejected = 0,
        errors = 0;
      for (const sol of sols) {
        const out = { ...sol, amsc: "", approved_sources: [], reject: null };
        const sa = (sol.set_aside || "").toUpperCase().trim();
        if (HARD_SA.test(sa)) {
          out.reject = "Set-aside ineligible: " + sa;
          rejected++;
          results.push(out);
          continue;
        }
        if (/AIDC/i.test(sol.supplier_restrictions || "")) {
          out.reject = "AIDC — no certification";
          rejected++;
          results.push(out);
          continue;
        }
        if (!sol.nsn || sol.nsn.length < 13) {
          out.reject = "No NSN — cannot enrich";
          rejected++;
          results.push(out);
          continue;
        }
        try {
          const nsnHtml = await fetchNsnPage(sol.nsn);
          const nsnData = parseNsnPage(nsnHtml);
          out.amsc = nsnData.amsc || "";
          out.approved_sources = nsnData.approved_sources || [];
          if (BLOCKED_AMSC.includes(out.amsc.toUpperCase())) {
            out.reject =
              "AMSC:" + out.amsc + " — Government drawing/sole source lock";
            rejected++;
            results.push(out);
            continue;
          }
          const blockedCage = out.approved_sources.find((s) =>
            BLOCKED_CAGES.includes((s.cage || "").toUpperCase()),
          );
          if (blockedCage) {
            out.reject = "Blocked CAGE: " + blockedCage.cage;
            rejected++;
            results.push(out);
            continue;
          }
          enriched++;
          console.log(
            "[agent] ✅",
            sol.sol_number,
            "| AMSC:",
            out.amsc || "N/A",
            "| Sources:",
            out.approved_sources.length,
          );
        } catch (e) {
          out.enrich_error = e.message;
          errors++;
          console.warn(
            "[agent] ⚠️ NSN fetch failed for",
            sol.sol_number,
            ":",
            e.message,
          );
        }
        results.push(out);
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log(
        "[agent] /navigator/batch complete — enriched:",
        enriched,
        "| rejected:",
        rejected,
        "| errors:",
        errors,
      );
      res.writeHead(200, CORS);
      res.end(
        JSON.stringify({
          ok: true,
          total: sols.length,
          enriched,
          rejected,
          errors,
          sols: results,
        }),
      );
    });
    return;
  }

  // ── /navigator/scrape ─────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/navigator/scrape") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (payload) => {
      try {
        res.write("data: " + JSON.stringify(payload) + "\n\n");
      } catch {}
    };
    send({ type: "log", msg: "Navigator scrape initiated", level: "info" });
    const origLog = console.log;
    const origError = console.error;
    const patchLog = (...args) => {
      origLog(...args);
      const msg = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      const level = msg.includes("❌")
        ? "err"
        : msg.includes("✅")
          ? "ok"
          : "info";
      send({
        type: "log",
        msg: msg.replace("[navigator-scraper] ", ""),
        level,
      });
    };
    const patchErr = (...args) => {
      origError(...args);
      const msg = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      send({
        type: "log",
        msg: msg.replace("[navigator-scraper] ", ""),
        level: "err",
      });
    };
    console.log = patchLog;
    console.error = patchErr;
    let scraper;
    try {
      delete require.cache[require.resolve("./navigator-scraper")];
      scraper = require("./navigator-scraper");
    } catch (e) {
      console.log = origLog;
      console.error = origError;
      send({
        type: "log",
        msg: "navigator-scraper.js not found: " + e.message,
        level: "err",
      });
      send({
        type: "result",
        ok: false,
        error: "navigator-scraper.js not found",
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    scraper
      .scrapeNavigatorBatch()
      .then((result) => {
        console.log = origLog;
        console.error = origError;
        if (result.ok) {
          send({
            type: "result",
            ok: true,
            sols: result.sols,
            count: result.count,
            pass1: result.pass1,
            pass2: result.pass2 || 0,
            backupPath: result.backupPath,
          });
        } else {
          send({
            type: "result",
            ok: false,
            error: result.error || "Scrape failed",
          });
        }
        res.write("data: [DONE]\n\n");
        res.end();
      })
      .catch((e) => {
        console.log = origLog;
        console.error = origError;
        send({ type: "log", msg: "Fatal: " + e.message, level: "err" });
        send({ type: "result", ok: false, error: e.message });
        res.write("data: [DONE]\n\n");
        res.end();
      });
    const keepAlive = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
      } catch {
        clearInterval(keepAlive);
      }
    }, 20000);
    req.on("close", () => {
      clearInterval(keepAlive);
      console.log = origLog;
      console.error = origError;
    });
    return;
  }

  // ── /chat ────────────────────────────────────────────────────────────
  // POST { messages: [...], system: "...", key: "sk-ant-..." }
  // Proxies to Claude API — no CORS, key never in browser network tab.
  if (req.method === "POST" && req.url === "/chat") {
    let rawBody = "";
    req.on("data", (c) => (rawBody += c));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
        return;
      }

      const dotenv = require("dotenv");
      dotenv.config();
      const apiKey = body.key || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: "No API key" }));
        return;
      }

      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            system: body.system || "",
            messages: body.messages || [],
          }),
        });
        const data = await resp.json();
        res.writeHead(resp.ok ? 200 : 502, CORS);
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(502, CORS);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ ok: false, error: "Unknown endpoint" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   IMPERIO — DIBBS LOCAL AGENT  v1.0             ║");
  console.log("║   Listening on http://localhost:" + PORT + "            ║");
  console.log("║   Health: http://localhost:" + PORT + "/health          ║");
  console.log("║   Stop: Ctrl+C or close this window             ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");
  console.log(
    "[agent] Cookie jar:",
    Object.keys(cookieJar).length,
    "stored cookies",
  );
  console.log("[agent] Ready.\n");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      "[agent] ERROR: Port 3100 already in use. Close the other instance first.",
    );
  } else {
    console.error("[agent] Server error:", err.message);
  }
  process.exit(1);
});
