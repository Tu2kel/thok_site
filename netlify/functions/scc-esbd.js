// netlify/functions/scc-esbd.js — SLED/ESBD opportunity store + ingestion engine
// Mongo is the source of truth for SLED opportunities. This function ingests
// ESBD rows (from the CSV import today, the Railway scraper next), dedups/merges
// by (solicitation id + agency), PRESERVES our internal fields on re-sync,
// auto-triages via the shared NIGP crosswalk, computes distributor coverage,
// flags new/materially-changed opportunities, and records a sync log.
//
// Actions (POST { action, ... }):
//   ingest    { rows:[...], source } → dedup/merge/triage/coverage, sync-log
//   list      { verdict?, state?, status?, changedOnly?, limit? } → opportunities
//   get       { id }                → one opportunity (with history)
//   update    { id, fields }        → set internal fields (status/notes/pricing/…)
//   syncLog   { limit? }            → recent sync runs (incl. failures/errors)
//   clearFlags{ ids? }              → clear is_new / changed flags after review

const { MongoClient } = require("mongodb");
const NIGP = require("../../scc/core/nigp-map.js");

const OPPS = "esbd_opportunities";
const LOG  = "esbd_sync_log";

let _client = null;
async function getDb() {
  if (!_client) _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await _client.connect();
  return _client.db();
}

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const ok  = (b) => ({ statusCode: 200, headers: H, body: JSON.stringify(b) });
const bad = (c, e) => ({ statusCode: c, headers: H, body: JSON.stringify({ ok: false, error: e }) });

// Fields the scraper/import owns (safe to overwrite every sync).
const SCRAPED = ["name", "agency_num", "esbd_status", "due_date", "due_at", "due_time", "posted_date",
  "nigp", "contact_name", "contact_email", "contact_phone", "delivery_addr", "documents",
  "source_url", "last_modified"];
// Fields WE own — set once, never clobbered by re-sync (only via `update`).
const INTERNAL = ["internal_status", "notes", "suppliers", "est_cost", "margin_pct",
  "bid_unit_price", "bid_total", "decision", "submission_result", "award_result", "assigned_to"];

function keyOf(r) { return String(r.sol_id || "").trim().toUpperCase() + "|" + String(r.agency_num || "").trim().toUpperCase(); }

// "M/D/YYYY" → Date (UTC midnight) for open/closed filtering + deadline sort.
function parseDue(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 23, 59));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeRow(r) {
  const nigp = r.nigp || r.nigp_codes || r["NIGP Codes"] || "";
  const c = NIGP.classify(nigp);
  return {
    key: keyOf(r),
    sol_id: (r.sol_id || r["Solicitation ID"] || "").trim(),
    agency_num: String(r.agency_num || r["Agency/Texas SmartBuy Member Number"] || "").trim(),
    name: r.name || r["Name"] || "",
    esbd_status: r.status || r.esbd_status || r["Status"] || "",
    due_date: r.due_date || r["Due Date"] || "",
    due_at: parseDue(r.due_date || r["Due Date"] || ""),
    due_time: r.due_time || r["Due Time"] || "",
    posted_date: r.posted_date || r.posted || r["Posting Date"] || "",
    last_modified: r.last_modified || r["Last Modified"] || "",
    nigp,
    contact_name: r.contact_name || "", contact_email: r.contact_email || "",
    contact_phone: r.contact_phone || "", delivery_addr: r.delivery_addr || "",
    documents: Array.isArray(r.documents) ? r.documents : [],
    source_url: r.source_url || (r.sol_id ? "https://www.txsmartbuy.gov/esbd" : ""),
    // routing (auto-triage)
    verdict: c.verdict, lane_label: c.label, fsc_lanes: c.fscLanes,
    nigp_classes: c.productClasses, state: "TX", source: r.source || "ESBD",
  };
}

// distributor coverage: how many of our vendors cover this opportunity's lanes
async function coverageFor(db, lanes, cache) {
  if (!lanes || !lanes.length) return 0;
  const kk = lanes.slice().sort().join(",");
  if (cache.has(kk)) return cache.get(kk);
  let n = 0;
  try {
    n = await db.collection("distributors").countDocuments({
      $or: [{ fsc: { $in: lanes } }, { fsc_codes: { $in: lanes } }],
    });
  } catch (e) {}
  cache.set(kk, n);
  return n;
}

const MATERIAL = ["esbd_status", "due_date", "due_time", "nigp", "name", "last_modified"];

exports.handler = async (ev) => {
  if (ev.httpMethod === "OPTIONS") return { statusCode: 204, headers: H, body: "" };
  if (ev.httpMethod !== "POST") return bad(405, "POST only");
  let body; try { body = JSON.parse(ev.body || "{}"); } catch { return bad(400, "bad JSON"); }
  const action = body.action || "list";

  let db;
  try { db = await getDb(); } catch (e) { return bad(500, "db: " + e.message); }
  const opps = db.collection(OPPS);

  try {
    // ── INGEST ────────────────────────────────────────────────────────────────
    if (action === "ingest") {
      const startedAt = new Date();
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return bad(400, "rows[] required");

      const norm = rows.map(normalizeRow).filter((r) => r.sol_id);
      const keys = norm.map((r) => r.key);
      const existing = await opps.find({ key: { $in: keys } }).toArray();
      const byKey = new Map(existing.map((d) => [d.key, d]));
      const covCache = new Map();

      let added = 0, updated = 0, unchanged = 0, errors = 0;
      const ops = [];
      for (const r of norm) {
        try {
          const coverage = await coverageFor(db, r.fsc_lanes, covCache);
          const prev = byKey.get(r.key);
          if (!prev) {
            ops.push({ insertOne: { document: {
              ...r, distributor_coverage: coverage,
              internal_status: "New", notes: "", suppliers: [], est_cost: "", margin_pct: "",
              bid_unit_price: "", bid_total: "", decision: "", submission_result: "", award_result: "",
              is_new: true, changed: false, changed_fields: [],
              status_changes: [], first_seen: startedAt, last_synced: startedAt,
            } } });
            added++;
          } else {
            const changedFields = MATERIAL.filter((f) => (prev[f] || "") !== (r[f] || ""));
            const set = { distributor_coverage: coverage, last_synced: startedAt };
            SCRAPED.forEach((f) => { if (r[f] !== undefined) set[f] = r[f]; });
            // re-triage in case NIGP changed
            set.verdict = r.verdict; set.lane_label = r.lane_label; set.fsc_lanes = r.fsc_lanes; set.nigp_classes = r.nigp_classes;
            const upd = { $set: set };
            if (changedFields.length) {
              set.changed = true; set.changed_fields = changedFields;
              upd.$push = { status_changes: { at: startedAt, fields: changedFields,
                from: Object.fromEntries(changedFields.map((f) => [f, prev[f] || ""])),
                to: Object.fromEntries(changedFields.map((f) => [f, r[f] || ""])) } };
              updated++;
            } else { unchanged++; }
            // NEVER clobber internal fields — they're only in $set above if scraped; INTERNAL untouched.
            ops.push({ updateOne: { filter: { key: r.key }, update: upd } });
          }
        } catch (e) { errors++; }
      }
      if (ops.length) await opps.bulkWrite(ops, { ordered: false });

      const logDoc = { started_at: startedAt, finished_at: new Date(), source: body.source || "import",
        total: norm.length, added, updated, unchanged, errors, ok: true };
      await db.collection(LOG).insertOne(logDoc);
      return ok({ ok: true, ...logDoc });
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    if (action === "list") {
      const q = {};
      if (body.verdict) q.verdict = body.verdict;
      if (body.state) q.state = body.state;
      if (body.status) q.internal_status = body.status;
      if (body.decision !== undefined) q.decision = body.decision;
      if (body.changedOnly) q.$or = [{ is_new: true }, { changed: true }];
      // biddable = product we can route (have vendor coverage) and haven't decided yet
      let sort = { last_synced: -1 };
      if (body.biddable) {
        q.verdict = "PRODUCT"; q.distributor_coverage = { $gt: 0 }; q.decision = { $in: ["", null] };
        q.due_at = { $gte: new Date() };        // OPEN only — never surface expired sols
        sort = { due_at: 1 };                    // soonest deadline first
      }
      const rows = await opps.find(q).sort(sort).limit(Math.min(body.limit || 500, 2000)).toArray();
      return ok({ ok: true, count: rows.length, opportunities: rows });
    }

    // ── STATS (coverage/verdict mix + unmapped NIGP classes to expand crosswalk) ─
    if (action === "stats") {
      const vAgg = await opps.aggregate([{ $group: { _id: "$verdict", n: { $sum: 1 } } }]).toArray();
      const verdictCounts = Object.fromEntries(vAgg.map((v) => [v._id || "UNKNOWN", v.n]));
      const biddable = await opps.countDocuments({ verdict: "PRODUCT", distributor_coverage: { $gt: 0 }, decision: { $in: ["", null] }, due_at: { $gte: new Date() } });
      const committed = await opps.countDocuments({ decision: "BID" });
      const productNoLane = await opps.countDocuments({ verdict: "PRODUCT", $or: [{ fsc_lanes: { $size: 0 } }, { fsc_lanes: { $exists: false } }] });
      const unmapped = await opps.aggregate([
        { $match: { verdict: "PRODUCT", $or: [{ fsc_lanes: { $size: 0 } }, { fsc_lanes: { $exists: false } }] } },
        { $unwind: "$nigp_classes" },
        { $group: { _id: "$nigp_classes", n: { $sum: 1 }, sample: { $first: "$name" }, nigp: { $first: "$nigp" } } },
        { $sort: { n: -1 } }, { $limit: 45 },
      ]).toArray();
      return ok({ ok: true, verdictCounts, biddable, committed, productNoLane,
        unmappedClasses: unmapped.map((u) => ({ cls: u._id, n: u.n, sample: u.sample, nigp: (u.nigp || "").split(/[;\n]/)[0] })) });
    }

    if (action === "get") {
      if (!body.id) return bad(400, "id required");
      const doc = await opps.findOne({ _id: mongoId(body.id) } );
      return doc ? ok({ ok: true, opportunity: doc }) : bad(404, "not found");
    }

    // ── UPDATE internal fields ────────────────────────────────────────────────
    if (action === "update") {
      if (!body.id || !body.fields) return bad(400, "id + fields required");
      const set = {};
      for (const f of INTERNAL) if (body.fields[f] !== undefined) set[f] = body.fields[f];
      if (!Object.keys(set).length) return bad(400, "no updatable fields");
      set.updated_at = new Date();
      const res = await opps.updateOne({ _id: mongoId(body.id) }, { $set: set });
      return ok({ ok: true, matched: res.matchedCount, modified: res.modifiedCount });
    }

    // ── SYNC LOG ────────────────────────────────────────────────────────────
    if (action === "syncLog") {
      const rows = await db.collection(LOG).find({}).sort({ started_at: -1 }).limit(Math.min(body.limit || 20, 100)).toArray();
      const last = rows.find((r) => r.ok);
      return ok({ ok: true, last_success: last || null, runs: rows });
    }

    // ── SYNC STATE (scraper run metadata: next run, last success, duration…) ──
    if (action === "syncState") {
      const meta = db.collection("_meta");
      if (body.set) {
        await meta.updateOne({ _id: "esbd_scraper_state" }, { $set: { ...body.set, updated_at: new Date() } }, { upsert: true });
        return ok({ ok: true });
      }
      const doc = await meta.findOne({ _id: "esbd_scraper_state" });
      return ok({ ok: true, state: doc || null });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === "delete") {
      if (Array.isArray(body.ids) && body.ids.length) {
        const res = await opps.deleteMany({ _id: { $in: body.ids.map(mongoId) } });
        return ok({ ok: true, deleted: res.deletedCount });
      }
      if (body.solPrefix) {  // maintenance: purge test/tagged records
        const res = await opps.deleteMany({ sol_id: { $regex: body.solPrefix } });
        return ok({ ok: true, deleted: res.deletedCount });
      }
      return bad(400, "ids[] or solPrefix required");
    }

    // ── CLEAR review flags ────────────────────────────────────────────────────
    if (action === "clearFlags") {
      const q = Array.isArray(body.ids) && body.ids.length ? { _id: { $in: body.ids.map(mongoId) } } : {};
      const res = await opps.updateMany(q, { $set: { is_new: false, changed: false, changed_fields: [] } });
      return ok({ ok: true, cleared: res.modifiedCount });
    }

    return bad(400, "unknown action: " + action);
  } catch (e) {
    // failed sync → admin error log
    if (action === "ingest") {
      try { await db.collection(LOG).insertOne({ started_at: new Date(), finished_at: new Date(), source: body.source || "import", ok: false, error: e.message }); } catch (_) {}
    }
    return bad(500, e.message);
  }
};

function mongoId(id) {
  try { const { ObjectId } = require("mongodb"); return new ObjectId(String(id)); }
  catch (e) { return id; }
}
