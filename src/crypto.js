const enc = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
export async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export function newId(prefix = "") {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return prefix + [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 14);
}

// ---- Owner session cookie ----
const COOKIE = "ts_admin";
const SESSION_HOURS = 12;

// Admin accounts come from the ADMIN_USERS secret, one "username:password" per line
// (or separated by ";"). ADMIN_PASSWORD alone still works as a single "owner" account.
export function adminAccounts(env) {
  const accounts = new Map();
  for (const entry of String(env.ADMIN_USERS || "").split(/[\n;]+/)) {
    const i = entry.indexOf(":");
    if (i < 1) continue;
    const user = entry.slice(0, i).trim().toLowerCase();
    const pass = entry.slice(i + 1).trim();
    if (/^[a-z0-9_.-]{1,40}$/.test(user) && pass) accounts.set(user, pass);
  }
  if (env.ADMIN_PASSWORD && !accounts.size) accounts.set("owner", env.ADMIN_PASSWORD);
  return accounts;
}

export async function makeSession(env, user) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const sig = await hmacHex(env.SESSION_SECRET, `admin.${user}.${exp}`);
  return `${COOKIE}=${exp}.${user}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}
export function clearSession() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
// Returns the signed-in admin's username, or null
export async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = request.headers.get("Cookie") || "";
  const m = new RegExp(`(?:^|; )${COOKIE}=(\\d+)\\.([a-z0-9_.-]{1,40})\\.([a-f0-9]{64})`).exec(cookie);
  if (!m || Number(m[1]) < Date.now()) return null;
  // An account removed from ADMIN_USERS is signed out immediately
  if (!adminAccounts(env).has(m[2])) return null;
  return safeEqual(m[3], await hmacHex(env.SESSION_SECRET, `admin.${m[2]}.${m[1]}`)) ? m[2] : null;
}

// ---- Stripe webhook signature (Stripe-Signature: t=...,v1=...) ----
export async function verifyStripe(payload, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = parts.t;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => safeEqual(s, expected));
}
