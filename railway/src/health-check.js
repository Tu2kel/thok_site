// src/health-check.js — SCC pipeline component health checker
// Tests every external dependency with a live probe. Returns a structured
// report and optionally emails anthony@ifedlog.com when components are red.

const { sendEmailResend } = require("./email");

function info(...a) { console.log("[health-check]", ...a); }

// ── Individual probes ─────────────────────────────────────────────────────────

async function checkMongo(db) {
  try {
    await db.collection("_meta").findOne({ _id: "health_ping" });
    return { ok: true, msg: "Connected" };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function checkSamApi() {
  const key = process.env.SAM_API_KEY;
  if (!key) return { ok: false, msg: "SAM_API_KEY not set" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const today = new Date();
    const from  = new Date(today); from.setDate(from.getDate() - 3);
    const fmt   = d => (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0") + "/" + d.getFullYear();
    const res = await fetch(
      "https://api.sam.gov/opportunities/v2/search?api_key=" + key + "&active=Yes&classificationCode=5305&postedFrom=" + fmt(from) + "&postedTo=" + fmt(today) + "&limit=1",
      { headers: { Accept: "application/json" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, msg: "HTTP " + res.status + ": " + body.slice(0, 100) };
    }
    const data = await res.json();
    const count = data.totalRecords || 0;
    return { ok: true, msg: "Reachable — " + count + " total DLA records" };
  } catch (e) {
    return { ok: false, msg: e.name === "AbortError" ? "Timeout (15s)" : e.message };
  }
}

async function checkDibbsPdf() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch("https://dibbs2.bsm.dla.mil/", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok || res.status === 302 || res.redirected
      ? { ok: true, msg: "Reachable (HTTP " + res.status + ")" }
      : { ok: false, msg: "HTTP " + res.status };
  } catch (e) {
    return { ok: false, msg: e.name === "AbortError" ? "Timeout (15s)" : e.message };
  }
}

async function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, msg: "ANTHROPIC_API_KEY not set" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 401) return { ok: false, msg: "API key invalid or expired" };
    return res.ok ? { ok: true, msg: "Key valid" } : { ok: false, msg: "HTTP " + res.status };
  } catch (e) {
    return { ok: false, msg: e.name === "AbortError" ? "Timeout (15s)" : e.message };
  }
}

async function checkResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, msg: "RESEND_API_KEY not set" };
  if (!key.startsWith("re_")) return { ok: false, msg: "Key format invalid (expected re_...)" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    // /emails endpoint works with send-only keys; /domains requires domain permissions
    const res = await fetch("https://api.resend.com/emails?limit=1", {
      headers: { Authorization: "Bearer " + key },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) return { ok: false, msg: "API key invalid or unauthorized" };
    return (res.ok || res.status === 200) ? { ok: true, msg: "Key valid" } : { ok: false, msg: "HTTP " + res.status };
  } catch (e) {
    return { ok: false, msg: e.name === "AbortError" ? "Timeout (10s)" : e.message };
  }
}

async function checkGmail() {
  const pass = process.env.IFEDLOG_APP_PASSWORD;
  if (!pass) return { ok: false, msg: "IFEDLOG_APP_PASSWORD not set" };
  try {
    const { ImapFlow } = require("imapflow");
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: "anthony@ifedlog.com", pass },
      logger: false,
    });
    await client.connect();
    await client.logout();
    return { ok: true, msg: "IMAP connected (anthony@ifedlog.com)" };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function checkBlastState(db) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const resendLimit = parseInt(process.env.RESEND_DAILY_LIMIT || "5000");
    const [cursor, resendDoc, ctrl] = await Promise.all([
      db.collection("_meta").findOne({ _id: "blast_cursor" }),
      db.collection("_meta").findOne({ _id: "resend_daily" }),
      db.collection("_meta").findOne({ _id: "blast_control" }),
    ]);
    const resendSent = (resendDoc && resendDoc.date === today) ? (resendDoc.count || 0) : 0;
    const paused     = !!(ctrl && ctrl.paused);
    const lastVendor = cursor ? cursor.last_vendor_id : null;
    return {
      ok: true,
      msg: "Resend " + resendSent + "/" + resendLimit + (paused ? " · PAUSED" : "") + (lastVendor ? " · cursor: " + lastVendor : " · no cursor"),
      paused,
      resend_sent: resendSent,
    };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function runHealthCheck(db, { emailOnFailure = false } = {}) {
  info("Running pipeline health check…");
  const started = Date.now();

  const [mongo, sam, dibbs, anthropic, resend, gmail, blast] = await Promise.all([
    checkMongo(db),
    checkSamApi(),
    checkDibbsPdf(),
    checkAnthropic(),
    checkResend(),
    checkGmail(),
    checkBlastState(db),
  ]);

  const checks = {
    mongodb:    mongo,
    sam_api:    sam,
    dibbs:      dibbs,
    anthropic:  anthropic,
    resend:     resend,
    gmail_imap: gmail,
    blast:      blast,
  };

  const failures = Object.entries(checks).filter(([, v]) => !v.ok);
  const allOk    = failures.length === 0;
  const elapsed  = Date.now() - started;

  const lines = Object.entries(checks).map(([k, v]) =>
    (v.ok ? "✅" : "❌") + " " + k.padEnd(12) + " — " + v.msg,
  );

  const report = [
    "SCC Health Check — " + new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT",
    "=".repeat(60),
    ...lines,
    "=".repeat(60),
    allOk ? "All systems go ✅" : failures.length + " component(s) DOWN ❌",
    "Check took " + elapsed + "ms",
  ].join("\n");

  info("\n" + report);

  if (!allOk && emailOnFailure) {
    try {
      await sendEmailResend({
        to: "anthony@ifedlog.com",
        subject: "🚨 SCC Alert: " + failures.length + " component(s) down — " + failures.map(([k]) => k).join(", "),
        body: report,
      });
      info("Alert email sent to anthony@ifedlog.com");
    } catch (e) {
      info("Failed to send alert email: " + e.message);
    }
  }

  return { ok: allOk, checks, report, elapsed_ms: elapsed };
}

module.exports = { runHealthCheck };
