// X avatar lookup and the profile feed, with fxtwitter and YouTube replaced by canned responses.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { xAvatar, feedPosts, feedVideos, handle } from "./api.js";

const AV = "https://pbs.twimg.com/profile_images/1/abc_200x200.jpg";
const POSTS = { code: 200, results: [
  { id: "1", text: "NOTHING IS IMPOSSIBLE", author: { screen_name: "baney75", avatar_url: AV }, created_timestamp: 100, media: { photos: [{ url: "https://pbs.twimg.com/media/x.jpg" }] } },
  { id: "2", text: "@someone a reply", author: { screen_name: "baney75", avatar_url: AV }, replying_to: { screen_name: "someone" } },
  { id: "3", text: "a repost", author: { screen_name: "other", avatar_url: "https://pbs.twimg.com/o.jpg" } },
  { id: "4", text: "photo from elsewhere", author: { screen_name: "baney75" }, media: { photos: [{ url: "https://evil.example/x.jpg" }] } },
] };
const RSS = `<feed><entry><yt:videoId>AAAAAAAAAAA</yt:videoId><title>Tom &amp; Jerry &lt;3</title><published>2026-11-01T00:00:00+00:00</published></entry></feed>`;

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    // The case-sensitive miss: the profile endpoint 404s for "baney75", the posts endpoint works.
    if (u === "https://api.fxtwitter.com/baney75") return new Response(JSON.stringify({ code: 404 }), { status: 404 });
    if (u.endsWith("/2/profile/baney75/statuses")) return new Response(JSON.stringify(POSTS));
    if (u === "https://www.youtube.com/@baney75") return new Response('"externalId":"UCabcdefghijklmnopqrstuv"');
    if (u.includes("feeds/videos.xml")) return new Response(RSS);
    return new Response("{}", { status: 404 });
  };
});

test("X avatar falls back to the account's own posts when the profile lookup 404s", async () => {
  assert.equal(await xAvatar("baney75"), AV);
});

test("profile feed keeps the member's own posts, drops replies, reposts and outside images", () => {
  const p = feedPosts(POSTS, "baney75");
  assert.deepEqual(p.map((x) => x.id), ["1", "4"]);
  assert.equal(p[0].photo, "https://pbs.twimg.com/media/x.jpg");
  assert.equal(p[1].photo, "");
});

test("YouTube feed parses ids, unescapes titles and reads dates", () => {
  assert.deepEqual(feedVideos(RSS), [{ id: "AAAAAAAAAAA", title: "Tom & Jerry <3", ts: 1793491200 }]);
});

let ttls;
function env(verified) {
  ttls = [];
  const user = { id: "u1", verified, links: JSON.stringify({ x: "baney75", youtube: "@baney75" }) };
  const kv = new Map();
  return {
    DB: { prepare: () => ({ bind: () => ({ first: async () => user, run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) }) },
    FRESH: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v, o) => { ttls.push(o && o.expirationTtl); kv.set(k, v); } },
  };
}
const feed = (e) => handle(new Request("https://ff.test/api/u/u1/feed"), e).then((r) => r.json());

test("verified members get their X posts and YouTube uploads, cached", async () => {
  const e = env(1);
  const f = await feed(e);
  assert.deepEqual(f.posts.map((p) => p.id), ["1", "4"]);
  assert.equal(f.videos[0].id, "AAAAAAAAAAA");
  const n = calls.length;
  await feed(e);
  assert.equal(calls.length, n, "the second load comes from the cache");
});

test("unverified members show no outside posts", async () => {
  const f = await feed(env(0));
  assert.deepEqual(f, { posts: [], videos: [] });
  assert.equal(calls.length, 0);
});

test("a failed source is retried in 2 minutes, not cached for 30", async () => {
  const e = env(1);
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes("fxtwitter") ? new Response(JSON.stringify({ code: 404 }), { status: 404 }) : real(url));
  const f = await feed(e);
  assert.deepEqual(f.posts, []);
  assert.equal(f.videos.length, 1);
  assert.deepEqual(ttls, [120]);
});

test("a good load is cached for 30 minutes", async () => {
  await feed(env(1));
  assert.deepEqual(ttls, [1800]);
});

