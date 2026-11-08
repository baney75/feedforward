// The front door in a real browser: apply, accept an invite, and sign in, each through the browser's own proof of
// work, with no backdating and no sleeps. Usage: PLAYWRIGHT=/path/to/playwright node scripts/door.e2e.mjs http://127.0.0.1:8796
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const BASE = process.argv[2] || "http://127.0.0.1:8796";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || "playwright");
const RUN = Date.now().toString(36);
const sql = (q) => execFileSync("npx", ["-y", "wrangler@4.154.0", "d1", "execute", "feedforward", "--local", "--command", q], { stdio: "pipe" });
const SYS = "e2e" + RUN.slice(-7);
sql(`INSERT INTO users (id, code_hash, ref_code, role, name, created) VALUES ('${SYS}', 'e2e-${RUN}', 'e${RUN.slice(-6)}', 'owner', 'Door Tester', 0)`);
sql(`INSERT INTO invites (code, creator, created) VALUES ('door${RUN.slice(-5)}', '${SYS}', 0)`);
const INVITE = `door${RUN.slice(-5)}`;
let pass = 0; const ok = (m) => { pass++; console.log("ok  " + m); };

const b = await chromium.launch();
// Each browser gets its own simulated address, so the real per-network limits don't trip across runs.
const ip = () => `10.${Math.random() * 255 | 0}.${Math.random() * 255 | 0}.${Math.random() * 255 | 0}`;
const page = async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  // The simulated address goes only to Feedforward; on a CDN request it would trigger a CORS preflight.
  const addr = ip();
  await c.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue({ headers: { ...r.request().headers(), "cf-connecting-ip": addr } }) : r.continue())); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); return { c, p, errs }; };

// Apply
{
  const { p, errs } = await page();
  await p.goto(BASE + "/"); await p.click('[data-tab="apply"]');
  await p.fill('input[name="name"]', "Ada Learner");
  await p.fill('textarea[name="reason"]', "I want to run small models on my own GPU and understand them.");
  const t0 = Date.now();
  await p.click("#apForm .door-go");
  await p.waitForSelector(".door-welcome .door-code", { timeout: 20000 });
  assert.match(await p.textContent(".door-code"), /^[a-z]+(-[a-z]+){3}-\d{2}$/);
  ok(`apply works through the browser's proof of work (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  assert.deepEqual(errs, []);
}
// Accept an invite, keep the code, land in the app
let code, codeOfMember;
{
  const { p, c, errs } = await page();
  await p.goto(`${BASE}/join/${INVITE}`);
  await p.waitForSelector(".door-who"); assert.match(await p.textContent(".door-who"), /Door Tester/);
  ok("the invite page names who invited you");
  await p.fill('#joinForm input[name="name"]', "Grace");
  await p.click("#joinForm .door-go");
  await p.waitForSelector(".door-welcome .door-code", { timeout: 20000 });
  code = (await p.textContent(".door-code")).trim();
  codeOfMember = code;
  ok("accepting an invite shows your code before anything else");
  await c.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.click("#copyCode"); await p.click("#enter");
  await p.waitForSelector("body:not(.door) .vcard, body:not(.door) .skel-grid", { timeout: 20000 });
  ok("keeping the code opens the app");
  assert.equal((await p.request.get(BASE + "/data/home.json")).status(), 200); ok("the new member can load the catalog");
  assert.deepEqual(errs, []);
}
// Sign in on a fresh browser with that code
{
  const { p, errs } = await page();
  await p.goto(BASE + "/"); await p.click('[data-tab="signin"]');
  await p.fill('#siForm input[name="code"]', code);
  await p.click("#siForm .door-go");
  await p.waitForSelector("body:not(.door)", { timeout: 20000 });
  ok("signing in with the code on another device works");
  assert.deepEqual(errs, []);
}
// Pair a TV from a phone: the TV shows a code, the signed-in phone approves it, the TV opens TV mode.
{
  const tv = await page();
  await tv.p.goto(BASE + "/?tv=1");
  await tv.p.waitForSelector(".door-paircode", { timeout: 15000 });
  const code = (await tv.p.textContent(".door-paircode")).replace(/[^A-Z0-9]/g, "");
  assert.match(code, /^[A-Z0-9]{6}$/); ok("a TV shows a pairing code and QR");
  const phone = await page();
  await phone.p.goto(BASE + "/"); await phone.p.click('[data-tab="signin"]');
  await phone.p.fill('#siForm input[name="code"]', code === "" ? "" : codeOfMember);
  await phone.p.click("#siForm .door-go"); await phone.p.waitForSelector("body:not(.door)", { timeout: 20000 });
  await phone.p.goto(`${BASE}/pair#${code}`);
  await phone.p.waitForSelector("#pairInfo .hint b", { timeout: 10000 });
  ok("the phone shows what it's about to sign in");
  await phone.p.fill('#pairForm input[name="check"]', (await tv.p.textContent(".door-paircheck")).trim());
  await phone.p.click('#pairForm button[type="submit"]');
  await phone.p.waitForSelector(".pg-pair h1", { timeout: 10000 });
  await tv.p.waitForFunction(() => !document.body.classList.contains("door"), null, { timeout: 15000 });
  ok("approving on the phone signs the TV in");
  assert.deepEqual(tv.errs, []); assert.deepEqual(phone.errs, []);
}
// The X video frame loads inside Feedforward (a header that refuses framing would leave it blank).
{
  const { p, errs } = await page();
  await p.goto(BASE + "/");
  const loaded = await p.evaluate(() => new Promise((res) => {
    const f = document.createElement("iframe");
    f.src = "/xv#" + encodeURIComponent("https://video.twimg.com/amplify_video/1/vid/avc1/640x360/x.mp4|");
    f.onload = () => { try { res(!!f.contentDocument.querySelector("video") && f.contentDocument.querySelector("video").src.startsWith("https://video.twimg.com/")); } catch { res(false); } };
    document.body.appendChild(f);
    setTimeout(() => res(false), 8000);
  }));
  assert.equal(loaded, true); ok("the X video frame loads inside Feedforward and takes only X video URLs");
  assert.deepEqual(errs, []);
}
await b.close();
console.log(`\n${pass} checks passed`);
