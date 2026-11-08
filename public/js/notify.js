// The bell: things that happened for this member, worked out by the Worker from what's already stored.
import { api, signedIn } from "./account.js";
import { store } from "./store.js";
import { D } from "./data.js";
import { esc, ago } from "./ui.js";
import { icon } from "./icons.js";
import { isFresh, markSeen, settleQueues, isCleared, clearItems, unclearItems, settleCleared } from "./notify-state.js";
import { haptic } from "./haptics.js";

const btn = document.getElementById("bellBtn");
const POLL = 300;
let items = [], loaded = 0;

function when(ts) { return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function itemLink(item) { return /^[vs]:/.test(item) ? "/watch/" + encodeURIComponent(item.slice(2)) : ""; }
function itemTitle(item) { return (item.startsWith("v:") && D.byId.get(item.slice(2))?.title) || "a discussion you joined"; }

// Worker data, including names and comment text, is written by members: everything is escaped here.
function row(n) {
  const name = esc(n.name || "A member");
  if (n.kind === "comment") return { ic: "reply", href: itemLink(n.item), text: `<b>${name}</b> commented on ${esc(itemTitle(n.item))}`, sub: esc(n.body) };
  if (n.kind === "reminder") return { ic: "clock", href: "/sessions", text: `<b>${esc(n.title)}</b> is coming up`, sub: esc(when(n.starts)) };
  if (n.kind === "session") return { ic: "tv", href: "/sessions", text: `New session: <b>${esc(n.title)}</b>`, sub: esc(when(n.starts)) };
  if (n.kind === "joined") return { ic: "people", href: "/u/" + encodeURIComponent(n.uid), text: `<b>${name}</b> joined with your invite`, sub: "" };
  if (n.kind === "applications") return { ic: "people", href: "/admin?tab=applications", text: `${n.n} ${n.n === 1 ? "application is" : "applications are"} waiting for a decision`, sub: "" };
  if (n.kind === "flagged") return { ic: "reply", href: "/admin?tab=reports", text: `${n.n} flagged ${n.n === 1 ? "comment needs" : "comments need"} a look`, sub: "" };
  return null;
}

const CLEARED = "notifCleared";
const cleared = () => store.get(CLEARED, {});
const showing = () => { const c = cleared(); return items.filter((n) => !isCleared(n, c)); };
function unread() { const seen = store.get("notifSeen", 0), queues = store.get("notifQueues", {}); return showing().filter((n) => isFresh(n, seen, queues)).length; }
function paint() {
  const u = unread();
  btn.classList.toggle("has-new", u > 0);
  btn.setAttribute("aria-label", u ? `Notifications, ${u} new` : "Notifications");
}
export async function refreshBell() {
  btn.hidden = !signedIn();
  if (!signedIn()) { items = []; loaded = 0; paint(); return; }
  try { items = (await api("/api/notifications")).items || []; loaded = Date.now() / 1000; store.set("notifQueues", settleQueues(items, store.get("notifQueues", {}))); const c = cleared(), settled = settleCleared(items, c, Date.now()); if (settled !== c) store.set(CLEARED, settled); paint(); } catch {}
}

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sheet = document.getElementById("sheet");
let snapshot = { seen: 0, queues: {} }, undoList = [];

function draw(focusIndex = -1) {
  const rows = showing().map((n) => { const r = row(n); return r && { ...r, id: n.id, fresh: isFresh(n, snapshot.seen, snapshot.queues), ts: n.ts }; }).filter(Boolean);
  sheet.innerHTML = `<div class="notif-head"><h2 tabindex="-1" autofocus>Notifications</h2>${rows.length ? `<button class="notif-all" type="button" id="notifAll">Clear all</button>` : ""}</div>${rows.length ? `<ul class="notif-list">${rows.map((r) => {
    const body = `<span class="notif-ic">${icon(r.ic)}</span><span class="notif-t">${r.text}${r.sub ? `<small>${r.sub}</small>` : ""}<time>${esc(ago(r.ts))}</time></span>${r.fresh ? '<i class="notif-dot" role="img" aria-label="New"></i>' : ""}`;
    return `<li data-id="${esc(r.id)}">${r.href ? `<a href="${esc(r.href)}">${body}</a>` : `<div>${body}</div>`}<button class="notif-x" type="button" aria-label="Clear this notification">${icon("close")}</button></li>`;
  }).join("")}</ul>` : `<p class="notif-empty">You're all caught up. New comments in your discussions, sessions and accepted invites show up here.</p>`}${undoList.length ? `<div class="notif-undo" role="status"><span>${undoList.length === 1 ? "Cleared" : `Cleared ${undoList.length}`}</span><button class="notif-all" type="button" id="notifUndo">Undo</button></div>` : ""}`;
  const xs = sheet.querySelectorAll(".notif-x");
  if (focusIndex >= 0 && xs.length) xs[Math.min(focusIndex, xs.length - 1)].focus({ preventScroll: true });
  else if (focusIndex >= 0) sheet.querySelector("h2").focus({ preventScroll: true });
}
function clear(list, focusIndex) {
  store.set(CLEARED, clearItems(list, cleared(), Date.now()));
  undoList = list; haptic.tick(); draw(focusIndex); paint();
}
function clearRow(li, instant) {
  const n = items.find((x) => x.id === li.dataset.id);
  if (!n || li.dataset.going) return;
  li.dataset.going = "1";
  const at = [...li.parentElement.children].indexOf(li), done = () => clear([n], at);
  if (instant || calm()) return done();
  li.animate([{ opacity: 1, height: li.offsetHeight + "px", transform: "none" }, { opacity: 0, height: 0, transform: "translateX(-48px)" }], { duration: 170, easing: "ease-out" }).finished.then(done, done);
}
function bindSwipes() {
  let s = null;
  sheet.ontouchstart = (e) => { const li = e.target.closest?.(".notif-list li"); s = li && e.touches.length === 1 ? { li, x: e.touches[0].clientX, y: e.touches[0].clientY, on: false, dx: 0 } : null; };
  sheet.ontouchmove = (e) => {
    if (!s) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.on) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; } if (dx < -10) s.on = true; else return; }
    s.dx = Math.min(0, dx); s.li.style.transform = `translateX(${s.dx}px)`; s.li.style.opacity = 1 + s.dx / 300;
  };
  sheet.ontouchend = () => { if (!s || !s.on) { s = null; return; } const { li, dx } = s; s = null; if (dx < -90) clearRow(li, true); else { li.style.transform = ""; li.style.opacity = ""; } };
}
function open() {
  snapshot = { seen: store.get("notifSeen", 0), queues: store.get("notifQueues", {}) };
  undoList = [];
  sheet.className = "notif";
  draw();
  sheet.addEventListener("close", () => { sheet.classList.remove("notif"); sheet.onclick = sheet.ontouchstart = sheet.ontouchmove = sheet.ontouchend = null; }, { once: true });
  sheet.onclick = (e) => {
    if (e.target === sheet || e.target.closest("a")) { sheet.close(); return; }
    const x = e.target.closest(".notif-x");
    if (x) { clearRow(x.closest("li")); return; }
    if (e.target.closest("#notifAll")) { clear(showing(), 0); return; }
    if (e.target.closest("#notifUndo")) { store.set(CLEARED, unclearItems(undoList, cleared(), Date.now())); undoList = []; haptic.tick(); draw(0); paint(); }
  };
  bindSwipes();
  sheet.showModal();
  const m = markSeen(items, snapshot.seen);
  store.set("notifSeen", m.seen); store.set("notifQueues", m.queues);
  paint();
}

btn.innerHTML = icon("bell");
btn.addEventListener("click", open);
addEventListener("ff:account", refreshBell);
addEventListener("ff:changed", (e) => { if (e.detail === CLEARED) paint(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() / 1000 - loaded > POLL) refreshBell(); });
setInterval(() => { if (!document.hidden) refreshBell(); }, POLL * 1000);
refreshBell();
