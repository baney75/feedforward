// Agent tokens and the OAuth connector against a real SQLite database built from the migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { oauth } from "./oauth.js";
import { tokenUser, sha } from "./api.js";

const dir = path.dirname(new URL(import.meta.url).pathname);

// A small stand-in for D1: prepare/bind/first/run/all, and batch as one transaction.
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
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(60);
const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function setup() {
  const env = { DB: d1() };
  const t = Math.floor(Date.now() / 1000);
  env.DB.raw.prepare("INSERT INTO users (id, code_hash, ref_code, created) VALUES ('u1', 'h', 'r', ?)").run(t);
  const session = "s".repeat(40);
  env.DB.raw.prepare("INSERT INTO sessions (token_hash, user_id, created, seen) VALUES (?, 'u1', ?, ?)").run(await sha(session), t, t);
  return { env, session };
}
const post = (url, body, headers = {}) => new Request("https://ff.test" + url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function register(env, name) {
  return (await (await oauth(post("/oauth/register", { client_name: name, redirect_uris: [REDIRECT] }), env)).json()).client_id;
}
async function connect(env, session, clientId) {
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER)));
  const ap = await (await oauth(post("/api/oauth/approve", { client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", scope: "read" }, { authorization: "Bearer " + session }), env)).json();
  const code = new URL(ap.redirect).searchParams.get("code");
  const r = await oauth(post("/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER }), env);
  return (await r.json()).access_token;
}
const live = async (env, token) => env.DB.raw.prepare("SELECT COUNT(*) n FROM api_tokens WHERE token_hash = ?").get(await sha(token)).n;

test("two apps with the same name keep separate connector tokens", async () => {
  const { env, session } = await setup();
  const a = await connect(env, session, await register(env, "Claude"));
  const b = await connect(env, session, await register(env, "Claude"));
  assert.match(a, /^ffk_/); assert.match(b, /^ffk_/);
  assert.equal(await live(env, a), 1, "the first machine's token must survive the second machine connecting");
  assert.equal(await live(env, b), 1);
});

test("reconnecting one app replaces only that app's token", async () => {
  const { env, session } = await setup();
  const c1 = await register(env, "Claude"), c2 = await register(env, "Claude");
  const old = await connect(env, session, c1), other = await connect(env, session, c2);
  const fresh = await connect(env, session, c1);
  assert.equal(await live(env, old), 0);
  assert.equal(await live(env, fresh), 1);
  assert.equal(await live(env, other), 1);
});

test("a hand-made token named like a connector survives an OAuth connect", async () => {
  const { env, session } = await setup();
  env.DB.raw.prepare("INSERT INTO api_tokens (id, user_id, token_hash, name, scope, created) VALUES ('t0', 'u1', 'x', 'Claude connector', 'read', 0)").run();
  await connect(env, session, await register(env, "Claude"));
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM api_tokens WHERE id = 't0'").get().n, 1);
});

test("agent tokens never authenticate the account API", async () => {
  const { env, session } = await setup();
  const agent = await connect(env, session, await register(env, "Claude"));
  // Even a session row holding the agent token's hash must not make it an account token.
  env.DB.raw.prepare("INSERT INTO sessions (token_hash, user_id, created, seen) VALUES (?, 'u1', 0, 0)").run(await sha(agent));
  assert.equal(await tokenUser(env, agent), null);
  assert.ok(await tokenUser(env, session), "a real session still signs in");
});
