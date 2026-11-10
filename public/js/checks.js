// Questions inside a video. At each one the video stops and a question waits under the player; it plays on once
// you answer. Scrubbing forward past a question you haven't answered takes you back to it. A right answer counts
// for good (it syncs with progress); a miss asks again next time.
import { esc } from "./ui.js";
import { icon } from "./icons.js";
import { store } from "./store.js";

let all = null;
export function loadChecks() {
  if (!all) all = fetch("/data/checks.json").then((r) => (r.ok ? r.json() : {})).catch(() => { all = null; return {}; });
  return all;
}
export const checkKey = (id, k) => `chk:${id}:${k}`;
// [right, total] for a video, from what this device and your account know.
export function checkScore(id, list) { return [list.filter((_, k) => store.isDone(checkKey(id, k))).length, list.length]; }

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const JUMP = 3; // seconds: a bigger step between two reads means you scrubbed, not watched

// Runs the questions for one video on the watch page. Returns { stop, summary }.
export function runChecks({ id, list, stage, box, strip, on }) {
  let open = -1, last = null, timer = 0, enabled = on;
  const passed = new Set(); // asked and answered this visit, right or wrong
  const asked = (k) => store.isDone(checkKey(id, k)) || passed.has(k);
  const dim = () => {
    stage.video.querySelector(".ckdim")?.remove();
    if (open >= 0) stage.video.insertAdjacentHTML("beforeend", `<div class="ckdim" role="status"><span>${icon("info")}Question ${open + 1} of ${list.length} is below the video</span></div>`);
  };
  const paintStrip = () => {
    const [r, n] = checkScore(id, list);
    strip.innerHTML = `<button type="button" class="ckon" aria-pressed="${enabled}">${icon("check")}${enabled ? "Questions on" : "Questions off"}</button>
      <span class="ckdots" aria-label="${r} of ${n} answered right">${list.map((c, k) => `<i class="${store.isDone(checkKey(id, k)) ? "ok" : passed.has(k) ? "miss" : ""}${k === open ? " now" : ""}" title="${clock(c.t)}"></i>`).join("")}</span>
      <span class="muted">${n} question${n === 1 ? "" : "s"} in this video${r ? `, ${r} right` : ""}</span>`;
    strip.querySelector(".ckon").onclick = () => { enabled = !enabled; if (!enabled) close(); paintStrip(); };
  };
  const close = () => { open = -1; box.innerHTML = ""; box.hidden = true; dim(); paintStrip(); };
  const ask = (k) => {
    open = k;
    const c = list[k];
    stage.pause();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    box.hidden = false;
    box.innerHTML = `<div class="q ckq"><span class="kind">Question ${k + 1} of ${list.length} · ${clock(c.t)}</span><h3>${esc(c.q)}</h3>
      <div class="opts">${c.options.map((o, i) => `<button type="button" data-ck="${i}">${esc(o)}</button>`).join("")}</div><div class="fb" aria-live="polite"></div><div class="act"></div></div>`;
    dim(); paintStrip();
    const r = box.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0) box.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    box.querySelector("[data-ck]").focus({ preventScroll: true });
    box.querySelector(".opts").onclick = (e) => {
      const b = e.target.closest("[data-ck]");
      if (!b || box.querySelector(".opts").dataset.done) return;
      const pick = +b.dataset.ck, right = pick === c.answer;
      box.querySelector(".opts").dataset.done = "1";
      box.querySelectorAll("[data-ck]").forEach((x) => { x.disabled = true; if (+x.dataset.ck === c.answer) x.classList.add("right"); });
      if (!right) b.classList.add("wrong");
      passed.add(k);
      if (right) store.done(checkKey(id, k));
      box.querySelector(".fb").innerHTML = `<b class="${right ? "r" : "w"}">${right ? "Right." : "Not quite."}</b> ${esc(c.why)}`;
      // Rewatch goes back to the start of this part: the last question before this one, or about a minute earlier.
      const back = Math.max(k ? list[k - 1].t + 1 : 0, c.t - 60);
      box.querySelector(".act").innerHTML = `${right ? "" : `<button type="button" class="btn" data-rewatch>${icon("left")}Rewatch this part</button>`}<button type="button" class="btn primary" data-go>${icon("play")}Keep watching</button>`;
      box.querySelector("[data-go]").onclick = () => { close(); stage.play(); };
      const rw = box.querySelector("[data-rewatch]");
      if (rw) rw.onclick = () => { passed.delete(k); close(); last = back; stage.seek(back); stage.play(); };
      (rw || box.querySelector("[data-go]")).focus();
    };
  };
  const tick = () => {
    if (!stage.playing()) return;
    const t = stage.time();
    if (open >= 0) { stage.pause(); return; }
    if (last == null) { last = t; return; } // the first read is where you started, so earlier questions don't pull you back
    if (enabled) {
      const k = list.findIndex((c, i) => !asked(i) && last < c.t && c.t <= t + 0.3);
      if (k >= 0) {
        if (t - list[k].t > JUMP) stage.seek(list[k].t);
        last = list[k].t; ask(k); return;
      }
    }
    last = t;
  };
  timer = setInterval(tick, 250);
  paintStrip();
  return {
    stop() { clearInterval(timer); stage.video.querySelector(".ckdim")?.remove(); },
    summary() { const [r, n] = checkScore(id, list); return passed.size || r ? `${r} of ${n} questions right` : ""; },
  };
}
