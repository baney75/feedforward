// A sync takes a moment. Anything you did while it was on the way must survive its answer, and go up with the next one.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Maps: the server's answer, plus every local entry that changed after the request left.
export function mergeMap(sent = {}, server = {}, local = {}) {
  const out = { ...server }; let dirty = false;
  for (const [k, v] of Object.entries(local)) if (!same(v, sent[k])) { out[k] = v; dirty = true; }
  return [out, dirty];
}

// Newest-first lists: whatever was added ahead of what we sent stays on top.
export function mergeList(sent = [], server = [], local = [], cap = 500) {
  const end = sent.length ? local.indexOf(sent[0]) : local.length;
  const fresh = end > 0 ? local.slice(0, end) : end < 0 ? local : [];
  return [[...new Set([...fresh, ...server])].slice(0, cap), fresh.length > 0];
}

export function byOldest(pos) {
  return Object.fromEntries(Object.entries(pos).sort((a, b) => (a[1][2] || 0) - (b[1][2] || 0)));
}
