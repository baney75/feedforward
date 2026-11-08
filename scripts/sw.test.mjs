// The service worker never hands member-only files to a browser the server has turned away.
// Runs public/sw.js in a sandbox with fake caches and a fake network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
function load(net) {
  const stores = new Map(), handlers = {};
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name), key = (r) => (typeof r === "string" ? r : r.url);
    return { match: async (r) => m.get(key(r)) ?? undefined, put: async (r, res) => void m.set(key(r), res), keys: async () => [...m.keys()], delete: async (r) => m.delete(key(r)), addAll: async () => {} };
  };
  const caches = { open: async (n) => store(n), delete: async (n) => stores.delete(n), keys: async () => [...stores.keys()], match: async () => undefined };
  const self = { addEventListener: (t, f) => (handlers[t] = f), skipWaiting: () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, caches, fetch: net, location: { origin: "https://ff.test" }, URL, Request, Response, Promise, console });
  const fetchEvent = async (url) => {
    let out; handlers.fetch({ request: new Request(url), respondWith: (p) => (out = p) });
    return out && (await out);
  };
  return { stores, handlers, fetchEvent };
}

test("a 401 wipes the cached catalog instead of serving it", async () => {
  let member = true;
  const sw = load(async () => (member ? new Response("{}", { status: 200 }) : new Response("no", { status: 401 })));
  assert.equal((await sw.fetchEvent("https://ff.test/data/home.json")).status, 200);
  assert.ok([...sw.stores.keys()].some((k) => k.startsWith("lt-data")), "a member's catalog is kept for offline use");
  member = false;   // signed out elsewhere, banned, or the gate cookie expired
  assert.equal((await sw.fetchEvent("https://ff.test/data/home.json")).status, 401);
  assert.ok(![...sw.stores.keys()].some((k) => k.startsWith("lt-data")), "the cached catalog is gone");
});

test("catalog copies cached before invite-only are deleted on activate", async () => {
  const sw = load(async () => new Response("{}"));
  sw.stores.set("lt-data-v4", new Map([["https://ff.test/data/videos.json", new Response("old")]]));
  let done; sw.handlers.activate({ waitUntil: (p) => (done = p) }); await done;
  assert.ok(!sw.stores.has("lt-data-v4"));
});

test("offline, a member still gets their cached catalog", async () => {
  let online = true;
  const sw = load(async () => { if (!online) throw new TypeError("offline"); return new Response("{}"); });
  await sw.fetchEvent("https://ff.test/data/home.json");
  online = false;
  assert.equal((await sw.fetchEvent("https://ff.test/data/home.json")).status, 200);
});
