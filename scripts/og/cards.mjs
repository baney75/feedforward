#!/usr/bin/env node
// Renders the link-preview cards from card.html: public/og-invite.jpg (invite links) and public/og-card.jpg (the site).
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/og/invite.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || "playwright");
// Serve the repo so the page can load fonts, thumbnails and thumbs.json over http.
const types = { ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(new URL(q.url, "http://x").pathname)); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const b = await chromium.launch();
for (const [kind, file] of [["invite", "og-invite.jpg"], ["main", "og-card.jpg"]]) {
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto(`http://127.0.0.1:${srv.address().port}/scripts/og/card.html?kind=${kind}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  const png = path.join(os.tmpdir(), `og-${kind}.png`);
  await p.locator("#c").screenshot({ path: png });
  await p.close();
  const out = path.join(ROOT, "public", file);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", png, "-q:v", "3", out]);
  console.log(file, fs.statSync(out).size, "bytes");
}
await b.close(); srv.close();
