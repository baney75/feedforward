// The repo check: catalog integrity, learning content, labs, copy rules and syntax. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
// Every .js file under a folder, recursively, as repo-relative paths.
const jsUnder = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? jsUnder(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
const json = (p) => JSON.parse(read(p));
const learn = json("public/data/learn.json");
// Generated catalog files live only on the build machine. CI checks code; the build machine checks both.
const hasData = fs.existsSync(path.join(root, "public/data/videos.json"));
const dataTest = hasData ? test : test.skip;
const people = hasData ? json("public/data/people.json") : [];
const videos = hasData ? json("public/data/videos.json").rows : [];
const posts = hasData ? json("public/data/posts.json").rows : [];
const ids = new Set(videos.map((v) => v[0]));

dataTest("catalog is large and well formed", () => {
  assert.ok(videos.length > 10000, `only ${videos.length} videos`);
  assert.ok(posts.length > 1000, `only ${posts.length} posts`);
  assert.equal(ids.size, videos.length, "duplicate video ids");
  for (const v of videos) {
    assert.match(v[0], /^[\w-]{11}$/, "bad id " + v[0]);
    assert.ok(typeof v[1] === "string" && v[1].length, "empty title");
    assert.ok(people[v[5]], "video points at a missing person");
    assert.ok(v[6] >= 0 && v[6] < 9, "bad topic");
  }
  for (const p of posts) {
    assert.ok(people[p.p] && people[p.p].x, "post from a person without an X account");
    assert.match(p.id, /^\d+$/);
  }
});

dataTest("the starter bundle and Shorts are consistent with the full catalog", () => {
  const home = json("public/data/home.json");
  const shorts = json("public/data/shorts.json").rows;
  assert.ok(home.videos.length >= 500 && home.videos.length <= 1500, "starter bundle size " + home.videos.length);
  for (const v of home.videos) assert.ok(ids.has(v[0]), "starter video missing from catalog " + v[0]);
  assert.ok(fs.statSync(path.join(root, "public/data/home.json")).size < 450000, "starter bundle too big to paint fast");
  assert.ok(shorts.length > 100, "only " + shorts.length + " shorts");
  for (const s of shorts) { assert.match(s[0], /^[\w-]{11}$/); assert.ok(people[s[3]], "short from a missing person"); }
});

dataTest("politics and religion are filtered out of posts", () => {
  const bad = /\b(trump|biden|democrats?|republicans?|maga|election|abortion|gaza|jesus|bible)\b/i;
  const hits = posts.filter((p) => bad.test(p.t) || (p.qt && bad.test(p.qt.t)));
  assert.deepEqual(hits.map((p) => p.id), []);
});

dataTest("every person resolves and has a reason to be here", () => {
  const slugs = new Set();
  for (const p of people) {
    assert.ok(p.why && p.why.length > 10, p.name + " has no why");
    assert.ok(p.yt || p.x, p.name + " has no source");
    assert.ok(!slugs.has(p.slug), "duplicate slug " + p.slug); slugs.add(p.slug);
  }
});

dataTest("learning tracks point at real videos, labs and quizzes", () => {
  const labs = new Set(learn.labs.map((l) => l.slug));
  for (const t of learn.tracks) {
    assert.ok(t.steps.length >= 4, t.slug + " is too short");
    for (const s of t.steps) {
      if (s.kind === "video") assert.ok(ids.has(s.id) || (s.title && s.by), `${t.slug}: video ${s.id} is not in the catalog and has no title`);
      if (s.kind === "lab") assert.ok(labs.has(s.slug), `${t.slug}: unknown lab ${s.slug}`);
      if (s.kind === "read") assert.match(s.url, /^https:\/\//);
    }
    for (const q of t.quiz || []) assert.ok(q.answer >= 0 && q.answer < q.options.length && q.why, `${t.slug}: bad quiz item`);
  }
});

test("books are official free editions with complete entries", () => {
  const books = json("public/data/books.json");
  assert.ok(books.length >= 20, "only " + books.length + " books");
  const topics = new Set(["foundations", "local", "agents", "research", "math", "cs", "systems", "making", "labs"]);
  for (const b of books) {
    for (const k of ["title", "authors", "url", "license", "topic", "level", "why"]) assert.ok(b[k], `${b.title}: missing ${k}`);
    assert.match(b.url, /^https?:\/\//);
    assert.ok(topics.has(b.topic), `${b.title}: bad topic ${b.topic}`);
  }
});

test("every lab module exists and follows the contract", () => {
  for (const l of learn.labs) {
    const src = read(`public/labs/${l.slug}.js`);
    assert.match(src, /export\s+(const|let)\s+meta\b/, l.slug + " has no meta export");
    assert.match(src, /export\s+(async\s+)?function\s+mount\b|export\s+const\s+mount\b/, l.slug + " has no mount export");
  }
});

test("copy has no em or en dashes", () => {
  const files = ["public/index.html", "public/data/learn.json", "public/data/books.json", "public/manifest.webmanifest",
    ...jsUnder("public/js"), ...jsUnder("public/labs"), ...jsUnder("worker")];
  const hits = files.filter((f) => /[–—]/.test(read(f)));
  assert.deepEqual(hits, []);
});

test("all JavaScript parses", () => {
  const files = [...jsUnder("public/js"), ...jsUnder("public/labs"), ...jsUnder("worker"), "public/sw.js"];
  for (const f of files) execFileSync(process.execPath, ["--check", path.join(root, f)]);
});

test("the service worker never forwards the browser's navigation request", () => {
  const sw = read("public/sw.js");
  const line = sw.split("\n").find((l) => l.includes('req.mode === "navigate"'));
  assert.ok(line && /new Request\(url\.pathname/.test(line), "navigations must be refetched as a plain GET");
});

test("page styles are scoped so they can't leak into the app shell", () => {
  // Drop comments, keyframe bodies and at-rule preludes; what's left before each "{" is a selector list.
  const css = read("public/css/pages.css").replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "").replace(/@[^{;]+\{/g, "{");
  const bad = [];
  for (const m of css.matchAll(/([^{}@;]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || /^(from|to|\d+%)/.test(sel) || sel.startsWith(":root")) continue;
    for (const part of sel.split(",")) if (!/\.pg\b|\.pg-/.test(part)) bad.push(part.trim());
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test("the site refuses to be framed", () => {
  assert.match(read("public/_headers"), /frame-ancestors 'none'/);
});

test("the service worker never stores signed-in API responses", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /\["\/api\/fresh", "\/api\/stats", "\/api\/live", "\/api\/people\/extra"\]\.includes\(url\.pathname\) && !req\.headers\.get\("authorization"\)/);
});

test("signing out clears this device's synced data, and another account's data never merges", () => {
  const a = read("public/js/account.js");
  assert.match(a, /export async function signOut\(\)[^\n]*clearSynced\(\)/);
  assert.match(a, /if \(owner && owner !== acct\.user\.id\)/);
});

test("people added by admins load on the site", () => {
  assert.match(read("public/js/data.js"), /json\("\/api\/people\/extra"\)/);
});

test("no invisible or direction-changing characters in source (Trojan Source)", () => {
  const files = [...jsUnder("public/js"), ...jsUnder("public/labs"), ...jsUnder("worker"), "public/sw.js", "public/index.html"];
  const bad = files.filter((f) => /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(read(f)));
  assert.deepEqual(bad, []);
});

test("install metadata is complete", () => {
  const m = json("public/manifest.webmanifest");
  assert.equal(m.display, "standalone");
  for (const s of ["192x192", "512x512"]) assert.ok(m.icons.some((i) => i.sizes === s && i.purpose === "maskable"), "missing maskable " + s);
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, "public", i.src.split("?")[0])), "missing " + i.src);
  assert.ok(fs.existsSync(path.join(root, "public/icons/apple-touch-icon.png")));
  assert.ok(fs.existsSync(path.join(root, "public/favicon.ico")));
});

test("share previews stay within what search and social cards show", () => {
  const html = read("public/index.html");
  const meta = (attr) => (html.match(new RegExp(`<meta ${attr} content="([^"]*)"`)) || [])[1] || "";
  const d = meta('name="description"'), og = meta('property="og:description"');
  assert.ok(d && d.length <= 160, `meta description is ${d.length} characters; keep it at 160 or fewer`);
  assert.ok(og && og.length <= 125, `og:description is ${og.length} characters; keep it at 125 or fewer`);
});

test("one logo everywhere: the header, icons and OG scene share the layers mark", () => {
  const files = ["public/index.html", "public/icons/icon.svg", "public/icons/maskable.svg", "scripts/og/scene.html"];
  for (const f of files) {
    const s = read(f);
    assert.ok(!s.includes("M17.5 17l15 15-15 15"), `${f} still has the old prompt-and-dot logo`);
    assert.ok(s.includes('width="8.2" height="32.6" rx="4.1"'), `${f} is missing the layers mark`);
  }
});

test("icon and share-image URLs are versioned, so a new logo replaces cached copies", () => {
  // Link previews and the service worker cache these by URL; the same URL keeps showing the old logo.
  const html = read("public/index.html"), mf = read("public/manifest.webmanifest"), sw = read("public/sw.js");
  const v = (html.match(/\/icons\/icon\.svg\?v=(\d+)/) || [])[1];
  assert.ok(v, "index.html must link /icons/icon.svg?v=<n>");
  for (const ref of ["/favicon.ico", "/icons/apple-touch-icon.png", "/og.mp4"]) assert.ok(html.includes(`${ref}?v=${v}`), `index.html must use ${ref}?v=${v}`);
  for (const m of mf.matchAll(/"(\/icons\/[^"]+)"/g)) assert.ok(m[1].endsWith(`?v=${v}`), `manifest icon ${m[1]} must end with ?v=${v}`);
  assert.ok(sw.includes(`/icons/icon.svg?v=${v}`), "sw.js must precache the versioned icon");
});

test("X videos play through the no-referrer frame, which only Feedforward may embed", () => {
  // video.twimg.com answers 403 when the referrer is another site, so a bare <video> never plays.
  const ui = read("public/js/ui.js"), xv = read("public/xv.html"), h = read("public/_headers");
  assert.ok(!/<video[^>]*src="\$\{esc\(u\)\}"/.test(ui), "post videos must not use a bare <video src>");
  // Cloudflare serves /xv.html at /xv (it redirects), so the page, the iframe and the header rule all use /xv.
  assert.match(ui, /src="\/xv#/);
  assert.match(xv, /<meta name="referrer" content="no-referrer">/);
  assert.match(xv, /video\.twimg\.com/);
  const block = h.slice(h.indexOf("\n/xv\n"));
  assert.ok(block.length > 5, "_headers needs a /xv rule (not /xv.html, which redirects)");
  assert.match(block, /frame-ancestors 'self'/);
  assert.match(block, /Referrer-Policy: no-referrer/);
  assert.match(h, /camera=\(self\)/, "the front door's QR scanner needs the camera");
});


test("share cards: centered, and every page points at one that exists", () => {
  // X and iMessage trim the sides of a card and WhatsApp shows only the center square: cards are built centered
  // (scripts/og/card.html) and the site and invite links must name them.
  const html = read("public/index.html"), worker = read("worker/index.js"), card = read("scripts/og/card.html");
  assert.match(html, /og:image" content="https:\/\/feedforward\.dbaney\.com\/og-card\.jpg\?v=\d+"/);
  assert.match(html, /twitter:image" content="https:\/\/feedforward\.dbaney\.com\/og-card\.jpg\?v=\d+"/);
  assert.match(worker, /\/og-invite\.jpg\?v=\d+/);
  for (const f of ["public/og-card.jpg", "public/og-invite.jpg"]) assert.ok(fs.existsSync(path.join(root, f)), "missing " + f);
  assert.match(card, /#mid \{ position: absolute; left: 50%; top: 50%; transform: translate\(-50%, -50%\); width: 600px;/, "the card's content stays in the center square");
});

test("every gated data file retries with the member's session when the gate cookie is refused", () => {
  for (const page of ["research", "dictionary", "repos"]) {
    const src = read(`public/js/pages/${page}.js`);
    assert.match(src, /gatedFetch\("\/data\//, `${page} must load its data through gatedFetch`);
    assert.doesNotMatch(src, /[^d]fetch\("\/data\//, `${page} must not fetch gated data directly`);
  }
});

test("catalog refresh stays silent: no toast about how many items are new (reported by owner)", () => {
  const app = read("public/js/app.js"), data = read("public/js/data.js");
  assert.ok(!/new since the last update|lt:fresh/.test(app + data));
});

test("bell: a staff queue that grows is new even when its newest timestamp is old (a report has no date)", async () => {
  const { isFresh, markSeen } = await import("../public/js/notify-state.js");
  const before = [{ kind: "flagged", n: 1, ts: 100 }, { kind: "comment", ts: 200 }];
  const m = markSeen(before, 0);
  assert.equal(m.seen, 200);
  assert.equal(isFresh({ kind: "flagged", n: 1, ts: 100 }, m.seen, m.queues), false, "unchanged queue stays read");
  assert.equal(isFresh({ kind: "flagged", n: 2, ts: 100 }, m.seen, m.queues), true, "a new report lights the bell");
  assert.equal(isFresh({ kind: "comment", ts: 201 }, m.seen, m.queues), true);
  assert.equal(markSeen([], 200).queues.flagged, undefined, "an emptied queue starts over");
});

test("bell: a queue cleared between opens lights again on the next arrival", async () => {
  const { isFresh, markSeen, settleQueues } = await import("../public/js/notify-state.js");
  let q = markSeen([{ kind: "applications", n: 5, ts: 1 }], 0).queues;
  q = settleQueues([], q);
  assert.equal(isFresh({ kind: "applications", n: 1, ts: 2 }, 0, q), true, "emptied, then one arrives");
  q = settleQueues([{ kind: "applications", n: 2, ts: 1 }], { applications: 5 });
  assert.equal(q.applications, 2);
  assert.equal(isFresh({ kind: "applications", n: 3, ts: 1 }, 0, q), true, "shrank, then grew");
});

test("one player: the watch page uses the stage, and saving position never starts an account sync", () => {
  assert.doesNotMatch(read("public/js/views.js"), /mountPlayer/, "a second player would stop the mini player surviving navigation");
  const pos = read("public/js/store.js").match(/setPos\(id, t, d\) \{[\s\S]*?\n  \},/)[0];
  assert.doesNotMatch(pos, /write\(/, "write() fires ff:changed, and a 5 second tick would starve the debounced sync");
});

test("Library: a swipe inside a sideways shelf scrolls it and never removes an item", () => {
  assert.match(read("public/js/views.js"), /it\.closest\("\.shelf"\)\) it = null/);
});

test("watch page: one next step, no recommendation wall until asked", () => {
  const src = read("public/js/views.js");
  assert.doesNotMatch(src, /class="side"|upnext-inline/);
  assert.match(src, /id="moreNext"/);
  assert.match(src, /upNext\.find\(\(x\) => !finished\(x\.id\)\)/);
});

test("clickable terms skip ordinary English words", () => {
  const src = read("public/js/terms.js");
  const safe = src.match(/const SAFE = new Set\((\[[^\]]*\])/)[1];
  for (const w of ["agent", "attention", "temperature", "token", "thread", "vector", "matrix"]) assert.ok(!JSON.parse(safe).includes(w), w);
});

test("in-app links keep their hash, so dictionary links land on the term", () => {
  assert.match(read("public/js/app.js"), /nav\(u\.pathname \+ u\.search \+ u\.hash/);
});

test("every new shell module is cached for offline", () => {
  const sw = read("public/sw.js");
  for (const f of ["palette", "terms", "gestures", "stage"]) assert.ok(sw.includes(`"/js/${f}.js"`), f);
});

test("a typed code gets its dashes, whatever word it holds", async () => {
  const { formatCode, isCode, stepCode } = await import(path.join(root, "public/js/code.js"));
  const { WORDS } = await import(path.join(root, "public/js/words.js"));
  const type = (s) => [...s].reduce((v, c) => formatCode(v + c), "");
  for (let i = 0; i + 3 < WORDS.length; i += 3) {
    const code = `${WORDS[i]}-${WORDS[i + 1]}-${WORDS[i + 2]}-${WORDS[i + 3]}-07`;
    assert.equal(type(code.replaceAll("-", "")), code);
    assert.ok(isCode(code));
  }
  assert.equal(formatCode("Otter River cedar_ACORN 42"), "otter-river-cedar-acorn-42");
  assert.equal(formatCode("otter-maple-rocket-42"), "otter-maple-rocket-42", "a whole pasted code is never re-split");
  assert.equal(formatCode("zzzq-qqq-zzz-42"), "zzzq-qqq-zzz-42", "old three-word codes keep working");
  const keys = (text) => { const st = {}; let v = ""; for (const c of text) v = stepCode(st, v + c, { inputType: "insertText", data: c }); return v; };
  assert.equal(keys("otter-maple-rocket-42"), "otter-maple-rocket-42", "an old code typed with its dashes is not split");
  assert.equal(keys("otter maple rocket 42"), "otter-maple-rocket-42", "spaces work the same way");
  assert.equal(keys("otterrivercedaracorn42"), "otter-river-cedar-acorn-42", "no dashes typed still gets auto dashes");
  { const st = {}; let v = "";
    for (const c of "ottermap") v = stepCode(st, v + c, { inputType: "insertText", data: c });
    assert.equal(v, "otter-map-");
    v = stepCode(st, v.slice(0, -1), { inputType: "deleteContentBackward" });
    for (const c of "le") v = stepCode(st, v + c, { inputType: "insertText", data: c });
    assert.equal(v, "otter-maple", "deleting an auto dash keeps it deleted"); }
});

test("iPhone haptics: buttons carry a real switch label, and scripted flips only follow a real tap", () => {
  const src = read("public/js/haptics.js");
  assert.match(src, /setAttribute\("switch", ""\)/);
  assert.match(src, /b\.append\(label\("inset:0"\)\)/);
  assert.match(src, /Date\.now\(\) - lastTap < GRANT\) setTimeout\(flip/);
  assert.match(src, /if \(!e\.isTrusted/);
});

test("notifications: cleared stays cleared, undo restores, a grown queue returns", async () => {
  const { isCleared, clearItems, unclearItems, settleCleared } = await import("../public/js/notify-state.js");
  const a = { id: "c:1", kind: "comment", ts: 5 }, q = (n) => ({ id: "apps", kind: "applications", n, ts: 9 });
  let c = clearItems([a, q(2)], {}, 100);
  assert.ok(isCleared(a, c) && isCleared(q(2), c));
  assert.equal(isCleared({ id: "c:2", kind: "comment", ts: 1 }, c), false, "an older item that was never cleared still shows");
  assert.equal(isCleared(q(3), c), false, "a new application brings the queue back");
  c = unclearItems([a], c, 200);
  assert.equal(isCleared(a, c), false);
  c = settleCleared([q(1)], c, 300);
  assert.equal(isCleared(q(1), c), true, "a cleared queue that only shrank stays cleared");
  assert.equal(isCleared(q(2), c), false, "shrank to 1, then grew to 2: that is news");
  assert.equal(settleCleared([q(1)], c, 400), c, "settled state does not rewrite itself");
});

test("YouTube's end wall is replaced and annotations stay off; Twitch names the page as parent", () => {
  const views = read("public/js/views.js");
  assert.match(views, /!next \|\| track\) \{ endCard\(\); return; \}/);
  assert.match(read("public/js/tv.js"), /iv_load_policy: 3/);
  assert.match(views, /player\.twitch\.tv\/\?channel=\$\{p\.twitch\}&parent=\$\{location\.hostname\}/);
});

test("the theme picker stays short, and a removed theme falls back to the device", () => {
  const list = read("public/js/app.js").match(/const THEMES = \[([\s\S]*?)\n\];/)[1];
  assert.equal((list.match(/\["[a-z]*", "/g) || []).length, 4);
  assert.doesNotMatch(read("public/index.html"), /terminal|sepia/);
});

test("go-anywhere: Enter opens the highlighted row, and private notes leave with the account", () => {
  assert.match(read("public/js/palette.js"), /if \(typeT\) \{ clearTimeout\(typeT\); typeT = 0; paint\(\); \} pick\(active\)/);
  assert.match(read("public/js/account.js"), /SYNCED_KEYS = \[[^\]]*"notes", "recentQ"\]/);
});

test("member home has no animated counters (reported twice: they looked glitchy)", () => {
  const src = read("public/js/views.js");
  assert.doesNotMatch(src, /data-count|liveCounters/, "the count-up stats row must stay gone");
});

test("a sync's answer never wipes what you did while it was on the way", async () => {
  const { mergeMap, mergeList } = await import("../public/js/sync-merge.js");
  assert.deepEqual(mergeMap({ a: 1 }, { a: 1, b: 2 }, { a: 1 }), [{ a: 1, b: 2 }, false], "nothing changed: server wins, no extra sync");
  assert.deepEqual(mergeMap({ a: 1 }, { a: 1 }, { a: 1, c: 3 }), [{ a: 1, c: 3 }, true], "added during the sync");
  assert.deepEqual(mergeMap({ a: 1 }, { a: 1 }, { a: -9 }), [{ a: -9 }, true], "undone during the sync");
  assert.deepEqual(mergeMap({ old: -1 }, {}, { old: -1 }), [{}, false], "an entry the server pruned does not sync forever");
  assert.deepEqual(mergeList(["a", "b"], ["a", "b", "z"], ["n", "a", "b"]), [["n", "a", "b", "z"], true]);
  assert.deepEqual(mergeList(["a"], ["a", "z"], ["a"]), [["a", "z"], false]);
  assert.deepEqual(mergeList([], ["z"], ["n"]), [["n", "z"], true]);
});

test("a track video counts when you finish it, not when you press play", async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  globalThis.CustomEvent ||= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  globalThis.dispatchEvent ||= () => true;
  const { store } = await import("../public/js/store.js");
  store.setPos("x", 30, 600);
  assert.equal(store.isFinished("x"), false);
  store.setPos("x", 545, 600);
  assert.equal(store.isFinished("x"), true);
  store.setPos("x", 3, 600);
  assert.equal(store.isFinished("x"), true, "starting over keeps the credit");
  const src = fs.readFileSync(path.join(root, "public/js/views.js"), "utf8");
  assert.doesNotMatch(src, /stepDone[\s\S]{0,300}hasWatched/, "pressing play earns nothing");
  assert.doesNotMatch(src, /#nextStep/, "moving to the next step earns nothing");
  store.setPos("c", 590, 600); store.clearHistory();
  assert.equal(store.isFinished("c"), false, "clearing history clears finished marks");
  mem.clear();
  mem.set("lt:history", JSON.stringify(["old", "high", "part"]));
  mem.set("lt:pos", JSON.stringify({ high: [570, 600], part: [30, 600] }));
  const { store: s2 } = await import("../public/js/store.js?migrate");
  assert.equal(s2.isDone("v:old"), true, "history from before positions keeps its credit");
  assert.equal(s2.isDone("v:high"), true, "an old position at 90% keeps its credit");
  s2.setPos("old", 3, 600);
  assert.equal(s2.isFinished("old"), true, "and rewatching does not lose it");
  assert.equal(s2.isDone("v:part"), false, "a partly watched video is not finished");
  assert.equal(s2.pos("part").length, 3, "old positions get a time");
  const stage = fs.readFileSync(path.join(root, "public/js/stage.js"), "utf8");
  assert.match(stage, /Math\.abs\(t - cur\.saved\) < 1/, "a paused player never re-reports a place it did not move to");
  delete globalThis.localStorage;
});

test("the topic row stays short: three topics, plus the one you are on", () => {
  const src = read("public/js/ui.js");
  assert.match(src, /chipTopics\(active\)\.map/, "the row is built from the short list");
  assert.doesNotMatch(src, /\$\{TOPICS\.map\(\(t, i\) => `<button class="chip"/, "not from every topic");
  assert.match(src, /MAIN_TOPICS = \[[^\]]*\]/);
  assert.equal(src.match(/MAIN_TOPICS = \[([^\]]*)\]/)[1].split(",").length, 3);
});

test("a Short with no tall thumbnail falls back instead of showing YouTube's grey placeholder", () => {
  const views = read("public/js/views.js"), ui = read("public/js/ui.js");
  assert.doesNotMatch(views, /oardefault/, "that size is missing for about one Short in five");
  assert.match(views, /\/oar2\.jpg/);
  const m = ui.match(/const m = (\/.*?\/)\.exec\(img\.currentSrc/)[1];
  assert.ok(new RegExp(m.slice(1, -1)).test("https://i.ytimg.com/vi/VjGeZRvcMOo/oar2.jpg"), "the placeholder check covers Shorts");
});
