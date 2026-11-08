// Offline support. App code: network first, cache fallback. Fonts and icons: cache first. Thumbnails: the cached
// copy at once, refreshed in the background. Catalog data is members-only: always asked of the network, kept
// only for offline use, and wiped the moment the server says this browser isn't a member.
// Only our own "lt-" caches are ever deleted, so a lab's model cache (transformers-cache) survives updates.
// lt-data-v5: every catalog copy cached before Feedforward went invite-only is deleted on activate.
const APP = "lt-app-v10", DATA = "lt-data-v5", IMG = "lt-img-v1";
const SHELL = ["/", "/css/tokens.css", "/css/app.css", "/js/app.js", "/js/data.js", "/js/ui.js", "/js/views.js", "/js/tv.js", "/js/icons.js", "/js/store.js", "/js/account.js", "/js/social.js", "/js/notify.js", "/js/stage.js", "/js/palette.js", "/js/terms.js", "/js/gestures.js", "/js/notify-state.js", "/css/pages.css",
  "/manifest.webmanifest", "/icons/icon.svg?v=3", "/fonts/ibm-plex-sans-latin-400-normal.woff2", "/fonts/ibm-plex-sans-latin-600-normal.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("lt-") && ![APP, DATA, IMG].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, name, fallbackUrl) {
  const c = await caches.open(name);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(fallbackUrl || req, r.clone());
    return r;
  } catch {
    return (await c.match(fallbackUrl || req)) || (await c.match("/")) || Response.error();
  }
}
// Members-only files: the network decides. A 401 wipes the cached catalog and passes through; the cache answers
// only when there's no network at all.
async function memberOnly(req) {
  const c = await caches.open(DATA);
  let r;
  try { r = await fetch(req); } catch { return (await c.match(req)) || Response.error(); }
  if (r.status === 401 || r.status === 403) { await caches.delete(DATA); return r; }
  if (r.ok) c.put(req, r.clone());
  return r;
}
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") c.put(req, r.clone());
  return r;
}
async function swr(req, name, max) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()).then(() => max && trim(c, max)); return r; }).catch(() => hit);
  return hit || net;
}
async function trim(c, max) {
  const ks = await c.keys();
  for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Navigations: fetch the URL as a plain same-origin GET. Forwarding the browser's navigation Request
    // itself got a 403 from the edge (2026-11-07), while the same URL as an ordinary request returns 200.
    if (req.mode === "navigate") return e.respondWith(networkFirst(new Request(url.pathname + url.search, { credentials: "same-origin" }), APP, "/"));
    // Catalog feeds are kept for offline use, members only. Anything with a Bearer token (profile, tokens, admin)
    // is never stored.
    if (url.pathname.startsWith("/api/")) {
      if (["/api/fresh", "/api/stats", "/api/live", "/api/people/extra"].includes(url.pathname) && !req.headers.get("authorization")) return e.respondWith(memberOnly(req));
      return;
    }
    if (url.pathname.startsWith("/data/")) return e.respondWith(memberOnly(req));
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/")) return e.respondWith(cacheFirst(req, APP));
    return e.respondWith(networkFirst(req, APP));
  }
  if (url.hostname === "i.ytimg.com" || url.hostname === "pbs.twimg.com" || url.hostname === "yt3.googleusercontent.com" || url.hostname === "yt3.ggpht.com") {
    return e.respondWith(swr(req, IMG, 600));
  }
});
