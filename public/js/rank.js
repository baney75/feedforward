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
export function videoSampler(videos, { topic = -1, exclude = new Set(), watched = new Set(), newest = false, taste = NO_TASTE, rng = Math.random } = {}) {
  const fits = videos.filter((v) => (topic < 0 || v.topic === topic) && !exclude.has(v.id));
  // Weak videos only appear in a topic too small to fill a feed without them. Newest is a plain timeline.
  const good = newest ? fits : fits.filter((v) => v.q >= 2);
  const pool = new Map();
  for (const v of good.length >= 60 ? good : fits) { if (!pool.has(v.person)) pool.set(v.person, []); pool.get(v.person).push(v); }
  const people = [...pool.keys()];
  const shares = people.map((p) => Math.max(0.12, 1 + 1.6 * taste.person(p)));
  const total = shares.reduce((a, b) => a + b, 0);
  const draw = (fair) => {
    if (fair) return people[Math.floor(rng() * people.length)];
    let x = rng() * total;
    for (let i = 0; i < people.length; i++) { x -= shares[i]; if (x <= 0) return people[i]; }
    return people[people.length - 1];
  };
  const used = new Set(exclude), recent = [], topicsBack = [];
  return function next() {
    for (let tries = 0; tries < 80 && people.length; tries++) {
      const explore = rng() < EXPLORE, p = draw(explore), strict = tries < 40;
      if (strict && recent.includes(p)) continue;
      const list = pool.get(p);
      let best = null;
      for (let k = 0; k < 5; k++) {
        const v = list[Math.floor(rng() * list.length)];
        if (used.has(v.id) || watched.has(v.id)) continue;
        if (strict && topic < 0 && topicsBack.length === TOPIC_RUN && topicsBack.every((t) => t === v.topic)) continue;
        const key = newest ? v.ts + v.score * 1e5 : v.score + (v.fresh ? 25 : 0) + rng() * 10 + (explore ? 0 : leaning(taste, v));
        if (!best || key > best.key) best = { v, key };
      }
      if (!best) continue;
      used.add(best.v.id);
      recent.push(p); if (recent.length > PERSON_GAP) recent.shift();
      topicsBack.push(best.v.topic); if (topicsBack.length > TOPIC_RUN) topicsBack.shift();
      return best.v;
    }
    return null;
  };
}

// Shorts: seen maps id to [when, ms watched]. What you've seen drops back and returns as it ages.
export function rankShorts(pool, { taste = NO_TASTE, seen = new Map(), now = Date.now(), rng = Math.random, startId = null } = {}) {
  const value = (s) => {
    let n = s.score + rng() * 12 + leaning(taste, s);
    const e = seen.get(s.id);
    if (e) { const fade = Math.max(0, 1 - (now - e[0]) / SEEN_FADE); n -= SEEN_COST * fade + (e[1] < SKIP_MS ? SKIP_COST * fade : 0); }
    return n;
  };
  const rest = pool.map((s) => [s, value(s)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const out = [];
  if (startId) { const k = rest.findIndex((s) => s.id === startId); if (k >= 0) out.push(...rest.splice(k, 1)); }
  const allowed = (s) => !out.slice(-PERSON_GAP).some((x) => x.person === s.person)
    && out.slice(-PERSON_WINDOW).filter((x) => x.person === s.person).length < PERSON_MAX
    && !(out.length >= TOPIC_RUN && out.slice(-TOPIC_RUN).every((x) => x.topic === s.topic));
  while (rest.length) {
    // Every sixth slot goes to someone the viewer hasn't shown a liking for yet.
    const fresh = (s) => !seen.has(s.id) && Math.abs(taste.person(s.person)) < 0.05;
    let k = (out.length + 1) % EXPLORE_EVERY === 0 ? rest.findIndex((s) => allowed(s) && fresh(s)) : -1;
    if (k < 0) k = rest.findIndex(allowed);
    if (k < 0) k = rest.findIndex((s) => !out.slice(-1).some((x) => x.person === s.person));
    if (k < 0) k = 0;
    out.push(...rest.splice(k, 1));
  }
  return out;
}

// How a Short was watched, as a taste signal. A flick past tells us nothing.
export function shortSignal(ms) { return ms < GLANCE_MS ? null : ms < SKIP_MS ? "skip" : ms >= DWELL_MS ? "dwell" : null; }
