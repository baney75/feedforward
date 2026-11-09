// What to show next. Pure: no page, no storage, so scripts/check.test.mjs can measure it on the real catalog.
// A viewer's actions become a taste for people and topics. Taste leans the feed; it never closes it.
const WEIGHT = { like: 3, save: 2, finish: 2, dwell: 0.8, abandon: -1, skip: -0.6, dislike: -4 };
const PRIOR = 3; // Shrinks thin evidence: one like is a lean, not a verdict.
const EXPLORE = 0.15, EXPLORE_EVERY = 6;
const PERSON_GAP = 3, TOPIC_RUN = 2; // No creator within 3 slots, no topic more than 2 in a row.
const PERSON_WINDOW = 16, PERSON_MAX = 3; // Nobody takes over a session, however well they score.
const SEEN_FADE = 14 * 864e5, SEEN_COST = 70, SKIP_COST = 30;
export const SKIP_MS = 4000, GLANCE_MS = 1200, DWELL_MS = 15000;

export const NO_TASTE = { person: () => 0, topic: () => 0 };

// signals: [[kind, item], ...] where item has .person and .topic. Unknown kinds count for nothing.
export function buildTaste(signals) {
  const tally = (map, key, w) => { const e = map.get(key) || [0, 0]; e[0] += w; e[1] += Math.abs(w); map.set(key, e); };
  const people = new Map(), topics = new Map();
  for (const [kind, item] of signals) {
    const w = WEIGHT[kind];
    if (!w || !item) continue;
    tally(people, item.person, w); tally(topics, item.topic, w);
  }
  const read = (map, key) => { const e = map.get(key); return e ? e[0] / (e[1] + PRIOR) : 0; };
  return { person: (i) => read(people, i), topic: (i) => read(topics, i) };
}

const leaning = (taste, x) => 30 * taste.person(x.person) + 18 * taste.topic(x.topic);

// The feed and TV: each pick is a draw across creators, then the best of a few of that creator's videos.
// Good videos come first. Weak ones are only backfill, once the good ones for this viewer run out.
export function videoSampler(videos, { topic = -1, exclude = new Set(), watched = new Set(), newest = false, taste = NO_TASTE, rng = Math.random } = {}) {
  const fits = videos.filter((v) => (topic < 0 || v.topic === topic) && !exclude.has(v.id) && !watched.has(v.id));
  const tier = (list) => {
    const pool = new Map();
    for (const v of list) { if (!pool.has(v.person)) pool.set(v.person, []); pool.get(v.person).push(v); }
    const people = [...pool.keys()], shares = people.map((p) => Math.max(0.12, 1 + 1.6 * taste.person(p)));
    return { pool, people, shares, total: shares.reduce((a, b) => a + b, 0) };
  };
  const tiers = (newest ? [fits] : [fits.filter((v) => v.q >= 2), fits.filter((v) => !(v.q >= 2))]).map(tier);
  const draw = (t, fair) => {
    if (fair) return t.people[Math.floor(rng() * t.people.length)];
    let x = rng() * t.total;
    for (let i = 0; i < t.people.length; i++) { x -= t.shares[i]; if (x <= 0) return t.people[i]; }
    return t.people[t.people.length - 1];
  };
  const used = new Set(exclude), recent = [], topicsBack = [];
  const count = (p) => recent.filter((x) => x === p).length;
  const take = (v) => {
    used.add(v.id);
    recent.push(v.person); if (recent.length > PERSON_WINDOW) recent.shift();
    topicsBack.push(v.topic); if (topicsBack.length > TOPIC_RUN) topicsBack.shift();
    return v;
  };
  const nextFrom = (t) => {
    for (let tries = 0; tries < 80 && t.people.length; tries++) {
      const explore = rng() < EXPLORE, p = draw(t, explore), strict = tries < 40;
      if (strict && (recent.slice(-PERSON_GAP).includes(p) || count(p) >= PERSON_MAX)) continue;
      const list = t.pool.get(p);
      let best = null;
      for (let k = 0; k < 5; k++) {
        const v = list[Math.floor(rng() * list.length)];
        if (used.has(v.id)) continue;
        if (strict && topic < 0 && topicsBack.length === TOPIC_RUN && topicsBack.every((x) => x === v.topic)) continue;
        const key = newest ? v.ts + v.score * 1e5 : v.score + (v.fresh ? 25 : 0) + rng() * 10 + (explore ? 0 : leaning(taste, v));
        if (!best || key > best.key) best = { v, key };
      }
      if (best) return take(best.v);
    }
    // Random draws can miss the last few left. Before giving up on this tier, look through all of it.
    for (const list of t.pool.values()) for (const v of list) if (!used.has(v.id)) return take(v);
    return null;
  };
  return function next() {
    for (const t of tiers) { const v = nextFrom(t); if (v) return v; }
    return null;
  };
}

// Shorts: seen maps id to [when, ms watched]. What you've seen drops back and returns as it ages.
export function rankShorts(pool, { taste = NO_TASTE, seen = new Map(), now = Date.now(), rng = Math.random, startId = null } = {}) {
  const plain = new Map(pool.map((s) => [s.id, s.score + rng() * 12]));
  const value = (s) => {
    let n = plain.get(s.id) + leaning(taste, s) - (s.q < 2 ? 40 : 0);
    const e = seen.get(s.id);
    if (e) { const fade = Math.max(0, 1 - (now - e[0]) / SEEN_FADE); n -= SEEN_COST * fade + (e[1] < SKIP_MS ? SKIP_COST * fade : 0); }
    return n;
  };
  const rest = pool.map((s) => [s, value(s)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const out = [];
  if (startId) { const k = rest.findIndex((s) => s.id === startId); if (k >= 0) out.push(...rest.splice(k, 1)); }
  const manyTopics = new Set(pool.map((s) => s.topic)).size > 1;
  const gapOK = (s) => !out.slice(-PERSON_GAP).some((x) => x.person === s.person);
  const personOK = (s) => gapOK(s) && out.slice(-PERSON_WINDOW).filter((x) => x.person === s.person).length < PERSON_MAX;
  const allowed = (s) => personOK(s) && !(manyTopics && out.length >= TOPIC_RUN && out.slice(-TOPIC_RUN).every((x) => x.topic === s.topic));
  const notLast = (s) => !out.length || out[out.length - 1].person !== s.person;
  // Every sixth slot goes to a creator the viewer hasn't shown a liking for, chosen without any taste at all.
  const fresh = (s) => !seen.has(s.id) && Math.abs(taste.person(s.person)) < 0.05;
  const discovery = () => {
    let k = -1;
    rest.forEach((s, i) => { if (allowed(s) && fresh(s) && (k < 0 || plain.get(s.id) > plain.get(rest[k].id))) k = i; });
    return k;
  };
  while (rest.length) {
    let k = (out.length + 1) % EXPLORE_EVERY === 0 ? discovery() : -1;
    for (const rule of [allowed, personOK, gapOK, notLast]) if (k < 0) k = rest.findIndex(rule);
    if (k < 0) k = 0;
    out.push(...rest.splice(k, 1));
  }
  return out;
}

// Everything a viewer did, as signals for buildTaste. Lookups turn a saved key or id into its video or Short.
export function collectSignals({ likes = [], dislikes = [], saved = [], ratings = {}, progress = {}, positions = {}, seen = new Map(), video, short, finishedAt = 0.9, now = Date.now() }) {
  const item = (key) => key.startsWith("v:") ? video(key.slice(2)) : key.startsWith("s:") ? short(key.slice(2)) : null;
  const sig = [];
  for (const k of likes) sig.push(["like", item(k)]);
  for (const k of dislikes) sig.push(["dislike", item(k)]);
  for (const k of saved) sig.push(["save", item(k)]);
  for (const [k, stars] of Object.entries(ratings)) sig.push([stars >= 4 ? "save" : stars <= 2 ? "dislike" : "", item(k)]);
  const finished = new Set();
  for (const [k, when] of Object.entries(progress)) if (when > 0 && k.startsWith("v:")) finished.add(k.slice(2));
  for (const [id, p] of Object.entries(positions)) {
    if (p[0] / p[1] >= finishedAt) finished.add(id);
    else if (!finished.has(id) && p[1] > 120 && p[0] / p[1] < 0.15 && p[2] < now - 864e5) sig.push(["abandon", video(id)]);
  }
  for (const id of finished) sig.push(["finish", video(id)]);
  for (const [id, e] of seen) { const k = shortSignal(e[1]); if (k) sig.push([k, short(id)]); }
  return sig;
}

// How a Short was watched, as a taste signal. A flick past tells us nothing.
export function shortSignal(ms) { return ms < GLANCE_MS ? null : ms < SKIP_MS ? "skip" : ms >= DWELL_MS ? "dwell" : null; }
