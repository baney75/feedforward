// Haptics: a light tick for taps that change something (like, save, swipe), a success pattern for moments
// that matter (you're in, a streak). Android uses the Vibration API. iOS Safari has none, but since iOS 18 a
// native switch control ticks when it toggles, so a hidden one is toggled inside the same tap.
// Off with reduced motion, and the viewer can turn it off (lt:haptics = false).
let sw = null;
const enabled = () => {
  try { if (localStorage.getItem("lt:haptics") === "false") return false; } catch {}
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
};
function iosTick() {
  if (!sw) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox"; input.setAttribute("switch", ""); input.tabIndex = -1;
    label.appendChild(input); document.body.appendChild(label);
    sw = label;
  }
  sw.click();
}
function buzz(pattern) {
  if (!enabled()) return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); return; } catch {} }
  iosTick();
  if (Array.isArray(pattern) && pattern.length > 2) setTimeout(iosTick, pattern[0] + pattern[1]);
}
export const haptic = {
  tick: () => buzz(8),
  success: () => buzz([12, 60, 18]),
  warn: () => buzz([30, 40, 30]),
};
export const setHaptics = (on) => { try { localStorage.setItem("lt:haptics", on ? "true" : "false"); } catch {} };
export const hapticsOn = enabled;
