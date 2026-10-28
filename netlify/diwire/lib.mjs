// DiWire shared server code: MongoDB access, passwords, sessions.
// Data lives in the "diwire" database on the same cluster as MONGODB_URI.
//   users     { email, name, passHash, plan: "free"|"pick3"|"pro", picks: [key], picksLeft, proUntil, createdAt, lastLoginAt }
//   sessions  { _id: sha256(token), userId, exp }   (TTL index on exp)
//   assets    { _id: "app", html, updatedAt }       (the paid app page, uploaded by scripts/diwire-publish-app.mjs)
import mongodb from "mongodb";
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const { MongoClient, ObjectId } = mongodb;
const scrypt = promisify(_scrypt);
export { ObjectId };

const env = (k) => (globalThis.Netlify?.env?.get(k) ?? process.env[k]);

let clientPromise = null;
let dbOverride = null;
let indexesReady = null;

export function _setDb(db) { dbOverride = db; indexesReady = null; } // tests only

export async function getDb() {
  if (dbOverride) return dbOverride;
  if (!clientPromise) {
    const uri = env("MONGODB_URI");
    if (!uri) throw new Error("MONGODB_URI is not set");
    clientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
  }
  const db = (await clientPromise).db("diwire");
  if (!indexesReady) {
    indexesReady = Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("sessions").createIndex({ exp: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((e) => { indexesReady = null; throw e; });
  }
  await indexesReady;
  return db;
}

// ---- passwords (scrypt, N=16384) ----
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `s1$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("s1$")) return false;
  const [, s, k] = stored.split("$");
  const key = await scrypt(pw, Buffer.from(s, "base64"), 64);
  const want = Buffer.from(k, "base64");
  return want.length === key.length && timingSafeEqual(want, key);
}

// ---- sessions ----
export const COOKIE = "dw_s";
const sha = (t) => createHash("sha256").update(t).digest("hex");

export async function createSession(db, userId, keep) {
  const token = randomBytes(32).toString("base64url");
  const days = keep ? 30 : 1;
  const exp = new Date(Date.now() + days * 864e5);
  await db.collection("sessions").insertOne({ _id: sha(token), userId, exp });
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (keep) parts.push(`Max-Age=${days * 86400}`);
  return parts.join("; ");
}

export function readToken(req) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export async function currentUser(db, req) {
  const token = readToken(req);
  if (!token) return null;
  const s = await db.collection("sessions").findOne({ _id: sha(token) });
  if (!s || s.exp < new Date()) return null;
  return db.collection("users").findOne({ _id: s.userId });
}

export async function endSession(db, req) {
  const token = readToken(req);
  if (token) await db.collection("sessions").deleteOne({ _id: sha(token) });
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ---- admins: emails listed in DIWIRE_ADMIN_EMAILS (comma-separated) ----
export function isAdmin(user) {
  const list = String(env("DIWIRE_ADMIN_EMAILS") || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  return !!user?.email && list.includes(user.email.toLowerCase());
}

// ---- what an account can use right now ----
export function entitlement(user) {
  if (isAdmin(user)) return { plan: "pro", picks: user.picks || [], picksLeft: user.picksLeft || 0, proUntil: null, admin: true };
  const now = new Date();
  const proActive = user.plan === "pro" && (!user.proUntil || new Date(user.proUntil) > now);
  const picks = Array.isArray(user.picks) ? user.picks : [];
  const picksLeft = Math.max(0, user.picksLeft || 0);
  const plan = proActive ? "pro" : picks.length || picksLeft ? "pick3" : "free";
  return { plan, picks, picksLeft, proUntil: proActive && user.proUntil ? user.proUntil : null };
}

export function publicUser(user) {
  return { email: user.email, name: user.name || "", ...entitlement(user) };
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
