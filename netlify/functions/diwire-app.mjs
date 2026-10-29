// Serves the DiWire app only to signed-in users.
// The app page itself is not in this (public) repo: it is stored in MongoDB
// (diwire.assets, _id "app") by scripts/diwire-publish-app.mjs.
import { getDb, currentUser, isAdmin } from "../diwire/lib.mjs";

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
    // Only remember a found app, so a fresh upload shows up right away.
    cache = { html: doc?.html || null, at: doc?.html ? Date.now() : 0 };
  }
  if (!cache.html) {
    // Admin: go straight to the upload. Everyone else: a short holding page.
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
