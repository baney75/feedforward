// The site was first published as LocalTube. Send old links to the same path on feedforward.dbaney.com.
// /sw.js is a kill switch: browsers that installed the old LocalTube service worker fetch it on their next
// visit, and it clears the old caches, unregisters itself and moves open pages to the new domain.
const KILL = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window" })) c.navigate("https://feedforward.dbaney.com" + new URL(c.url).pathname);
})()));`;

export default {
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/sw.js") return new Response(KILL, { headers: { "content-type": "text/javascript", "cache-control": "no-cache" } });
    return Response.redirect(`https://feedforward.dbaney.com${u.pathname}${u.search}`, 301);
  },
};
