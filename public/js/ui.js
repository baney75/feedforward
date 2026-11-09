// Small render helpers. Everything returns HTML strings; user-visible data is always escaped.
import { D, TOPICS } from "./data.js";
import { icon } from "./icons.js";
import { store } from "./store.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function num(n) {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}
export function dur(s) {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
export function ago(ts, short = false) {
  if (!ts) return "";
  const s = Date.now() / 1000 - ts;
  const u = [[31557600, "year", "y"], [2629800, "month", "mo"], [604800, "week", "w"], [86400, "day", "d"], [3600, "hour", "h"], [60, "minute", "m"]];
  for (const [n, name, ab] of u) {
    if (s >= n) { const k = Math.floor(s / n); return short ? k + ab : `${k} ${name}${k > 1 ? "s" : ""} ago`; }
  }
  return short ? "now" : "just now";
}
export const thumb = (id, q = "mqdefault") => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
export const topicLabel = (i) => (TOPICS[i] ? TOPICS[i].label : "");

// A picture that fails to load turns into the person's initial instead of an empty circle.
const initialSvg = (ch) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36" fill="#2a2925"/><text x="18" y="23.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#b4afa5">${ch}</text></svg>`);
export function avatar(p, cls = "") {
  if (p && p.av) return `<img class="av ${cls}" src="${esc(p.av)}" alt="" loading="lazy" width="36" height="36" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${initialSvg(esc((p.name || "?")[0].toUpperCase()))}'">`;
  const ch = esc((p?.name || "?")[0]);
  return `<span class="av ${cls}" aria-hidden="true" style="display:grid;place-items:center;font-weight:600;color:var(--fg-2)">${ch}</span>`;
}

// How far you got: a bar sized to your real position, and a check once you've finished.
export function watchedPct(id) { const p = store.pos(id); return p ? Math.min(100, Math.round((p[0] / p[1]) * 100)) : store.hasWatched(id) ? 100 : 0; }
export function finished(id) { return store.isFinished(id); }
function progress(id) {
  const pct = watchedPct(id);
  if (!pct) return "";
  return `<span class="seen" style="width:${pct}%"></span>${finished(id) ? `<span class="done-mark" title="Finished">${icon("check")}<span class="sr-only">Finished</span></span>` : ""}`;
}
// YouTube answers a missing sharp thumbnail with a tiny grey placeholder instead of an error.
export function watchThumbs() {
  const back = (img) => { const m = /\/vi\/([\w-]+)\/(sd|maxres)default/.exec(img.currentSrc || img.src); if (m) { img.srcset = ""; img.src = thumb(m[1], "hqdefault"); } };
  document.addEventListener("load", (e) => { const i = e.target; if (i.tagName === "IMG" && i.naturalWidth && i.naturalWidth <= 120) back(i); }, true);
  document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") back(e.target); }, true);
}

// Resting on a thumbnail flips through three frames YouTube publishes from inside the video.
export function watchPreviews() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let cur = null, wait = 0, flip = 0;
  const stop = () => { clearTimeout(wait); clearInterval(flip); cur?.querySelector(".hoverframe")?.remove(); cur = null; };
  document.addEventListener("pointerover", (e) => {
    const th = e.target.closest?.(".vcard .thumb, .vrow .thumb");
    if (th === cur) return;
    stop();
    const id = th?.closest("a")?.getAttribute("href")?.match(/^\/watch\/([\w-]{11})/)?.[1];
    if (!id) return;
    cur = th;
    wait = setTimeout(() => {
      const urls = [1, 2, 3].map((n) => thumb(id, "hq" + n));
      urls.forEach((u) => { new Image().src = u; });
      const f = new Image(); f.className = "hoverframe"; f.alt = ""; f.src = urls[0];
      th.appendChild(f);
      let i = 0; flip = setInterval(() => { i = (i + 1) % 3; f.src = urls[i]; }, 800);
    }, 350);
  }, { passive: true });
  document.addEventListener("click", stop, true);
}

export function videoCard(v, { big = false, row = false } = {}) {
  const p = D.people[v.person];
  const srcset = `${thumb(v.id, "mqdefault")} 320w, ${thumb(v.id, "sddefault")} 640w${big ? `, ${thumb(v.id, "maxresdefault")} 1280w` : ""}`;
  const sizes = big ? "(max-width: 719px) 100vw, 640px" : row ? "200px" : "(max-width: 719px) 78vw, 380px";
  const img = `<div class="thumb"><img src="${thumb(v.id, big ? "hqdefault" : "mqdefault")}" srcset="${srcset}" sizes="${sizes}" alt="" loading="lazy" width="320" height="180">${v.sec ? `<span class="dur">${dur(v.sec)}</span>` : ""}${progress(v.id)}</div>`;
  const sub = `<span class="who">${esc(p.name)}</span><br>${v.views ? num(v.views) + " views" : ""}${v.views && v.ts ? `<span class="dot"></span>` : ""}${v.ts ? ago(v.ts) : ""}${v.fresh ? ' <span class="badge">New</span>' : ""}`;
  if (row) return `<a class="vrow" href="/watch/${v.id}">${img}<div class="vtext"><h3 class="vt">${esc(v.title)}</h3><div class="vsub">${sub}</div></div></a>`;
  return `<a class="vcard${big ? " big" : ""}" href="/watch/${v.id}"${big ? "" : ""}>${img}<div class="vmeta">${avatar(p)}<div class="vtext"><h3 class="vt">${esc(v.title)}</h3><div class="vsub">${sub}</div></div></div></a>`;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
export function linkify(text) {
  // X has no markup, so people type *emphasis* and "- " lists. Show what they meant.
  let s = esc(text).replace(/(^|[\s(])\*([^*\n]{1,80})\*(?=[\s.,!?:;)]|$)/g, "$1<em>$2</em>").replace(/^- /gm, "• ");
  s = s.replace(URL_RE, (u) => {
    const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    const label = u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 42) + (u.length > 50 ? "..." : "");
    if (yt && D.byId.has(yt[1])) return `<a href="/watch/${yt[1]}">${label}</a>`;
    return `<a href="${u}" target="_blank" rel="noopener">${label}</a>`;
  });
  s = s.replace(/(^|[^\w/])@(\w{1,15})/g, (m, pre, h) => {
    const p = D.peopleByX.get(h.toLowerCase());
    return `${pre}<a href="${p ? "/p/" + p.slug : "https://x.com/" + h}"${p ? "" : ' target="_blank" rel="noopener"'}>@${h}</a>`;
  });
  return s;
}

function media(m) {
  let out = "";
  if (m.ph && m.ph.length) {
    out += `<div class="post-media n${m.ph.length}">${m.ph.map(([u, w, h]) => `<img src="${esc(u)}" alt="" loading="lazy" ${w ? `width="${w}" height="${h}"` : ""} referrerpolicy="no-referrer">`).join("")}</div>`;
  }
  if (m.vd) {
    const [u, poster, w, h] = m.vd;
    // X videos play in a no-referrer frame: X's host refuses requests that name another site as the referrer.
    out += `<div class="post-media n1 xv" style="aspect-ratio:${w && h ? `${w} / ${h}` : "16 / 9"}"><iframe src="/xv#${encodeURIComponent(`${u}|${poster || ""}`)}" title="Video from X" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`;
  }
  if (m.cd && !m.ph && !m.vd) {
    const [u, t, d, img] = m.cd;
    const yt = (u || "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (yt) out += `<a class="ytembed vrow" href="/watch/${yt[1]}"><div class="thumb"><img src="${thumb(yt[1])}" alt="" loading="lazy" width="320" height="180"></div><div class="vtext"><h3 class="vt">${esc(t)}</h3><div class="vsub">Watch here</div></div></a>`;
    else out += `<a class="lcard" href="${esc(u)}" target="_blank" rel="noopener">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "<span></span>"}<div><b>${esc(t)}</b><span>${esc(d)}</span></div></a>`;
  }
  return out;
}

export function postCard(post) {
  const p = D.people[post.p];
  const url = `https://x.com/${p.x}/status/${post.id}`;
  const long = post.t.length > 420 || post.t.split("\n").length > 9;
  const saved = store.isSaved("p:" + post.id);
  let q = "";
  if (post.qt) {
    const qp = post.qt;
    q = `<div class="qpost"><div class="post-h">${qp.a ? `<img class="av s" src="${esc(qp.a)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<b>${esc(qp.n || "")}</b><span class="muted">@${esc(qp.h || "")}</span></div><div class="post-text">${linkify(qp.t)}</div>${qp.ph && qp.ph[0] ? `<img src="${esc(qp.ph[0][0])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</div>`;
  }
  return `<article class="post" data-post="${post.id}">
    <a href="/p/${p.slug}" aria-label="${esc(p.name)}">${avatar(p)}</a>
    <div style="min-width:0">
      <div class="post-h"><a href="/p/${p.slug}"><b>${esc(p.name)}</b></a><span class="muted">@${esc(p.x)}</span><span class="muted dot"></span><a class="muted" href="${url}" target="_blank" rel="noopener" title="${new Date(post.ts * 1000).toLocaleString()}">${ago(post.ts, true)}</a>${post.fresh ? ' <span class="badge">New</span>' : ""}</div>
      <div class="post-text${long ? " clamp" : ""}">${linkify(post.t)}</div>${long ? '<button class="more" data-more>Show more</button>' : ""}
      ${media(post)}${q}
      <div class="post-f">
        <span title="Likes">${icon("heart")}${num(post.l)}</span>
        <button data-save="p:${post.id}" aria-pressed="${saved}" aria-label="Save post">${icon(saved ? "bookmarked" : "bookmark")}</button>
      </div>
    </div>
  </article>`;
}

export function personCard(p) {
  const counts = [p.nv ? `${num(p.nv)} videos` : "", p.np ? `${p.np} posts` : ""].filter(Boolean).join(" · ");
  return `<a class="pcard" href="/p/${p.slug}">${avatar(p)}<div style="min-width:0"><b>${esc(p.name)}</b><p>${esc(p.why)}</p><small>${counts}</small></div></a>`;
}

export function chips(active, { all = "All", extra = [] } = {}) {
  return `<div class="chip-rail"><button class="chip-arrow prev" type="button" tabindex="-1" aria-hidden="true">${icon("left")}</button><div class="chips" role="group" aria-label="Topics">
    <button class="chip" data-topic="-1" aria-pressed="${active === -1}">${all}</button>
    ${extra.map((e) => `<button class="chip" data-topic="${e.v}" aria-pressed="${active === e.v}">${e.label}</button>`).join("")}
    ${TOPICS.map((t, i) => `<button class="chip" data-topic="${i}" aria-pressed="${active === i}">${t.label}</button>`).join("")}
  </div><button class="chip-arrow next" type="button" tabindex="-1" aria-hidden="true">${icon("right")}</button></div>`;
}

// Chip rails show a fade and an arrow only on a side that has more to scroll to.
function syncRail(rail) {
  const bar = rail.querySelector(".chips"), max = bar.scrollWidth - bar.clientWidth;
  rail.classList.toggle("more-left", bar.scrollLeft > 2);
  rail.classList.toggle("more-right", bar.scrollLeft < max - 2);
}
function initRail(rail) {
  rail.dataset.on = "1";
  const bar = rail.querySelector(".chips");
  const sync = () => syncRail(rail);
  bar.addEventListener("scroll", sync, { passive: true });
  new ResizeObserver(sync).observe(bar);
  rail.addEventListener("click", (e) => {
    const a = e.target.closest(".chip-arrow"); if (!a) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    bar.scrollBy({ left: (a.classList.contains("prev") ? -1 : 1) * bar.clientWidth * 0.75, behavior: smooth ? "smooth" : "auto" });
  });
  sync();
}
export function watchChipRails(root) {
  const scan = () => root.querySelectorAll(".chip-rail:not([data-on])").forEach(initRail);
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  scan();
}

let toastTimer;
export function toast(msg, { action, fn } = {}) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("on"); t.dataset.at = Date.now();
  t.classList.toggle("has-action", !!action);
  if (action) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = action;
    b.onclick = () => { t.classList.remove("on"); fn(); };
    t.appendChild(b);
  }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), action ? 6000 : 2200);
}

// Calls fn when the sentinel scrolls into view; returns a disconnect function.
export function infinite(sentinel, fn) {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) fn(); }, { rootMargin: "1200px 0px" });
  io.observe(sentinel);
  return () => io.disconnect();
}

// Role and teaching badges: a small mark with a tooltip and screen-reader text, never color alone.
const BADGES = {
  owner: ["Founder", "#ffb224", '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>'],
  admin: ["Admin", "#e5484d", '<path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10v-6z"/>'],
  mod: ["Moderator", "#3e8ef7", '<path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10v-6z"/>'],
  contributor: ["Contributor", "#8e6cf0", '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'],
  professor: ["Professor", "#d68a1a", '<path d="M12 4 1.5 9 12 14l8.5-4.1V16h2V9z"/><path d="M5.5 12.2V16c0 1.7 2.9 3.5 6.5 3.5s6.5-1.8 6.5-3.5v-3.8L12 15.3z"/>'],
  tutor: ["Tutor", "#2f9e8f", '<path d="M3 5.5C5.5 4 9 4 12 6c3-2 6.5-2 9-.5V19c-2.5-1.5-6-1.5-9 .5-3-2-6.5-2-9-.5z"/>'],
  verified: ["Verified", "#30a46c", '<path d="M12 2.2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 21.8l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"/><path d="m8.2 12.2 2.6 2.6 5-5.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'],
};
export function badges(u) {
  if (!u) return "";
  const keys = [];
  // One mark per person: the role that says the most, or the check.
  const top = ["owner", "admin", "mod", "professor", "tutor", "contributor"].find((k) => k === u.role || k === u.teach);
  if (top) keys.push(top); else if (u.verified) keys.push("verified");
  return keys.map((k) => { const [label, color, path] = BADGES[k]; const stroke = k === "contributor";
    return `<span class="badge-mark" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true" style="${stroke ? `stroke:${color};fill:none` : `fill:${color}`}">${path}</svg><span class="sr-only">${label}</span></span>`; }).join("");
}
export function userAvatar(u, cls = "") {
  if (u && u.avatar) return `<img class="av ${cls}" src="${esc(u.avatar)}" alt="" loading="lazy" width="36" height="36">`;
  const ch = esc(((u && u.name) || "?")[0].toUpperCase());
  return `<span class="av ${cls}" aria-hidden="true" style="display:grid;place-items:center;font-weight:600;color:var(--fg-2)">${ch}</span>`;
}
