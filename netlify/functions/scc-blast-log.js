// netlify/functions/scc-blast-log.js
// Blast log + daily briefs CRUD for the SCC Briefs tab (read/persist only)
// Actions: getBriefs | getBriefDetail | getBlastLog | saveBrief | nsnWatchUpsert
// reBlast is retired — the Railway pipeline (Resend) is the sole blaster.

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = "scc_db";

let _client;
async function getDb() {
  if (!_client) {
    _client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
  }
  return _client.db(DB_NAME);
}

// The UI re-blast path (send RFQs from the Briefs tab) sent via the Gmail API as
// a personal placeholder address from before Resend. Removed 2026-07-10.
// The Railway pipeline (Resend, from anthony@ifedlog.com) is the sole blaster.
// This function is now read-only: briefs + blast log + nsn-watch persistence.

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { action } = payload;
  const ok  = (d) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, result: d }) });
  const fail = (m) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: m }) });

  try {
    const db = await getDb();

    // ── getBriefs — list recent daily runs ──────────────────────────────
    if (action === "getBriefs") {
      const limit = payload.limit || 60;
      const briefs = await db.collection("blast_briefs")
        .find({}, { projection: { sols: 0, blast_log: 0 } })
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray();
      return ok(briefs);
    }

    // ── getBriefDetail — one brief with full sols + blast_log ───────────
    if (action === "getBriefDetail") {
      const { id } = payload;
      if (!id) return fail("id required");
      const { ObjectId } = require("mongodb");
      const brief = await db.collection("blast_briefs").findOne({ _id: new ObjectId(id) });
      if (!brief) return fail("Not found");

      // Enrich each sol with who was already contacted
      const solNums = (brief.sols || []).map(s => s.sol_number);
      const logs    = await db.collection("blast_log").find({ sol_number: { $in: solNums } }).toArray();
      const logMap  = {};
      for (const l of logs) {
        if (!logMap[l.sol_number]) logMap[l.sol_number] = [];
        logMap[l.sol_number].push(l);
      }
      brief.sols = (brief.sols || []).map(s => ({ ...s, contacts: logMap[s.sol_number] || [] }));
      return ok(brief);
    }

    // ── getBlastLog — all log entries, optionally filtered ──────────────
    if (action === "getBlastLog") {
      const filter = {};
      if (payload.sol_number) filter.sol_number = payload.sol_number;
      if (payload.vendor_email) filter.vendor_email = payload.vendor_email.toLowerCase();
      const logs = await db.collection("blast_log").find(filter).sort({ sent_at: -1 }).limit(500).toArray();
      return ok(logs);
    }

    // ── reBlast — retired ──────────────────────────────────────────────
    // Sent via the Gmail API as a personal placeholder address (pre-Resend). The
    // Railway pipeline (Resend, from anthony@ifedlog.com) is the sole blaster.
    if (action === "reBlast") {
      return fail("Re-blast retired — Railway (Resend, anthony@ifedlog.com) is the sole blaster.");
    }

    // ── saveBrief — persist a UI-triggered blast session ───────────────
    if (action === "saveBrief") {
      const { brief, blastEntries, sessionId } = payload;
      if (!brief) return fail("brief required");

      const doc = {
        run_date:     brief.run_date || new Date().toLocaleDateString("en-US"),
        source:       "ui-blast",
        total_sols:   brief.total_sols || 0,
        go_count:     brief.go_count  || 0,
        verify_count: brief.verify_count || 0,
        reject_count: brief.reject_count || 0,
        blast_sent:   brief.blast_sent  || 0,
        blast_failed: brief.blast_failed || 0,
        sols:         brief.sols || [],
        blast_log:    [],
        updated_at:   new Date().toISOString(),
      };

      if (sessionId) {
        // Upsert — safe for periodic mid-blast saves and page-reload recovery
        await db.collection("blast_briefs").updateOne(
          { session_id: sessionId },
          { $set: doc, $setOnInsert: { session_id: sessionId, created_at: new Date().toISOString() } },
          { upsert: true },
        );
      } else {
        await db.collection("blast_briefs").insertOne({ ...doc, created_at: new Date().toISOString() });
      }

      // Write each sent vendor+sol combo to blast_log for re-blast dedup
      if (blastEntries && blastEntries.length) {
        for (const entry of blastEntries) {
          if (!entry.sol_number || !entry.vendor_email) continue;
          await db.collection("blast_log").updateOne(
            { sol_number: entry.sol_number, vendor_email: entry.vendor_email.toLowerCase() },
            { $set: {
                sol_number:   entry.sol_number,
                item_name:    entry.item_name  || "",
                fsc:          entry.fsc        || "",
                quote_due:    entry.quote_due  || "",
                vendor_name:  entry.vendor_name,
                vendor_email: entry.vendor_email.toLowerCase(),
                vendor_id:    entry.vendor_id  || null,
                status:       "sent",
                sent_at:      entry.sent_at    || new Date().toISOString(),
              }
            },
            { upsert: true },
          ).catch(() => {});
        }
      }

      return ok({ saved: true });
    }

    return fail("Unknown action: " + action);
  } catch (e) {
    return fail(e.message);
  }
};
