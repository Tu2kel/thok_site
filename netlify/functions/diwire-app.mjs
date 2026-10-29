// Serves the DiWire app only to signed-in users.
// The app ships with every deploy, encrypted (netlify/diwire/app-enc.mjs), so this public repo
// never holds it in readable form. DIWIRE_APP_KEY (Netlify env, secret) unlocks it at request time.
// An admin can still upload a newer build from /diwire/admin; the newest of the two wins.
import { createDecipheriv } from "node:crypto";
import { getDb, currentUser, isAdmin, env } from "../diwire/lib.mjs";
import { APP } from "../diwire/app-enc.mjs";

let bundled = null;
function bundledHtml() {
  if (bundled !== null) return bundled;
  try {
    const key = Buffer.from(String(env("DIWIRE_APP_KEY") || ""), "base64");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(APP.iv, "base64"));
    d.setAuthTag(Buffer.from(APP.tag, "base64"));
    bundled = Buffer.concat([d.update(Buffer.from(APP.data, "base64")), d.final()]).toString("utf8");
  } catch (e) {
    console.error("diwire-app: can't unlock the bundled app (check DIWIRE_APP_KEY)", e.message);
    bundled = "";
  }
  return bundled;
}

let cache = { html: null, at: 0 };

export default async (req) => {
  let db;
  try { db = await getDb(); } catch (e) {
    console.error("diwire-app db", e);
    return new Response("DiWire is temporarily unavailable. Try again in a minute.", { status: 503, headers: { "content-type": "text/plain" } });
  }
  const user = await currentUser(db, req);
  if (!user) return Response.redirect(new URL("/diwire/#signin", req.url), 302);

  if (!cache.html || Date.now() - cache.at > 60_000) {
    const doc = await db.collection("assets").findOne({ _id: "app" });
    const uploadedNewer = doc?.html && doc.updatedAt && new Date(doc.updatedAt) > new Date(APP.builtAt);
    const html = uploadedNewer ? doc.html : bundledHtml() || doc?.html || null;
    cache = { html, at: html ? Date.now() : 0 };
  }
  if (!cache.html) {
    if (isAdmin(user)) return Response.redirect(new URL("/diwire/admin/#upload", req.url), 302);
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DiWire</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#f3efe6;font:16px/1.6 system-ui,sans-serif;padding:24px;text-align:center}h1{font-size:28px;margin:0 0 8px}a{color:#f2cf6b}</style></head>
<body><div><h1>DiWire is almost ready</h1><p>Your account is set. The app opens here as soon as it goes live.</p><p><a href="/diwire/">Back to DiWire</a></p></div></body></html>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "300" } });
  }

  return new Response(cache.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
};

export const config = { path: ["/diwire/app", "/diwire/app/"] };
