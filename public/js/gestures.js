// Phone gestures. Each one starts only where nothing else already owns the swipe: the YouTube frame takes its own
// touches, and anything that scrolls sideways keeps them.
import { haptic } from "./haptics.js";

const near = (x) => x < 24 || x > innerWidth - 24; // The edges belong to the phone's own back gesture.
function ownsSideways(el) {
  if (el.closest(".lib-item,input,textarea,select,dialog,[role=slider],.post-media")) return true;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}
export function initGestures({ nav, standalone, stageEl, closeStage }) {
  const view = document.getElementById("view");
  const ptr = document.createElement("div");
  ptr.id = "ptr"; ptr.setAttribute("aria-hidden", "true");
  document.body.appendChild(ptr);
  const PULL = 80;
  const tabs = () => [...document.querySelectorAll(".tabbar a")].map((a) => a.getAttribute("href"));
  const barShown = () => { const b = document.querySelector(".tabbar"); return !!b && getComputedStyle(b).display !== "none"; };
  const onTab = () => barShown() && tabs().includes(location.pathname);
  let s = null, ticked = false;
  document.addEventListener("touchstart", (e) => {
    s = null; ticked = false;
    if (e.touches.length !== 1 || document.querySelector("dialog[open]") || document.body.classList.contains("focus")) return;
    const t = e.touches[0];
    if (!view.contains(e.target)) return;
    s = { x: t.clientX, y: t.clientY, at: Date.now(), el: e.target, top: scrollY <= 0, pull: 0 };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!s || e.touches.length !== 1) { s = null; return; }
    if (!(standalone && s.top && onTab() && location.pathname !== "/shorts")) return;
    const dy = e.touches[0].clientY - s.y;
    s.pull = Math.max(0, Math.min(130, dy));
    ptr.style.transform = `translate(-50%, ${s.pull * 0.6}px)`;
    ptr.style.opacity = Math.min(1, s.pull / PULL);
    ptr.classList.toggle("ready", s.pull >= PULL);
    if (s.pull >= PULL && !ticked) { ticked = true; haptic.tick(); }
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, quick = Date.now() - s.at < 450, from = s;
    s = null;
    ptr.style.transform = ""; ptr.style.opacity = 0; ptr.classList.remove("ready");
    if (from.pull >= PULL) { haptic.tick(); location.reload(); return; }
    // Down on the page under the video: back to browsing, with the video still playing in the corner.
    if (location.pathname.startsWith("/watch/") && from.top && dy > 100 && Math.abs(dx) < 50 && !from.el.closest("textarea,input,.shelf")) { haptic.tick(); nav("/"); return; }
    if (quick && Math.abs(dx) > 90 && Math.abs(dy) < 40 && onTab() && !near(from.x) && !ownsSideways(from.el)) {
      const list = tabs(), next = list[list.indexOf(location.pathname) + (dx < 0 ? 1 : -1)];
      if (next) { haptic.tick(); nav(next); }
    }
  }, { passive: true });
  // Swipe the mini player's bar down to put it away.
  const bar = stageEl.querySelector(".stage-bar");
  let y0 = null, moved = 0;
  bar.addEventListener("touchstart", (e) => { y0 = stageEl.classList.contains("mini") ? e.touches[0].clientY : null; moved = 0; }, { passive: true });
  bar.addEventListener("touchmove", (e) => { if (y0 == null) return; moved = Math.max(0, e.touches[0].clientY - y0); stageEl.style.transform = `translateY(${moved}px)`; stageEl.style.opacity = 1 - Math.min(0.7, moved / 160); }, { passive: true });
  bar.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; stageEl.style.transform = ""; stageEl.style.opacity = ""; if (moved > 60) { haptic.tick(); closeStage(); } }, { passive: true });
}
