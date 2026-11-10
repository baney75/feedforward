// Questions inside a video. At each one the video stops and a question waits under the player; it plays on once
// you answer. Scrubbing forward past a question you haven't answered takes you back to it. A right answer counts
// for good (it syncs with progress); a miss asks again next time.
import { esc } from "./ui.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { dueCheck } from "./checktime.js";

let all = null;
export function loadChecks() {
  if (!all) all = fetch("/data/checks.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(() => { all = null; return {}; });
  return all;
}
// Keyed by the question's time, not its place in the list, so adding a question later keeps everyone's answers.
export const checkKey = (id, c) => `chk:${id}:${c.t}`;
// [right, total] for a video, from what this device and your account know.
export function checkScore(id, list) { return [list.filter((c) => store.isDone(checkKey(id, c))).length, list.length]; }

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Runs the questions for one video on the watch page. Returns { stop, summary }.
export function runChecks({ id, list, stage, box, strip, on }) {
  let open = -1, last = null, timer = 0, enabled = on, forced = 0, held = false;
  const passed = new Set(); // asked and answered this visit, right or wrong
  const asked = (k) => store.isDone(checkKey(id, list[k])) || passed.has(k);
  const dim = () => {
    stage.video.querySelector(".ckdim")?.remove();
    if (open >= 0) stage.video.insertAdjacentHTML("beforeend", `<div class="ckdim" role="status"><span>${icon("info")}Question ${open + 1} of ${list.length} is below the video</span></div>`);
  };
  const paintStrip = () => {
    const [r, n] = checkScore(id, list);
    strip.innerHTML = `<button type="button" class="ckon" aria-pressed="${enabled}">${icon("check")}${enabled ? "Questions on" : "Questions off"}</button>
      <span class="ckdots" aria-label="${r} of ${n} answered right">${list.map((c, k) => `<i class="${store.isDone(checkKey(id, list[k])) ? "ok" : passed.has(k) ? "miss" : ""}${k === open ? " now" : ""}" title="${clock(c.t)}"></i>`).join("")}</span>
      <span class="muted">${n} question${n === 1 ? "" : "s"} in this video${r ? `, ${r} right` : ""}</span>`;
    strip.querySelector(".ckon").onclick = () => { enabled = !enabled; if (!enabled) close(); paintStrip(); };
  };
  const close = () => { open = -1; box.innerHTML = ""; box.hidden = true; dim(); paintStrip(); };
  const ask = (k) => {
    open = k;
    const c = list[k];
    stage.pause(true);
    forced = 0; held = false;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
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
      if (right) store.done(checkKey(id, c));
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
    // The plain fallback player can't be paused from here, so there are no questions to offer.
    if (!stage.controllable()) { strip.hidden = true; return; }
    if (!stage.playing()) { if (open >= 0) held = true; return; }
    const t = stage.time();
    if (open >= 0) {
      // Answered, then played with YouTube's own button: same as Keep watching.
      if (box.querySelector(".opts")?.dataset.done) { close(); last = t; return; }
      // Play pressed after the question paused the video: pause once more. If they play again (an iPhone's own
      // fullscreen player can't be left from here, so it may be the only way out), let it go; the question is
      // skipped for now, and the ones after it still come.
      if (held) { held = false; if (forced++ < 1) { stage.pause(true); last = t; return; } passed.delete(open); close(); }
      else { last = t; return; }
    }
    // The first read that has a time is where you started, so earlier questions don't pull you back. A buffering
    // player can read 0 before it reaches a resumed spot.
    if (last == null) { if (t > 0.05) last = t; return; }
    if (enabled) {
      const { k, seekTo } = dueCheck(list, last, t, asked);
      if (k >= 0) { if (seekTo != null) stage.seek(seekTo); last = list[k].t; ask(k); return; }
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
