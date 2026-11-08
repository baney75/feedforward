// Worker refresh logic against canned RSS and fxtwitter responses.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Load worker/index.js with its JSON import replaced by an inline source list.
const dir = path.dirname(new URL(import.meta.url).pathname);
let src = fs.readFileSync(path.join(dir, "index.js"), "utf8");
src = src.replace(/import SOURCES from "\.\/sources\.json";/, 'const SOURCES = [{"i":0,"yt":"UC1","mode":"ai","x":"alice","topic":"local"}];');
const tmp = path.join(dir, ".worker.test.tmp.mjs");
fs.writeFileSync(tmp, src);
const W = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

const RSS = `<feed><entry><yt:videoId>AAAAAAAAAAA</yt:videoId><title>Running Qwen locally with llama.cpp</title><link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/><published>${new Date(Date.now() - 864e5).toISOString()}</published><media:statistics views="1234"/></entry>
<entry><yt:videoId>BBBBBBBBBBB</yt:videoId><title>My trip to the beach</title><link rel="alternate" href="https://www.youtube.com/watch?v=BBBBBBBBBBB"/><published>${new Date().toISOString()}</published></entry>
<entry><yt:videoId>CCCCCCCCCCC</yt:videoId><title>Quick GPU tip</title><link rel="alternate" href="https://www.youtube.com/shorts/CCCCCCCCCCC"/><published>${new Date().toISOString()}</published></entry></feed>`;
const now = Math.floor(Date.now() / 1000);
const FX = { code: 200, results: [
  { id: "1", text: "New open weights model runs at 40 tokens per second on my Mac with MLX, here is the full recipe and the numbers.", author: { screen_name: "alice" }, created_timestamp: now - 3600, likes: 900 },
  { id: "2", text: "The election results are in and I have a lot of thoughts about what the senate should do next about AI policy.", author: { screen_name: "alice" }, created_timestamp: now - 3600, likes: 5000 },
  { id: "3", text: "Replying to someone else about a model they trained on a big GPU cluster last week, great work there.", author: { screen_name: "alice" }, replying_to: { screen_name: "bob" }, created_timestamp: now, likes: 3 },
  { id: "5", text: "Permanent underclass is dead\n\nOpenAI shaking", quote: { id: "9", text: "Introducing a new open weights model with 17B active parameters for local inference." }, author: { screen_name: "alice" }, created_timestamp: now, likes: 4000 },
  { id: "4", text: "Had a great lunch today with family, the weather was perfect and the kids loved the park near our place.", author: { screen_name: "alice" }, created_timestamp: now, likes: 50 },
] };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("feeds/videos.xml")) return new Response(RSS);
  if (u.includes("fxtwitter")) return new Response(JSON.stringify(FX));
  return new Response("", { status: 404 });
};

function kv() { const m = new Map(); return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => m.set(k, v) }; }

test("refresh keeps on-topic uploads and posts, drops politics, personal posts, replies and Shorts", async () => {
  const env = { FRESH: kv() };
  const out = await W.refresh(env);
  assert.deepEqual(out.videos.map((v) => v[0]), ["AAAAAAAAAAA"]);
  assert.equal(out.videos[0][6], 1, "llama.cpp video should be tagged Local AI");
  assert.deepEqual(out.posts.map((p) => p.id), ["1"]);
  const again = await W.refresh(env);
  assert.equal(again.videos.length, 1, "refresh should not duplicate");
});

test("/api/fresh serves the stored feed to members only", async () => {
  const env = { FRESH: kv(), ASSETS: { fetch: () => new Response("asset") }, PEPPER: "test" };
  await W.refresh(env);
  assert.equal((await W.default.fetch(new Request("https://x/api/fresh"), env)).status, 401, "invite-only: no gate, no feed");
  const { gateCookie } = await import(pathToFileURL(path.join(dir, "gate.js")).href);
  const cookie = (await gateCookie(env, "abcd123456")).split(";")[0];
  const r = await W.default.fetch(new Request("https://x/api/fresh", { headers: { cookie } }), env);
  const d = await r.json();
  assert.equal(d.posts.length, 1);
  assert.equal((await (await W.default.fetch(new Request("https://x/"), env)).text()), "asset");
});

test("old LocalTube links redirect to the same path on feedforward.dbaney.com", async () => {
  const R = await import(pathToFileURL(path.join(dir, "redirect.js")).href);
  const r = R.default.fetch(new Request("https://localtube.dbaney.com/watch/abc?x=1"));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://feedforward.dbaney.com/watch/abc?x=1");
});

test("the old domain serves a service worker kill switch instead of a redirect", async () => {
  const R = await import(pathToFileURL(path.join(dir, "redirect.js")).href);
  const r = R.default.fetch(new Request("https://localtube.dbaney.com/sw.js"));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /unregister\(\)/);
});
