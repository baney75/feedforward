// Loads the catalog, merges fresh items from the Worker, and ranks, samples and searches it.
import { store } from "./store.js";

export const TOPICS = [
  { code: "foundations", label: "How models work" },
  { code: "local", label: "Local AI" },
  { code: "agents", label: "Agents & harnesses" },
  { code: "research", label: "Research" },
  { code: "math", label: "Math for AI" },
  { code: "cs", label: "Computer science" },
  { code: "systems", label: "GPUs & systems" },
  { code: "making", label: "CAD & 3D printing" },
  { code: "labs", label: "From the labs" },
];
export const topicIndex = (code) => TOPICS.findIndex((t) => t.code === code);

export const D = { people: [], videos: [], posts: [], shorts: [], books: [], learn: null, meta: null, byId: new Map(), postById: new Map(),
  ready: null, full: null, isFull: false, gen: 0, fresh: 0 };

function video(r, fresh = false) {
  const [id, title, sec, views, ts, person, topic, q, score] = r;
  return { id, title, sec, views, ts, person, topic, q, score, fresh };
}
const short = ([id, title, views, person, topic, q, score]) => ({ id, title, views, person, topic, q, score });

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

function setVideos(rows) { for (const r of rows) if (!D.byId.has(r[0])) { const v = video(r); D.videos.push(v); D.byId.set(v.id, v); } }
function setPosts(rows) { for (const p of rows) if (!D.postById.has(p.id)) { D.posts.push(p); D.postById.set(p.id, p); } D.posts.sort((a, b) => b.ts - a.ts); }

// Phase 1 paints from a small starter bundle. Phase 2 (D.full) merges the whole catalog behind it.
export function load() {
  if (D.ready) return D.ready;
  D.ready = (async () => {
    const [home, learn, books] = await Promise.all([json("/data/home.json"), json("/data/learn.json"), json("/data/books.json").catch(() => [])]);
    D.people = home.people;
    D.peopleBySlug = new Map(D.people.map((p) => [p.slug, p]));
    D.peopleByX = new Map(D.people.filter((p) => p.x).map((p) => [p.x.toLowerCase(), p]));
    D.meta = home.meta;
    D.learn = learn;
    D.books = books;
    D.shorts = (home.shorts || []).map(short);
    setVideos(home.videos);
    setPosts(home.posts);
    index();
    D.full = loadFull();
    return D;
  })();
  return D.ready;
}

// People added by admins since the last build live at index 10000 + n, matching the cron's tags.
async function loadExtraPeople() {
  try {
    const d = await json("/api/people/extra");
    for (const p of d.people || []) {
      if (D.people[p.i]) continue;
      D.people[p.i] = p;
      D.peopleBySlug.set(p.slug, p);
      if (p.x) D.peopleByX.set(p.x.toLowerCase(), p);
    }
  } catch {}
}

async function loadFull() {
  const [videos, posts, shorts] = await Promise.all([json("/data/videos.json"), json("/data/posts.json"), json("/data/shorts.json").catch(() => ({ rows: [] })), loadExtraPeople()]);
  setVideos(videos.rows);
  setPosts(posts.rows);
  const have = new Set(D.shorts.map((s) => s.id));
  for (const r of shorts.rows) if (!have.has(r[0])) D.shorts.push(short(r));
  D.isFull = true;
  index();
  await mergeFresh();
  dispatchEvent(new Event("lt:full"));
  return D;
}

function index() {
  D.gen++;
  D.vByPerson = new Map();
  for (const v of D.videos) {
    if (!D.vByPerson.has(v.person)) D.vByPerson.set(v.person, []);
    D.vByPerson.get(v.person).push(v);
  }
  for (const list of D.vByPerson.values()) list.sort((a, b) => b.score - a.score);
}

// Fresh uploads and posts collected by the Worker's cron since the last full build.
async function mergeFresh() {
  try {
    const f = await json("/api/fresh");
    let n = 0;
    for (const r of f.videos || []) {
      if (D.byId.has(r[0])) { const v = D.byId.get(r[0]); v.ts = Math.max(v.ts, r[4]); v.views = Math.max(v.views, r[3]); continue; }
      if (!D.people[r[5]]) continue;
      const v = video(r, true); D.videos.push(v); D.byId.set(v.id, v); n++;
    }
    for (const p of f.posts || []) {
      if (D.postById.has(p.id) || !D.people[p.p]) continue;
      p.fresh = true; D.posts.push(p); D.postById.set(p.id, p); n++;
    }
    D.posts.sort((a, b) => b.ts - a.ts);
    D.fresh = n;
    if (n) { index(); dispatchEvent(new CustomEvent("lt:fresh", { detail: n })); }
  } catch {}
}

export const person = (i) => D.people[i];

// Weighted pick: each person gets an equal share, then the better of a few random draws from their videos.
export function sampler({ topic = -1, exclude = new Set(), newest = false } = {}) {
  const pool = new Map();
  for (const v of D.videos) {
    if (topic >= 0 && v.topic !== topic) continue;
    if (exclude.has(v.id)) continue;
    if (!pool.has(v.person)) pool.set(v.person, []);
    pool.get(v.person).push(v);
  }
  const people = [...pool.keys()];
  const used = new Set(exclude);
  const watched = new Set(store.history());
  return function next() {
    for (let tries = 0; tries < 60 && people.length; tries++) {
      const p = people[Math.floor(Math.random() * people.length)];
      const list = pool.get(p);
      let best = null;
      for (let k = 0; k < 3; k++) {
        const v = list[Math.floor(Math.random() * list.length)];
        if (used.has(v.id) || watched.has(v.id)) continue;
        const key = newest ? v.ts + v.score * 1e5 : v.score + (v.fresh ? 25 : 0) + Math.random() * 10;
        if (!best || key > best.key) best = { v, key };
      }
      if (best) { used.add(best.v.id); return best.v; }
    }
    return null;
  };
}

export function take(next, n) { const out = []; for (let i = 0; i < n; i++) { const v = next(); if (!v) break; out.push(v); } return out; }

// A stable daily pick of standout videos, so the hero changes once a day.
export function todaysPicks(n = 4, topic = -1) {
  const day = Math.floor(Date.now() / 864e5);
  const recent = Date.now() / 1000 - 2.5 * 31557600;
  let cands = D.videos.filter((v) => v.q >= 3 && v.score >= 60 && v.views >= 60000 && v.ts > recent && (topic < 0 || v.topic === topic));
  if (cands.length < 8) cands = D.videos.filter((v) => v.q >= 3 && (topic < 0 || v.topic === topic));
  const seen = new Set(), out = [];
  let x = day * 2654435761 % 4294967296;
  for (let i = 0; i < 400 && out.length < n && cands.length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const v = cands[x % cands.length];
    if (seen.has(v.person)) continue;
    seen.add(v.person); out.push(v);
  }
  return out;
}

export function topPosts({ topic = -1, sort = "best", limit = 40, offset = 0, personIdx = -1, sinceDays = 0 } = {}) {
  let list = D.posts.filter((p) => (topic < 0 || p.tp === topic) && (personIdx < 0 || p.p === personIdx));
  if (sinceDays) { const cut = Date.now() / 1000 - sinceDays * 86400; list = list.filter((p) => p.ts >= cut); }
  if (sort === "best") {
    // Score with a gentle half-life so great old posts still surface but new ones lead.
    const now = Date.now() / 1000;
    list = list.map((p) => [p, p.s + 18 * Math.exp(-(now - p.ts) / (86400 * 21))]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  } else list = [...list].sort((a, b) => b.ts - a.ts);
  return list.slice(offset, offset + limit);
}

export function related(v, n = 12) {
  const out = [], seen = new Set([v.id]);
  for (const x of (D.vByPerson.get(v.person) || [])) { if (out.length >= 4) break; if (!seen.has(x.id)) { out.push(x); seen.add(x.id); } }
  const next = sampler({ topic: v.topic, exclude: seen });
  return out.concat(take(next, n - out.length));
}

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
export function search(q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return { people: [], videos: [], posts: [] };
  const hit = (s) => { const t = norm(s); return terms.every((w) => t.includes(w)); };
  const people = D.people.filter((p) => hit(p.name + " " + (p.x || "") + " " + (p.yt || "") + " " + p.why));
  const videos = D.videos.filter((v) => hit(v.title + " " + D.people[v.person].name)).sort((a, b) => b.score - a.score).slice(0, 48);
  const posts = D.posts.filter((p) => hit(p.t + " " + D.people[p.p].name)).sort((a, b) => b.s - a.s).slice(0, 30);
  return { people, videos, posts };
}

// Community signal: likes from learners lift a video in "For you" and the hero, gently.
export function applyStats(st) {
  for (const [item, n] of Object.entries(st.likes || {})) {
    if (!item.startsWith("v:")) continue;
    const v = D.byId.get(item.slice(2));
    if (v && !v.boosted) { v.score = Math.min(100, v.score + Math.min(20, 6 * Math.log2(1 + n))); v.boosted = true; }
  }
}
