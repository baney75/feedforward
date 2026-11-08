import { D, TOPICS, topicIndex, sampler, take, todaysPicks, topPosts, related, search } from "./data.js";
import { esc, num, ago, dur, thumb, avatar, videoCard, postCard, personCard, chips, toast, infinite, topicLabel } from "./ui.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { mountPlayer } from "./tv.js";
import { likeButton, stars, bindSocial, comments } from "./social.js";
import { mine, like as likeItem, signedIn } from "./account.js";
import { haptic } from "./haptics.js";

const $ = (s, el = document) => el.querySelector(s);
const wideWire = () => matchMedia("(min-width: 1600px)").matches;
const setTitle = (t) => { document.title = t ? `${t} · Feedforward` : "Feedforward: learn AI from the people building it"; };
function topicFromQuery(qs) { const t = qs.get("topic"); if (t === "new") return -2; const i = topicIndex(t); return i; }
// Swap one query parameter on the current URL and re-route. Other parameters (sort, tab) are kept.
function setParam(key, value) {
  const u = new URL(location.href);
  if (value == null) u.searchParams.delete(key); else u.searchParams.set(key, value);
  history.replaceState(null, "", u.pathname + u.search);
  dispatchEvent(new PopStateEvent("popstate"));
}
// The chip bar is rebuilt on every render, so its listener goes away with it.
function bindChips(el) {
  el.querySelectorAll(".chips").forEach((bar) => bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-topic]"); if (!b) return;
    const i = +b.dataset.topic;
    setParam("topic", i === -1 ? null : i === -2 ? "new" : TOPICS[i].code);
  }));
}

// An empty state that helps: an icon, what this place is for, and one way forward.
function emptyState(ic, title, body, action = "") {
  return `<div class="empty-card">${icon(ic)}<h2>${title}</h2><p>${body}</p>${action}</div>`;
}

// ---------- Home ----------
export function home(el, qs) {
  const topic = topicFromQuery(qs);
  const tIdx = topic >= 0 ? topic : -1;
  setTitle(topic >= 0 ? TOPICS[topic].label : "");
  const m = D.meta;
  const hello = `<section class="hello"><div><h1>Learn AI from the people <em>building it.</em></h1>
    <p>Videos, posts, free books and hands-on labs from people who teach AI well, build it in the open, or run it at home. No ads, no politics.</p></div>
    <div class="stats" aria-live="polite"><div><b data-count="people">${D.people.filter((p) => p && p.i < 10000).length}</b>people</div><div><b data-count="videos">${D.meta.videos}</b>videos</div><div><b data-count="shorts">${D.meta.shorts || 0}</b>shorts</div><div><b data-count="learners">0</b>learners</div></div></section>`;
  const disliked = new Set([...mine.dislikes].filter((k) => k.startsWith("v:")).map((k) => k.slice(2)));
  const picks = todaysPicks(8, tIdx).filter((v) => !disliked.has(v.id)).slice(0, 4);
  const hero = picks.length ? `<section class="hero" aria-label="Today's picks">${videoCard(picks[0], { big: true })}<div class="hero-side">${picks.slice(1).map((v) => videoCard(v, { row: true })).join("")}</div></section>` : "";
  const exclude = new Set(picks.map((v) => v.id));
  // Videos you disliked leave your feed.
  for (const id of disliked) exclude.add(id);
  const newest = topic === -2;
  const next = sampler({ topic: tIdx, exclude, newest });
  const tracks = (D.learn.tracks || []).slice(0, 4).map(trackCard).join("");
  const chipBar = chips(topic, { extra: [{ v: -2, label: "Newest" }] });

  const wire = `<aside class="wire-rail" aria-label="The Wire"><div class="sec-h"><h2>The Wire</h2><a href="/wire">See all</a></div><div id="wireList">${topPosts({ topic: tIdx, limit: 30 }).map(postCard).join("")}</div></aside>`;
  // Members are already in: no pitch, no stats. Topics on top, then where you left off, then today's picks.
  void hello;
  el.innerHTML = `<div class="home"><div class="home-main">
      <div class="chips-wrap">${chipBar}</div>
      ${topic === -1 ? keepGoing() || startHere() : ""}
      ${newest ? "" : hero}
      ${topic === -1 ? `<div class="sec-h"><h2>Start learning</h2><a href="/learn">All tracks and labs</a></div><div class="shelf">${tracks}</div>` : ""}
      <div class="sec-h"><h2>${newest ? "Newest uploads" : topic >= 0 ? TOPICS[topic].label : "For you"}</h2><div style="display:flex;gap:8px"><a class="btn" href="/tv">${icon("tv")}TV mode</a><button class="btn" id="reshuffle">${icon("shuffle")}Shuffle</button></div></div>
      <div class="grid" id="feed"></div><div id="more" style="height:1px"></div>
    </div>${wire}</div>`;
  bindChips(el);
  const stopCounters = liveCounters(el);
  const feed = $("#feed", el);
  let count = 0, postOff = 0, gen = D.gen, sampled = next;
  const shown = new Set(exclude);
  const add = () => {
    let vids;
    // When the full catalog arrives, keep going from the bigger pool without repeating anything shown.
    if (gen !== D.gen) { gen = D.gen; sampled = sampler({ topic: tIdx, exclude: shown, newest }); }
    if (newest) {
      const all = D.videos.filter((v) => !exclude.has(v.id)).sort((a, b) => b.ts - a.ts || b.score - a.score);
      vids = all.slice(count, count + 24);
    } else vids = take(sampled, 24);
    vids.forEach((v) => shown.add(v.id));
    let html = "";
    vids.forEach((v, k) => {
      html += videoCard(v);
      if (!wideWire() && (count + k + 1) % (innerWidth < 720 ? 6 : 12) === (innerWidth < 720 ? 4 : 8)) {
        const ps = topPosts({ topic: tIdx, limit: 3, offset: postOff }); postOff += 3;
        if (ps.length) html += `<section class="feed-break inline-posts" aria-label="From the Wire"><div class="sec-h"><h2>From the Wire</h2><a href="/wire">See all</a></div>${ps.map(postCard).join("")}</section>`;
      }
    });
    count += vids.length;
    feed.insertAdjacentHTML("beforeend", html);
  };
  add();
  $("#reshuffle", el).onclick = () => dispatchEvent(new PopStateEvent("popstate"));
  const stopFeed = infinite($("#more", el), add);
  return () => { stopFeed(); stopCounters(); };
}

// For someone who hasn't started a track: one clear way to begin, above the videos.
function startHere() {
  const t = (D.learn.tracks || [])[0];
  if (!t) return "";
  return `<a class="start-here" href="/learn/${t.slug}"><span class="topic-tag">Start here</span><b>${esc(t.title)}</b><span class="muted">${t.steps.length} steps, from the first idea to the code.</span><span class="btn primary">Begin${icon("right")}</span></a>`;
}

// "Keep going": the next step in the track you started, plus what you watched recently.
function keepGoing() {
  const hist = store.history().map((id) => D.byId.get(id)).filter(Boolean).slice(0, 10);
  const active = D.learn.tracks.map((t) => [t, trackProgress(t)]).find(([, [d, n]]) => d > 0 && d < n);
  if (!hist.length && !active) return "";
  let next = "";
  if (active) {
    const [t, [d, n]] = active;
    const k = t.steps.findIndex((s, i) => !stepDone(t, s, i));
    const st = t.steps[k];
    const href = st.kind === "video" ? `/watch/${st.id}?track=${t.slug}` : st.kind === "lab" ? `/lab/${st.slug}?track=${t.slug}` : `/learn/${t.slug}`;
    next = `<a class="nextup" href="${href}"><span class="topic-tag">Your track · step ${k + 1} of ${n}</span><b>${esc(t.title)}</b>${meter(d, n)}<span class="btn primary">Continue${icon("right")}</span></a>`;
  }
  return `<div class="sec-h"><h2>Keep going</h2>${store.streak() ? `<span class="streak">${icon("flame")}${store.streak()}-day streak</span>` : ""}</div>
    <div class="shelf">${next}${hist.map((v) => videoCard(v)).join("")}</div>`;
}

const shownCounts = {};
// Live counters: count up from zero on first paint, then refresh every minute from /api/pulse.
function liveCounters(el) {
  const els = [...el.querySelectorAll("[data-count]")];
  if (!els.length) return () => {};
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = (b, n) => (b.textContent = n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "K" : n.toLocaleString());
  const tween = (b, to) => {
    const from = +(b.dataset.now || 0);
    shownCounts[b.dataset.count] = to;
    if (still || from === to) { b.dataset.now = to; return show(b, to); }
    const t0 = performance.now(), dur = 1100;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4); show(b, Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); else b.dataset.now = to; };
    requestAnimationFrame(step);
  };
  const base = Object.fromEntries(els.map((b) => [b.dataset.count, +b.textContent || 0]));
  // Count up once per visit. After that a re-render shows the last numbers at once, so nothing jumps.
  els.forEach((b) => { if (shownCounts[b.dataset.count] != null) { b.dataset.now = shownCounts[b.dataset.count]; show(b, shownCounts[b.dataset.count]); } });
  els.forEach((b) => tween(b, shownCounts[b.dataset.count] ?? base[b.dataset.count]));
  const pull = async () => {
    try {
      const p = await (await fetch("/api/pulse")).json();
      const val = { people: base.people + (p.extraPeople || 0), videos: base.videos + (D.fresh ? D.videos.filter((v) => v.fresh).length : 0), shorts: base.shorts, learners: p.learners || 0 };
      els.forEach((b) => tween(b, val[b.dataset.count]));
    } catch {}
  };
  pull();
  const timer = setInterval(() => { if (!document.hidden) pull(); }, 60000);
  return () => clearInterval(timer);
}

// ---------- Watch ----------
export function watch(el, qs, id) {
  const v = D.byId.get(id) || extraVideo(id);
  const p = v.person != null ? D.people[v.person] : null;
  setTitle(v.title);
  const trackSlug = qs.get("track");
  const track = trackSlug && D.learn.tracks.find((t) => t.slug === trackSlug);
  const saved = store.isSaved("v:" + id);
  const posts = p ? topPosts({ personIdx: p.i, limit: 3 }) : [];
  const upNext = related(v, 14);
  el.innerHTML = `<div class="watch">
    <div style="min-width:0">
      <div class="player"><div id="yt"></div><button class="pcover" type="button" aria-label="Play ${esc(v.title)}"><img src="${thumb(id, "maxresdefault")}" alt="" onerror="this.onerror=null;this.src='${thumb(id, "hqdefault")}'"><span class="pplay" aria-hidden="true">${icon("play")}</span></button></div>
      ${track ? trackBanner(track, id) : ""}
      <h1>${esc(v.title)}</h1>
      <div class="wbar">
        ${p ? `<a class="who" href="/p/${p.slug}">${avatar(p)}<div><b>${esc(p.name)}</b><small>${p.ytSubs ? num(p.ytSubs) + " subscribers" : topicLabel(v.topic)}</small></div></a>` : `<div class="who"><b>${esc(v.by || "")}</b></div>`}
        ${likeButton("v:" + id)}
        <button class="btn" id="save" aria-pressed="${saved}" aria-label="Save">${icon(saved ? "bookmarked" : "bookmark")}<span class="lbl">${saved ? "Saved" : "Save"}</span></button>
        <button class="btn" id="share" aria-label="Share">${icon("share")}<span class="lbl">Share</span></button>
        <a class="btn" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener" aria-label="Watch on YouTube">${icon("yt")}<span class="lbl">YouTube</span></a>
      </div>
      <div class="vsub wmeta" style="margin-top:12px">${v.views ? num(v.views) + " views" : ""}${v.ts ? `<span class="dot"></span>${ago(v.ts)}` : ""}${v.sec ? `<span class="dot"></span>${dur(v.sec)}` : ""}${v.topic != null && v.topic >= 0 ? `<span class="dot"></span><a href="/?topic=${TOPICS[v.topic].code}">${topicLabel(v.topic)}</a>` : ""}</div>
      ${p ? `<div class="why"><span class="muted">Why ${esc(p.name)} is on Feedforward</span><br>${esc(p.why)}</div>` : ""}
      <section class="upnext-inline" aria-label="Up next"><div class="sec-h" style="margin-top:0"><h2>Up next</h2></div><div class="shelf">${upNext.slice(0, 10).map((x) => videoCard(x)).join("")}</div></section>
      <div id="cmts"></div>
      ${posts.length ? `<div class="sec-h"><h2>${esc(p.name)} on the Wire</h2><a href="/p/${p.slug}?tab=posts">All posts</a></div>${posts.map(postCard).join("")}` : ""}
    </div>
    <aside class="side"><div class="side-h"><h2>Up next</h2><label class="toggle"><input type="checkbox" id="autoplay" ${store.get("autoplay", true) !== false ? "checked" : ""}> Autoplay</label></div>${upNext.map((x) => videoCard(x, { row: true })).join("")}</aside>
  </div>`;
  let countdown = 0;
  // Our poster covers YouTube's start screen until the video plays. A tap plays it; if the browser refuses,
  // the cover steps aside so YouTube's own play button can take the tap.
  const pl = $(".player", el);
  const stop = mountPlayer($("#yt", el), id, {
    onPlaying: () => pl.classList.add("started"),
    onPlay: () => store.watched(id),
    onEnd: () => {
      if (store.get("autoplay", true) === false || !upNext[0] || track) return;
      const nx = upNext[0], pl = $(".player", el);
      let n = 6;
      pl.insertAdjacentHTML("beforeend", `<div class="autonext" role="status"><img src="${thumb(nx.id, "hqdefault")}" alt=""><div><span class="topic-tag">Up next in <b id="an">${n}</b></span><h3>${esc(nx.title)}</h3><div class="row"><button class="btn" id="anCancel">Cancel</button><a class="btn primary" href="/watch/${nx.id}">${icon("play")}Play now</a></div></div></div>`);
      $("#anCancel", el).onclick = () => { clearInterval(countdown); el.querySelector(".autonext")?.remove(); };
      countdown = setInterval(() => { n--; const c = $("#an", el); if (c) c.textContent = n; if (n <= 0) { clearInterval(countdown); el.querySelector(".autonext a.primary")?.click(); } }, 1000);
    },
    onError: () => { const pl = $(".player", el); if (pl) pl.innerHTML = `<div class="noembed"><img src="${thumb(id, "hqdefault")}" alt=""><div><p>The owner only allows this video to play on YouTube.</p><a class="btn primary" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">${icon("yt")}Watch on YouTube</a></div></div>`; },
  });
  $(".pcover", el).onclick = () => { stop.play(); setTimeout(() => pl.classList.add("started"), 1500); };
  $("#save", el).onclick = (e) => {
    const on = store.toggleSave("v:" + id);
    e.currentTarget.innerHTML = icon(on ? "bookmarked" : "bookmark") + `<span class="lbl">${on ? "Saved" : "Save"}</span>`;
    e.currentTarget.setAttribute("aria-pressed", on); toast(on ? "Saved to your library" : "Removed from your library");
  };
  $("#share", el).onclick = async () => {
    const url = location.origin + "/watch/" + id;
    try { if (navigator.share) await navigator.share({ title: v.title, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch {}
  };
  if (track) bindTrackBanner(el, track, id);
  $("#autoplay", el).onchange = (e) => store.set("autoplay", e.target.checked);
  const unbind = bindSocial(el);
  comments($("#cmts", el), "v:" + id);
  return () => { clearInterval(countdown); stop(); unbind(); };
}

function extraVideo(id) {
  for (const t of D.learn.tracks) for (const s of t.steps) if (s.kind === "video" && s.id === id) return { id, title: s.title, by: s.by, person: null, topic: -1 };
  return { id, title: "Video", person: null, topic: -1 };
}

// ---------- Person ----------
export function personPage(el, qs, slug) {
  const p = D.peopleBySlug.get(slug);
  if (!p) return notFound(el);
  setTitle(p.name);
  const tab = qs.get("tab") || (p.nv ? "videos" : "posts");
  const sort = qs.get("sort") || "popular";
  el.innerHTML = `<header class="ph">${avatar(p, "l")}<div style="min-width:0;flex:1">
      <h1>${esc(p.name)}</h1><p>${esc(p.why)}</p>
      <div class="links">${p.yt ? `<a class="btn" href="https://www.youtube.com/${esc(p.yt)}" target="_blank" rel="noopener">${icon("yt")}${p.ytSubs ? num(p.ytSubs) : "YouTube"}</a>` : ""}${p.x ? `<a class="btn" href="https://x.com/${esc(p.x)}" target="_blank" rel="noopener">${icon("x")}@${esc(p.x)}</a>` : ""}<span class="chip" style="background:none;border:1px solid var(--line)">${topicLabel(topicIndex(p.topic))}</span></div>
    </div></header>
    <div class="tabs" role="group">${p.nv ? `<button data-tab="videos" aria-pressed="${tab === "videos"}">Videos <span class="muted mono">${num(p.nv)}</span></button>` : ""}${p.np ? `<button data-tab="posts" aria-pressed="${tab === "posts"}">Posts <span class="muted mono">${p.np}</span></button>` : ""}</div>
    <div id="pc"></div><div id="more" style="height:1px"></div>`;
  el.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; history.replaceState(null, "", `/p/${slug}?tab=${b.dataset.tab}`); dispatchEvent(new PopStateEvent("popstate")); };
  const pc = $("#pc", el);
  if (tab === "videos" && p.nv) {
    const list = [...(D.vByPerson.get(p.i) || [])];
    if (sort === "new") list.sort((a, b) => b.ts - a.ts); else if (sort === "views") list.sort((a, b) => b.views - a.views);
    pc.innerHTML = `<div class="seg" role="group" style="margin-bottom:20px">${[["popular", "Best"], ["new", "Newest"], ["views", "Most viewed"]].map(([k, l]) => `<button data-sort="${k}" aria-pressed="${sort === k}">${l}</button>`).join("")}</div><div class="grid" id="g"></div>`;
    pc.querySelector(".seg").onclick = (e) => { const b = e.target.closest("[data-sort]"); if (!b) return; history.replaceState(null, "", `/p/${slug}?tab=videos&sort=${b.dataset.sort}`); dispatchEvent(new PopStateEvent("popstate")); };
    let n = 0;
    const add = () => { $("#g", pc).insertAdjacentHTML("beforeend", list.slice(n, n + 24).map((v) => videoCard(v)).join("")); n += 24; };
    add();
    return infinite($("#more", el), add);
  }
  pc.innerHTML = `<div class="narrow">${topPosts({ personIdx: p.i, sort: "latest", limit: 200 }).map(postCard).join("") || '<p class="empty">No posts yet.</p>'}</div>`;
}

export function peoplePage(el) {
  setTitle("People");
  el.innerHTML = `<div class="page-h"><div><h1>People</h1><p>Everyone on Feedforward, and why they're here. Picked for teaching, building in the open, and getting the details right.</p></div></div>
    ${TOPICS.map((t) => { const ps = D.people.filter((p) => p.topic === t.code); return ps.length ? `<div class="sec-h"><h2>${t.label}</h2></div><div class="people">${ps.map(personCard).join("")}</div>` : ""; }).join("")}`;
}

// ---------- Wire ----------
export function wirePage(el, qs) {
  const topic = topicFromQuery(qs);
  const sort = qs.get("sort") || "best";
  setTitle("The Wire");
  el.innerHTML = `<div class="wire-wrap"><div style="min-width:0">
      <div class="page-h"><div><h1>The Wire</h1><p>Posts from the people on Feedforward, kept only when they're about AI, computer science or making. No politics, no drama.</p></div>
      <div class="seg" role="group" aria-label="Sort">${[["best", "Best"], ["latest", "Latest"]].map(([k, l]) => `<button data-sort="${k}" aria-pressed="${sort === k}">${l}</button>`).join("")}</div></div>
      ${chips(topic)}<div id="list" style="margin-top:8px"></div><div id="more" style="height:1px"></div></div>
    <aside><div class="box"><h2>On the Wire</h2>${D.people.filter((p) => p.np).sort((a, b) => b.np - a.np).slice(0, 12).map((p) => `<a class="pcard row" href="/p/${p.slug}">${avatar(p, "s")}<div style="min-width:0"><b style="font-size:15px">${esc(p.name)}</b></div></a>`).join("")}<a class="link" href="/people" style="font-size:14px">Everyone</a></div></aside></div>`;
  bindChips(el);
  el.querySelector(".seg").onclick = (e) => { const b = e.target.closest("[data-sort]"); if (b) setParam("sort", b.dataset.sort === "best" ? null : b.dataset.sort); };
  let off = 0;
  const tIdx = topic >= 0 ? topic : -1;
  const add = () => { const ps = topPosts({ topic: tIdx, sort, limit: 25, offset: off }); off += ps.length; $("#list", el).insertAdjacentHTML("beforeend", ps.map(postCard).join("")); };
  add();
  return infinite($("#more", el), add);
}

// ---------- Learn ----------
function trackProgress(t) {
  const n = t.steps.length;
  const d = t.steps.filter((s, k) => stepDone(t, s, k)).length;
  return [d, n];
}
function stepDone(t, s, k) {
  if (s.kind === "lab") return store.isDone("lab:" + s.slug);
  if (s.kind === "video" && store.hasWatched(s.id)) return true;
  return store.isDone(`step:${t.slug}:${k}`);
}
function meter(d, n) { return `<div class="meter${d === n ? " done" : ""}"><i><b style="width:${Math.round((100 * d) / n)}%"></b></i>${d}/${n}</div>`; }
function trackCard(t, k) {
  const [d, n] = trackProgress(t);
  return `<a class="track" href="/learn/${t.slug}"><span class="num">Track ${String((k ?? D.learn.tracks.indexOf(t)) + 1).padStart(2, "0")} · ${esc(t.level)}</span><h3>${esc(t.title)}</h3><p>${esc(t.blurb)}</p>${meter(d, n)}</a>`;
}
function labCard(l) {
  const done = store.isDone("lab:" + l.slug);
  return `<a class="labcard" href="/lab/${l.slug}"><span class="lk"><span>${l.minutes} min · ${topicLabel(topicIndex(l.topic))}</span>${done ? `<span class="ok">${icon("check")}Done</span>` : ""}</span><h3>${esc(l.title)}</h3><p>${esc(l.blurb)}</p></a>`;
}
export function learnPage(el) {
  setTitle("Learn");
  el.innerHTML = `<div class="page-h"><div><h1>Learn</h1><p>Short tracks that take you from zero to building, using the best videos on Feedforward in the right order. Labs let you poke at the ideas yourself. Progress stays on this device.</p></div></div>
    <nav class="hub" aria-label="More ways to learn">${[["/books", "books", "Free books"], ["/research", "learn", "Research papers"], ["/dictionary", "search", "Dictionary"], ["/sessions", "tv", "Live sessions"], ["/skills", "labs", "Agent skills"], ["/repos", "topic", "Top repos"], ["/chat", "chat", "Chat"], ["/agents", "info", "Connect an agent"]].map(([h, i, l]) => `<a href="${h}">${icon(i)}<span>${l}</span></a>`).join("")}</nav>
    <div class="tracks">${D.learn.tracks.map(trackCard).join("")}</div>
    <div class="sec-h"><h2>Labs</h2><span class="muted" style="font-size:14px">Interactive. Runs in your browser.</span></div>
    <div class="labs">${D.learn.labs.map(labCard).join("")}</div>`;
}

export function trackPage(el, qs, slug) {
  const t = D.learn.tracks.find((x) => x.slug === slug);
  if (!t) return notFound(el);
  setTitle(t.title);
  const render = () => {
    const [d, n] = trackProgress(t);
    el.innerHTML = `<nav class="crumbs"><a href="/learn">Learn</a>${icon("right")}<span>Track ${D.learn.tracks.indexOf(t) + 1}</span></nav>
      <div class="page-h"><div><h1>${esc(t.title)}</h1><p>${esc(t.blurb)}</p></div><div style="min-width:220px">${meter(d, n)}</div></div>
      <ol class="steps">${t.steps.map((s, k) => step(t, s, k)).join("")}</ol>
      ${t.quiz && t.quiz.length ? `<section class="quiz"><div class="sec-h"><h2>Check yourself</h2></div>${t.quiz.map((q, k) => quiz(t, q, k)).join("")}</section>` : ""}`;
  };
  render();
  el.onclick = (e) => {
    const m = e.target.closest("[data-mark]");
    if (m) { const key = m.dataset.mark; store.isDone(key) ? store.undo(key) : store.done(key); render(); return; }
    const o = e.target.closest("[data-opt]");
    if (o) {
      const k = +o.dataset.q, q = t.quiz[k], pick = +o.dataset.opt, box = o.closest(".q");
      box.querySelectorAll("[data-opt]").forEach((b) => { b.classList.remove("right", "wrong"); if (+b.dataset.opt === q.answer) b.classList.add("right"); });
      if (pick !== q.answer) o.classList.add("wrong"); else store.done(`quiz:${t.slug}:${k}`);
      box.querySelector(".fb").innerHTML = `<b class="${pick === q.answer ? "r" : "w"}">${pick === q.answer ? "Right." : "Not quite."}</b> ${esc(q.why)}`;
    }
  };
}
function step(t, s, k) {
  const done = stepDone(t, s, k);
  const key = `step:${t.slug}:${k}`;
  let body = "", kind = "", title = s.title;
  if (s.kind === "video") {
    const v = D.byId.get(s.id);
    kind = "Watch";
    title = s.title || (v && v.title) || "Video";
    const by = v ? D.people[v.person].name : s.by || "";
    body = `<a class="vrow" href="/watch/${s.id}?track=${t.slug}"><div class="thumb"><img src="${thumb(s.id)}" alt="" loading="lazy" width="320" height="180">${v && v.sec ? `<span class="dur">${dur(v.sec)}</span>` : ""}</div><div class="vtext"><h3 class="vt">${esc(title)}</h3><div class="vsub">${esc(by)}</div></div></a>`;
  } else if (s.kind === "lab") {
    const l = D.learn.labs.find((x) => x.slug === s.slug) || { title: s.slug, minutes: 5 };
    kind = "Lab"; title = l.title;
    body = `<div class="act"><a class="btn" href="/lab/${s.slug}?track=${t.slug}">${icon("labs")}Open the lab</a><span class="muted" style="align-self:center;font-size:14px">${l.minutes} min</span></div>`;
  } else {
    kind = "Read";
    body = `<div class="act"><a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">${icon("ext")}${esc(s.site || "Open")}</a></div>`;
  }
  const markable = s.kind !== "lab";
  return `<li class="step${done ? " done" : ""}"><span class="tick">${done ? icon("check") : k + 1}</span><div style="min-width:0">
    <span class="kind">${kind}</span>${s.kind === "video" ? "" : `<h3>${esc(title)}</h3>`}${s.note ? `<p>${esc(s.note)}</p>` : ""}${body}
    ${markable ? `<div class="act"><button class="btn" data-mark="${key}">${icon("check")}${done ? "Done" : "Mark done"}</button></div>` : ""}</div></li>`;
}
function quiz(t, q, k) {
  return `<div class="q"><h3>${esc(q.q)}</h3><div class="opts">${q.options.map((o, i) => `<button data-q="${k}" data-opt="${i}">${esc(o)}</button>`).join("")}</div><div class="fb" aria-live="polite"></div></div>`;
}
function trackBanner(t, id) {
  const k = t.steps.findIndex((s) => s.kind === "video" && s.id === id);
  const nextStep = t.steps[k + 1];
  const href = !nextStep ? `/learn/${t.slug}` : nextStep.kind === "video" ? `/watch/${nextStep.id}?track=${t.slug}` : nextStep.kind === "lab" ? `/lab/${nextStep.slug}?track=${t.slug}` : `/learn/${t.slug}`;
  return `<div class="why" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><span class="muted">Track: <a class="link" href="/learn/${t.slug}">${esc(t.title)}</a></span><br>Step ${k + 1} of ${t.steps.length}</div><a class="btn primary" id="nextStep" href="${href}">${nextStep ? "Next step" : "Back to track"}${icon("right")}</a></div>`;
}
function bindTrackBanner(el, t, id) {
  const b = $("#nextStep", el); if (b) b.addEventListener("click", () => store.watched(id));
}

export async function labPage(el, qs, slug) {
  const l = D.learn.labs.find((x) => x.slug === slug);
  if (!l) return notFound(el);
  setTitle(l.title);
  const track = qs.get("track") && D.learn.tracks.find((t) => t.slug === qs.get("track"));
  el.innerHTML = `<div class="lab-page"><nav class="crumbs"><a href="/learn">Learn</a>${icon("right")}${track ? `<a href="/learn/${track.slug}">${esc(track.title)}</a>${icon("right")}` : ""}<span>Lab</span></nav>
    <div class="page-h"><div><h1>${esc(l.title)}</h1><p>${esc(l.blurb)}</p></div></div><div id="lab"><div class="skel" role="status" aria-label="Loading the lab"><i></i><i></i><i></i></div></div>
    ${track ? `<div class="act" style="margin-top:32px;display:flex"><a class="btn" href="/learn/${track.slug}">${icon("left")}Back to ${esc(track.title)}</a></div>` : ""}</div>`;
  let stop;
  const my = el.dataset.seq;
  try {
    const mod = await import(`/labs/${slug}.js`);
    if (el.dataset.seq !== my) return null; // the reader already moved on
    const root = $("#lab", el); root.innerHTML = "";
    stop = mod.mount(root, { markDone: () => { if (!store.isDone("lab:" + slug)) { store.done("lab:" + slug); toast("Lab complete"); } } });
  } catch (e) {
    if (el.dataset.seq !== my) return null;
    $("#lab", el).innerHTML = `${emptyState("learn", "This lab didn't load", "Check your connection, then try again.", `<button class="btn primary" type="button" onclick="location.reload()">Try again</button>`)}`;
  }
  return () => { try { stop && stop(); } catch {} };
}

// ---------- Search, library, about ----------
export function searchPage(el, qs) {
  const q = qs.get("q") || "";
  setTitle(q ? `Search: ${q}` : "Search");
  const input = document.getElementById("q"); if (input && input.value !== q) input.value = q;
  const r = search(q);
  const none = !r.people.length && !r.videos.length && !r.posts.length;
  el.innerHTML = `<div class="results"><div class="page-h"><div><h1>${q ? `Results for "${esc(q)}"` : "Search"}</h1></div></div>
    ${q && none ? `<p class="empty">Nothing matched. Try fewer words, or a name like "Karpathy" or a topic like "quantization".</p>` : ""}
    ${!q ? `<p class="muted">Try <a class="link" href="/search?q=llama.cpp">llama.cpp</a>, <a class="link" href="/search?q=attention">attention</a>, <a class="link" href="/search?q=claude code">claude code</a> or <a class="link" href="/search?q=fusion 360">fusion 360</a>.</p>` : ""}
    ${r.people.length ? `<h2>People</h2><div class="people">${r.people.map(personCard).join("")}</div>` : ""}
    ${r.videos.length ? `<h2>Videos</h2><div class="grid">${r.videos.map((v) => videoCard(v)).join("")}</div>` : ""}
    ${r.posts.length ? `<h2>Posts</h2><div class="narrow">${r.posts.map(postCard).join("")}</div>` : ""}</div>`;
}

export function libraryPage(el, qs) {
  setTitle("Library");
  const tab = qs.get("tab") || "saved";
  const saved = store.saved();
  const sv = saved.filter((k) => k.startsWith("v:")).map((k) => D.byId.get(k.slice(2))).filter(Boolean);
  const sp = saved.filter((k) => k.startsWith("p:")).map((k) => D.postById.get(k.slice(2))).filter(Boolean);
  const ss = saved.filter((k) => k.startsWith("s:")).map((k) => D.shorts.find((x) => x.id === k.slice(2))).filter(Boolean);
  const hist = store.history().map((id) => D.byId.get(id)).filter(Boolean);
  el.innerHTML = `<div class="page-h"><div><h1>Library</h1><p>Saved videos, Shorts and posts, and what you've watched, on every device you sign in on.</p></div></div>
    <div class="tabs" role="group"><button data-tab="saved" aria-pressed="${tab === "saved"}">Saved</button><button data-tab="history" aria-pressed="${tab === "history"}">History</button></div>
    <div id="lib"></div>`;

  el.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; history.replaceState(null, "", "/library?tab=" + b.dataset.tab); dispatchEvent(new PopStateEvent("popstate")); };
  const lib = $("#lib", el);
  if (tab === "history") {
    lib.innerHTML = hist.length ? `<div class="grid">${hist.map((v) => videoCard(v)).join("")}</div><p style="margin-top:32px"><button class="btn" id="clear">Clear history</button></p>` : `${emptyState("library", "Nothing watched yet", "Videos you watch show up here, on every device you sign in on.", `<a class="btn primary" href="/">Find something to watch</a>`)}`;
    const c = $("#clear", el); if (c) c.onclick = () => { store.clearHistory(); dispatchEvent(new PopStateEvent("popstate")); };
  } else {
    lib.innerHTML = (sv.length ? `<div class="grid">${sv.map((v) => videoCard(v)).join("")}</div>` : "") +
      (ss.length ? `<div class="sec-h"><h2>Shorts</h2></div><div class="shelf">${ss.map((x) => `<a class="vcard" href="/shorts/${x.id}"><div class="thumb" style="aspect-ratio:9/16"><img src="https://i.ytimg.com/vi/${x.id}/oardefault.jpg" alt="" loading="lazy"></div><div class="vtext" style="margin-top:8px"><h3 class="vt">${esc(x.title)}</h3></div></a>`).join("")}</div>` : "") + (sp.length ? `<div class="sec-h"><h2>Posts</h2></div><div class="narrow">${sp.map(postCard).join("")}</div>` : "") || `${emptyState("bookmark", "Save it for later", "Tap Save on any video, or the bookmark on any post, and it waits here.", `<a class="btn primary" href="/">Browse Home</a>`)}`;
  }
}

export function aboutPage(el) {
  setTitle("About");
  const m = D.meta;
  el.innerHTML = `<div class="prose about"><svg class="about-logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--accent)"/><g fill="var(--accent-ink)"><rect x="15.5" y="15.7" width="8.2" height="32.6" rx="4.1"/><rect x="27.7" y="21.8" width="8.2" height="20.4" rx="4.1"/><circle cx="44" cy="32" r="4.5"/></g></svg><h1>About Feedforward</h1>
    <p>Feedforward is a learning feed for AI. It gathers the full video libraries, the best Shorts and the best recent posts of ${D.people.filter(Boolean).length} people who teach AI well, build it in the open, or run it on their own machines. Then it filters out everything that isn't about AI, computer science or making things.</p>
    <p>The name has two meanings. It's a feed that moves you forward, and a feedforward network is the first neural network everyone learns: input goes in, flows layer by layer, and an answer comes out. Feedforward is invite-only, and your account is a code: no email, no password. No ads, no tracking, and no algorithm trained on you. What you watch and save syncs only to your own account.</p>
    <h2>How the feed works</h2>
    <ul><li>Every channel's full upload history is listed with <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a>. Posts come from each person's public X timeline.</li>
    <li>A language model labels every video title and post by topic and teaching value. Channels that aren't purely technical are filtered to their AI and computer science uploads. Politics, religion, ads and personal posts are dropped, with a word list as a second net.</li>
    <li>"For you" gives every person an equal share, then picks the better of a few random draws, so small channels aren't buried by big ones. Nothing you've watched repeats.</li>
    <li>A small server job checks every channel and account for new uploads and posts throughout the day, so the feed stays current.</li></ul>
    <p class="muted" style="font-size:15px">Right now: ${num(m.videos)} videos, ${num(m.posts)} posts. Catalog built ${new Date(m.built * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.${D.fresh ? ` ${D.fresh} new since then.` : ""}</p>
    <h2>Keyboard</h2>
    <ul class="keys"><li><kbd>/</kbd> search</li><li><kbd>T</kbd> TV mode: one great video after another</li><li><kbd>Shift</kbd> + <kbd>N</kbd> play something new</li><li>In TV mode: <kbd>N</kbd> next, <kbd>P</kbd> previous, <kbd>Space</kbd> pause, <kbd>←</kbd> <kbd>→</kbd> 10 seconds, <kbd>1</kbd> to <kbd>9</kbd> jump, <kbd>Esc</kbd> exit</li></ul>
    <h2>Install it</h2>
    <p>Feedforward is a web app. On a phone, use your browser's Share or menu button and choose Add to Home Screen. On a computer, use the install button in the address bar. It opens like an app and remembers what you saved.</p>
    <p><button class="btn primary" id="aboutInstall">${icon("install")}Install Feedforward</button></p>
    <h2>Credits</h2>
    <p>Inspired by Andrej Karpathy's <a href="https://hackertube.org/">HackerTube</a> and <a href="https://karpathy.ai/tristan-tube/">TristanTube</a>, and by 0xSero asking for the best AI education feed. Every video plays through YouTube's own player, and every post links back to X. Made by <a href="https://dbaney.com/">Donovan Baney</a>.</p>
    <p>Want someone added? The list favors people who teach clearly and show their work.</p>
    <h2>Contact</h2>
    <p>Questions, a problem, or something to report? Email <a href="mailto:support@dbaney.com">support@dbaney.com</a>. Security issues go through <a href="https://github.com/baney75/feedforward/security/advisories/new">a private report</a>.</p>
    <h2>Data</h2>
    <p>The catalog is plain JSON for members: <a href="/data/videos.json">videos</a>, <a href="/data/posts.json">posts</a>, <a href="/data/people.json">people</a>.</p></div>`;
  $("#aboutInstall", el).onclick = () => dispatchEvent(new Event("lt:install"));
}

export function notFound(el) {
  setTitle("Not found");
  el.innerHTML = `<div class="empty"><h1 style="font-size:28px;color:var(--fg)">Nothing here.</h1><p style="margin:12px 0 24px">That page doesn't exist.</p><a class="btn primary" href="/">Go home</a></div>`;
}

// ---------- Shorts ----------
// A vertical, snap-scrolling player. Only the short in view holds an iframe; the rest are posters.
export function shortsPage(el, qs, startId) {
  setTitle("Shorts");
  if (store.shortsOff()) {
    el.innerHTML = `<div class="empty shorts-off"><h1>Shorts are off</h1><p>You turned them off on this device. Longer videos, tracks and labs are all still here. Settings live on your profile.</p>
      <div class="row"><a class="btn primary" href="/">Go home</a><button class="btn" type="button" id="shortsOn">Turn Shorts back on</button></div></div>`;
    $("#shortsOn", el).onclick = () => { store.setShortsOff(false); dispatchEvent(new PopStateEvent("popstate")); };
    return;
  }
  const topic = topicFromQuery(qs);
  const tIdx = topic >= 0 ? topic : -1;
  // Shorts you disliked leave your Shorts feed.
  const pool = D.shorts.filter((s) => (tIdx < 0 || s.topic === tIdx) && !mine.dislikes.has("s:" + s.id));
  // Best-first with some randomness, and never the same person twice in a row.
  const ranked = pool.map((s) => [s, s.score + Math.random() * 30]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const list = [];
  const rest = [...ranked];
  if (startId) { const k = rest.findIndex((s) => s.id === startId); if (k >= 0) list.push(...rest.splice(k, 1)); }
  while (rest.length) {
    const last = list[list.length - 1];
    let k = rest.findIndex((s) => !last || s.person !== last.person);
    if (k < 0) k = 0;
    list.push(...rest.splice(k, 1));
  }
  if (!list.length) { el.innerHTML = `<div class="page-h"><div><h1>Shorts</h1></div></div>${chips(topic)}<p class="empty">No shorts in this topic yet.</p>`; bindChips(el); return; }
  el.innerHTML = `<div class="shorts-page">${chips(topic)}<div class="shorts" tabindex="0" aria-label="Shorts. Use the up and down arrow keys to move between them.">${list.slice(0, 40).map(shortSlide).join("")}</div>
    <div class="snav"><button class="icon-btn" data-snav="-1" aria-label="Previous short">${icon("up")}</button><button class="icon-btn" data-snav="1" aria-label="Next short">${icon("down")}</button></div></div>`;

  bindChips(el);
  const box = $(".shorts", el);
  let shown = 40, active = null, paused = false, tapT = 0, lastTap = 0;
  // Our own controls: YouTube's overlay stays off (controls=0) and a tap layer sits over the player.
  // Tap pauses or plays, double-tap likes, a thin line shows progress. Sound starts off (phones block
  // autoplay with sound) and stays on once you turn it on.
  const YT = "https://www.youtube-nocookie.com";
  const cmd = (slide, func, args = []) => { const f = slide && slide.querySelector("iframe"); if (f && f.contentWindow) f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), YT); };
  const soundOn = () => sessionStorage.getItem("ff:sound") === "1";
  const activate = (slide) => {
    if (active === slide) return;
    if (active) { const f = active.querySelector("iframe"); if (f) f.remove(); active.classList.remove("playing", "paused", "started"); }
    // A tap waiting to become a pause belongs to the Short we're leaving.
    clearTimeout(tapT); lastTap = 0;
    active = slide; paused = false;
    const id = slide.dataset.id;
    // Always start muted: phones only autoplay muted video. Sound comes on once it's really playing.
    const params = new URLSearchParams({ autoplay: "1", mute: "1", controls: "0", disablekb: "1", fs: "0", iv_load_policy: "3", playsinline: "1", rel: "0", loop: "1", playlist: id, enablejsapi: "1", origin: location.origin });
    slide.querySelector(".sframe").insertAdjacentHTML("afterbegin", `<iframe src="${YT}/embed/${id}?${params}" allow="autoplay; encrypted-media; picture-in-picture" title="${esc(slide.dataset.title)}"></iframe>`);
    const f = slide.querySelector("iframe");
    // YouTube draws its mobile controls on small players and ignores controls=0 there. So the player is laid
    // out at 720x1280 and scaled down to the frame: YouTube sees a big player and keeps its controls hidden.
    const frame = slide.querySelector(".sframe");
    const fit = () => {
      const s = Math.min(frame.clientWidth / 720, frame.clientHeight / 1280);
      frame.style.setProperty("--ys", s.toFixed(4));
      frame.style.setProperty("--yx", ((frame.clientWidth - 720 * s) / 2).toFixed(1) + "px");
      frame.style.setProperty("--yy", ((frame.clientHeight - 1280 * s) / 2).toFixed(1) + "px");
    };
    fit(); new ResizeObserver(fit).observe(frame);
    f.addEventListener("load", () => f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT));
    slide.classList.add("playing", "muted");
    delete slide.dataset.unmuted;
    store.watched(id);
    history.replaceState(history.state, "", `/shorts/${id}${location.search}`);
    const k = [...box.children].indexOf(slide);
    if (k > shown - 6 && shown < list.length) { box.insertAdjacentHTML("beforeend", list.slice(shown, shown + 20).map(shortSlide).join("")); [...box.children].slice(shown).forEach((s) => io.observe(s)); shown += 20; }
  };
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(e.target); }, { root: box, threshold: [0.6] });
  [...box.children].forEach((s) => io.observe(s));
  const step = (d) => { const k = active ? [...box.children].indexOf(active) : 0; const t = box.children[Math.max(0, k + d)]; if (t) t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
  const keys = (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
    if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    // Space or K pauses and plays, like YouTube.
    // (Never steal Space from a focused button, link or chip: it activates them.)
    if ((e.key === "k" || (e.key === " " && !document.activeElement?.closest("button, a, [role=button], summary"))) && active) { e.preventDefault(); active.querySelector(".scatch").click(); }
  };
  addEventListener("keydown", keys);
  el.querySelector(".snav").onclick = (e) => { const b = e.target.closest("[data-snav]"); if (b) step(+b.dataset.snav); };
  // Progress, from the player's own timing messages.
  const onMsg = (e) => {
    if (e.origin !== YT || !active) return;
    let d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    const info = d && d.info;
    if (info && info.currentTime != null && info.duration) active.style.setProperty("--prog", (100 * info.currentTime / info.duration).toFixed(2) + "%");
    // The thumbnail covers the player until it's really playing, so YouTube's start screen never shows.
    if (info && info.playerState === 1) {
      active.classList.add("started");
      // Playing muted: if this viewer turned sound on, ask for it now.
      if (soundOn() && !active.dataset.unmuted) { active.dataset.unmuted = "1"; cmd(active, "unMute"); cmd(active, "setVolume", [100]); active.classList.remove("muted"); }
    }
    // Safari pauses a video that unmutes without a tap: go back to muted playback and offer sound again.
    if (info && info.playerState === 2 && !paused && active.dataset.unmuted === "1") {
      active.dataset.unmuted = "blocked"; cmd(active, "mute"); cmd(active, "playVideo"); active.classList.add("muted");
    }
  };
  addEventListener("message", onMsg);
  box.addEventListener("click", (e) => {
    const catcher = e.target.closest(".scatch");
    if (catcher) {
      const slide = catcher.closest(".short"), now = Date.now();
      if (now - lastTap < 280) {
        // Double tap: like, with a burst where the finger was.
        clearTimeout(tapT); lastTap = 0;
        const r = catcher.getBoundingClientRect();
        catcher.insertAdjacentHTML("beforeend", `<span class="burst" style="left:${e.clientX - r.left}px;top:${e.clientY - r.top}px">${icon("heartfill")}</span>`);
        setTimeout(() => catcher.querySelector(".burst")?.remove(), 800);
        haptic.success();
        const item = "s:" + slide.dataset.id;
        if (signedIn() && !mine.likes.has(item)) likeItem(item, true).then(() => { const pill = slide.querySelector(".vote"); if (pill) pill.outerHTML = likeButton(item, { stacked: true }); }).catch(() => {});
        return;
      }
      lastTap = now;
      tapT = setTimeout(() => {
        paused = !paused; cmd(slide, paused ? "pauseVideo" : "playVideo");
        slide.classList.toggle("paused", paused); haptic.tick();
      }, 260);
      return;
    }
    const snd = e.target.closest("[data-sound]");
    if (snd) {
      const slide = snd.closest(".short"), on = slide.classList.contains("muted");
      cmd(slide, on ? "unMute" : "mute"); if (on) cmd(slide, "setVolume", [100]);
      slide.classList.toggle("muted", !on); sessionStorage.setItem("ff:sound", on ? "1" : "0"); haptic.tick();
      return;
    }
    const sh = e.target.closest("[data-share]");
    if (sh) { const url = `${location.origin}/shorts/${sh.dataset.share}`; (navigator.share ? navigator.share({ url }) : navigator.clipboard.writeText(url).then(() => toast("Link copied"))).catch(() => {}); }
  });
  document.body.classList.add("on-shorts");
  const unbind = bindSocial(el);
  return () => { unbind(); io.disconnect(); removeEventListener("keydown", keys); removeEventListener("message", onMsg); document.body.classList.remove("on-shorts"); };
}
function shortSlide(s) {
  const p = D.people[s.person];
  const saved = store.isSaved("s:" + s.id);
  return `<section class="short" data-id="${s.id}" data-title="${esc(s.title)}">
    <div class="sframe"><img src="https://i.ytimg.com/vi/${s.id}/oardefault.jpg" alt="" loading="lazy" width="720" height="1280" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${s.id}/hqdefault.jpg'">
      <div class="scatch" aria-label="Tap to pause, double tap to like"><span class="spause" aria-hidden="true">${icon("play")}</span></div>
      <button class="ssound" data-sound type="button" aria-label="Turn sound on or off"><span class="on">Tap for sound</span><span class="off" aria-hidden="true">${icon("volume")}</span></button>
      <div class="sbar" aria-hidden="true"><i></i></div>
      <div class="sover"><a class="who" href="/p/${p.slug}">${avatar(p, "s")}<b>${esc(p.name)}</b></a><p>${esc(s.title)}</p><span class="topic-tag">${topicLabel(s.topic)} · ${num(s.views)} views</span></div></div>
    <div class="sacts">
      ${likeButton("s:" + s.id, { stacked: true })}
      <button data-save="s:${s.id}" aria-pressed="${saved}" aria-label="Save">${icon(saved ? "bookmarked" : "bookmark")}<span>Save</span></button>
      <button data-share="${s.id}" aria-label="Share">${icon("share")}<span>Share</span></button>
      <a href="https://www.youtube.com/shorts/${s.id}" target="_blank" rel="noopener" aria-label="Open on YouTube">${icon("yt")}<span>YouTube</span></a>
    </div></section>`;
}

// ---------- Books ----------
export function booksPage(el, qs) {
  setTitle("Books");
  const topic = topicFromQuery(qs);
  const list = D.books.filter((b) => topic < 0 || b.topic === TOPICS[topic].code);
  el.innerHTML = `<div class="page-h"><div><h1>Books</h1><p>The best books on AI and computer science that their authors give away. Every link goes to the official free edition.</p></div></div>
    ${chips(topic)}
    <div class="books">${list.map((b, k) => bookCard(b, k)).join("") || '<p class="empty">No books in this topic yet.</p>'}</div>`;
  bindChips(el);
  return bindSocial(el);
}
const bookSlug = (b) => b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
// "Free online (text CC BY-SA 4.0, code MIT, per the d2l-en repo)" -> "Free online". One short muted line.
const shortLicense = (l) => String(l || "").replace(/\s*\(.*$/, "").replace(/,.*$/, "").slice(0, 40);
function bookCard(b, k = 0) {
  return `<article class="book">
    <a class="cover" style="--k:${(k * 3) % 4}" href="${esc(b.url)}" target="_blank" rel="noopener" aria-label="Read ${esc(b.title)} free">
      <span class="ct">${esc(b.title)}</span><span class="ca">${esc(b.authors)}</span><span class="cy">${esc(String(b.year || ""))}</span></a>
    <div class="binfo"><span class="topic-tag">${esc(b.level)} · ${topicLabel(topicIndex(b.topic))}</span>
      <h3>${esc(b.title)}</h3><p>${esc(b.why)}</p>${stars("b:" + bookSlug(b))}
      <p class="bmeta muted">${esc(b.authors)}${b.year ? " · " + esc(String(b.year)) : ""} · ${esc(shortLicense(b.license))}</p>
      <a class="btn" href="${esc(b.url)}" target="_blank" rel="noopener">${icon("books")}Read free${b.format === "pdf" ? " (PDF)" : ""}</a></div>
  </article>`;
}
