// The bell: things that happened for this member, worked out by the Worker from what's already stored.
import { api, signedIn } from "./account.js";
import { store } from "./store.js";
import { D } from "./data.js";
import { esc, ago } from "./ui.js";
import { icon } from "./icons.js";
import { isFresh, markSeen, settleQueues } from "./notify-state.js";

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

function unread() { const seen = store.get("notifSeen", 0), queues = store.get("notifQueues", {}); return items.filter((n) => isFresh(n, seen, queues)).length; }
function paint() {
  const u = unread();
  btn.classList.toggle("has-new", u > 0);
  btn.setAttribute("aria-label", u ? `Notifications, ${u} new` : "Notifications");
}
export async function refreshBell() {
  btn.hidden = !signedIn();
  if (!signedIn()) { items = []; loaded = 0; paint(); return; }
  try { items = (await api("/api/notifications")).items || []; loaded = Date.now() / 1000; store.set("notifQueues", settleQueues(items, store.get("notifQueues", {}))); paint(); } catch {}
}

function open() {
  const d = document.getElementById("sheet"), seen = store.get("notifSeen", 0), queues = store.get("notifQueues", {});
  const rows = items.map((n) => { const r = row(n); return r && { ...r, fresh: isFresh(n, seen, queues), ts: n.ts }; }).filter(Boolean);
  d.className = "notif";
  d.innerHTML = `<h2 tabindex="-1" autofocus>Notifications</h2>${rows.length ? `<ul class="notif-list">${rows.map((r) => {
    const body = `<span class="notif-ic">${icon(r.ic)}</span><span class="notif-t">${r.text}${r.sub ? `<small>${r.sub}</small>` : ""}<time>${esc(ago(r.ts))}</time></span>${r.fresh ? '<i class="notif-dot" role="img" aria-label="New"></i>' : ""}`;
    return `<li>${r.href ? `<a href="${esc(r.href)}">${body}</a>` : `<div>${body}</div>`}</li>`;
  }).join("")}</ul>` : `<p class="notif-empty">You're all caught up. New comments in your discussions, sessions and accepted invites show up here.</p>`}`;
  d.addEventListener("close", () => { d.classList.remove("notif"); d.onclick = null; }, { once: true });
  d.onclick = (e) => { if (e.target === d || e.target.closest("a")) d.close(); };
  d.showModal();
  const m = markSeen(items, seen);
  store.set("notifSeen", m.seen); store.set("notifQueues", m.queues);
  paint();
}

btn.innerHTML = icon("bell");
btn.addEventListener("click", open);
addEventListener("ff:account", refreshBell);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() / 1000 - loaded > POLL) refreshBell(); });
setInterval(() => { if (!document.hidden) refreshBell(); }, POLL * 1000);
refreshBell();
