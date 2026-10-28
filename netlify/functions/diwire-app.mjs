// Serves the DiWire app only to signed-in users.
// The app page itself is not in this (public) repo: it is stored in MongoDB
// (diwire.assets, _id "app") by scripts/diwire-publish-app.mjs.
import { getDb, currentUser } from "../diwire/lib.mjs";

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
    cache = { html: doc?.html || null, at: Date.now() };
  }
  if (!cache.html) return new Response("The DiWire app hasn't been published yet.", { status: 503, headers: { "content-type": "text/plain" } });

  return new Response(cache.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
};

export const config = { path: ["/diwire/app", "/diwire/app/"] };
