// Cmd+K goes anywhere: pages, people, videos, labs, courses, dictionary terms and posts. ? lists the shortcuts.
import { D, search } from "./data.js";
import { esc, thumb, avatar } from "./ui.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { glossary } from "./terms.js";

const box = document.createElement("dialog");
box.id = "cmdk"; box.setAttribute("aria-label", "Go anywhere");
box.innerHTML = `<div class="cmdk-in">${icon("search")}<input id="cmdkQ" role="combobox" aria-expanded="true" aria-controls="cmdkL" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Go to a video, person, lab or term"><kbd>esc</kbd></div><div id="cmdkL" role="listbox" aria-label="Results"></div>`;
const keys = document.createElement("dialog");
keys.id = "keysSheet"; keys.setAttribute("aria-label", "Keyboard shortcuts");
const K = (a, b) => `<li><span>${b}</span><span>${a.map((k) => `<kbd>${k}</kbd>`).join(" ")}</span></li>`;
keys.innerHTML = `<h2>Keyboard shortcuts</h2><ul class="keys-list">${K(["⌘", "K"], "Go anywhere")}${K(["/"], "Search")}${K(["Z"], "Focus mode on a video")}${K(["T"], "TV mode")}${K(["Shift", "N"], "Play something new")}${K(["?"], "This list")}</ul><div class="row"><button class="btn" type="button" id="keysX">Close</button></div>`;
document.body.append(box, keys);
keys.querySelector("#keysX").onclick = () => keys.close();
keys.addEventListener("click", (e) => { if (e.target === keys) keys.close(); });
box.addEventListener("click", (e) => { if (e.target === box) box.close(); });

const input = box.querySelector("#cmdkQ"), list = box.querySelector("#cmdkL");
let items = [], active = 0, go = () => {}, places = [], words = [], typeT = 0;
const RECENT = "recentQ", match = (s, q) => s.toLowerCase().includes(q);

function results(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return [["Recent", store.get(RECENT, []).map((r) => ({ href: "/search?q=" + encodeURIComponent(r), label: r, ico: "clock" }))], ["Go to", places]];
  let found = { people: [], videos: [], posts: [] };
  try { found = search(raw); } catch {}
  const labs = (D.learn?.labs || []).filter((l) => match(l.title, q)).slice(0, 3).map((l) => ({ href: "/lab/" + l.slug, label: l.title, sub: "Lab", ico: "labs" }));
  const tracks = (D.learn?.tracks || []).filter((t) => match(t.title, q)).slice(0, 3).map((t) => ({ href: "/learn/" + t.slug, label: t.title, sub: "Course", ico: "learn" }));
  const terms = words.filter((t) => match(t.term, q) || (t.aka || []).some((a) => match(a, q))).slice(0, 4).map((t) => ({ href: "/dictionary#" + t.slug, label: t.term, sub: t.short, ico: "books" }));
  return [
    ["Go to", places.filter((p) => match(p.label, q)).slice(0, 3)],
    ["People", found.people.slice(0, 3).map((p) => ({ href: "/p/" + p.slug, label: p.name, av: avatar(p) }))],
    ["Dictionary", terms], ["Labs and courses", [...labs, ...tracks]],
    ["Videos", found.videos.slice(0, 6).map((v) => ({ href: "/watch/" + v.id, label: v.title, sub: D.people[v.person]?.name, img: thumb(v.id) }))],
    ["Posts", found.posts.slice(0, 3).map((p) => ({ href: `/p/${D.people[p.p]?.slug}?tab=posts`, label: p.t.slice(0, 90), sub: D.people[p.p]?.name, ico: "wire" }))],
    ["", [{ href: "/search?q=" + encodeURIComponent(raw.trim()), label: `Search everything for "${raw.trim()}"`, ico: "search", save: raw.trim() }]],
  ];
}
function paint() {
  const groups = results(input.value).filter(([, g]) => g.length);
  items = groups.flatMap(([, g]) => g);
  active = 0;
  let i = 0;
  list.innerHTML = groups.map(([h, g]) => `${h ? `<div class="cmdk-h">${h}</div>` : ""}${g.map((it) => { const n = i++; return `<a id="cmdk${n}" role="option" href="${esc(it.href)}" data-i="${n}" aria-selected="${n === 0}">${it.img ? `<img src="${esc(it.img)}" alt="" width="64" height="36" loading="lazy">` : it.av || `<span class="cmdk-i">${icon(it.ico || "search")}</span>`}<span class="cmdk-t"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></a>`; }).join("")}`).join("");
  mark();
}
function mark() {
  list.querySelectorAll("[aria-selected=true]").forEach((a) => a.setAttribute("aria-selected", "false"));
  const a = list.querySelector("#cmdk" + active);
  if (a) { a.setAttribute("aria-selected", "true"); a.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", a.id); } else input.removeAttribute("aria-activedescendant");
}
function remember(q) { if (q) store.set(RECENT, [q, ...store.get(RECENT, []).filter((x) => x !== q)].slice(0, 5)); }
function pick(i) {
  const it = items[i]; if (!it) return;
  remember(it.save || (it.ico === "clock" ? it.label : input.value.trim()));
  box.close(); go(it.href);
}
input.addEventListener("input", () => { clearTimeout(typeT); typeT = setTimeout(() => { typeT = 0; paint(); }, 70); });
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
  else if (e.key === "Enter") { e.preventDefault(); if (typeT) { clearTimeout(typeT); typeT = 0; paint(); } pick(active); }
});
list.addEventListener("click", (e) => { const a = e.target.closest("[data-i]"); if (!a) return; e.preventDefault(); e.stopPropagation(); pick(+a.dataset.i); });
list.addEventListener("pointermove", (e) => { const a = e.target.closest("[data-i]"); if (a && +a.dataset.i !== active) { active = +a.dataset.i; mark(); } });

export const paletteOpen = () => box.open || keys.open;
export function togglePalette() {
  if (box.open) { box.close(); return; }
  if (keys.open) keys.close();
  input.value = ""; paint(); box.showModal(); input.focus();
  glossary().then((w) => { words = w; if (box.open && input.value) paint(); }).catch(() => {});
}
export function toggleKeys() { if (keys.open) keys.close(); else if (!box.open) keys.showModal(); }
export function initPalette(nav, pages) { go = nav; places = pages; }
