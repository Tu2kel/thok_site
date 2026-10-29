// Change a DiWire customer's plan by hand (until checkout is connected).
//
//   node scripts/diwire-set-plan.mjs someone@example.com pro 365   -> Pro for 365 days
//   node scripts/diwire-set-plan.mjs someone@example.com pick3     -> adds 3 picks
//   node scripts/diwire-set-plan.mjs someone@example.com free      -> ends Pro (keeps owned picks)
//
// Reads MONGODB_URI from the environment or from .env in the repo root.
import "dotenv/config";
import mongodb from "mongodb";

const [email, plan, days] = process.argv.slice(2);
if (!email || !["pro", "pick3", "free"].includes(plan)) {
  console.error("Usage: node scripts/diwire-set-plan.mjs <email> <pro|pick3|free> [days for pro]");
  process.exit(1);
}
const client = await new mongodb.MongoClient((process.env.DIWIRE_MONGODB_URI || process.env.MONGODB_URI)).connect();
try {
  const users = client.db("diwire").collection("users");
  const u = await users.findOne({ email: email.toLowerCase() });
  if (!u) { console.error(`No DiWire account for ${email}.`); process.exit(1); }
  let update;
  if (plan === "pro") update = { $set: { plan: "pro", proUntil: new Date(Date.now() + (Number(days) || 365) * 864e5) } };
  if (plan === "pick3") update = { $inc: { picksLeft: 3 } };
  if (plan === "free") update = { $set: { plan: "free", proUntil: null } };
  await users.updateOne({ _id: u._id }, update);
  const after = await users.findOne({ _id: u._id });
  console.log(`${email}: plan=${after.plan} picksLeft=${after.picksLeft || 0} picks=${(after.picks || []).length} proUntil=${after.proUntil || "-"}`);
} finally {
  await client.close();
}
