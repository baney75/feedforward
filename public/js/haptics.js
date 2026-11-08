// Haptics: a light tick for taps that change something, a success pattern for moments that matter.
// Android uses the Vibration API. iPhones have no web haptics API: Safari ticks only when a real finger toggles a
// native switch, and a script clicking one does nothing. So on iPhone every button carries an invisible label wired to
// a hidden switch, and the tap itself makes the tick. For about a second after a real tap Safari also lets a script
// flip a switch: links use that, and so does the second pulse of a success pattern. Swipes grant nothing.
// Off with reduced motion, and the viewer can turn it off (lt:haptics = false).
const enabled = () => {
  try { if (localStorage.getItem("lt:haptics") === "false") return false; } catch {}
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
};
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ATTR = "data-haptic";
function label(style) {
  const l = document.createElement("label");
  l.setAttribute(ATTR, ""); l.setAttribute("aria-hidden", "true");
  l.style.cssText = `position:absolute;touch-action:manipulation;-webkit-tap-highlight-color:transparent;${style}`;
  const i = document.createElement("input");
  i.type = "checkbox"; i.setAttribute("switch", ""); i.tabIndex = -1;
  i.style.cssText = "position:absolute;width:1px;height:1px;margin:0;visibility:hidden";
  i.addEventListener("click", (e) => e.stopPropagation());
  l.append(i);
  return l;
}
// Submit buttons stay plain: a label inside one would take over its default action. Links navigate through the app,
// so the tab bar gets labels beside its links that pass the tap along.
const BUTTONS = "button[type=button]:not(.term), button:not([type]):not(form button):not(.term)";
function scan() {
  if (!enabled()) return;
  document.querySelectorAll(BUTTONS).forEach((b) => {
    if (b.querySelector(`:scope > [${ATTR}]`)) return;
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    b.append(label("inset:0"));
  });
  const bar = document.querySelector(".tabbar"), links = bar ? [...bar.querySelectorAll("a")] : [];
  if (links.length && !bar.querySelector(`:scope > [${ATTR}]`)) links.forEach((a, n) => {
    const l = label(`top:0;bottom:0;left:${(n * 100) / links.length}%;width:${100 / links.length}%`);
    l.addEventListener("click", () => a.click());
    bar.append(l);
  });
}
if (isIOS) {
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; scan(); }); } }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
  addEventListener("click", (e) => {
    if (!e.isTrusted || !enabled()) return;
    lastTap = Date.now();
    if (!e.target.closest?.(`[${ATTR}]`) && e.target.closest?.("a[href]")) flip();
  }, true);
}
let hidden = null, lastTap = 0;
const GRANT = 850;
function flip() {
  if (!hidden?.isConnected) { hidden = label("display:none"); document.body.append(hidden); }
  hidden.click();
}
function buzz(pattern) {
  if (!enabled()) return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} return; }
  if (isIOS && Array.isArray(pattern) && Date.now() - lastTap < GRANT) setTimeout(flip, pattern[0] + pattern[1]);
}
export const haptic = {
  tick: () => buzz(8),
  success: () => buzz([12, 60, 18]),
  warn: () => buzz([30, 40, 30]),
};
export const setHaptics = (on) => {
  try { localStorage.setItem("lt:haptics", on ? "true" : "false"); } catch {}
  if (!isIOS) return;
  if (on) scan(); else document.querySelectorAll(`[${ATTR}]`).forEach((l) => l.remove());
};
export const hapticsOn = enabled;
