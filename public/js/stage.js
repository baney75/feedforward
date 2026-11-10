// The one video player. It lives outside the page, so moving between pages never reloads it: on the watch page it
// sits exactly over the page's empty .player slot, and when you leave mid-video it shrinks to a corner.
import { mountPlayer } from "./tv.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { flushSync } from "./account.js";

const root = document.createElement("div");
root.id = "stage"; root.hidden = true;
root.innerHTML = `<div class="stage-video"></div><div class="stage-bar"><a class="stage-title"></a><button type="button" class="stage-btn" id="stagePP"></button><button type="button" class="stage-btn" id="stageX" aria-label="Close player">${icon("close")}</button></div>`;
document.body.appendChild(root);
const video = root.querySelector(".stage-video"), title = root.querySelector(".stage-title"), pp = root.querySelector("#stagePP");
let cur = null, slot = null, ro = null, tick = 0, ticks = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function savePos(paused) {
  if (!cur || (!paused && !cur.player.playing())) return;
  const t = cur.player.time();
  // A paused player only reports a place it actually moved to. A player that hasn't started reads 0, and one left
  // paused here must not overwrite the further point you reached on another device.
  if (paused && (!(t >= 1) || Math.abs(t - cur.saved) < 1)) return;
  cur.saved = t;
  store.setPos(cur.id, t, cur.player.duration()); paintPP();
}
// Up to the account about once a minute while playing, and right away when you pause, leave or switch apps.
function tickPos() { savePos(); if (++ticks % 12 === 0 && cur && cur.player.playing()) store.touchPos(); }
document.addEventListener("visibilitychange", () => { if (document.hidden && cur) { savePos(true); flushSync(); } });
function paintPP() {
  if (!cur) return;
  const on = cur.player.playing();
  pp.innerHTML = icon(on ? "pause" : "play"); pp.setAttribute("aria-label", on ? "Pause" : "Play");
}
function dock() {
  if (!slot || !root.isConnected) return;
  const r = slot.getBoundingClientRect();
  root.style.cssText = `left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px`;
}
// Glide from where the player was to where it is now.
function glide(from) {
  if (calm() || !from.width) return;
  const to = root.getBoundingClientRect();
  if (!to.width) return;
  root.animate([{ transformOrigin: "0 0", transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
}
function unslot() { if (ro) ro.disconnect(); ro = null; slot = null; removeEventListener("resize", dock); }
function toMini() {
  const from = root.getBoundingClientRect();
  unslot();
  root.style.cssText = "";
  root.classList.add("mini");
  video.querySelector(".autonext")?.remove();
  title.textContent = cur.title; title.href = "/watch/" + cur.id;
  paintPP();
  glide(from);
}
export function closeStage() {
  if (!cur) return;
  savePos();
  store.touchPos();
  clearInterval(tick);
  cur.player(); cur = null;
  unslot();
  root.hidden = true; root.className = ""; root.style.cssText = "";
  video.innerHTML = "";
}
// The watch page calls this when it renders. Returns the controls below.
export function openStage({ id, title: t, slotEl, cover, on }) {
  const same = cur && cur.id === id;
  const from = same && root.classList.contains("mini") ? root.getBoundingClientRect() : null;
  if (!same) closeStage();
  root.hidden = false; root.classList.remove("mini");
  slot = slotEl; dock();
  ro = new ResizeObserver(dock); ro.observe(slot); addEventListener("resize", dock);
  if (same) {
    cur.on = on;
    if (from) glide(from);
    return controls(video, true);
  }
  video.innerHTML = `<div class="stage-yt"></div>${cover}`;
  const p = store.pos(id);
  const start = p && p[0] > 10 && p[0] < p[1] - 20 ? Math.floor(p[0]) : 0;
  const me = { id, title: t, on, player: null, saved: start };
  cur = me;
  const call = (k, ...a) => me.on && me.on[k] && me.on[k](...a);
  me.player = mountPlayer(video.querySelector(".stage-yt"), id, {
    start,
    onPlaying: () => { root.classList.add("started"); paintPP(); call("onPlaying"); },
    // A pause the page asked for (a question inside the video) saves the place but doesn't sync on its own.
    onPause: () => { savePos(true); if (me.quiet) me.quiet = false; else store.touchPos(); paintPP(); },
    onPlay: () => call("onPlay"),
    onEnd: () => { const d = me.player.duration(); if (d) { store.setPos(id, d, d); store.touchPos(); } if (root.classList.contains("mini")) closeStage(); else call("onEnd"); },
    onError: (c) => call("onError", c),
  });
  clearInterval(tick); tick = setInterval(tickPos, 5000);
  return controls(video, false);
}
// What a page can do with the player it opened. Each call reaches whatever player is current, so a stale page does nothing.
function controls(video, resumed) {
  const me = cur, live = () => cur === me;
  return {
    video, resumed,
    play: () => live() && me.player.play(),
    pause: (quiet) => { if (!live()) return; if (quiet) me.quiet = true; me.player.pause(); },
    seek: (t) => live() && me.player.seek(t),
    time: () => (live() ? me.player.time() : 0),
    playing: () => live() && me.player.playing(),
    controllable: () => live() && !me.player.fallback,
  };
}
// The watch page calls this when it goes away. Another watch page reuses or replaces the player itself.
export function leaveStage() {
  if (!cur || location.pathname.startsWith("/watch/")) return;
  savePos();
  if (cur.player.playing()) toMini(); else closeStage();
}
pp.onclick = () => { if (!cur) return; cur.player.toggle(); setTimeout(paintPP, 250); };
root.querySelector("#stageX").onclick = closeStage;
export const stageEl = root;
