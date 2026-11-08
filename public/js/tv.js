// YouTube IFrame player (privacy-enhanced host) and the lean-back TV mode.
import { D, TOPICS, sampler } from "./data.js";
import { esc } from "./ui.js";
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

function fallbackIframe(host, id, autoplay = 1) {
  host.outerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay}&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video player"></iframe>`;
}

export function mountPlayer(host, id, { start = 0, onPlay, onPlaying, onPause, onEnd, onError } = {}) {
  let player, dead = false, played = false;
  api().then((YT) => {
    if (dead) return;
    player = new YT.Player(host, {
      host: "https://www.youtube-nocookie.com", videoId: id,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, ...(start ? { start } : {}) },
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
  stop.toggle = () => { try { stop.playing() ? player.pauseVideo() : player.playVideo(); } catch {} };
  return stop;
}

// ---------- TV mode ----------
const tv = { open: false, player: null, hist: [], pos: -1, topic: -1, next: null, ui: 0, tick: 0 };
const $tv = () => document.getElementById("tv");

function pick() {
  if (!tv.next) tv.next = sampler({ topic: tv.topic });
  return tv.next() || (tv.next = sampler({ topic: tv.topic }), tv.next());
}

function renderShell() {
  const el = $tv();
  el.innerHTML = `<div class="tvp"><div id="tvp"></div><div class="tvcover" aria-hidden="true"><img alt=""></div></div><div class="catch"></div>
    <div class="tvtop"><label class="tvsel"><span class="sr-only">Topic</span><select id="tvtopic">${[["-1", "Everything"], ...TOPICS.map((t, i) => [String(i), t.label])].map(([v, l]) => `<option value="${v}"${+v === tv.topic ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><button class="x" id="tvx">Exit</button></div>
    <button class="tvnav prev" id="tvprev" aria-label="Previous video">${icon("left")}</button>
    <button class="tvnav next" id="tvnext" aria-label="Next video">${icon("right")}</button>
    <div class="osd"><div class="ttl"></div><div class="by"></div><div class="bar"><i></i></div>
    <div class="keys"><kbd>N</kbd> next <kbd>P</kbd> previous <kbd>Space</kbd> pause <kbd>←</kbd><kbd>→</kbd> 10s <kbd>1</kbd>-<kbd>9</kbd> jump <kbd>Esc</kbd> exit</div></div>`;
  el.querySelector("#tvx").onclick = closeTV;
  el.querySelector("#tvprev").onclick = () => go(-1);
  el.querySelector("#tvnext").onclick = () => go(1);
  el.querySelector("#tvtopic").onchange = (e) => { tv.topic = +e.target.value; tv.next = null; go(1, true); };
  el.querySelector(".catch").onclick = () => {
    if (!el.classList.contains("ui")) return showUI();
    try { tv.player.getPlayerState() === 1 ? tv.player.pauseVideo() : tv.player.playVideo(); } catch {}
    showUI();
  };
  el.onmousemove = showUI;
}

function showUI() {
  const el = $tv(); el.classList.add("ui");
  clearTimeout(tv.ui); tv.ui = setTimeout(() => el.classList.remove("ui"), 3000);
}

function load(v) {
  const el = $tv();
  el.querySelector(".ttl").textContent = v.title;
  const p = D.people[v.person];
  el.querySelector(".by").innerHTML = `${esc(p.name)} <span style="opacity:.7">· ${esc(TOPICS[v.topic]?.label || "")}</span>`;
  store.watched(v.id);
  // Our poster covers YouTube's start screen until the video is really playing.
  const cover = el.querySelector(".tvcover");
  if (cover) { const im = cover.querySelector("img"); im.onerror = () => { im.onerror = null; im.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`; }; im.src = `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`; el.classList.add("covered"); }
  if (tv.player && tv.player.loadVideoById) tv.player.loadVideoById(v.id);
  showUI();
}

function go(dir, fresh = false) {
  if (dir < 0) { if (tv.pos > 0) load(tv.hist[--tv.pos]); return; }
  if (!fresh && tv.pos < tv.hist.length - 1) return load(tv.hist[++tv.pos]);
  const v = pick(); if (!v) return;
  tv.hist = tv.hist.slice(0, tv.pos + 1); tv.hist.push(v); tv.pos = tv.hist.length - 1;
  load(v);
}

export async function openTV(startId) {
  if (tv.open) return;
  tv.open = true;
  const el = $tv(); el.hidden = false; document.body.style.overflow = "hidden";
  renderShell();
  const first = (startId && D.byId.get(startId)) || pick();
  tv.hist = [first]; tv.pos = 0;
  try {
    const YT = await api();
    tv.player = new YT.Player("tvp", {
      host: "https://www.youtube-nocookie.com", videoId: first.id,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, controls: 0, modestbranding: 1, iv_load_policy: 3 },
      events: { onStateChange: (e) => { if (e.data === 1) $tv().classList.remove("covered"); if (e.data === 0) go(1); }, onError: () => go(1, true) },
    });
  } catch { fallbackIframe(document.getElementById("tvp"), first.id); el.classList.remove("covered"); }
  load(first);
  try { if (matchMedia("(min-width: 720px)").matches) await el.requestFullscreen?.(); } catch {}
  tv.tick = setInterval(() => {
    try { const d = tv.player.getDuration(), t = tv.player.getCurrentTime(); el.querySelector(".bar i").style.width = (d ? (100 * t) / d : 0) + "%"; } catch {}
  }, 500);
  addEventListener("keydown", tvKeys, true);

}

export function closeTV() {
  if (!tv.open) return;
  tv.open = false;
  clearInterval(tv.tick); clearTimeout(tv.ui);
  try { tv.player && tv.player.destroy(); } catch {}
  tv.player = null;
  const el = $tv(); el.hidden = true; el.innerHTML = ""; document.body.style.overflow = "";
  removeEventListener("keydown", tvKeys, true);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (location.pathname === "/tv") {
    if (history.state && history.state.tv) history.back();
    else { history.replaceState(null, "", "/"); dispatchEvent(new PopStateEvent("popstate")); }
  }
}

export const tvIsOpen = () => tv.open;

function tvKeys(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const p = tv.player; const k = e.key;
  const seek = (s) => { try { p.seekTo(Math.max(0, p.getCurrentTime() + s), true); } catch {} };
  const handled = () => { e.preventDefault(); e.stopPropagation(); showUI(); };
  if (k === "Escape" || k === "t" || k === "T") { handled(); closeTV(); }
  else if (k === "n" || k === "N") { handled(); go(1); }
  else if (k === "p" || k === "P") { handled(); go(-1); }
  else if (k === " ") { handled(); try { p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(); } catch {} }
  else if (k === "ArrowRight") { handled(); seek(10); }
  else if (k === "ArrowLeft") { handled(); seek(-10); }
  else if (k === "m" || k === "M") { handled(); try { p.isMuted() ? p.unMute() : p.mute(); } catch {} }
  else if (/^[0-9]$/.test(k)) { handled(); try { p.seekTo((p.getDuration() * +k) / 10, true); } catch {} }
}
