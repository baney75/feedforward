// What counts as new. Staff queues have no event time (a report carries no date), so they're new when they grow.
export const QUEUES = new Set(["applications", "flagged"]);
export function isFresh(n, seen, queues) { return QUEUES.has(n.kind) ? n.n > (queues[n.kind] || 0) : n.ts > seen; }
export function markSeen(items, seen) {
  const events = items.filter((n) => !QUEUES.has(n.kind)).map((n) => n.ts);
  return { seen: Math.max(seen, ...events), queues: Object.fromEntries(items.filter((n) => QUEUES.has(n.kind)).map((n) => [n.kind, n.n])) };
}
// A queue that shrank or emptied lowers its mark, so the next arrivals count as new.
export function settleQueues(items, queues) {
  const now = Object.fromEntries(items.filter((n) => QUEUES.has(n.kind)).map((n) => [n.kind, n.n]));
  return Object.fromEntries(Object.entries(queues).filter(([k]) => now[k]).map(([k, v]) => [k, Math.min(v, now[k])]));
}
// Clearing: { key: ms } like saved items, so a clear reaches every device and a negative value is an undo.
// A staff queue is cleared at its size, and comes back only when it grows past that.
const clearKey = (n) => (QUEUES.has(n.kind) ? `${n.kind}:${n.n}` : n.id);
export function isCleared(n, cleared) {
  if (!QUEUES.has(n.kind)) return cleared[n.id] > 0;
  return Object.entries(cleared).some(([k, v]) => v > 0 && k.startsWith(n.kind + ":") && +k.split(":")[1] >= n.n);
}
export const clearItems = (list, cleared, at) => ({ ...cleared, ...Object.fromEntries(list.map((n) => [clearKey(n), at])) });
export const unclearItems = (list, cleared, at) => ({ ...cleared, ...Object.fromEntries(list.map((n) => [clearKey(n), -at])) });
// A queue that shrank forgets its larger clears, so new arrivals show up again.
export function settleCleared(items, cleared, at) {
  const size = Object.fromEntries(items.filter((n) => QUEUES.has(n.kind)).map((n) => [n.kind, n.n]));
  let out = cleared;
  for (const [k, v] of Object.entries(cleared)) {
    const [kind, n] = k.split(":");
    if (v > 0 && QUEUES.has(kind) && +n > (size[kind] || 0)) out = { ...out, [k]: -at };
  }
  return out;
}
