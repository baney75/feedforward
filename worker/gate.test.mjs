// Invite-only gate, proof of work, invites with permissions and applications, against SQLite built from the
// migrations (the same stand-in for D1 as auth.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { powChallenge, checkPow, gateCookie, gateUser, gatedPath, liveSession, forgetSessions, POW_BITS } from "./gate.js";
import { handle, sha } from "./api.js";

const dir = path.dirname(new URL(import.meta.url).pathname);
const PEPPER = "test-pepper";

function d1() {
  const db = new DatabaseSync(":memory:");
  const mig = path.join(dir, "..", "migrations");
  for (const f of fs.readdirSync(mig).filter((f) => f.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(mig, f), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { const out = []; for (const s of list) out.push(await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
// Solve a challenge the way the browser does: find n so sha256("<c>:<n>") starts with `bits` zero bits.
function solve({ c, bits }) {
  for (let n = 0; ; n++) {
    const h = createHash("sha256").update(`${c}:${n}`).digest();
    let z = 0; for (const x of h) { if (x === 0) { z += 8; continue; } z += Math.clz32(x) - 24; break; }
    if (z >= bits) return { c, n: String(n) };
  }
}
// Challenges are dated in whole seconds; backdate one so the "too fast" check passes without waiting.
async function aged(env, secs = 10) {
  const real = Date.now; Date.now = () => real() - secs * 1000;
  try { return solve(await powChallenge(env)); } finally { Date.now = real; }
}
let n = 0;
const req = (p, { method = "GET", body, token, ip } = {}) => new Request("https://ff.test" + p, {
  method, body: body && JSON.stringify(body),
  headers: { "content-type": "application/json", "cf-connecting-ip": ip || `10.0.${n >> 8 & 255}.${n++ & 255}`, ...(token ? { authorization: "Bearer " + token } : {}) },
});
const call = async (env, p, o) => { const r = await handle(req(p, o), env); return { status: r.status, d: await r.json(), cookie: r.headers.get("set-cookie") }; };
async function setup() {
  const kv = new Map();
  const FRESH = { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) };
  const env = { DB: d1(), PEPPER, FRESH };
  const t = Math.floor(Date.now() / 1000);
  // An owner to make invites and decide applications.
  env.DB.raw.prepare("INSERT INTO users (id, code_hash, ref_code, role, created) VALUES ('owner00001', 'h0', 'ownref1', 'owner', ?)").run(t);
  const tok = "s".repeat(40);
  env.DB.raw.prepare("INSERT INTO sessions (token_hash, user_id, created, seen) VALUES (?, 'owner00001', ?, ?)").run(await sha(tok), t, t);
  return { env, owner: tok };
}

test("proof of work: good work passes once; wrong, replayed, rushed and forged work fails", async () => {
  const env = { PEPPER };
  const seen = new Set(), take = async (k) => (seen.has(k) ? false : (seen.add(k), true));
  const ch = await powChallenge(env);
  assert.equal(ch.bits, POW_BITS);
  const good = solve(ch);
  assert.equal(await checkPow(env, good, { take }), null);
  assert.match(await checkPow(env, good, { take }), /already used/);
  assert.match(await checkPow(env, { c: good.c, n: String(+good.n + 1) }, {}), /didn't pass|already/);
  assert.match(await checkPow(env, solve(await powChallenge(env)), { minAge: 3 }), /quick/);
  const forged = good.c.replace(/\.(\d{1,2})\./, ".1.");
  assert.match(await checkPow(env, solve({ c: forged, bits: 1 }), {}), /isn't valid/);
});

test("gate cookie: valid for its user, refused when tampered or expired", async () => {
  const env = { PEPPER };
  const raw = (await gateCookie(env, "abcd123456", "0123456789abcdef99")).split(";")[0];
  const r = (c) => new Request("https://ff.test/data/home.json", { headers: { cookie: c } });
  assert.deepEqual(await gateUser(r(raw), env), { uid: "abcd123456", sid: "0123456789abcdef" });
  assert.equal(await gateUser(r(raw.replace("abcd123456", "zzzz123456")), env), null, "a changed user id breaks the signature");
  assert.equal(await gateUser(r(raw), { PEPPER: "other" }), null, "signed with another secret");
  const expired = raw.replace(/\.(\d{10})\./, ".1000000000.");
  assert.equal(await gateUser(r(expired), env), null);
});

test("a gate cookie dies with its session: sign-out, a new code or a ban ends it", async () => {
  const { env, owner } = await setup();
  const j = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  const raw = j.cookie.split(";")[0];
  const g = await gateUser(new Request("https://ff.test/", { headers: { cookie: raw } }), env);
  forgetSessions(); assert.equal(await liveSession(env, g), true);
  await call(env, `/api/admin/users/${j.d.user.id}`, { method: "POST", token: owner, body: { banned: true } });
  forgetSessions(); assert.equal(await liveSession(env, g), false, "banned");
  // Another member signs out: their cookie stops working too.
  const k = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  const gk = await gateUser(new Request("https://ff.test/", { headers: { cookie: k.cookie.split(";")[0] } }), env);
  await call(env, "/api/logout", { method: "POST", token: k.d.token });
  forgetSessions(); assert.equal(await liveSession(env, gk), false, "signed out");
});

test("a referral link reports itself as a referral, so the browser joins with it as one", async () => {
  const { env } = await setup();
  const look = await call(env, "/api/invite/ownref1");
  assert.equal(look.d.kind, "ref");
});

test("only the front door is public", () => {
  for (const p of ["/api/account", "/api/login", "/api/apply", "/api/pow", "/api/invite/abc1234", "/api/pulse", "/api/oauth/client"]) assert.equal(gatedPath(p), false, p);
  for (const p of ["/api/fresh", "/api/stats", "/api/comments", "/api/u/x", "/api/skills", "/data/home.json", "/labs/tokenizer.html", "/api/accounts"]) assert.equal(gatedPath(p), true, p);
});

test("no invite, no account; a referral link works; a bot's honeypot gets nothing", async () => {
  const { env } = await setup();
  assert.equal((await call(env, "/api/account", { method: "POST", body: { pow: await aged(env) } })).status, 403);
  assert.equal((await call(env, "/api/account", { method: "POST", body: { ref: "ownref1" } })).status, 400, "no proof of work");
  const ok = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^__Host-ff_gate=.+HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", website: "http://spam", pow: await aged(env) } })).status, 400);
});

test("a member's referral link brings in five people a day, then stops", async () => {
  const { env } = await setup();
  const m = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  const ref = m.d.user.ref;
  for (let i = 0; i < 5; i++) assert.equal((await call(env, "/api/account", { method: "POST", body: { ref, pow: await aged(env) } })).status, 200, "join " + (i + 1));
  assert.equal((await call(env, "/api/account", { method: "POST", body: { ref, pow: await aged(env) } })).status, 429);
});

test("invites grant permissions below the maker's role, re-checked at use", async () => {
  const { env, owner } = await setup();
  const mk = (b) => call(env, "/api/admin/invites", { method: "POST", token: owner, body: b });
  assert.equal((await mk({ role: "owner" })).status, 403);
  const inv = (await mk({ role: "mod", teach: "tutor", verified: true, max_uses: 1, days: 7 })).d.code;
  const look = await call(env, "/api/invite/" + inv);
  assert.deepEqual([look.d.role, look.d.teach, look.d.verified], ["mod", "tutor", true]);
  const j = await call(env, "/api/account", { method: "POST", body: { invite: inv, pow: await aged(env) } });
  assert.equal(j.status, 200);
  assert.deepEqual([j.d.user.role, j.d.user.teach, j.d.user.verified], ["mod", "tutor", true]);
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: inv, pow: await aged(env) } })).status, 403, "one use only");
  // The mod can't hand out mod or the check; and an invite from a demoted maker grants nothing.
  const modTok = j.d.token;
  assert.equal((await call(env, "/api/admin/invites", { method: "POST", token: modTok, body: { role: "mod" } })).status, 403);
  assert.equal((await call(env, "/api/admin/invites", { method: "POST", token: modTok, body: { verified: true } })).status, 403);
  const c = (await call(env, "/api/admin/invites", { method: "POST", token: modTok, body: { role: "contributor" } })).d.code;
  env.DB.raw.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(j.d.user.id);
  const k = await call(env, "/api/account", { method: "POST", body: { invite: c, pow: await aged(env) } });
  assert.equal(k.d.user.role, "user");
});

test("expired invites are refused", async () => {
  const { env, owner } = await setup();
  const inv = (await call(env, "/api/admin/invites", { method: "POST", token: owner, body: { days: 1 } })).d.code;
  env.DB.raw.prepare("UPDATE invites SET expires = 1 WHERE code = ?").run(inv);
  assert.equal((await call(env, "/api/invite/" + inv)).status, 410);
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: inv, pow: await aged(env) } })).status, 403);
});

test("apply, wait, get approved, sign in with the same code", async () => {
  const { env, owner } = await setup();
  const a = await call(env, "/api/apply", { method: "POST", body: { name: "Ada Learner", reason: "I want to train a small model on my own GPU.", pow: await aged(env) } });
  assert.equal(a.status, 200);
  const code = a.d.code;
  const pending = await call(env, "/api/login", { method: "POST", body: { code, pow: await aged(env) } });
  assert.equal(pending.status, 409); assert.equal(pending.d.status, "pending");
  const list = (await call(env, "/api/admin/applications", { token: owner })).d.applications;
  assert.equal(list[0].name, "Ada Learner");
  assert.equal((await call(env, "/api/admin/applications/" + list[0].id, { method: "POST", token: owner, body: { decision: "approve" } })).status, 200);
  assert.equal((await call(env, "/api/admin/applications/" + list[0].id, { method: "POST", token: owner, body: { decision: "approve" } })).status, 409, "decided once");
  const inn = await call(env, "/api/login", { method: "POST", body: { code, pow: await aged(env) } });
  assert.equal(inn.status, 200); assert.equal(inn.d.user.name, "Ada Learner");
  assert.match(inn.cookie, /__Host-ff_gate=/);
});

test("applications need a real reason and proof of work, and users can't decide them", async () => {
  const { env } = await setup();
  assert.equal((await call(env, "/api/apply", { method: "POST", body: { name: "Bot", reason: "hi", pow: await aged(env) } })).status, 400);
  assert.equal((await call(env, "/api/apply", { method: "POST", body: { name: "Bot", reason: "I want to learn about models." } })).status, 400);
  const j = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  assert.equal((await call(env, "/api/admin/applications", { token: j.d.token })).status, 403);
});

test("like and dislike are one choice, and no dislike count ever leaks", async () => {
  const { env } = await setup();
  const m = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  const t = m.d.token, item = "v:kCc8FmEb1nY";
  assert.equal((await call(env, "/api/like", { method: "POST", token: t, body: { item, on: true } })).d.likes, 1);
  const d = await call(env, "/api/like", { method: "POST", token: t, body: { item, on: true, kind: "dislike" } });
  assert.equal(d.d.likes, 0, "disliking takes the like back");
  assert.ok(!("dislikes" in d.d), "the dislike count isn't sent");
  const me = (await call(env, "/api/me", { token: t })).d;
  assert.deepEqual([me.likes, me.dislikes], [[], [item]]);
});

test("replies need the green check; staff and verified members can post", async () => {
  const { env, owner } = await setup();
  const m = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  const body = { item: "v:kCc8FmEb1nY", body: "This explains attention well." };
  assert.equal((await call(env, "/api/comments", { method: "POST", token: m.d.token, body })).status, 403);
  await call(env, `/api/admin/users/${m.d.user.id}`, { method: "POST", token: owner, body: { verified: true } });
  assert.equal((await call(env, "/api/comments", { method: "POST", token: m.d.token, body })).status, 200);
  assert.equal((await call(env, "/api/comments", { method: "POST", token: owner, body })).status, 200);
});

test("an invite can be turned off and on, and its total uses changed", async () => {
  const { env, owner } = await setup();
  const code = (await call(env, "/api/admin/invites", { method: "POST", token: owner, body: { max_uses: 5 } })).d.code;
  assert.equal((await call(env, `/api/admin/invites/${code}`, { method: "POST", token: owner, body: { disabled: true } })).status, 200);
  assert.equal((await call(env, "/api/invite/" + code)).status, 410);
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: code, pow: await aged(env) } })).status, 403);
  await call(env, `/api/admin/invites/${code}`, { method: "POST", token: owner, body: { disabled: false, max_uses: 1 } });
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: code, pow: await aged(env) } })).status, 200, "on again");
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: code, pow: await aged(env) } })).status, 403, "the new total of 1 holds");
  // A plain member can't touch it.
  const m = await call(env, "/api/account", { method: "POST", body: { ref: "ownref1", pow: await aged(env) } });
  assert.equal((await call(env, `/api/admin/invites/${code}`, { method: "POST", token: m.d.token, body: { disabled: false } })).status, 403);
});

test("a uses edit and a turn-off that overlap both stick", async () => {
  const { env, owner } = await setup();
  const code = (await call(env, "/api/admin/invites", { method: "POST", token: owner, body: { max_uses: 5 } })).d.code;
  // Slow the invite read down so both requests read before either writes: the race the old code lost.
  const prep = env.DB.prepare;
  env.DB.prepare = (sql) => { const st = prep(sql); if (!/^SELECT \* FROM invites WHERE code/.test(sql)) return st;
    return { bind: (...a) => { const b = st.bind(...a); return { ...b, first: async () => { const r = await b.first(); await new Promise((res) => setTimeout(res, 40)); return r; } }; } }; };
  await Promise.all([
    call(env, `/api/admin/invites/${code}`, { method: "POST", token: owner, body: { disabled: true } }),
    call(env, `/api/admin/invites/${code}`, { method: "POST", token: owner, body: { max_uses: 3 } }),
  ]);
  const row = env.DB.raw.prepare("SELECT disabled, max_uses FROM invites WHERE code = ?").get(code);
  assert.deepEqual([row.disabled, row.max_uses], [1, 3]);
});

test("lowering an unlimited invite to a spent limit stops the next join", async () => {
  const { env, owner } = await setup();
  const code = (await call(env, "/api/admin/invites", { method: "POST", token: owner, body: { max_uses: 0 } })).d.code;
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: code, pow: await aged(env) } })).status, 200);
  await call(env, `/api/admin/invites/${code}`, { method: "POST", token: owner, body: { max_uses: 1 } });
  assert.equal((await call(env, "/api/account", { method: "POST", body: { invite: code, pow: await aged(env) } })).status, 403);
});


test("pairing: a TV shows a code, a member approves, the TV gets its own session once", async () => {
  const { env, owner } = await setup();
  const start = await call(env, "/api/pair/start", { method: "POST", body: { device: "TV" } });
  assert.equal(start.status, 200); assert.match(start.d.code, /^[A-Z0-9]{6}$/);
  const poll = () => call(env, `/api/pair/poll?code=${start.d.code}&secret=${encodeURIComponent(start.d.secret)}`);
  assert.equal((await poll()).d.state, "waiting");
  assert.equal((await call(env, `/api/pair/poll?code=${start.d.code}&secret=wrong`)).d.state, "gone", "the secret stays with the TV");
  assert.equal((await call(env, `/api/pair/${start.d.code}`, { method: "POST" })).status, 401, "only a signed-in member approves");
  assert.equal((await call(env, `/api/pair/${start.d.code}`, { token: owner })).d.device, "TV", "the phone sees what it's approving");
  assert.equal((await call(env, `/api/pair/${start.d.code}`, { method: "POST", token: owner })).status, 200);
  const got = await poll();
  assert.equal(got.d.state, "approved"); assert.equal(got.d.user.id, "owner00001");
  assert.match(got.cookie, /__Host-ff_gate=/);
  assert.notEqual(got.d.token, owner, "the TV gets a session of its own");
  assert.equal((await call(env, "/api/me", { token: got.d.token })).status, 200);
  assert.equal((await poll()).d.state, "gone", "handed out once");
  assert.equal((await call(env, `/api/pair/${start.d.code}`, { method: "POST", token: owner })).status, 404, "a used code can't be approved again");
});
