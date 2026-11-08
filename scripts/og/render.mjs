#!/usr/bin/env node
// Renders the Feedforward Open Graph video and still from scene.html, frame by frame.
//
//   node scripts/og/render.mjs                 # frames to a temp dir, writes public/og.{mp4,webm,jpg}
//   node scripts/og/render.mjs --frames DIR    # keep the PNG frames in DIR
//   node scripts/og/render.mjs --still 5.5     # pick the moment used for og.jpg (seconds)
//   node scripts/og/render.mjs --sub 1         # motion-blur subframes per frame (default 6, 24 in fast windows; 1 = none)
//   node scripts/og/render.mjs --peek 0,4.2    # render just those moments as PNGs into the frames dir
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/og/render.mjs
//
// Needs ffmpeg on PATH and a Playwright install with Chromium.
// Stats come from public/data/meta.json, public/data/books.json and the lab files in public/labs.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PUB = path.join(ROOT, "public");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const STILL_T = parseFloat(opt("--still", "5.6"));
const SUB = parseInt(opt("--sub", "6"), 10);   // motion-blur subframes per frame
const SUB_FAST = SUB > 1 ? 4 * SUB : 1;         // inside the scene's FAST windows, so quick moves smear instead of stepping
const SHUTTER = 0.5;                            // 180 degree shutter: subframes span half a frame, centred on it
const FRAMES = path.resolve(opt("--frames", fs.mkdtempSync(path.join(os.tmpdir(), "og-frames-"))));
const PW = process.env.PLAYWRIGHT || "playwright";   // set PLAYWRIGHT to a path if it is installed elsewhere
const { chromium } = createRequire(import.meta.url)(PW);

// ---- real numbers ----
const meta = JSON.parse(fs.readFileSync(path.join(PUB, "data/meta.json"), "utf8"));
const books = JSON.parse(fs.readFileSync(path.join(PUB, "data/books.json"), "utf8"));
const labs = fs.readdirSync(path.join(PUB, "labs")).filter(f => f.endsWith(".js") && !f.startsWith("_")
  && !/^lab-kit|-worker\.js$|-tools\.js$/.test(f)).length;
const stats = [[meta.people, "people"], [meta.videos, "videos"], [meta.shorts, "Shorts"], [meta.posts, "posts"],
  [books.length, "books"], [labs, "labs"]];
console.log("stats", stats.map(s => s.join(" ")).join(", "));

// ---- thumbnails (cached next to this script; fetched if missing) ----
const thumbs = JSON.parse(fs.readFileSync(path.join(HERE, "thumbs.json"), "utf8"));
fs.mkdirSync(path.join(HERE, "thumbs"), { recursive: true });
for (const t of thumbs) {
  const f = path.join(HERE, "thumbs", `${t.id}.jpg`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`);
    if (!r.ok) throw new Error(`thumbnail ${t.id}: HTTP ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
}
const data = { stats, thumbs: thumbs.map(t => ({ src: `thumbs/${t.id}.jpg`, dur: t.dur })) };

// ---- render ----
// Grayscale text AA and a fixed color profile keep each frame independent of what was painted before it.
const browser = await chromium.launch({ args: ["--disable-lcd-text", "--force-color-profile=srgb", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(d => { window.__OG_DATA = d; }, data);
await page.goto(pathToFileURL(path.join(HERE, "scene.html")).href);
await page.evaluate(() => window.__ready);
// Set the scene to time t and wait for two painted frames, so a screenshot never catches a stale paint.
// tf is the frame's own time: discrete state (counters, typing, cursor) follows it, continuous motion follows t.
const show = (t, tf = t) => page.evaluate(([t, tf]) => new Promise(r => { window.__og.render(t, tf); requestAnimationFrame(() => requestAnimationFrame(r)); }), [t, tf]);
const { frames, FPS, FAST } = await page.evaluate(() => ({ frames: window.__og.frames, FPS: window.__og.FPS, FAST: window.__og.FAST }));

// Averages PNG screenshots in a blank page (exact integer mean, rounded), so motion blur needs nothing beyond Chromium.
const mixer = await browser.newPage();
const average = async bufs => bufs.length === 1 ? bufs[0] : Buffer.from(await mixer.evaluate(async srcs => {
  let sum, w, h;
  for (const src of srcs) {
    const im = new Image(); im.src = "data:image/png;base64," + src; await im.decode();
    w = im.width; h = im.height;
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    sum ??= new Uint32Array(d.length);
    for (let i = 0; i < d.length; i++) sum[i] += d[i];
  }
  const out = new ImageData(w, h), n = srcs.length;
  for (let i = 0; i < sum.length; i++) out.data[i] = Math.round(sum[i] / n);
  const c = new OffscreenCanvas(w, h); c.getContext("2d").putImageData(out, 0, 0);
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}, bufs.map(b => b.toString("base64"))), "base64");

fs.mkdirSync(FRAMES, { recursive: true });
// --peek 0,1.5,4.2 renders just those moments to FRAMES/peek-<t>.png and stops (no encode, no outputs touched).
const peek = opt("--peek", null);
if (peek) {
  for (const t of peek.split(",").map(Number)) {
    await show(t);
    await page.screenshot({ path: path.join(FRAMES, `peek-${t.toFixed(2)}.png`) });
  }
  await browser.close();
  if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }
  console.log("peek frames in", FRAMES); process.exit(0);
}
const t0 = Date.now();
// the mixer must be lossless: the mean of one image with itself is that image
{
  await show(4.2); const a = await page.screenshot(), m = await average([a, a]);
  const same = await mixer.evaluate(async ([x, y]) => {
    const px = async s => { const im = new Image(); im.src = "data:image/png;base64," + s; await im.decode();
      const c = new OffscreenCanvas(im.width, im.height), g = c.getContext("2d"); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
    const [p, q] = [await px(x), await px(y)]; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false; return true;
  }, [a.toString("base64"), m.toString("base64")]);
  if (!same) errors.push("frame mixer is not lossless");
}
// Motion blur: n subframes per frame, centred on the frame time and spread over SHUTTER of a frame, averaged.
// render() wraps t modulo the duration, so frame 0 borrows its first subframes from the loop's end.
let shots = 0;
for (let f = 0; f < frames; f++) {
  const tf = f / FPS, n = FAST.some(([a, b]) => tf >= a && tf <= b) ? SUB_FAST : SUB;
  const subs = [];
  for (let k = 0; k < n; k++) {
    const off = n > 1 ? (k / (n - 1) - 0.5) * SHUTTER : 0;
    await show((f + off) / FPS, tf);
    subs.push(await page.screenshot()); shots++;
  }
  fs.writeFileSync(path.join(FRAMES, `f${String(f).padStart(4, "0")}.png`), await average(subs));
  if (f % 10 === 0) process.stdout.write(`frame ${f}/${frames}\r`);
}
console.log(`\n${shots} subframes`);
console.log(`\n${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${FRAMES}`);

// determinism: the same moment rendered twice must match byte for byte
for (const t of [1.7, 2.3, 4.2, 6.6, 7.7]) {
  await show(t); const a = await page.screenshot();
  await show((t + 3.3) % 8); await show(t); const b = await page.screenshot();
  // Same moment, different history. Allow 1/255 of compositor rounding; anything more is state leaking between frames.
  const maxDiff = a.equals(b) ? 0 : await page.evaluate(async ([x, y]) => {
    const px = async src => { const im = new Image(); im.src = "data:image/png;base64," + src; await im.decode();
      const c = new OffscreenCanvas(im.width, im.height), g = c.getContext("2d"); g.drawImage(im, 0, 0);
      return g.getImageData(0, 0, im.width, im.height).data; };
    const [p, q] = [await px(x), await px(y)]; let m = 0;
    for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i]));
    return m;
  }, [a.toString("base64"), b.toString("base64")]);
  console.log(`determinism t=${t}: max channel difference ${maxDiff}/255`);
  if (maxDiff > 1) {
    fs.writeFileSync(path.join(FRAMES, `det-${t}-a.png`), a); fs.writeFileSync(path.join(FRAMES, `det-${t}-b.png`), b);
    errors.push(`render(${t}) is not deterministic (both captures saved in ${FRAMES})`);
  }
}

// still: JPEG under 200 KB
await show(STILL_T);
let q = 90, jpg;
do { jpg = await page.screenshot({ type: "jpeg", quality: q }); q -= 4; } while (jpg.length > 195_000 && q > 40);
fs.writeFileSync(path.join(PUB, "og.jpg"), jpg);
console.log(`og.jpg at t=${STILL_T}s, quality ${q + 4}, ${jpg.length} bytes`);
await browser.close();
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }

// ---- encode ----
const input = ["-y", "-v", "error", "-framerate", String(FPS), "-i", path.join(FRAMES, "f%04d.png")];
execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-tune", "animation",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", path.join(PUB, "og.mp4")], { stdio: "inherit" });
execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good",
  "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", path.join(PUB, "og.webm")], { stdio: "inherit" });
for (const f of ["og.mp4", "og.webm", "og.jpg"]) console.log(f, fs.statSync(path.join(PUB, f)).size, "bytes");
