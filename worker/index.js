// Feedforward Worker: serves the static app and keeps a small "fresh" feed of new uploads and posts in KV.
// The cron checks a slice of sources each run (YouTube RSS and the public fxtwitter API), so no keys are needed.
import SOURCES from "./sources.json";
import { handle, xAvatar, setListed } from "./api.js";
import { mcp } from "./mcp.js";
import { gatedPath, gateUser, liveSession } from "./gate.js";
import { tokenUser, inviteInfo, wsToken } from "./api.js";
import { oauth, metadata } from "./oauth.js";
export { ChatRoom } from "./chat.js";
setListed(SOURCES);

const TOPICS = ["foundations", "local", "agents", "research", "math", "cs", "systems", "making", "labs"];
const PER_TICK = 10;
const UA = "Mozilla/5.0 (compatible; Feedforward/1.0; +https://feedforward.dbaney.com/about)";

// The same backstop word list the catalog build uses.
const BLOCK = /\b(trump|biden|harris|vance|democrat|republican|maga|election|congress|senate|immigra\w*|abortion|israel|gaza|palestin\w*|ukraine|putin|woke|left-wing|right-wing|jesus|christ|bible|god|allah|religio\w*|sponsor(ed)?|giveaway|discount code|promo code)\b/i;
// A fresh post must look technical to be shown before the next full (model-reviewed) build.
const TECH = /\b(ai|llms?|models?|gpt|claude|gemini|qwen|llama|deepseek|mistral|gemma|agents?|agentic|tokens?|inference|training|fine-?tun\w*|gpus?|cuda|neural|transformers?|open[- ]?weights?|benchmarks?|evals?|prompts?|mcp|codex|cursor|rag|embeddings?|quantiz\w*|gguf|mlx|ollama|vllm|llama\.cpp|kernels?|papers?|arxiv|datasets?|robots?|robotics|cad|3d[- ]print\w*|compilers?|python|rust|coding|software|open[- ]source|harness|context window|reasoning|rl)\b/i;
const GUESS = [
  ["local", /\b(llama\.cpp|gguf|ollama|mlx|lm studio|quantiz\w*|local(ly)?|on-device|vram|rtx|4090|5090|mac studio|dgx spark|home server|raspberry pi)\b/i],
  ["agents", /\b(agents?|agentic|claude code|codex|cursor|harness|mcp|prompt\w*|evals?|opencode|pi agent|skills?)\b/i],
  ["systems", /\b(gpus?|cuda|kernels?|triton|inference|vllm|chips?|nvidia|tpus?|datacenter|hbm)\b/i],
  ["making", /\b(3d[- ]print\w*|cad|fusion 360|freecad|filament|nozzle|printers?|slicer|cnc)\b/i],
  ["research", /\b(papers?|arxiv|interpretab\w*|alignment|benchmarks?|research)\b/i],
  ["foundations", /\b(transformers?|attention|neural|backprop\w*|training|fine-?tun\w*|embeddings?|tokeni[sz]\w*|from scratch)\b/i],
];
const guess = (text, fallback) => { for (const [t, re] of GUESS) if (re.test(text)) return TOPICS.indexOf(t); return TOPICS.indexOf(fallback); };

const json = (d, init = {}) => new Response(JSON.stringify(d), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) } });

// /join/<code>: the app, with a link preview made for this invite ("Donovan Baney invited you to Feedforward").
const ROLE_NAME = { contributor: "a Contributor", mod: "a Moderator", admin: "an Admin" };
async function joinPage(req, env, code) {
  const page = await env.ASSETS.fetch(new Request(new URL("/", req.url), { headers: req.headers }));
  let info = null;
  try { info = await inviteInfo(env, code); } catch {}
  const who = info && !info.gone && info.by && info.by.name && info.by.name !== "Learner" ? info.by.name : "";
  const title = who ? `${who} invited you to Feedforward` : "You're invited to Feedforward";
  const grants = info && !info.gone ? [info.role !== "user" && ROLE_NAME[info.role], info.teach && `a ${info.teach}`].filter(Boolean) : [];
  const desc = (grants.length ? `Join as ${grants.join(" and ")}. ` : "") + "Invite-only: learn AI from the people building it, with videos, labs and live sessions.";
  const img = new URL("/og-invite.jpg?v=1", req.url).toString(), here = new URL(`/join/${code}`, req.url).toString();
  const set = (sel, v) => [sel, { element: (e) => e.setAttribute("content", v) }];
  let rw = new HTMLRewriter();
  for (const [sel, h] of [
    set('meta[property="og:title"]', title), set('meta[name="twitter:title"]', title),
    set('meta[property="og:description"]', desc), set('meta[name="twitter:description"]', desc), set('meta[name="description"]', desc),
    set('meta[property="og:image"]', img), set('meta[name="twitter:image"]', img), set('meta[property="og:url"]', here),
    set('meta[property="og:image:alt"]', `${title}. You're invited: learn AI from the people building it.`),
  ]) rw = rw.on(sel, h);
  // The invite card is a still image: drop the site video so platforms show the card.
  rw = rw.on('meta[property^="og:video"]', { element: (e) => e.remove() }).on("title", { element: (e) => e.setInnerContent(title) });
  const out = rw.transform(page);
  const r = new Response(out.body, out);
  r.headers.set("cache-control", "no-store");
  return r;
}

// A member: a valid gate cookie, or a signed-in Bearer session (scripts and the app before its cookie lands).
async function member(req, env) {
  const g = await gateUser(req, env);
  if (g && (await liveSession(env, g))) return true;
  const h = req.headers.get("authorization") || "";
  // Chat sockets carry the session as a "t.<token>" subprotocol, since browsers can't set headers on them.
  const tok = h.startsWith("Bearer ") ? h.slice(7) : wsToken(req);
  return !!tok && !tok.startsWith("ffk_") && !!(await tokenUser(env, tok));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Invite-only: catalog data, labs and community reads need a member. Anonymous MCP use does too; agents
    // with a personal token (ffk_) are checked by the MCP server itself.
    const bearer = (req.headers.get("authorization") || "").startsWith("Bearer ");
    if (gatedPath(url.pathname) || (url.pathname === "/mcp" && !bearer)) {
      if (!(await member(req, env))) return json({ error: "Feedforward is invite-only. Sign in, use an invite link, or apply." }, { status: 401, headers: { "cache-control": "no-store" } });
      if (url.pathname.startsWith("/data/") || url.pathname.startsWith("/labs/")) {
        // Member-only files must never sit in a shared cache.
        const r = await env.ASSETS.fetch(req);
        const out = new Response(r.body, r);
        out.headers.set("cache-control", r.ok ? "private, max-age=600" : "no-store");
        return out;
      }
    }
    if (url.pathname === "/api/fresh") {
      const d = (await env.FRESH.get("fresh", "json")) || { videos: [], posts: [], updated: 0 };
      return json({ videos: d.videos, posts: d.posts, updated: d.updated }, { headers: { "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/api/live") {
      const d = (await env.FRESH.get("live", "json")) || { live: {}, checked: 0 };
      return json(d, { headers: { "cache-control": "public, max-age=60" } });
    }
        if (url.pathname === "/api/health") {
      const d = (await env.FRESH.get("fresh", "json")) || {};
      return json({ ok: true, updated: d.updated || 0, videos: (d.videos || []).length, posts: (d.posts || []).length, cursor: d.cursor || 0, sources: SOURCES.length });
    }
    if (url.pathname.startsWith("/u/a/")) {
      const key = url.pathname.slice(5);
      if (!/^[a-z0-9]+-[a-z0-9]+$/.test(key)) return new Response("Not found", { status: 404 });
      const obj = await env.AVATARS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "image/webp", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
    }
    const join = url.pathname.match(/^\/join\/([\w-]{1,40})\/?$/);
    if (join && req.method === "GET") return joinPage(req, env, join[1]);
    if (url.pathname === "/mcp") return mcp(req, env);
    if (url.pathname === "/mcp/me") return mcp(req, env, { personal: true });
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(metadata(req).resource, { headers: { "access-control-allow-origin": "*" } });
    if (url.pathname === "/.well-known/oauth-authorization-server") return json(metadata(req).server, { headers: { "access-control-allow-origin": "*" } });
    if (url.pathname === "/oauth/authorize") return env.ASSETS.fetch(new Request(new URL("/", req.url), req));
    if (url.pathname.startsWith("/oauth/") || url.pathname.startsWith("/api/oauth/")) {
      const r = await oauth(req, env);
      if (r) return r;
    }
    if (url.pathname.startsWith("/api/")) {
      const r = await handle(req, env);
      if (r) return r;
      return json({ error: "Not found" }, { status: 404 });
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
};

async function get(url, type = "text") {
  const r = await fetch(url, { headers: { "user-agent": UA }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(url + " " + r.status);
  return type === "json" ? r.json() : r.text();
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function youtube(src) {
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${src.yt}`);
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || "";
    if (!id || link.includes("/shorts/")) continue;
    const title = decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const ts = Math.floor(Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1] || 0) / 1000);
    const views = +((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0);
    if (BLOCK.test(title)) continue;
    if (src.mode === "ai" && !TECH.test(title)) continue;
    out.push([id, title, 0, views, ts, src.i, guess(title, src.topic), 2, 70]);
  }
  return out;
}

async function xposts(src) {
  let d;
  for (let k = 0; k < 2 && !d; k++) {
    try { const r = await get(`https://api.fxtwitter.com/2/profile/${src.x}/statuses`, "json"); if (r.code === 200 && r.results?.length) d = r; } catch {}
  }
  if (!d) return [];
  const me = src.x.toLowerCase(), out = [];
  for (const s of d.results) {
    const a = (s.author?.screen_name || "").toLowerCase();
    const reply = typeof s.replying_to === "object" ? s.replying_to?.screen_name : s.replying_to;
    if (a !== me || s.reposted_by || (reply && reply.toLowerCase() !== me)) continue;
    const text = s.text || "";
    const qtext = s.quote?.text || "";
    // Before the next model-reviewed build, a fresh post must carry its own substance: long enough, and technical in its own words.
    if (text.length < 80 || BLOCK.test(text) || BLOCK.test(qtext) || !TECH.test(text)) continue;
    const rec = { id: s.id, p: src.i, t: text, ts: s.created_timestamp || 0, l: s.likes || 0, r: s.reposts || 0, c: s.replies || 0, v: s.views || 0,
      tp: guess(text + " " + qtext, src.topic), q: 2, s: Math.min(95, Math.round(45 + 10 * Math.log10((s.likes || 0) + 1))) };
    Object.assign(rec, media(s));
    if (s.quote && s.quote.id) {
      const qa = s.quote.author || {};
      rec.qt = { id: s.quote.id, n: qa.name, h: qa.screen_name, a: qa.avatar_url, t: qtext, ts: s.quote.created_timestamp || 0, ...media(s.quote) };
    }
    out.push(rec);
  }
  return out;
}

function media(s) {
  const m = {}, md = s.media && typeof s.media === "object" ? s.media : {};
  if (md.photos?.length) m.ph = md.photos.slice(0, 4).map((p) => [p.url, p.width, p.height]);
  if (md.videos?.length && md.videos[0].url) { const v = md.videos[0]; m.vd = [v.url, v.thumbnail_url, v.width, v.height]; }
  const c = s.embed_card;
  if (c && typeof c === "object" && c.url && c.title) m.cd = [c.url, c.title, c.description || "", c.image || null];
  return m;
}

// Sources = the built roster plus anyone an admin added since (person index 10000 + n).
async function allSources(env) {
  if (!env.DB) return SOURCES;
  try {
    const rows = await env.DB.prepare("SELECT n, yt_id, x, mode, topic FROM people_extra WHERE active = 1").all();
    return SOURCES.concat(rows.results.map((r) => ({ i: 10000 + r.n, yt: r.yt_id || null, x: r.x || null, mode: r.mode, topic: r.topic })));
  } catch { return SOURCES; }
}

export async function refresh(env) {
  const d = (await env.FRESH.get("fresh", "json")) || { videos: [], posts: [], cursor: 0 };
  const SRC = await allSources(env);
  const start = (d.cursor || 0) % SRC.length;
  const batch = Array.from({ length: Math.min(PER_TICK, SRC.length) }, (_, k) => SRC[(start + k) % SRC.length]);
  const vids = new Map(d.videos.map((v) => [v[0], v]));
  const posts = new Map(d.posts.map((p) => [p.id, p]));
  await Promise.all(batch.map(async (src) => {
    if (src.yt) { try { for (const v of await youtube(src)) vids.set(v[0], v); } catch {} }
    if (src.x) { try { for (const p of await xposts(src)) posts.set(p.id, p); } catch {} }
  }));
  const now = Date.now() / 1000;
  const out = {
    videos: [...vids.values()].filter((v) => now - v[4] < 45 * 86400).sort((a, b) => b[4] - a[4]).slice(0, 600),
    posts: [...posts.values()].filter((p) => now - p.ts < 21 * 86400).sort((a, b) => b.ts - a.ts).slice(0, 600),
    cursor: (start + batch.length) % SRC.length,
    updated: Math.floor(now),
  };
  await env.FRESH.put("fresh", JSON.stringify(out));
  await Promise.all([syncAvatars(env), checkLive(env), env.DB ? env.DB.prepare("DELETE FROM rl WHERE reset < ?").bind(Math.floor(Date.now() / 1000) - 3600).run().catch(() => {}) : null]);
  return out;
}

// Keep learners' X profile pictures current: a few of the stalest each run.
async function syncAvatars(env) {
  if (!env.DB) return;
  try {
    const rows = await env.DB.prepare("SELECT id, links FROM users WHERE links LIKE '%\"x\"%' AND avatar_x_ts < ? ORDER BY avatar_x_ts LIMIT 5").bind(Math.floor(Date.now() / 1000) - 86400).all();
    for (const r of rows.results) {
      const x = JSON.parse(r.links || "{}").x;
      const a = x ? await xAvatar(x) : "";
      await env.DB.prepare("UPDATE users SET avatar_x = CASE WHEN ? != '' THEN ? ELSE avatar_x END, avatar_x_ts = ? WHERE id = ?").bind(a, a, Math.floor(Date.now() / 1000), r.id).run();
    }
  } catch {}
}

// Twitch: who is live right now. The channel page carries isLiveBroadcast when a stream is on.
async function checkLive(env) {
  const list = SOURCES.filter((s) => s.twitch);
  if (!list.length) return;
  const live = {};
  await Promise.all(list.map(async (s) => {
    try {
      const t = await get(`https://www.twitch.tv/${s.twitch}`);
      if (/"isLiveBroadcast":true/.test(t)) {
        const title = decode((t.match(/<meta property="og:description" content="([^"]{0,200})/) || [])[1] || "");
        live[s.twitch] = { i: s.i, title, since: Math.floor(Date.now() / 1000) };
      }
    } catch {}
  }));
  await env.FRESH.put("live", JSON.stringify({ live, checked: Math.floor(Date.now() / 1000) }));
}
