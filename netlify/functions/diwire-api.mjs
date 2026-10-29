// DiWire accounts API
//   POST /api/diwire/signup  { name, email, password, keep }
//   POST /api/diwire/login   { email, password, keep }
//   POST /api/diwire/logout
//   GET  /api/diwire/me
//   POST /api/diwire/picks   { key }   spend one Pick 3 credit on a circuit
//   POST /api/diwire/link    { email, name }  email a sign-in link (signs up new emails too)
//   GET  /api/diwire/verify?t=…               the emailed link: signs in, then opens the app
//   POST /api/diwire/photo   { image: dataURL }  read a photo of an open box (Pro: full answer; others: blurred teaser)
// Admin only (email listed in DIWIRE_ADMIN_EMAILS):
//   GET  /api/diwire/admin-users?q=   list accounts (newest first, up to 200)
//   POST /api/diwire/admin-plan       { email, action: "pro"|"pick3"|"free", days }
//   POST /api/diwire/admin-app        { html }   publish a new app build
import {
  getDb, hashPassword, verifyPassword, createSession, currentUser, endSession,
  entitlement, publicUser, json, isAdmin, sha, env,
} from "../diwire/lib.mjs";
import { randomBytes } from "node:crypto";
import { PRO_DAILY, TEASER_DAILY, readPhoto, teaserOf } from "../diwire/photo.mjs";
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

    if (action === "verify" && req.method === "GET") {
      const url = new URL(req.url);
      const t = url.searchParams.get("t") || "";
      // Links work for 15 minutes and may be opened more than once (mail scanners often open links first).
      const link = t && (await db.collection("links").findOne({ _id: sha(t) }));
      if (!link || link.exp < new Date()) return Response.redirect(new URL("/diwire/#link-expired", req.url), 302);
      const users = db.collection("users");
      let u = await users.findOne({ email: link.email });
      if (!u) {
        const doc = { email: link.email, name: link.name || "", passHash: null, plan: "free", picks: [], picksLeft: 0, createdAt: new Date(), lastLoginAt: new Date(), via: "link" };
        try { doc._id = (await users.insertOne(doc)).insertedId; u = doc; }
        catch (e) { if (e?.code === 11000) u = await users.findOne({ email: link.email }); else throw e; }
      } else {
        await users.updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() } });
      }
      const cookie = await createSession(db, u._id, true);
      return new Response(null, { status: 302, headers: { location: new URL("/diwire/app/", req.url).toString(), "set-cookie": cookie, "cache-control": "no-store" } });
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
        else if (b?.action === "photos10") update = { $inc: { photoCredits: 10 } };
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

    if (action === "link") {
      const b = await body(req);
      const email = String(b?.email || "").trim().toLowerCase();
      const name = String(b?.name || "").trim().slice(0, 80);
      if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
      const key = env("RESEND_API_KEY");
      if (!key) return json({ error: "Email sign-in isn't set up yet. Use your password." }, 503);
      const token = randomBytes(32).toString("base64url");
      await db.collection("links").insertOne({ _id: sha(token), email, name, exp: new Date(Date.now() + 15 * 60e3) });
      const link = new URL(`/api/diwire/verify?t=${token}`, req.url).toString();
      const exists = !!(await db.collection("users").findOne({ email }));
      const subject = exists ? "Your DiWire sign-in link" : "Finish creating your DiWire account";
      const text = `${exists ? "Tap this link to sign in to DiWire" : "Tap this link to finish creating your DiWire account"}:\n\n${link}\n\nIt works for 15 minutes. If you didn't ask for this, ignore this email.\n\nDiWire · The House of Kel LLC`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0b0b0d;color:#f3efe6;border-radius:12px">
<p style="font-size:22px;font-weight:bold;margin:0 0 12px">DiWire</p>
<p style="margin:0 0 20px;color:#d3cec3">${exists ? "Tap the button to sign in." : "Tap the button to finish creating your account."} The link works for 15 minutes.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#d81624;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">${exists ? "Sign in to DiWire" : "Create my account"}</a></p>
<p style="margin:0;color:#77736b;font-size:12px">If you didn't ask for this, ignore this email. DiWire · The House of Kel LLC</p></div>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "DiWire <diwire@ifedlog.com>", reply_to: "Anthony@ifedlog.com", to: [email], subject, text, html }),
      });
      if (!r.ok) { console.error("diwire link email", r.status, await r.text().catch(() => "")); return json({ error: "Couldn't send the email. Try again, or use your password." }, 502); }
      return json({ ok: true });
    }

    if (action === "photo") {
      const u = await currentUser(db, req);
      if (!u) return json({ error: "Sign in first." }, 401);
      const b = await body(req);
      const m = String(b?.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return json({ error: "Send a JPEG, PNG or WebP photo." }, 400);
      if (m[2].length > 5_000_000) return json({ error: "That photo is too large. Try again; the app shrinks it before sending." }, 413);
      const key = env("ANTHROPIC_API_KEY");
      if (!key) return json({ error: "Photo reading isn't set up yet." }, 503);
      const ent = entitlement(u);
      const pro = ent.plan === "pro";
      const day = new Date().toISOString().slice(0, 10);
      const usage = db.collection("photos");
      const uid = `${u._id}:${day}`;
      const today = (await usage.findOne({ _id: uid })) || { n: 0, t: 0 };
      let paidWithCredit = false;
      if (pro && !ent.admin && today.n >= PRO_DAILY) {
        const r = await db.collection("users").findOneAndUpdate({ _id: u._id, photoCredits: { $gte: 1 } }, { $inc: { photoCredits: -1 } }, { returnDocument: "after" });
        const after = r && (r.value !== undefined ? r.value : r);
        if (!after) return json({ error: `You've used today's ${PRO_DAILY} photos. Extra photos come in packs, or your count resets tomorrow.`, used: today.n, limit: PRO_DAILY, credits: 0, needCredits: true }, 402);
        paidWithCredit = true;
      }
      if (!pro && today.t >= TEASER_DAILY) return json({ error: "You've used today's free photo preview. Go Pro to read photos and see the full wiring.", locked: true }, 429);
      let out;
      // Newest model first; a retired or unknown model name falls through to the next one.
      const models = [...new Set([env("DIWIRE_VISION_MODEL"), "claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-4-6"].filter(Boolean))];
      let lastErr;
      for (const model of models) {
        try { out = await readPhoto({ key, model, media: m[1], data: m[2] }); break; }
        catch (e) { lastErr = e; console.error("diwire photo", model, e.status, (e.body || e.message || "").slice(0, 400)); if (!(e.status === 404 || (e.status === 400 && /model/i.test(e.body || "")))) break; }
      }
      if (!out) {
        const e = lastErr || {};
        if (paidWithCredit) await db.collection("users").updateOne({ _id: u._id }, { $inc: { photoCredits: 1 } });
        let why = "";
        if (isAdmin(u)) { let msg = ""; try { msg = JSON.parse(e.body || "{}").error?.message || ""; } catch {} why = ` [admin: ${e.status || "no status"} ${(msg || e.message || "").slice(0, 160)}]`; }
        const busy = e.status === 429 || e.status === 529 || e.status >= 500;
        return json({ error: (busy ? "Photo reading is busy right now. Try again in a minute; it didn't count against you." : "Couldn't read that photo right now. Try again in a minute; it didn't count against you.") + why }, 502);
      }
      await usage.updateOne({ _id: uid }, { $inc: pro ? { n: 1 } : { t: 1 }, $set: { day, userId: u._id } }, { upsert: true });
      if (!pro) return json({ locked: true, teaser: teaserOf(out.result) });
      const fresh = await db.collection("users").findOne({ _id: u._id });
      return json({ result: out.result, used: today.n + 1, limit: ent.admin ? null : PRO_DAILY, credits: fresh?.photoCredits || 0 });
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
