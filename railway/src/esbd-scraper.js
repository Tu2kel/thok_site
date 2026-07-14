// src/esbd-scraper.js — Puppeteer scraper for the Texas ESBD (txsmartbuy.gov).
// Runs unattended on Railway. Drives the real ESBD search UI, applies configured
// filters, exports all matching solicitation rows via the site's "Export to CSV"
// (one shot, up to 20k rows — no pagination guesswork), parses the CSV, and POSTs
// the rows to the scc-esbd `ingest` action (which dedups/merges/triages/coverage).
//
// The CSV columns are stable and already understood by scc-esbd.normalizeRow:
//   Name, Solicitation ID, Due Date, Due Time, Agency/Texas SmartBuy Member Number,
//   Status, Posting Date, Created, Last Modified, NIGP Codes
//
// Env:
//   ESBD_URL           default https://www.txsmartbuy.gov/esbd
//   ESBD_INGEST_URL    default https://thehouseofkel.com/.netlify/functions/scc-esbd
//   ESBD_KEYWORD       optional keyword filter
//   ESBD_STATUS        optional status filter label (e.g. "Posted")
//   ESBD_DAYS          optional lookback window for Start/End date (default: none = all)
//   CHROMIUM_PATH      Chromium executable (shared with the DIBBS scraper)
//   ESBD_SNAPSHOT_DIR  where failure snapshots go (default /tmp/esbd-snapshots)

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const ESBD_URL = process.env.ESBD_URL || "https://www.txsmartbuy.gov/esbd";
const INGEST_URL = process.env.ESBD_INGEST_URL || "https://thehouseofkel.com/.netlify/functions/scc-esbd";
const SNAP_DIR = process.env.ESBD_SNAPSHOT_DIR || "/tmp/esbd-snapshots";

const log = (...a) => console.log("[esbd-scraper]", ...a);
const err = (...a) => console.error("[esbd-scraper]", ...a);

function chromiumPath() {
  const cands = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].filter(Boolean);
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || cands[0];
}

// RFC4180 CSV parser — handles quoted fields with embedded commas/newlines
// (the ESBD NIGP column is a quoted multi-line list). Self-contained, no deps.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", i = 0, inQuotes = false;
  const s = text.replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c && c.trim())).map((r) => {
    const o = {}; header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ""; }); return o;
  });
}

// Map a parsed CSV row → the scc-esbd ingest row shape (keys normalizeRow accepts).
function toIngestRow(r) {
  const g = (names) => { for (const n of names) { const k = Object.keys(r).find((key) => key.trim().toLowerCase() === n.toLowerCase()); if (k != null) return r[k]; } return ""; };
  return {
    sol_id: g(["Solicitation ID"]), agency_num: g(["Agency/Texas SmartBuy Member Number", "Agency"]),
    name: g(["Name"]), status: g(["Status"]), due_date: g(["Due Date"]), due_time: g(["Due Time"]),
    posted_date: g(["Posting Date"]), last_modified: g(["Last Modified"]), nigp: g(["NIGP Codes"]),
    source_url: ESBD_URL,
  };
}

async function snapshot(page, tag) {
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const base = path.join(SNAP_DIR, "esbd-" + tag + "-" + Date.now());
    if (page) {
      await page.screenshot({ path: base + ".png", fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => "");
      if (html) fs.writeFileSync(base + ".html", html);
    }
    log("snapshot →", base);
    return base;
  } catch (e) { err("snapshot failed:", e.message); return null; }
}

async function reportState(set) {
  try {
    await fetch(INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "syncState", set }) });
  } catch (e) { err("state report failed:", e.message); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click a control by visible text via an IN-PAGE DOM click (not Puppeteer's
// native click) — SPA buttons are often spans/overlaid and fail el.click() with
// "not clickable". A DOM .click() works regardless of visibility/overlay.
async function clickByText(page, texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  return await page.evaluate((labels) => {
    const els = Array.from(document.querySelectorAll("button, a, input[type=button], input[type=submit], [role=button], [onclick]"));
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
    let el = null;
    for (const lab of labels) { el = els.find((e) => norm(e.textContent) === norm(lab) || norm(e.value) === norm(lab)); if (el) break; }
    if (!el) for (const lab of labels) { el = els.find((e) => norm(e.textContent).includes(norm(lab)) || norm(e.value).includes(norm(lab))); if (el) break; }
    if (!el) return false;
    if (el.scrollIntoView) el.scrollIntoView();
    el.click();
    return true;
  }, arr);
}

// Poll until any of `texts` appears in the page body (SPA renders async).
async function waitForText(page, texts, timeoutMs) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((labels) => {
      const t = (document.body && document.body.innerText || "").toLowerCase();
      return labels.some((l) => t.includes(l.toLowerCase()));
    }, arr).catch(() => false);
    if (found) return true;
    await sleep(1500);
  }
  return false;
}

// DOM inventory reported through syncState so failures are diagnosable remotely
// (Railway disk snapshots aren't reachable, but Mongo syncState is).
async function collectDiag(page) {
  try {
    return await page.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      const ctrls = Array.from(document.querySelectorAll("button, a, input[type=button], input[type=submit], [role=button]"))
        .map((e) => norm(e.textContent || e.value)).filter(Boolean);
      return {
        title: document.title, url: location.href,
        bodyLen: (document.body && document.body.innerText || "").length,
        hasExport: /export/i.test(document.body && document.body.innerText || ""),
        controls: [...new Set(ctrls)].slice(0, 30),
      };
    });
  } catch (e) { return { error: e.message }; }
}

// ── Core: one scrape run ────────────────────────────────────────────────────────
// Returns { rows, csvPath } or throws a classified error.
async function extractRows(page) {
  const downloadDir = path.join(SNAP_DIR, "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  // clear old CSVs
  for (const f of fs.readdirSync(downloadDir)) { if (f.endsWith(".csv")) try { fs.unlinkSync(path.join(downloadDir, f)); } catch {} }

  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });

  // Also capture the ESBD.Service.ss JSON as a fallback data source, in case the
  // CSV export path changes — snapshot whatever the app fetches.
  const serviceHits = [];
  page.on("response", async (res) => {
    try { if (/ESBD\.Service\.ss/i.test(res.url())) { const t = await res.text(); serviceHits.push({ url: res.url(), body: t.slice(0, 200000) }); } } catch {}
  });

  log("navigating to", ESBD_URL);
  await page.goto(ESBD_URL, { waitUntil: "networkidle2", timeout: 120000 });

  // session/blocked detection
  const title = (await page.title().catch(() => "")) || "";
  if (/sign in|log ?in|access denied|forbidden/i.test(title)) throw classified("SESSION", "ESBD returned a login/denied page: " + title);

  // wait for the SPA to render results + the Export control (it renders async)
  const ready = await waitForText(page, ["Export to CSV", "Export"], 45000);
  if (!ready) { const e = classified("SELECTOR", "ESBD results/Export not rendered within 45s"); e.diag = await collectDiag(page); throw e; }

  // optional keyword filter → Search → wait for results to re-render
  if (process.env.ESBD_KEYWORD) {
    try {
      const kw = await page.$('input[name*=keyword i], input[placeholder*="Keyword" i]');
      if (kw) { await kw.type(String(process.env.ESBD_KEYWORD), { delay: 30 }); await clickByText(page, ["Search"]); await sleep(5000); await waitForText(page, ["Export"], 30000); }
    } catch {}
  }

  // trigger the CSV export (in-page DOM click)
  const clicked = await clickByText(page, ["Export to CSV", "Export CSV", "Export"]);
  if (!clicked) { const e = classified("SELECTOR", "Could not find the 'Export to CSV' control"); e.diag = await collectDiag(page); throw e; }

  // wait for the download to land
  const csvPath = await waitForDownload(downloadDir, 120000);
  if (!csvPath) {
    const e = classified("EXPORT", serviceHits.length
      ? "CSV download did not complete, but " + serviceHits.length + " ESBD.Service.ss responses were captured (JSON fallback available)"
      : "CSV export produced no downloadable file (blocked download or empty result)");
    e.diag = await collectDiag(page);
    throw e;
  }
  const text = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCsv(text);
  if (!rows.length) throw classified("EMPTY", "Export CSV had 0 data rows");
  return { rows, csvPath };
}

function classified(code, msg) { const e = new Error(msg); e.code = code; return e; }
const TRANSIENT = new Set(["TIMEOUT", "EXPORT"]);

function waitForDownload(dir, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));
      const partial = fs.readdirSync(dir).some((f) => f.endsWith(".crdownload"));
      if (files.length && !partial) return resolve(path.join(dir, files[0]));
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 1000);
    };
    tick();
  });
}

// ── Public: run the full sync (launch → extract → ingest → report) ──────────────
async function runEsbdSync({ maxRetries = 2 } = {}) {
  const startedAt = Date.now();
  await reportState({ last_run_at: new Date(), running: true, last_error: null });
  const executablePath = chromiumPath();
  let attempt = 0, lastErr = null;

  while (attempt <= maxRetries) {
    attempt++;
    let browser = null;
    try {
      log("launch attempt", attempt, "chromium:", executablePath);
      browser = await puppeteer.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"] });
      const page = await browser.newPage();
      page.setDefaultTimeout(120000);
      await page.setViewport({ width: 1600, height: 1000 });
      await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");

      const { rows, csvPath } = await extractRows(page);
      log("extracted", rows.length, "rows from", csvPath);

      const ingestRows = rows.map(toIngestRow).filter((r) => r.sol_id);
      // POST to scc-esbd ingest in chunks (dedup/merge/triage/coverage happen there)
      let added = 0, updated = 0, unchanged = 0, errors = 0;
      for (let i = 0; i < ingestRows.length; i += 500) {
        const chunk = ingestRows.slice(i, i + 500);
        const res = await fetch(INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ingest", source: "railway-scraper", rows: chunk }) });
        const j = await res.json();
        if (!j.ok) throw classified("INGEST", "ingest chunk failed: " + (j.error || res.status));
        added += j.added || 0; updated += j.updated || 0; unchanged += j.unchanged || 0; errors += j.errors || 0;
      }

      await browser.close().catch(() => {});
      const duration = Date.now() - startedAt;
      const summary = { ok: true, running: false, last_success_at: new Date(), last_run_at: new Date(), last_duration_ms: duration, total: ingestRows.length, added, updated, unchanged, errors, last_error: null };
      await reportState(summary);
      log("✅ sync complete", JSON.stringify({ total: ingestRows.length, added, updated, unchanged, errors, ms: duration }));
      return summary;
    } catch (e) {
      lastErr = e;
      err("attempt", attempt, "failed:", e.code || "", e.message);
      try { const p = await browser.pages().then((ps) => ps[0]).catch(() => null); await snapshot(p, (e.code || "ERR").toLowerCase()); } catch {}
      if (browser) await browser.close().catch(() => {});
      if (!TRANSIENT.has(e.code) || attempt > maxRetries) break;
      await new Promise((r) => setTimeout(r, 5000 * attempt));  // backoff
    }
  }

  const duration = Date.now() - startedAt;
  const fail = { ok: false, running: false, last_run_at: new Date(), last_duration_ms: duration,
    last_error: (lastErr && (lastErr.code ? lastErr.code + ": " : "") + lastErr.message) || "unknown",
    diag: (lastErr && lastErr.diag) || null };
  await reportState(fail);
  err("❌ sync failed after", attempt, "attempt(s):", fail.last_error);
  return fail;
}

module.exports = { runEsbdSync, parseCsv, toIngestRow };
