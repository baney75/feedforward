// Everything a viewer does stays in this browser (localStorage). Every read and write tolerates a blocked store.
const mem = {};
function read(k, d) {
  try { const v = localStorage.getItem("lt:" + k); return v == null ? d : JSON.parse(v); } catch { return k in mem ? mem[k] : d; }
}
const SYNCED = new Set(["history", "saved", "progress", "days"]);
function write(k, v) {
  mem[k] = v;
  try { localStorage.setItem("lt:" + k, JSON.stringify(v)); } catch {}
  if (SYNCED.has(k)) dispatchEvent(new CustomEvent("ff:changed", { detail: k }));
}

const today = () => new Date().toLocaleDateString("en-CA");
function markDay() {
  const d = read("days", []);
  if (d[0] !== today()) { d.unshift(today()); write("days", d.slice(0, 400)); }
}

export const store = {
  // Consecutive days with at least one video, short, lab or step, ending today or yesterday.
  streak() {
    const days = new Set(read("days", []));
    let n = 0; const t = new Date();
    if (!days.has(today())) t.setDate(t.getDate() - 1);
    while (days.has(t.toLocaleDateString("en-CA"))) { n++; t.setDate(t.getDate() - 1); }
    return n;
  },
  learnedToday() { return read("days", [])[0] === today(); },
  get: read,
  set: write,
  // Saved items: {"v:<id>": ts}. A removal is kept as a negative timestamp (a tombstone), so syncing
  // across devices keeps whichever action happened last instead of bringing removed items back.
  isSaved(key) { return read("saved", {})[key] > 0; },
  toggleSave(key) {
    const s = read("saved", {});
    s[key] = s[key] > 0 ? -Date.now() : Date.now();
    write("saved", s);
    return s[key] > 0;
  },
  saved() { return Object.entries(read("saved", {})).filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k); },
  // Watch history: newest first, at most 500 video ids.
  watched(id) {
    const h = read("history", []).filter((x) => x !== id);
    h.unshift(id);
    write("history", h.slice(0, 500));
    markDay();
  },
  history() { return read("history", []); },
  clearHistory() { write("historyReset", Date.now()); write("history", []); },
  hasWatched(id) { return read("history", []).includes(id); },
  // Learning progress: {"lab:<slug>": ts, "step:<track>:<n>": ts, "quiz:<track>:<n>": ts}
  done(key) { const d = read("progress", {}); if (!(d[key] > 0)) d[key] = Date.now(); write("progress", d); markDay(); },
  undo(key) { const d = read("progress", {}); d[key] = -Date.now(); write("progress", d); },
  isDone(key) { return read("progress", {})[key] > 0; },
};
