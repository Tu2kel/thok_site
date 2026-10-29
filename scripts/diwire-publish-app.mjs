// Upload the DiWire app page to MongoDB so /diwire/app can serve it to signed-in users.
// The app is kept out of this public repo on purpose.
//
//   node scripts/diwire-publish-app.mjs path/to/diwire-app.html
//
// Reads MONGODB_URI from the environment or from .env in the repo root.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import mongodb from "mongodb";

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/diwire-publish-app.mjs <app.html>"); process.exit(1); }
if (!(process.env.DIWIRE_MONGODB_URI || process.env.MONGODB_URI)) { console.error("MONGODB_URI is not set (add it to .env)."); process.exit(1); }

const html = await readFile(file, "utf8");
if (!html.includes('id="entitlements"')) {
  console.error("This file doesn't have the DiWire access script (id=\"entitlements\"). Publish the build made for the live site.");
  process.exit(1);
}
const client = await new mongodb.MongoClient((process.env.DIWIRE_MONGODB_URI || process.env.MONGODB_URI)).connect();
try {
  await client.db("diwire").collection("assets").updateOne(
    { _id: "app" },
    { $set: { html, updatedAt: new Date(), bytes: Buffer.byteLength(html) } },
    { upsert: true },
  );
  console.log(`Published ${file} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). Live within a minute at /diwire/app/.`);
} finally {
  await client.close();
}
