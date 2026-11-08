// Shorts on an iPhone, in WebKit (Safari's engine): the catalog loads, and the action column is one even set of
// round buttons with nothing drawn behind like and dislike. A Chromium-only check missed this once.
// Usage: PLAYWRIGHT=/path/to/playwright-core node scripts/iphone.e2e.mjs http://127.0.0.1:8796
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const BASE = process.argv[2] || "http://127.0.0.1:8796";
const { webkit, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || "playwright");
const RUN = Date.now().toString(36), TOK = "iphone" + RUN + "z".repeat(28), UID = ("ip" + RUN).slice(0, 10);
const H = createHash("sha256").update(TOK).digest("hex");
execFileSync("npx", ["-y", "wrangler@4.154.0", "d1", "execute", "feedforward", "--local", "--command",
  `INSERT INTO users (id, code_hash, ref_code, name, verified, created) VALUES ('${UID}', 'ip-${RUN}', 'i${RUN.slice(-6)}', 'iPhone Tester', 1, 1790000000); INSERT INTO sessions (token_hash, user_id, created, seen) VALUES ('${H}', '${UID}', 1794000000, 1794000000);`], { stdio: "pipe" });
let pass = 0; const ok = (m) => { pass++; console.log("ok  " + m); };
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices["iPhone 15"], colorScheme: "dark" });
await ctx.addInitScript(([tok, uid]) => { try { sessionStorage.setItem("ff:launched", "1"); } catch {} localStorage.setItem("lt:acct", JSON.stringify({ token: tok, user: { id: uid, name: "iPhone Tester", role: "user", verified: true } })); }, [TOK, UID]);
// WebKit reports a request cut off by leaving the page as "Load failed"; that's the test navigating, not a bug.
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => { if (!/Load failed|access control checks|A network error occurred/.test(e.message)) errs.push(e.message); });
await p.goto(BASE + "/shorts", { waitUntil: "load" });
await p.waitForSelector(".short .sacts", { timeout: 20000 }); ok("Shorts load in WebKit (the catalog loads even without the gate cookie)");
const look = await p.evaluate(() => {
  const s = document.querySelector(".short"), icons = [...s.querySelectorAll(".sacts svg")].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  const vote = s.querySelector(".sacts .vote");
  return { icons, voteBg: vote ? getComputedStyle(vote).backgroundColor : "none", voteDisplay: vote ? getComputedStyle(vote).display : "none" };
});
assert.ok(look.icons.length >= 5, "five actions");
assert.ok(look.icons.every(([w, h]) => w === look.icons[0][0] && h === look.icons[0][1]), "every action is the same size: " + JSON.stringify(look.icons));
ok("every Shorts action is the same round button");
assert.ok(look.voteDisplay === "contents" || /rgba\(0, 0, 0, 0\)|transparent/.test(look.voteBg), "nothing drawn behind like and dislike: " + look.voteBg);
ok("nothing is drawn behind like and dislike");
// Tapping an action does the action (the tap layer must not swallow it).
const save = await p.$(".short .sacts [data-save]");
const before = await save.getAttribute("aria-pressed");
await save.tap();
await p.waitForTimeout(500);
assert.notEqual(await save.getAttribute("aria-pressed"), before, "Save toggles");
assert.ok(!(await p.evaluate(() => document.querySelector(".short").classList.contains("paused"))), "the tap didn't pause the video");
ok("tapping Save saves, and doesn't pause the video");
// With sound turned on earlier, a new Short still starts muted (Safari blocks unmuted autoplay).
await p.evaluate(() => sessionStorage.setItem("ff:sound", "1"));
await p.reload({ waitUntil: "load" });
await p.waitForSelector(".short iframe", { timeout: 20000 });
assert.match(await p.getAttribute(".short iframe", "src"), /[?&]mute=1/);
ok("every Short starts muted, even after sound was turned on");
// The top bar gets out of the way on scroll down and comes back on scroll up.
await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForSelector(".vcard", { timeout: 20000 });
await p.evaluate(async () => { for (let y = 0; y <= 900; y += 150) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
assert.ok(await p.evaluate(() => document.querySelector(".topbar").classList.contains("away")), "hidden after scrolling down");
await p.evaluate(async () => { for (let y = 900; y >= 700; y -= 50) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
assert.ok(!(await p.evaluate(() => document.querySelector(".topbar").classList.contains("away"))), "back after scrolling up");
ok("the top bar hides on scroll down and returns on scroll up");

// Turn off Shorts: the tab goes away and a Shorts link explains they're off.
await p.goto(BASE + "/me", { waitUntil: "load" });
await p.waitForSelector("#prefShorts", { timeout: 20000 });
await p.check("#prefShorts");
assert.ok(!(await p.$('.tabbar a[href="/shorts"]')), "no Shorts tab");
ok("turning off Shorts removes them from the tab bar");
await p.goto(BASE + "/shorts", { waitUntil: "load" });
await p.waitForSelector(".shorts-off", { timeout: 20000 });
assert.ok(!(await p.$(".short")), "no Shorts play");
ok("a Shorts link says they're off instead of playing");
assert.deepEqual(errs, []);
await b.close();
console.log(`\n${pass} checks passed`);
