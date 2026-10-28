// DiWire accounts API
//   POST /api/diwire/signup  { name, email, password, keep }
//   POST /api/diwire/login   { email, password, keep }
//   POST /api/diwire/logout
//   GET  /api/diwire/me
//   POST /api/diwire/picks   { key }   spend one Pick 3 credit on a circuit
// Admin only (email listed in DIWIRE_ADMIN_EMAILS):
//   GET  /api/diwire/admin-users?q=   list accounts (newest first, up to 200)
//   POST /api/diwire/admin-plan       { email, action: "pro"|"pick3"|"free", days }
//   POST /api/diwire/admin-app        { html }   publish a new app build
import {
  getDb, hashPassword, verifyPassword, createSession, currentUser, endSession,
  entitlement, publicUser, json, isAdmin,
} from "../diwire/lib.mjs";
import { KEYS, FREE } from "../diwire/keys.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function body(req) {
  try { return await req.json(); } catch { return null; }
}

export default async (req, context) => {
  const action = (context?.params?.action || new URL(req.url).pathname.split("/").pop() || "").toLowerCase();
  let db;
  try { db = await getDb(); } catch (e) {
    console.error("diwire db", e);
    return json({ error: "Accounts are temporarily unavailable. Try again in a minute." }, 503);
  }

  try {
    if (action === "me" && req.method === "GET") {
      const u = await currentUser(db, req);
      return u ? json(publicUser(u)) : json({ error: "Not signed in." }, 401);
    }

    if (action.startsWith("admin-")) {
      const me = await currentUser(db, req);
      if (!me) return json({ error: "Sign in first." }, 401);
      if (!isAdmin(me)) return json({ error: "Admins only." }, 403);
      const users = db.collection("users");

      if (action === "admin-users" && req.method === "GET") {
        const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
        const filter = q ? { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } } : {};
        const list = await users.find(filter, { projection: { passHash: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        const total = await users.countDocuments({});
        const app = await db.collection("assets").findOne({ _id: "app" }, { projection: { html: 0 } });
        return json({
          total,
          app: app ? { updatedAt: app.updatedAt, bytes: app.bytes } : null,
          users: list.map((u) => ({ ...publicUser(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })),
        });
      }

      if (action === "admin-plan" && req.method === "POST") {
        const b = await body(req);
        const email = String(b?.email || "").trim().toLowerCase();
        const u = email && (await users.findOne({ email }));
        if (!u) return json({ error: `No DiWire account for ${email || "that email"}.` }, 404);
        let update;
        if (b?.action === "pro") update = { $set: { plan: "pro", proUntil: new Date(Date.now() + (Math.min(Math.max(Number(b.days) || 365, 1), 3650)) * 864e5) } };
        else if (b?.action === "pick3") update = { $inc: { picksLeft: 3 } };
        else if (b?.action === "free") update = { $set: { plan: "free", proUntil: null } };
        else return json({ error: "Choose pro, pick3 or free." }, 400);
        await users.updateOne({ _id: u._id }, update);
        const after = await users.findOne({ _id: u._id });
        return json({ ...publicUser(after), createdAt: after.createdAt, lastLoginAt: after.lastLoginAt });
      }

      if (action === "admin-app" && req.method === "POST") {
        const b = await body(req);
        const html = String(b?.html || "");
        if (!html.includes('id="entitlements"')) return json({ error: "That file isn't the live-site build of DiWire (it has no access script)." }, 400);
        const bytes = Buffer.byteLength(html);
        await db.collection("assets").updateOne({ _id: "app" }, { $set: { html, bytes, updatedAt: new Date(), by: me.email } }, { upsert: true });
        return json({ ok: true, bytes, updatedAt: new Date() });
      }

      return json({ error: "Not found." }, 404);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    if (action === "signup") {
      const b = await body(req);
      const email = String(b?.email || "").trim().toLowerCase();
      const name = String(b?.name || "").trim().slice(0, 80);
      const pw = String(b?.password || "");
      if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (pw.length < 8) return json({ error: "Password needs at least 8 characters." }, 400);
      if (pw.length > 200) return json({ error: "Password is too long." }, 400);
      const users = db.collection("users");
      if (await users.findOne({ email })) return json({ error: "An account with that email already exists. Sign in instead." }, 409);
      const doc = { email, name, passHash: await hashPassword(pw), plan: "free", picks: [], picksLeft: 0, createdAt: new Date(), lastLoginAt: new Date() };
      let id;
      try { id = (await users.insertOne(doc)).insertedId; }
      catch (e) { if (e?.code === 11000) return json({ error: "An account with that email already exists. Sign in instead." }, 409); throw e; }
      const cookie = await createSession(db, id, !!b?.keep);
      return json(publicUser({ ...doc, _id: id }), 201, { "set-cookie": cookie });
    }

    if (action === "login") {
      const b = await body(req);
      const email = String(b?.email || "").trim().toLowerCase();
      const pw = String(b?.password || "");
      const u = email && (await db.collection("users").findOne({ email }));
      if (!u || !(await verifyPassword(pw, u.passHash))) return json({ error: "That email and password don't match." }, 401);
      await db.collection("users").updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() } });
      const cookie = await createSession(db, u._id, b?.keep !== false);
      return json(publicUser(u), 200, { "set-cookie": cookie });
    }

    if (action === "logout") {
      const cookie = await endSession(db, req);
      return json({ ok: true }, 200, { "set-cookie": cookie });
    }

    if (action === "picks") {
      const u = await currentUser(db, req);
      if (!u) return json({ error: "Sign in first." }, 401);
      const b = await body(req);
      const key = String(b?.key || "");
      if (!KEYS.includes(key)) return json({ error: "That circuit isn't one you can pick." }, 400);
      const ent = entitlement(u);
      if (ent.plan === "pro" || FREE.includes(key) || ent.picks.includes(key)) return json(publicUser(u));
      if (ent.picksLeft < 1) {
        const msg = ent.picks.length ? "You've used all your picks. Buy another Pick 3 or go Pro." : "Choosing circuits comes with Pick 3. Get Pick 3 or go Pro to unlock this one.";
        return json({ error: msg }, 402);
      }
      // Spend exactly one credit, only if one is still there.
      const r = await db.collection("users").findOneAndUpdate(
        { _id: u._id, picksLeft: { $gte: 1 }, picks: { $ne: key } },
        { $inc: { picksLeft: -1 }, $push: { picks: key } },
        { returnDocument: "after" },
      );
      const next = r && (r.value !== undefined ? r.value : r);
      if (!next) return json({ error: "Couldn't add that circuit. Refresh and try again." }, 409);
      return json(publicUser(next));
    }

    return json({ error: "Not found." }, 404);
  } catch (e) {
    console.error("diwire api", action, e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
};

export const config = {
  path: "/api/diwire/:action",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
