import { load, D, sampler, applyStats } from "./data.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { toast } from "./ui.js";
import * as V from "./views.js";
import { openTV, closeTV, tvIsOpen } from "./tv.js";
import { signedIn, user, refreshMe, sync, scheduleSync, loadStats, refreshGate } from "./account.js";
import { userAvatar } from "./ui.js";
import { haptic } from "./haptics.js";

const view = document.getElementById("view");
// Six main places. Everything else lives in a quiet Explore list (and on the Learn hub on phones).
const NAV = [
  ["/", "home", "Home"], ["/shorts", "shorts", "Shorts"], ["/wire", "wire", "Posts"], ["/learn", "learn", "Learn"], ["/chat", "chat", "Chat"], ["/library", "library", "Library"],
];
const EXPLORE = [["/people", "People"], ["/books", "Books"], ["/research", "Research"], ["/dictionary", "Dictionary"], ["/repos", "Repos"], ["/sessions", "Live sessions"], ["/skills", "Skills"], ["/agents", "Connect an agent"]];
const TABS = ["/", "/shorts", "/wire", "/learn", "/library"];
const LEARN_KIDS = new Set(["/people", "/books", "/research", "/dictionary", "/repos", "/sessions", "/skills", "/agents", "/chat"]);
// Pages that live in their own lazily loaded module.
// Feedforward is invite-only: signed out, every path shows the front door (gate.js) except /link, the QR sign-in.
const PAGES = { gate: "gate", pair: "pair", suggest: "suggest", oauth: "consent", teach: "teach", me: "me", link: "me", chat: "chat", sessions: "sessions", skills: "skills", agents: "agents", admin: "admin", u: "profile", research: "research", dictionary: "dictionary", repos: "repos" };

function shell() {
  const rail = document.querySelector(".rail");
  const noShorts = store.shortsOff(), nav = NAV.filter(([h]) => !(noShorts && h === "/shorts"));
  rail.innerHTML = nav.map(([h, i, l]) => `<a href="${h}">${icon(i)}<span>${l}</span></a>`).join("") +
    `<hr><div class="rail-h">Explore</div><div class="explore">${EXPLORE.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</div>` +
    `<div class="foot"><a href="/tv">TV mode</a> · <a href="/suggest">Suggest</a> · <a href="/about">About</a><br><a href="mailto:support@dbaney.com">support@dbaney.com</a> · <a href="https://github.com/baney75/feedforward">GitHub</a><br><button class="textbtn" type="button" id="railInstall">Install app</button> · <a href="https://dbaney.com/">dbaney.com</a></div>`;
  const tabbar = document.querySelector(".tabbar"), tabs = nav.filter(([h]) => TABS.includes(h));
  tabbar.style.setProperty("--tabs", tabs.length);
  tabbar.innerHTML = tabs.map(([h, i, l]) => `<a href="${h}">${icon(i)}<span>${l}</span></a>`).join("");
  document.getElementById("searchBtn").innerHTML = icon("search");
  document.getElementById("installBtn").innerHTML = icon("install");
  themeIcon();
}

function markNav(path) {
  const top = "/" + (path.split("/")[1] || "");
  const map = { "/watch": "/", "/p": "/people", "/lab": "/learn", "/search": "/", "/book": "/books", "/u": "/me", "/link": "/me" };
  const cur = map[top] && top !== "/" ? map[top] : top;
  document.querySelectorAll(".rail a, .tabbar a, .explore a").forEach((a) => {
    const h = a.getAttribute("href");
    if (h === cur && !(top === "/watch" || top === "/search")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // Phones have five tabs: everything under Explore belongs to Learn, so one tab is always lit.
  if (LEARN_KIDS.has(cur)) document.querySelector('.tabbar a[href="/learn"]')?.setAttribute("aria-current", "page");
}

// ---------- Router ----------
let cleanup = null, seq = 0;
function stopView() { if (cleanup) { try { cleanup(); } catch {} cleanup = null; } }
// Pages that can paint from the starter bundle; everything else waits for the full catalog.
const FAST = new Set(["", "learn", "lab", "about", "people", "books", "shorts", ...Object.keys(PAGES), "join"]);
// A member's start: refresh the gate cookie, then load the catalog. Runs once per sign-in.
let started = null;
function startMember() {
  if (!started) {
    started = refreshGate().then(() => load());
    // Member-only reads go after the gate cookie lands.
    started.then(() => loadStats()).then(async (st) => { await D.ready; applyStats(st); dispatchEvent(new Event("ff:stats")); }).catch(() => {});
    refreshMe().then(sync).catch(() => {});
  }
  return started;
}
// The amber line: starts on every page change, finishes when the page has painted.
const bar = document.getElementById("bar");
function barGo() { if (!bar) return; bar.className = ""; void bar.offsetWidth; bar.className = "go"; }
function barDone() { if (bar) requestAnimationFrame(() => (bar.className = "done")); }
async function route() {
  const my = ++seq;
  barGo();
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const qs = url.searchParams;
  stopView();
  view.onclick = null;
  const first = path.split("/")[1] || "";
  const door = !signedIn() && first !== "link";
  document.body.classList.toggle("door", door);
  if (door) {
    view.dataset.seq = my;
    const out = loadPage("gate", qs, path.split("/").filter(Boolean));
    out.then((c) => { barDone(); if (my === seq) cleanup = c; else if (typeof c === "function") c(); });
    scrollTo(0, 0);
    return;
  }
  markNav(path);
  if (path === "/tv") {
    try { await startMember(); } catch { if (!signedIn()) { started = null; D.ready = null; return route(); } }
    if (my !== seq) return;
    if (!D.isFull) await D.full.catch(() => {});
    if (my === seq && !tvIsOpen()) openTV((history.state && history.state.start) || null);
    return;
  }
  if (tvIsOpen()) closeTV();
  const parts = path.split("/").filter(Boolean);
  const r = parts[0] || "";
  try {
    if (signedIn()) await startMember(); else await D.ready;
    if (!FAST.has(r) && !D.isFull) { view.innerHTML = skeleton(); await D.full; }
  } catch (e) {
    // The gate turned this browser away (signed out elsewhere, or banned): show the front door.
    if (!signedIn()) { started = null; D.ready = null; return route(); }
    barDone();
    view.innerHTML = `<div class="empty-card" role="alert">${icon("info")}<h2>Videos didn’t load</h2><p>Check your connection, then try again.</p><button class="btn primary" type="button" id="retryCatalog">Try again</button></div>`;
    document.getElementById("retryCatalog").onclick = () => { started = null; D.ready = null; route(); };
    return;
  }
  if (my !== seq) return;
  view.dataset.seq = my;
  let out;
  if (r === "") out = V.home(view, qs);
  else if (r === "watch" && parts[1]) out = V.watch(view, qs, parts[1]);
  else if (r === "p" && parts[1]) out = V.personPage(view, qs, parts[1]);
  else if (r === "people") out = V.peoplePage(view);
  else if (r === "wire") out = V.wirePage(view, qs);
  else if (r === "learn" && parts[1]) out = V.trackPage(view, qs, parts[1]);
  else if (r === "learn") out = V.learnPage(view);
  else if (r === "lab" && parts[1]) out = V.labPage(view, qs, parts[1]);
  else if (r === "search") out = V.searchPage(view, qs);
  else if (r === "library") out = V.libraryPage(view, qs);
  else if (r === "about") out = V.aboutPage(view);
  else if (r === "shorts") out = V.shortsPage(view, qs, parts[1]);
  else if (r === "join") { history.replaceState(null, "", "/"); toast("You're already a member. Share your own invite link from your profile."); return route(); }
  else if (PAGES[r]) out = loadPage(PAGES[r], qs, parts);
  else if (r === "books") out = V.booksPage(view, qs);
  else out = V.notFound(view);
  if (out instanceof Promise) out.then((c) => { barDone(); if (my === seq) cleanup = c; else if (typeof c === "function") c(); });
  else { cleanup = out; barDone(); }
  setTimeout(askInstall, 4000);
  const st = history.state;
  if (st && typeof st.y === "number") requestAnimationFrame(() => scrollTo(0, st.y)); else scrollTo(0, 0);
}

function nav(href, { replace = false, state = {} } = {}) {
  try { history.replaceState({ ...(history.state || {}), y: scrollY }, ""); } catch {}
  replace ? history.replaceState(state, "", href) : history.pushState(state, "", href);
  route();
}
async function loadPage(name, qs, parts) {
  const my = view.dataset.seq;
  view.innerHTML = `<div class="skel" role="status" aria-label="Loading"><i></i><i></i><i></i></div>`;
  try {
    const mod = await import(`/js/pages/${name}.js`);
    if (view.dataset.seq !== my) return null;
    view.innerHTML = "";
    return await mod.render(view, qs, parts);
  } catch (e) {
    if (view.dataset.seq === my) { barDone(); view.innerHTML = `<div class="empty-card" role="alert">${icon("info")}<h2>This page didn’t load</h2><p>Check your connection, then try again.</p><button class="btn primary" type="button" onclick="location.reload()">Try again</button></div>`; }
    return null;
  }
}
function goTV(start) { if (location.pathname !== "/tv") nav("/tv", { state: { tv: 1, start } }); }
function skeleton() { return `<div class="skel" role="status" aria-label="Loading"><i></i><i></i><i></i></div>`; }

document.addEventListener("click", (e) => {
  const more = e.target.closest("[data-more]");
  if (more) { const t = more.previousElementSibling; t.classList.remove("clamp"); more.remove(); return; }
  const sv = e.target.closest("[data-save]");
  if (sv) {
    const on = store.toggleSave(sv.dataset.save);
    haptic.tick();
    sv.setAttribute("aria-pressed", on); sv.innerHTML = icon(on ? "bookmarked" : "bookmark");
    toast(on ? "Saved to your library" : "Removed from your library"); return;
  }
  const a = e.target.closest("a[href]");
  if (!a || a.target || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith("/data/") || u.pathname.startsWith("/labs/")) return;
  e.preventDefault();
  if (u.pathname === "/tv") { goTV(); return; }
  nav(u.pathname + u.search);
});
addEventListener("popstate", () => route());

// ---------- Search ----------
const form = document.querySelector(".search");
const q = document.getElementById("q");
form.addEventListener("submit", (e) => { e.preventDefault(); const v = q.value.trim(); if (v) { nav("/search?q=" + encodeURIComponent(v)); q.blur(); form.classList.remove("open"); } });
let typeT;
q.addEventListener("input", () => {
  clearTimeout(typeT);
  typeT = setTimeout(() => { const v = q.value.trim(); if (v.length >= 2) nav("/search?q=" + encodeURIComponent(v), { replace: location.pathname === "/search" }); }, 250);
});
q.addEventListener("blur", () => setTimeout(() => form.classList.remove("open"), 150));
document.getElementById("searchBtn").addEventListener("click", () => { form.classList.add("open"); q.focus(); });

// ---------- Keyboard ----------
addEventListener("keydown", (e) => {
  if (tvIsOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === "Escape" && typing) { document.activeElement.blur(); return; }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); if (innerWidth < 720) form.classList.add("open"); q.focus(); q.select(); }
  else if (e.key === "t" || e.key === "T") { e.preventDefault(); const m = location.pathname.match(/^\/watch\/([\w-]{11})/); goTV(m && m[1]); }
  else if (e.key === "N" && e.shiftKey) { const v = sampler()(); if (v) nav("/watch/" + v.id); }
});

// ---------- Theme ----------
const THEMES = [
  ["", "Match my device", "#0e0e0c", "#ffb224"], ["dark", "Ink", "#0e0e0c", "#ffb224"], ["light", "Paper", "#f8f6f0", "#ffb224"],
  ["terminal", "Terminal", "#050a06", "#39ff88"], ["amber", "Amber CRT", "#0c0800", "#ffb000"], ["midnight", "Midnight", "#0a0f1e", "#7aa2ff"],
  ["sepia", "Sepia", "#f4ecdd", "#c2622d"], ["contrast", "High contrast", "#000000", "#ffd400"],
];
const LIGHT = new Set(["light", "sepia"]);
function effectiveDark() { const t = document.documentElement.dataset.theme; return t ? !LIGHT.has(t) : !matchMedia("(prefers-color-scheme: light)").matches; }
function themeIcon() { document.getElementById("themeBtn").innerHTML = icon(effectiveDark() ? "moon" : "sun"); }
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem("lt:theme", t) : localStorage.removeItem("lt:theme"); } catch {}
  themeIcon();
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  let m = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
  m.content = bg;
}
addEventListener("ff:theme", () => document.getElementById("themeBtn").click());
// Any page can offer the theme picker with a button whose id is themePick.
document.addEventListener("click", (e) => { if (e.target.closest("#themePick")) dispatchEvent(new Event("ff:theme")); });
document.getElementById("themeBtn").addEventListener("click", () => {
  const d = document.getElementById("sheet");
  const cur = document.documentElement.dataset.theme || "";
  d.innerHTML = `<h2>Theme</h2><div class="themes" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l, bg, ac]) =>
    `<button role="radio" aria-checked="${k === cur}" data-theme-pick="${k}"><span class="sw" style="background:${bg}"><i style="background:${ac}"></i></span>${l}</button>`).join("")}</div>
    <div class="row"><button class="btn" id="sheetOk">Done</button></div>`;
  d.querySelector(".themes").onclick = (e) => {
    const b = e.target.closest("[data-theme-pick]"); if (!b) return;
    setTheme(b.dataset.themePick);
    d.querySelectorAll("[data-theme-pick]").forEach((x) => x.setAttribute("aria-checked", x === b));
  };
  d.querySelector("#sheetOk").onclick = () => d.close();
  d.showModal();
});
matchMedia("(prefers-color-scheme: light)").addEventListener("change", themeIcon);

// ---------- Install ----------
let deferred = null;
const installBtn = document.getElementById("installBtn");
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// No install button in the top bar: a phone gets one well-timed card instead (askInstall), and the footer
// keeps a quiet "Install app" link.
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
async function install() {
  if (deferred) { deferred.prompt(); const { outcome } = await deferred.userChoice; deferred = null; if (outcome === "accepted") installBtn.hidden = true; return; }
  const d = document.getElementById("sheet");
  const steps = isIOS
    ? `<ol><li>Tap the <b>Share</b> button in Safari's toolbar.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Feedforward opens like an app.</li></ol>`
    : `<ol><li>Open your browser's menu, or look for the install icon at the right end of the address bar.</li><li>Choose <b>Install Feedforward</b> or <b>Add to Home screen</b>.</li></ol>`;
  d.innerHTML = `<h2>Install Feedforward</h2><p class="muted">It runs full screen, starts fast, and keeps your saved videos and progress.</p>${steps}<div class="row"><button class="btn primary" id="sheetOk">Got it</button></div>`;
  d.querySelector("#sheetOk").onclick = () => d.close();
  d.showModal();
}
installBtn.addEventListener("click", install);
document.addEventListener("click", (e) => { if (e.target.closest("#railInstall")) install(); });
addEventListener("lt:install", install);
addEventListener("appinstalled", () => { installBtn.hidden = true; try { localStorage.setItem("lt:installAsk", JSON.stringify({ n: 9, t: Date.now() })); } catch {} toast("Installed"); });

// The install card: phones only, once someone is clearly coming back (a second day, two videos watched),
// at most twice and a week apart, never after an install or two dismissals.
function askInstall() {
  if (standalone || innerWidth >= 720 || !signedIn() || !(deferred || isIOS)) return;
  let ask = { n: 0, t: 0 };
  try { ask = JSON.parse(localStorage.getItem("lt:installAsk") || "null") || ask; } catch {}
  const days = store.get("days", []), seen = store.history().length;
  if (ask.n >= 2 || Date.now() - ask.t < 7 * 864e5 || days.length < 2 || seen < 2 || document.querySelector(".install-card")) return;
  try { localStorage.setItem("lt:installAsk", JSON.stringify({ n: ask.n + 1, t: Date.now() })); } catch {}
  const card = document.createElement("div");
  card.className = "install-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Add Feedforward to your home screen");
  card.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--accent)"/><g fill="var(--accent-ink)"><rect x="15.5" y="15.7" width="8.2" height="32.6" rx="4.1"/><rect x="27.7" y="21.8" width="8.2" height="20.4" rx="4.1"/><circle cx="44" cy="32" r="4.5"/></g></svg>
    <div><b>Put Feedforward on your home screen</b><span>${isIOS && !deferred ? "Tap Share, then Add to Home Screen. It opens full screen, like an app." : "One tap. It opens full screen and starts instantly."}</span></div>
    <div class="install-acts"><button class="btn" type="button" data-x>Not now</button>${deferred ? `<button class="btn primary" type="button" data-go>Add</button>` : ""}</div>`;
  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.add("on"));
  const close = () => { card.classList.remove("on"); setTimeout(() => card.remove(), 300); };
  card.querySelector("[data-x]").onclick = close;
  const go = card.querySelector("[data-go]"); if (go) go.onclick = () => { close(); install(); };
}

// ---------- Misc ----------
// The top bar gets out of the way: scrolling down slides it off, any scroll up brings it back (like the YouTube
// and X apps). It always shows near the top of the page, and small jitters don't move it.
{
  const bar = document.querySelector(".topbar");
  let lastY = scrollY, acc = 0;
  addEventListener("scroll", () => {
    const y = scrollY, dy = y - lastY; lastY = y;
    bar.classList.toggle("scrolled", y > 4);
    if (y < 80) { acc = 0; bar.classList.remove("away"); document.body.classList.remove("bar-away"); return; }
    acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy;
    if (acc > 24) { bar.classList.add("away"); document.body.classList.add("bar-away"); }
    else if (acc < -12) { bar.classList.remove("away"); document.body.classList.remove("bar-away"); }
  }, { passive: true });
  // Opening a page, or focusing anything in the bar (the / shortcut, Tab), always brings it back.
  const back = () => { bar.classList.remove("away"); document.body.classList.remove("bar-away"); };
  addEventListener("popstate", back);
  bar.addEventListener("focusin", back);
}
addEventListener("lt:fresh", (e) => toast(`${e.detail} new since the last update`));
if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

shell();
function acctButton() {
  const b = document.getElementById("acctBtn");
  const u = user();
  b.innerHTML = u ? userAvatar(u, "s") : icon("people");
  b.setAttribute("aria-label", u ? `Your profile, ${u.name || "Learner"}` : "Get your free code");
}
acctButton();
// Signing in on the front door, or out anywhere, re-routes: members get the app, everyone else the door.
let wasIn = signedIn();
addEventListener("ff:account", () => {
  acctButton();
  // A brand-new member is reading their code on the front door; the door lets go when they've kept it.
  if (sessionStorage.getItem("ff:hold")) return;
  if (signedIn() === wasIn) return;
  wasIn = signedIn();
  if (!wasIn) started = null;
  // A TV that just signed in goes straight to lean-back TV mode.
  if (wasIn && /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|AFT[A-Z]|CrKey|GoogleTV|Android TV|HbbTV|VIDAA|PhilipsTV|Roku/i.test(navigator.userAgent)) { document.body.classList.remove("door-tv"); history.replaceState(null, "", "/tv"); }
  route();
});
addEventListener("ff:changed", scheduleSync);
// Turning Shorts off or on rebuilds the navigation at once.
addEventListener("ff:prefs", () => { shell(); markNav(location.pathname.replace(/\/+$/, "") || "/"); });
sessionStorage.removeItem("ff:hold");
route();
