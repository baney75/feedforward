// Account client: device-code sign-in, API calls, community stats, sync of history, saves and progress.
// The session token lives in localStorage. The code is kept on this device only so it can be shown and shared by QR.
import { store } from "./store.js";
import { proofOfWork, prepare } from "./pow.js";
export { prepare };

const KEY = "lt:acct";
let acct = read();
function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function write(a) { acct = a; try { a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY); } catch {} dispatchEvent(new Event("ff:account")); }

export const account = () => acct;            // { token, code?, user }
export const user = () => acct && acct.user;
export const signedIn = () => !!(acct && acct.token);
export const RANK = { user: 1, contributor: 2, mod: 3, admin: 4, owner: 5 };
export const can = (min) => !!(acct && acct.user && RANK[acct.user.role] >= RANK[min]);

export async function api(path, { method = "GET", body, raw, type } = {}) {
  const headers = {};
  if (acct && acct.token) headers.authorization = "Bearer " + acct.token;
  if (body !== undefined && !raw) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = type;
  const r = await fetch(path, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  let d = {};
  try { d = await r.json(); } catch {}
  if (r.status === 401 && acct && path !== "/api/login") { write(null); }
  if (!r.ok) throw Object.assign(new Error(d.error || "Something went wrong."), { status: r.status });
  return d;
}

const device = () => (/iphone|ipad/i.test(navigator.userAgent) ? "iPhone or iPad" : /android/i.test(navigator.userAgent) ? "Android" : /mac/i.test(navigator.userAgent) ? "Mac" : /win/i.test(navigator.userAgent) ? "Windows" : "Browser");

// Joining needs an invite ({invite} or {ref}). Every front-door call spends a proof of work first.
export async function createAccount(join = store.get("join", null), { onProgress, extra = {}, ready } = {}) {
  if (!join || (!join.invite && !join.ref)) throw new Error("Feedforward is invite-only. Use a member's invite link, or apply.");
  const pow = await proofOfWork(onProgress, { ready, minAge: 2 });
  const d = await api("/api/account", { method: "POST", body: { device: device(), ...join, ...extra, pow } });
  store.set("join", null);
  write({ token: d.token, code: d.code, user: d.user });
  await sync();
  return d;
}
export async function signIn(code, { onProgress, ready } = {}) {
  const pow = await proofOfWork(onProgress, { ready });
  const d = await api("/api/login", { method: "POST", body: { code, device: device(), pow } });
  write({ token: d.token, code: code.trim().toLowerCase().replace(/[\s_]+/g, "-"), user: d.user });
  await sync();
  return d;
}
export async function apply(form, { onProgress, ready } = {}) {
  const pow = await proofOfWork(onProgress, { ready, minAge: 4 });
  return api("/api/apply", { method: "POST", body: { ...form, pow } });
}
// Who sent an invite link, for the front door.
export async function inviteInfo(code) {
  const r = await fetch("/api/invite/" + encodeURIComponent(code));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "That invite link isn't valid."), { status: r.status });
  return d;
}
// The read-only gate cookie that lets this browser load member-only files. Refreshed on every start.
export async function refreshGate() {
  if (!signedIn()) return false;
  try { const r = await fetch("/api/gate", { method: "POST", headers: { authorization: "Bearer " + acct.token } }); if (r.status === 401) write(null); return r.ok; } catch { return true; }
}
// What this device has synced belongs to the account that synced it. Signing out leaves a clean device,
// so the next person to sign in never uploads someone else's history into their account.
const SYNCED_KEYS = ["history", "saved", "progress", "days", "historyReset"];
function clearSynced() {
  for (const k of SYNCED_KEYS) { try { localStorage.removeItem("lt:" + k); } catch {} }
  store.set("owner", null);
  // Member-only catalog files cached for offline use go too.
  try { caches.keys().then((ks) => ks.filter((k) => k.startsWith("lt-data")).forEach((k) => caches.delete(k))); } catch {}
}
export async function signOut() { try { await api("/api/logout", { method: "POST" }); } catch {} clearSynced(); write(null); }
export async function refreshMe() {
  if (!signedIn()) return null;
  const d = await api("/api/me");
  write({ ...acct, user: d.user });
  mine.likes = new Set(d.likes); mine.ratings = d.ratings;
  return d;
}
export function updateUser(u) { write({ ...acct, user: { ...acct.user, ...u } }); }
export function setCode(code) { write({ ...acct, code }); }

// ---------- Your likes and ratings, plus everyone's counts ----------
export const mine = { likes: new Set(), ratings: {} };
export const stats = { likes: {}, ratings: {}, comments: {}, ready: null };
export function loadStats() {
  if (!stats.ready) stats.ready = fetch("/api/stats").then((r) => r.json()).then((d) => Object.assign(stats, d)).catch(() => stats);
  return stats.ready;
}
export async function like(item, on) {
  const d = await api("/api/like", { method: "POST", body: { item, on } });
  on ? mine.likes.add(item) : mine.likes.delete(item);
  stats.likes[item] = d.likes;
  return d;
}
export async function rate(item, stars) {
  const d = await api("/api/rate", { method: "POST", body: { item, stars } });
  mine.ratings[item] = stars;
  stats.ratings[item] = [Math.round(d.avg * 10) / 10, d.n];
  return d;
}

// ---------- Sync: merge this device's history, saves, progress and streak days with the account ----------
let syncTimer = 0, applying = false;
export async function sync() {
  if (!signedIn()) return;
  syncTimer = 0;
  // Data synced by a different account never merges into this one. Anonymous data (no owner) does: it's this person's.
  const owner = store.get("owner", null);
  if (owner && owner !== acct.user.id) { try { for (const k of SYNCED_KEYS) localStorage.removeItem("lt:" + k); } catch {} }
  store.set("owner", acct.user.id);
  try {
    const d = await api("/api/sync", { method: "POST", body: { history: store.get("history", []), historyReset: store.get("historyReset", 0), saved: store.get("saved", {}), progress: store.get("progress", {}), days: store.get("days", []) } });
    // Writing the merged result back must not schedule another sync.
    applying = true;
    try { store.set("history", d.data.history); store.set("saved", d.data.saved); store.set("progress", d.data.progress); store.set("days", d.data.days); store.set("historyReset", d.data.historyReset || 0); }
    finally { applying = false; }
  } catch (e) { if (e.status === 429) syncTimer = setTimeout(sync, 120000); }
}
// Batch changes: one sync at most every 15 seconds while someone is browsing.
export function scheduleSync() { if (!signedIn() || applying) return; clearTimeout(syncTimer); syncTimer = setTimeout(sync, 15000); }
addEventListener("pagehide", () => { if (syncTimer) { clearTimeout(syncTimer); sync(); } });

// Referral and invite links: /join/<code> remembers the code until an account is made.
export function rememberJoin(kind, code) { store.set("join", { [kind]: code }); }
