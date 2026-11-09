// Everything a viewer does stays in this browser (localStorage). Every read and write tolerates a blocked store.
const mem = {};
function read(k, d) {
  try { const v = localStorage.getItem("lt:" + k); return v == null ? d : JSON.parse(v); } catch { return k in mem ? mem[k] : d; }
}
const SYNCED = new Set(["history", "saved", "progress", "days", "notifCleared"]);
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

export const FINISHED = 0.9;
function posAll() { try { return JSON.parse(localStorage.getItem("lt:pos")) || {}; } catch { return {}; } }
// Once per device: positions saved before they carried a time get one, and anything that already counted as watched
// keeps its credit (history with no position, or a position at 90% or more), so nothing earned is lost.
function migratePos() {
  if (read("posStamped", false)) return;
  const all = posAll(), now = Date.now(), done = read("progress", {});
  for (const id of read("history", [])) { const p = all[id]; if ((!p || (p.length < 3 && p[0] / p[1] >= FINISHED)) && !(done["v:" + id] > 0)) done["v:" + id] = now; }
  for (const id of Object.keys(all)) if (all[id].length < 3) all[id] = [all[id][0], all[id][1], now];
  try { localStorage.setItem("lt:pos", JSON.stringify(all)); } catch {}
  write("progress", done); write("posStamped", true);
}
migratePos();

export const store = {
  // "Turn off Shorts": for people who know short video hooks them. Hides Shorts everywhere on this device.
  shortsOff() { return read("noShorts", false) === true; },
  setShortsOff(on) { write("noShorts", !!on); dispatchEvent(new Event("ff:prefs")); },
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
  // Where you stopped in each video: { id: [seconds, duration, when] }, newest last. Quiet: it updates every few
  // seconds while playing, so it doesn't sync on its own. The player calls touchPos() at moments worth syncing.
  pos(id) { return posAll()[id] || null; },
  setPos(id, t, d) {
    if (!(d > 0)) return;
    const all = posAll(); delete all[id]; all[id] = [Math.round(t), Math.round(d), Date.now()];
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k];
    try { localStorage.setItem("lt:pos", JSON.stringify(all)); } catch {}
    // Reaching 90% counts for good, so starting a video over never takes the credit back.
    if (t / d >= FINISHED && !this.isDone("v:" + id)) this.done("v:" + id);
  },
  allPos: posAll,
  replacePos(all) { try { localStorage.setItem("lt:pos", JSON.stringify(all)); } catch {} },
  touchPos() { dispatchEvent(new CustomEvent("ff:changed", { detail: "pos" })); },
  isFinished(id) { if (this.isDone("v:" + id)) return true; const p = this.pos(id); return !!p && p[0] / p[1] >= FINISHED; },
  history() { return read("history", []); },
  clearHistory() {
    const now = Date.now(), done = read("progress", {});
    for (const k of Object.keys(done)) if (k.startsWith("v:") && done[k] > 0) done[k] = -now;
    write("progress", done);
    write("historyReset", now); write("history", []); try { localStorage.removeItem("lt:pos"); } catch {}
  },
  hasWatched(id) { return read("history", []).includes(id); },
  // Learning progress: {"lab:<slug>": ts, "step:<track>:<n>": ts, "quiz:<track>:<n>": ts}
  done(key) { const d = read("progress", {}); if (!(d[key] > 0)) d[key] = Date.now(); write("progress", d); markDay(); },
  undo(key) { const d = read("progress", {}); d[key] = -Date.now(); write("progress", d); },
  isDone(key) { return read("progress", {})[key] > 0; },
};
