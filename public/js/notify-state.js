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
