// Feedforward is invite-only. Two jobs here:
// 1. The gate: catalog data, labs and community reads need a signed-in member. The browser holds a read-only
//    gate cookie (signed, HttpOnly, 7 days) so static files and lab iframes can be gated too. It never
//    authorizes a change: every write still needs the Bearer session, so the cookie adds no CSRF risk.
// 2. Proof of work: joining, applying and signing in each cost the browser about a second of hashing, which
//    is nothing for a person and real money for a bot farm. Challenges are signed, single use and expire.

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const keys = new Map();
async function hmac(env, msg) {
  let k = keys.get(env.PEPPER);
  if (!k) { k = await crypto.subtle.importKey("raw", enc.encode("gate:" + env.PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); keys.set(env.PEPPER, k); }
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const nowS = () => Math.floor(Date.now() / 1000);

export const GATE = "__Host-ff_gate";
const WEEK = 7 * 86400;
export async function gateCookie(env, uid) {
  const exp = nowS() + WEEK, body = `${uid}.${exp}`;
  return `${GATE}=${body}.${await hmac(env, body)}; Path=/; Max-Age=${WEEK}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearGate = `${GATE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function gateUser(req, env) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${GATE}=([\\w-]{6,20})\\.(\\d{10})\\.([\\w-]{43})(?:;|$)`));
  if (!m || +m[2] < nowS()) return null;
  return same(m[3], await hmac(env, `${m[1]}.${m[2]}`)) ? m[1] : null;
}

// Paths anyone may call: the front door (join, sign in, apply, invite lookups), the landing page's live
// counts, health and OAuth. Everything else under /api needs the gate.
export const PUBLIC_API = /^\/api\/(account|login|logout|gate|pow|apply|invite\/[\w-]{1,40}|pulse|health|oauth\/[\w/]+)$/;
export const gatedPath = (p) => (p.startsWith("/api/") && !PUBLIC_API.test(p)) || p.startsWith("/data/") || p.startsWith("/labs/");

// ---------- Proof of work ----------
export const POW_BITS = 18;           // about 260,000 hashes on average: under a second on a phone
const POW_TTL = 600;
export async function powChallenge(env, bits = POW_BITS) {
  const r = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${r}.${nowS()}.${bits}`;
  return { c: `${body}.${await hmac(env, "pow:" + body)}`, bits };
}
const zeroBits = (bytes) => { let n = 0; for (const x of bytes) { if (x === 0) { n += 8; continue; } n += Math.clz32(x) - 24; break; } return n; };
// Returns an error message, or null when the work is good. minAge (seconds) also rejects forms filled faster
// than a person can read them. take(key) must return true once per key (single use).
export async function checkPow(env, pow, { minAge = 0, take } = {}) {
  const c = String((pow && pow.c) || ""), n = String((pow && pow.n) ?? "");
  const m = c.match(/^([\w-]{16})\.(\d{10})\.(\d{1,2})\.([\w-]{43})$/);
  if (!m || !/^\d{1,12}$/.test(n)) return "Your browser didn't finish the check. Reload and try again.";
  if (!same(m[4], await hmac(env, `pow:${m[1]}.${m[2]}.${m[3]}`))) return "That check isn't valid. Reload and try again.";
  const age = nowS() - +m[2];
  if (age > POW_TTL) return "That took too long. Try again.";
  if (age < minAge) return "That was quick. Take a second and try again.";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${c}:${n}`)));
  if (zeroBits(digest) < +m[3] || +m[3] < POW_BITS) return "That check didn't pass. Try again.";
  if (take && !(await take("pow:" + m[1]))) return "That check was already used. Try again.";
  return null;
}
