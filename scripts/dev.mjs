// Local preview: serves public/ with SPA fallback and an empty /api/fresh. Usage: node scripts/dev.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("../public", import.meta.url).pathname);
const port = +(process.argv[2] || 8790);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/fresh")) { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"videos":[],"posts":[]}'); }
  let f = path.join(root, decodeURIComponent(u.pathname));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = fs.existsSync(path.join(f, "index.html")) ? path.join(f, "index.html") : path.join(root, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port));
