// The one video player. It lives outside the page, so moving between pages never reloads it: on the watch page it
// sits exactly over the page's empty .player slot, and when you leave mid-video it shrinks to a corner.
import { mountPlayer } from "./tv.js";
import { icon } from "./icons.js";
import { store } from "./store.js";

const root = document.createElement("div");
root.id = "stage"; root.hidden = true;
root.innerHTML = `<div class="stage-video"></div><div class="stage-bar"><a class="stage-title"></a><button type="button" class="stage-btn" id="stagePP"></button><button type="button" class="stage-btn" id="stageX" aria-label="Close player">${icon("close")}</button></div>`;
document.body.appendChild(root);
const video = root.querySelector(".stage-video"), title = root.querySelector(".stage-title"), pp = root.querySelector("#stagePP");
let cur = null, slot = null, ro = null, tick = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function savePos() { if (!cur || !cur.player.playing()) return; store.setPos(cur.id, cur.player.time(), cur.player.duration()); paintPP(); }
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
  clearInterval(tick);
  cur.player(); cur = null;
  unslot();
  root.hidden = true; root.className = ""; root.style.cssText = "";
  video.innerHTML = "";
}
// The watch page calls this when it renders. Returns { video, resumed, play }.
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
    return { video, resumed: true, play: () => cur.player.play() };
  }
  video.innerHTML = `<div class="stage-yt"></div>${cover}`;
  const p = store.pos(id);
  const start = p && p[0] > 10 && p[0] < p[1] - 20 ? Math.floor(p[0]) : 0;
  const me = { id, title: t, on, player: null };
  cur = me;
  const call = (k, ...a) => me.on && me.on[k] && me.on[k](...a);
  me.player = mountPlayer(video.querySelector(".stage-yt"), id, {
    start,
    onPlaying: () => { root.classList.add("started"); paintPP(); call("onPlaying"); },
    onPause: paintPP,
    onPlay: () => call("onPlay"),
    onEnd: () => { const d = me.player.duration(); if (d) store.setPos(id, d, d); if (root.classList.contains("mini")) closeStage(); else call("onEnd"); },
    onError: (c) => call("onError", c),
  });
  clearInterval(tick); tick = setInterval(savePos, 5000);
  return { video, resumed: false, play: () => me.player.play() };
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
