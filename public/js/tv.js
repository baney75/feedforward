// YouTube IFrame player (privacy-enhanced host) and the lean-back TV mode.
import { D, TOPICS, sampler } from "./data.js";
import { esc, chipTopics } from "./ui.js";
import { icon } from "./icons.js";
import { store } from "./store.js";

let apiReady;
function api() {
  if (apiReady) return apiReady;
  apiReady = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api"; s.onerror = () => { apiReady = null; rej(new Error("YouTube API failed")); };
    document.head.appendChild(s);
  });
  return apiReady;
}

const embedSrc = (id, autoplay = 1) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay}&rel=0&playsinline=1&iv_load_policy=3&color=white`;
function fallbackIframe(host, id, autoplay = 1) {
  host.outerHTML = `<iframe src="${embedSrc(id, autoplay)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video player"></iframe>`;
}

export function mountPlayer(host, id, { start = 0, onPlay, onPlaying, onPause, onEnd, onError } = {}) {
  let player, dead = false, played = false;
  api().then((YT) => {
    if (dead) return;
    player = new YT.Player(host, {
      host: "https://www.youtube-nocookie.com", videoId: id,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, color: "white", ...(start ? { start } : {}) },
      events: {
        onStateChange: (e) => {
          if (e.data === 2) onPause && onPause();
          if (e.data === 1) onPlaying && onPlaying();
          if (e.data === 1 && !played) { played = true; onPlay && onPlay(); }
          if (e.data === 0) onEnd && onEnd();
        },
        // 101 and 150: the owner disabled embedding. 100: removed or private.
        onError: (e) => { if ([100, 101, 150].includes(e.data)) onError && onError(e.data); },
      },
    });
  }).catch(() => { if (!dead) { fallbackIframe(host, id); onPlay && onPlay(); onPlaying && onPlaying(); } });
  const stop = () => { dead = true; try { player && player.destroy(); } catch {} };
  stop.play = () => { try { player && player.playVideo(); } catch {} };
  const read = (f, d) => { try { return player && player[f] ? player[f]() : d; } catch { return d; } };
  stop.playing = () => [1, 3].includes(read("getPlayerState", -1));
  stop.time = () => read("getCurrentTime", 0);
  stop.duration = () => read("getDuration", 0);
  stop.pause = () => { try { player && player.pauseVideo(); } catch {} };
  stop.seek = (t) => { try { player && player.seekTo(Math.max(0, t), true); } catch {} };
  stop.toggle = () => { try { stop.playing() ? player.pauseVideo() : player.playVideo(); } catch {} };
  return stop;
}

// ---------- TV mode ----------
// Works from a phone, a keyboard or a TV remote. With a remote: left and right seek, OK pauses, down is the next video,
// up walks into the controls. Inside the controls left and right move, OK presses, down leaves.
const tv = { open: false, run: 0, player: null, ready: false, hist: [], pos: -1, cur: null, topic: -1, next: null, ui: 0, tick: 0, ticks: 0, started: false, errs: 0, unmutedAt: 0, blocked: false };
const $tv = () => document.getElementById("tv");
const wantSound = () => sessionStorage.getItem("ff:tvsound") !== "0";
const clock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`; };
const call = (f, ...a) => { try { return tv.player && tv.player[f] ? tv.player[f](...a) : undefined; } catch { return undefined; } };

function pick() {
  if (!tv.next) tv.next = sampler({ topic: tv.topic });
  let v;
  for (let k = 0; k < 12; k++) {
    v = tv.next() || (tv.next = sampler({ topic: tv.topic }), tv.next());
    if (!v || !store.isFinished(v.id)) break;
  }
  return v;
}

// Pick up where this video was left, unless it's barely started or already finished.
function startAt(v) { const p = store.pos(v.id); return p && p[0] > 10 && !store.isFinished(v.id) ? Math.max(0, p[0] - 2) : 0; }

function savePos(sync) {
  if (!tv.cur || !tv.started) return;
  const d = call("getDuration"), t = call("getCurrentTime");
  if (d > 0 && t >= 0) store.setPos(tv.cur.id, t, d);
  if (sync) store.touchPos();
}

function renderShell() {
  const el = $tv();
  const ctl = (id, label, name) => `<button id="${id}" data-tvf type="button" aria-label="${label}">${icon(name)}</button>`;
  const chip = (i, l) => `<button class="chip" data-tvf data-tvtopic="${i}" type="button" aria-pressed="${i === tv.topic}">${esc(l)}</button>`;
  el.innerHTML = `<div class="tvp"><div id="tvp"></div><div class="tvcover" aria-hidden="true"><img alt=""></div></div><div class="catch"></div>
    <div class="tvtop"><button class="x" id="tvx" data-tvf type="button">Exit</button></div>
    <div class="osd"><div class="ttl"></div><div class="by"></div>
      <div class="tvprog"><div class="bar"><i></i></div><span class="tvtime mono"></span></div>
      <div class="tvrow"><div class="tvctl">${ctl("tvprev", "Previous video", "left")}${ctl("tvplay", "Pause", "pause")}${ctl("tvnext", "Next video", "right")}${ctl("tvsound", "Turn sound on or off", "volume")}</div>
      <div class="tvchips" role="group" aria-label="Topic">${chip(-1, "All")}${chipTopics(-1).map((i) => chip(i, TOPICS[i].label)).join("")}</div></div>
      <div class="keys"><kbd>Space</kbd> pause <kbd>←</kbd><kbd>→</kbd> 10s <kbd>↑</kbd> controls <kbd>↓</kbd> next <kbd>Esc</kbd> exit</div></div>`;
  const press = (sel, f) => { el.querySelector(sel).onclick = (e) => { f(); if (e.detail) e.currentTarget.blur(); showUI(); }; };
  press("#tvx", closeTV);
  press("#tvprev", () => go(-1));
  press("#tvnext", () => go(1));
  press("#tvplay", togglePlay);
  press("#tvsound", toggleSound);
  el.querySelectorAll("[data-tvtopic]").forEach((b) => { b.onclick = (e) => {
    tv.topic = +b.dataset.tvtopic; tv.next = null;
    el.querySelectorAll("[data-tvtopic]").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    go(1, true); if (e.detail) b.blur();
  }; });
  el.querySelector(".bar").onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), d = call("getDuration");
    if (d) { tv.unmutedAt = 0; call("seekTo", (d * (e.clientX - r.left)) / r.width, true); }
    showUI();
  };
  el.querySelector(".catch").onclick = () => { if (!el.classList.contains("ui")) return showUI(); togglePlay(); showUI(); };
  el.onmousemove = showUI;
  paintSound();
}

function hideUI() {
  const el = $tv(); if (!el) return;
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.classList.remove("ui");
}
// The controls stay up while nothing is moving on screen: on the poster and while paused.
function showUI() {
  const el = $tv(); el.classList.add("ui");
  clearTimeout(tv.ui);
  if (!el.classList.contains("covered") && !el.classList.contains("paused")) tv.ui = setTimeout(hideUI, 4000);
}

function paintPlay(playing) {
  const b = $tv().querySelector("#tvplay"); if (!b) return;
  b.innerHTML = icon(playing ? "pause" : "play"); b.setAttribute("aria-label", playing ? "Pause" : "Play");
}
function paintSound() {
  const b = $tv().querySelector("#tvsound"); if (!b) return;
  const on = wantSound() && !tv.blocked;
  b.innerHTML = icon(on ? "volume" : "volumeOff"); b.setAttribute("aria-pressed", String(!on));
}
function togglePlay() { tv.unmutedAt = 0; call("getPlayerState") === 1 ? call("pauseVideo") : call("playVideo"); }
function toggleSound() {
  const on = !(wantSound() && !tv.blocked);
  tv.blocked = false; tv.unmutedAt = 0;
  sessionStorage.setItem("ff:tvsound", on ? "1" : "0");
  if (on) { call("unMute"); call("setVolume", 100); } else call("mute");
  paintSound();
}

function load(v) {
  const el = $tv();
  savePos(true);
  tv.cur = v; tv.started = false;
  el.querySelector(".ttl").textContent = v.title;
  const p = D.people[v.person];
  el.querySelector(".by").innerHTML = `${esc(p.name)} <span style="opacity:.7">· ${esc(TOPICS[v.topic]?.label || "")}</span>`;
  el.querySelector(".bar i").style.width = "0"; el.querySelector(".tvtime").textContent = "";
  // Our poster covers YouTube's start screen until the video is really playing.
  const im = el.querySelector(".tvcover img");
  im.onerror = () => { im.onerror = null; im.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`; }; im.src = `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`;
  el.classList.add("covered"); el.classList.remove("paused");
  if (tv.ready) call("loadVideoById", { videoId: v.id, startSeconds: startAt(v) });
  // No YouTube API on this device: point the plain player at the new video instead.
  const plain = !tv.player && el.querySelector(".tvp iframe");
  if (plain) { plain.src = embedSrc(v.id); el.classList.remove("covered"); }
  showUI();
}

function go(dir, fresh = false) {
  if (dir < 0) { if (tv.pos > 0) load(tv.hist[--tv.pos]); return; }
  if (!fresh && tv.pos < tv.hist.length - 1) return load(tv.hist[++tv.pos]);
  const v = pick(); if (!v) return;
  tv.hist = tv.hist.slice(0, tv.pos + 1); tv.hist.push(v); tv.pos = tv.hist.length - 1;
  load(v);
}

function onState(e) {
  const el = $tv(); if (!tv.open) return;
  if (e.data === 1) {
    if (!tv.started) { tv.started = true; store.watched(tv.cur.id); }
    tv.errs = 0;
    el.classList.remove("covered", "paused"); paintPlay(true); showUI();
    // Everything starts muted because browsers only autoplay muted video. Sound comes on once it's really playing.
    if (wantSound() && !tv.blocked && call("isMuted")) { tv.unmutedAt = Date.now(); call("unMute"); call("setVolume", 100); }
  } else if (e.data === 2) {
    // Safari pauses a video that unmutes without a tap: go back to muted playback and leave the sound button to the viewer.
    if (tv.unmutedAt && Date.now() - tv.unmutedAt < 2000) { tv.unmutedAt = 0; tv.blocked = true; call("mute"); call("playVideo"); paintSound(); return; }
    el.classList.add("paused"); paintPlay(false); savePos(true); showUI();
  } else if (e.data === 0) {
    const d = call("getDuration");
    if (tv.cur && d > 0) { store.setPos(tv.cur.id, d, d); store.touchPos(); }
    tv.started = false; go(1);
  }
}

// A video that won't embed is dropped and the next one plays, but a dead connection must not spin forever.
function onError() {
  if (!tv.open) return;
  if (++tv.errs >= 6) { $tv().querySelector(".ttl").textContent = "These videos won't play right now."; $tv().querySelector(".by").textContent = "Check your connection, then try again."; return; }
  tv.hist.splice(tv.pos, 1); tv.pos--; tv.started = false;
  go(1, true);
}

function tick() {
  const el = $tv(), d = call("getDuration"), t = call("getCurrentTime");
  if (d > 0 && t >= 0 && tv.started) { el.querySelector(".bar i").style.width = (100 * t) / d + "%"; el.querySelector(".tvtime").textContent = `${clock(t)} / ${clock(d)}`; }
  if (call("getPlayerState") === 1 && ++tv.ticks % 10 === 0) savePos(tv.ticks % 120 === 0);
}

export async function openTV(startId) {
  if (tv.open) return;
  tv.open = true; const run = ++tv.run;
  Object.assign(tv, { ready: false, started: false, errs: 0, blocked: false, unmutedAt: 0, ticks: 0, topic: -1, next: null });
  const el = $tv(); el.hidden = false; document.body.style.overflow = "hidden";
  renderShell();
  const first = (startId && D.byId.get(startId)) || pick();
  tv.hist = [first]; tv.pos = 0;
  load(first);
  addEventListener("keydown", tvKeys, true);
  tv.tick = setInterval(tick, 500);
  if (matchMedia("(min-width: 720px)").matches) el.requestFullscreen?.()?.catch(() => {});
  try {
    const YT = await api();
    if (run !== tv.run || !tv.open) return;
    const start = startAt(first);
    tv.player = new YT.Player("tvp", {
      host: "https://www.youtube-nocookie.com", videoId: first.id,
      playerVars: { autoplay: 1, mute: 1, rel: 0, playsinline: 1, controls: 0, modestbranding: 1, iv_load_policy: 3, ...(start ? { start } : {}) },
      events: {
        onReady: () => {
          if (run !== tv.run) return;
          tv.ready = true;
          try { tv.player.getIframe().tabIndex = -1; } catch {}
          if (tv.cur.id !== first.id) call("loadVideoById", { videoId: tv.cur.id, startSeconds: startAt(tv.cur) });
          else call("playVideo");
        },
        onStateChange: (e) => { if (run === tv.run) onState(e); },
        onError: () => { if (run === tv.run) onError(); },
      },
    });
  } catch { if (run === tv.run && tv.open) { fallbackIframe(document.getElementById("tvp"), first.id); el.classList.remove("covered"); showUI(); } }
}

export function closeTV() {
  if (!tv.open) return;
  savePos(true);
  tv.open = false; tv.run++;
  clearInterval(tv.tick); clearTimeout(tv.ui);
  try { tv.player && tv.player.destroy(); } catch {}
  tv.player = null; tv.ready = false; tv.cur = null;
  const el = $tv(); el.hidden = true; el.innerHTML = ""; el.className = ""; document.body.style.overflow = "";
  removeEventListener("keydown", tvKeys, true);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (location.pathname === "/tv") {
    if (history.state && history.state.tv) history.back();
    else { history.replaceState(null, "", "/"); dispatchEvent(new PopStateEvent("popstate")); }
  }
}

export const tvIsOpen = () => tv.open;

// Remotes that don't send a named key send these codes (LG webOS and Samsung Tizen).
const REMOTE = { 461: "GoBack", 10009: "GoBack", 415: "MediaPlay", 19: "MediaPause", 417: "MediaFastForward", 412: "MediaRewind", 425: "MediaTrackNext", 424: "MediaTrackPrevious" };

function tvKeys(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = REMOTE[e.keyCode] || e.key;
  const seek = (s) => { const t = call("getCurrentTime"); if (t >= 0) { tv.unmutedAt = 0; call("seekTo", Math.max(0, t + s), true); } };
  const handled = () => { e.preventDefault(); e.stopPropagation(); showUI(); };
  const el = $tv(), a = document.activeElement, inRow = a && el.contains(a) && a.matches("[data-tvf]");
  if (["Escape", "GoBack", "BrowserBack", "Backspace"].includes(k)) { handled(); if (inRow) a.blur(); else closeTV(); return; }
  if (inRow) {
    if (k === "ArrowLeft" || k === "ArrowRight") {
      handled();
      const all = [...el.querySelectorAll(".osd [data-tvf], #tvx")], n = all.indexOf(a) + (k === "ArrowRight" ? 1 : -1);
      if (all[n]) all[n].focus();
      return;
    }
    if (k === "ArrowDown") { handled(); a.blur(); return; }
    if (k === "ArrowUp") { handled(); return; }
    if (k === "Enter" || k === " ") { showUI(); return; } // the browser presses the focused button
  }
  if (k === "t" || k === "T") { handled(); closeTV(); }
  else if (k === "ArrowUp") { handled(); el.querySelector("#tvplay").focus(); }
  else if (k === "ArrowDown" || k === "n" || k === "N" || k === "MediaTrackNext") { handled(); go(1); }
  else if (k === "p" || k === "P" || k === "MediaTrackPrevious") { handled(); go(-1); }
  else if (k === " " || k === "Enter" || k === "MediaPlayPause") { handled(); togglePlay(); }
  else if (k === "MediaPlay") { handled(); call("playVideo"); }
  else if (k === "MediaPause") { handled(); tv.unmutedAt = 0; call("pauseVideo"); }
  else if (k === "ArrowRight" || k === "MediaFastForward") { handled(); seek(10); }
  else if (k === "ArrowLeft" || k === "MediaRewind") { handled(); seek(-10); }
  else if (k === "m" || k === "M") { handled(); toggleSound(); }
  else if (/^[0-9]$/.test(k)) { handled(); const d = call("getDuration"); if (d) { tv.unmutedAt = 0; call("seekTo", (d * +k) / 10, true); } }
}
