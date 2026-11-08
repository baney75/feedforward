// The front door. Feedforward is invite-only, so signed out, every path lands here.
// Each part has one job:
//   the moving wall of real lessons      curiosity: what's behind the glass is real and worth it
//   "Invite only" and the live count     exclusivity and social proof: people you'd want to learn with are in
//   named teachers                       authority: you know these people
//   three doors, one button each         one decision at a time
//   "Donovan invited you"                a person vouched for you, so you're expected
//   the human check's progress           visible progress, so a wait feels like work being done for you
//   your code, big, with "save it"       ownership: it's your key
import { createAccount, signIn, apply, inviteInfo, prepare, adopt } from "../account.js";
import { esc, toast, userAvatar, badges } from "../ui.js";
import { $, setTitle, cssReady, copy, qrSvg, SITE } from "./_shared.js";
import { haptic } from "../haptics.js";

const TEACHERS = ["Andrej Karpathy", "3Blue1Brown", "Sebastian Lague", "Welch Labs", "Theo", "Tsoding", "Simon Willison", "StatQuest"];
// A few lessons for the wall when the live list is short. YouTube thumbnails are public.
const WALL = ["kCc8FmEb1nY", "zjkBMFhNj_g", "wjZofJX0v4M", "7xTGNNLPyMI", "eMlx5fFNoYc", "aircAruvnKk", "1DtMiRKg-cs", "VMj-3S1tku0", "l8pRSuU81PU", "9vM4p9NN0Ts", "LPZh9BOjkQs", "fNk_zzaMoSs"];
const ROLE = { contributor: "Contributor", mod: "Moderator", admin: "Admin" };
// What's behind the door: four lessons people know.
const PEEK = [["kCc8FmEb1nY", "Let's build GPT: from scratch, in code", "Andrej Karpathy"], ["aircAruvnKk", "But what is a neural network?", "3Blue1Brown"],
  ["wjZofJX0v4M", "Transformers, the tech behind LLMs", "3Blue1Brown"], ["zjkBMFhNj_g", "Intro to Large Language Models", "Andrej Karpathy"]];
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem("lt:" + k)); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem("lt:" + k) : localStorage.setItem("lt:" + k, JSON.stringify(v)); } catch {} } };
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "K" : Number(n || 0).toLocaleString());

export async function render(el, qs, parts) {
  await cssReady;
  setTitle("");
  const joinCode = parts[0] === "join" && parts[1] ? parts[1] : "";
  const pending = store.get("application");
  // A TV gets the pairing screen: scan with your phone, approve, done.
  let tab = isTV() ? "pair" : joinCode ? "invite" : pending ? "signin" : "invite";
  if (tab === "pair") document.body.classList.add("door-tv");

  el.innerHTML = `<div class="door-pg">
    <div class="door-wall" aria-hidden="true"><div class="dw-cols"></div></div>
    <header class="door-top">
      <a class="door-brand" href="/" aria-label="Feedforward">
        <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--accent)"/><g fill="var(--accent-ink)"><rect x="15.5" y="15.7" width="8.2" height="32.6" rx="4.1"/><rect x="27.7" y="21.8" width="8.2" height="20.4" rx="4.1"/><circle cx="44" cy="32" r="4.5"/></g></svg>
        <span>Feedforward</span>
      </a>
      <button class="btn door-signin" type="button" data-tab="signin">Sign in</button>
    </header>
    <div class="door-hero">
      <p class="door-eyebrow"><span class="door-live" aria-hidden="true"></span>Invite only<span class="door-sep" aria-hidden="true"></span>Free<span class="door-sep" aria-hidden="true"></span>No ads<span id="doorCount" hidden></span></p>
      <h1 class="door-h">Learn AI from the people <em>building it.</em></h1>
      <p class="door-sub">Hand-picked lessons from ${TEACHERS.slice(0, 2).map(esc).join(", ")} and <span id="doorPeople">80+</span> more teachers. Labs, live sessions and a community of builders.</p>
      <section class="door-card" aria-label="Get in">
        <div class="door-pane" id="doorPane"></div>
      </section>
    </div>
    <section class="door-peek" aria-label="Lessons inside">
      <h2>Lessons inside</h2>
      <ul>${PEEK.map(([id, t, by]) => `<li><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy"><b>${esc(t)}</b><span>${esc(by)}</span></li>`).join("")}</ul>
    </section>
    <section class="door-how" aria-label="How it works">
      <ol>
        <li><b>Get an invite, or apply</b><span>A member's link gets you straight in. Applications are read by people, not bots.</span></li>
        <li><b>Keep your code</b><span>Four words and two digits. It's your account on every device: no email, no password.</span></li>
        <li><b>Learn</b><span>Videos, Shorts, posts, labs and live sessions from the best teachers in AI.</span></li>
      </ol>
    </section>
    <p class="door-foot">Open source on <a href="https://github.com/baney75/feedforward" target="_blank" rel="noopener">GitHub</a>. Questions? <a href="mailto:support@dbaney.com">support@dbaney.com</a></p>
  </div>`;

  // Live wall and counts. The wall is real lessons, slowly moving, behind glass.
  const cols = $(".dw-cols", el);
  const paintWall = (ids) => {
    const pool = [...new Set([...ids, ...WALL])];
    cols.innerHTML = [0, 1, 2, 3].map((c) => {
      const mine = pool.filter((_, i) => i % 4 === c);
      const tiles = [...mine, ...mine].map((id) => `<img src="https://i.ytimg.com/vi/${esc(id)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">`).join("");
      return `<div class="dw-col" style="--d:${48 + c * 9}s;--dir:${c % 2 ? "reverse" : "normal"}">${tiles}</div>`;
    }).join("");
  };
  paintWall([]);
  fetch("/api/pulse").then((r) => r.json()).then((p) => {
    if (p.wall && p.wall.length) paintWall(p.wall);
    // A member count is social proof only once it's big; until then the eyebrow states facts.
    if (p.learners >= 250) { const c = $("#doorCount", el); c.hidden = false; c.textContent = ` · ${fmt(p.learners)} members`; }
    if (p.people) $("#doorPeople", el).textContent = String(Math.max(0, p.people - 4));
  }).catch(() => {});

  const pane = $("#doorPane", el);
  const show = (k, opts) => {
    tab = k;
    el.querySelector(".door-signin").hidden = k === "signin";
    PANES[k](pane, opts);
    if (opts && opts.focus) pane.querySelector("input, textarea")?.focus();
  };
  // Any [data-tab] control switches what the card shows.
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { e.preventDefault(); show(b.dataset.tab, { focus: true }); } });
  goTab = show;
  show(tab, { code: joinCode });
  return () => {};
}

// Switch the card from anywhere in this module (set by render).
let goTab = () => {};

// ---------- Panes ----------
const PANES = { invite: invitePane, signin: signinPane, apply: applyPane, pair: pairPane };

// Smart TVs and streaming sticks, by user agent (plus ?tv=1 for testing on anything).
export const isTV = () => /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|AFT[A-Z]|CrKey|GoogleTV|Android TV|HbbTV|VIDAA|PhilipsTV|Roku/i.test(navigator.userAgent) || new URLSearchParams(location.search).has("tv");

// Sign this screen in from a phone. The screen shows a code and its QR; the phone approves at /pair.
let pairTimer = 0;
async function pairPane(pane) {
  clearTimeout(pairTimer);
  pane.innerHTML = `<div class="door-pair"><div class="door-loading">Getting a code...</div></div>`;
  let d;
  try {
    const r = await fetch("/api/pair/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: isTV() ? "TV" : "Browser" }) });
    d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't get a code.");
  } catch (e) { pane.innerHTML = `<p class="door-err" role="alert">${esc(e.message)}</p><button class="btn" type="button" data-tab="pair">Try again</button>`; return; }
  const url = `${SITE}/pair#${d.code}`, pretty = d.code.slice(0, 3) + "-" + d.code.slice(3);
  pane.innerHTML = `<div class="door-pair">
    <div class="door-qr">${await qrSvg(url, "QR code: scan with your phone to sign this screen in")}</div>
    <div class="door-pair-t">
      <h2 class="door-title">Sign in with your phone</h2>
      <ol><li>Point your phone's camera at the code.</li><li>Tap <b>Approve</b> on your phone.</li></ol>
      <p class="door-hint">Or open <b>${esc(SITE.replace("https://", ""))}/pair</b> and enter</p>
      <p class="door-paircode mono" aria-label="Pairing code ${esc(d.code.split("").join(" "))}">${esc(pretty)}</p>
      <p class="door-hint" id="pairState">Waiting for your phone...</p>
    </div></div>
    ${isTV() ? "" : `<p class="door-back"><button class="textbtn" type="button" data-tab="signin">Type my code instead</button></p>`}`;
  const started = Date.now();
  const poll = async () => {
    if (!pane.isConnected) return;
    if (Date.now() - started > 570000) return pairPane(pane);   // codes live 10 minutes: get a fresh one
    try {
      const r = await (await fetch(`/api/pair/poll?code=${d.code}&secret=${encodeURIComponent(d.secret)}`)).json();
      if (r.state === "approved") { haptic.success(); $("#pairState", pane).textContent = "Approved. Signing you in..."; await adopt(r.token, r.user); return; }
      if (r.state === "gone") return pairPane(pane);
    } catch {}
    pairTimer = setTimeout(poll, 2000);
  };
  pairTimer = setTimeout(poll, 2000);
}

// The human check, shown as progress on the button that started it.
async function withCheck(btn, label, fn) {
  const was = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("checking");
  const set = (p) => { btn.style.setProperty("--p", Math.round(p * 100) + "%"); btn.innerHTML = `<span>${label} ${Math.round(p * 100)}%</span>`; };
  set(0);
  try { return await fn(set); }
  finally { btn.disabled = false; btn.classList.remove("checking"); btn.style.removeProperty("--p"); btn.innerHTML = was; }
}
const fail = (box, e) => { box.innerHTML = `<p class="door-err" role="alert">${esc(e.message || "Something went wrong. Try again.")}</p>`; };

function codeOf(input) {
  const s = String(input || "").trim();
  const m = s.match(/\/join\/([\w-]{1,40})/) || s.match(/^([\w-]{5,40})$/);
  return m ? m[1] : "";
}

function invitePane(pane, { code = "" } = {}) {
  if (!code) {
    pane.innerHTML = `<form class="door-form door-row" id="invForm">
      <label class="door-field door-span"><span>Have an invite? Paste the link or code</span>
        <input class="input" name="inv" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="feedforward.dbaney.com/join/..." required></label>
      <button class="btn primary door-go" type="submit">Continue</button>
    </form>
    <div class="door-msg" aria-live="polite"></div>
    <div class="door-or" role="separator"><span>No invite yet?</span></div>
    <button class="btn door-apply" type="button" data-tab="apply">Apply for an invite</button>
    <p class="door-hint door-center">A person reads every application. You get your code right away, and it lets you in the moment you're approved.</p>`;
    $("#invForm", pane).onsubmit = (e) => {
      e.preventDefault();
      const c = codeOf(e.currentTarget.inv.value);
      if (!c) return fail(pane.querySelector(".door-msg"), new Error("That doesn't look like an invite link."));
      history.replaceState(null, "", "/join/" + c);
      invitePane(pane, { code: c });
    };
    return;
  }
  pane.innerHTML = `<div class="door-loading">Checking your invite...</div>`;
  inviteInfo(code).then((inv) => {
    const by = inv.by || {}, named = by.name && by.name !== "Learner";
    const grants = [inv.role && inv.role !== "user" && ROLE[inv.role], inv.teach && inv.teach[0].toUpperCase() + inv.teach.slice(1), inv.verified && "Verified"].filter(Boolean);
    pane.innerHTML = `<div class="door-invite">
        <div class="door-from">${userAvatar(by, "l")}<div><p class="door-kicker">You're invited</p><p class="door-who">${named ? `${esc(by.name)}${badges(by)}` : "A member"} <span>invited you</span></p></div></div>
        ${grants.length ? `<p class="door-grants">${grants.map((g) => `<span>${esc(g)}</span>`).join("")}</p>` : ""}
      </div>
      <form class="door-form" id="joinForm">
        <label class="door-field"><span>Your name <i>optional</i></span><input class="input" name="name" maxlength="40" autocomplete="name" placeholder="How people will see you"></label>
        <input class="door-trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="btn primary door-go" type="submit">Accept invite</button>
        <div class="door-msg" aria-live="polite"></div>
      </form>`;
    let ready = prepare();
    $("#joinForm", pane).onsubmit = (e) => {
      e.preventDefault();
      const f = e.currentTarget, msg = $(".door-msg", pane);
      msg.innerHTML = "";
      const join = inv.kind === "invite" ? { invite: code } : { ref: code };
      // Hold the app back until they've seen and kept their code.
      sessionStorage.setItem("ff:hold", "1");
      withCheck(f.querySelector(".door-go"), "Checking you're human", async (p) => {
        const r = ready; ready = prepare();   // each challenge is single use
        const d = await createAccount(join, { onProgress: p, ready: r, extra: { name: f.name.value.trim(), website: f.website.value } });
        welcome(pane, d.code);
      }).catch((err) => { sessionStorage.removeItem("ff:hold"); fail(msg, err); });
    };
  }).catch((e) => {
    pane.innerHTML = `<div class="door-msg"></div><p class="door-hint"><button class="textbtn" type="button" data-other>Use a different invite</button> or <button class="textbtn" type="button" data-apply>apply</button>.</p>`;
    fail($(".door-msg", pane), e);
    pane.querySelector("[data-other]").onclick = () => { history.replaceState(null, "", "/"); invitePane(pane); };
    pane.querySelector("[data-apply]").onclick = () => goTab("apply");
  });
}

// "You're in": the code is the account, so it's shown big, with one clear way to keep it.
function welcome(pane, code) {
  haptic.success();
  pane.innerHTML = `<div class="door-welcome">
    <p class="door-kicker">You're in</p>
    <h2>This is your key.</h2>
    <p class="door-code mono">${esc(code)}</p>
    <p class="door-hint">It signs you in on any device. Keep it somewhere safe, like a password manager. Nobody can recover it for you.</p>
    <div class="door-acts"><button class="btn" type="button" id="copyCode">Copy code</button><button class="btn primary" type="button" id="enter" disabled>I saved it</button></div>
  </div>`;
  const enter = $("#enter", pane);
  $("#copyCode", pane).onclick = () => { copy(code, "Code copied"); enter.disabled = false; };
  // Copying unlocks the way in, so the code gets kept. A short wait does too, for people who write it down.
  setTimeout(() => (enter.disabled = false), 4000);
  enter.onclick = () => { sessionStorage.removeItem("ff:hold"); sessionStorage.setItem("ff:new", "1"); dispatchEvent(new Event("ff:account")); };
}

function signinPane(pane) {
  const pending = store.get("application");
  const canScan = "BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  pane.innerHTML = `<h2 class="door-title">Sign in</h2>${pending ? `<p class="door-pending"><b>Your application is in review.</b> Sign in with its code to check. It works the moment you're approved.</p>` : ""}
    <form class="door-form" id="siForm">
      <label class="door-field"><span>Your code</span>
        <input class="input mono" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="otter-maple-rocket-acorn-42" value="${pending ? esc(pending.code) : ""}" required></label>
      <button class="btn primary door-go" type="submit">Sign in</button>
      ${canScan ? `<button class="btn door-scan" type="button" id="scan">Scan a QR code</button>` : ""}
      <button class="btn door-scan" type="button" data-tab="pair">Sign in with my phone</button>
      <p class="door-hint">Signed in on another device? Open your profile there, show your QR code, and point this phone's camera at it.</p>
      <div class="door-msg" aria-live="polite"></div>
    </form>
    <p class="door-back"><button class="textbtn" type="button" data-tab="invite">I have an invite</button><span class="door-sep" aria-hidden="true"></span><button class="textbtn" type="button" data-tab="apply">Apply</button></p>`;
  const msg = $(".door-msg", pane), form = $("#siForm", pane);
  let ready = prepare();
  const go = (code) => withCheck(form.querySelector(".door-go"), "Checking you're human", async (p) => {
    const r = ready; ready = prepare();   // each challenge is single use
    try { await signIn(code, { onProgress: p, ready: r }); store.set("application", null); }
    catch (e) { if (e.status === 409) { msg.innerHTML = `<p class="door-pending" role="status">${esc(e.message)}</p>`; return; } throw e; }
  }).catch((e) => fail(msg, e));
  form.onsubmit = (e) => { e.preventDefault(); msg.innerHTML = ""; go(form.code.value); };
  const scan = $("#scan", pane);
  if (scan) scan.onclick = () => scanQR().then((text) => {
    if (!text) return;
    const link = text.match(/\/link#([a-z0-9-]+)/i), join = text.match(/\/join\/([\w-]+)/);
    if (link) { form.code.value = link[1]; go(link[1]); }
    else if (join) { history.replaceState(null, "", "/join/" + join[1]); goTab("invite", { code: join[1] }); }
    else toast("That QR code isn't a Feedforward code.");
  }).catch((e) => fail(msg, e));
}

// Camera QR scanning where the browser can (Chrome, Edge, Android). Elsewhere the phone's own camera app reads
// the same codes, because they're plain links.
async function scanQR() {
  const d = document.getElementById("sheet");
  d.innerHTML = `<h2>Scan a QR code</h2><div class="door-cam"><video playsinline muted></video><i aria-hidden="true"></i></div><div class="row"><button class="btn" id="camX">Cancel</button></div>`;
  d.showModal();
  const video = d.querySelector("video");
  let stream, stop = false;
  const close = () => { stop = true; try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {} d.close(); };
  d.querySelector("#camX").onclick = close;
  d.addEventListener("close", () => { stop = true; try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {} }, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch { close(); throw new Error("Feedforward needs the camera to scan. You can type the code instead."); }
  video.srcObject = stream; await video.play().catch(() => {});
  const det = new window.BarcodeDetector({ formats: ["qr_code"] });
  while (!stop) {
    try { const [hit] = await det.detect(video); if (hit) { close(); return hit.rawValue; } } catch {}
    await new Promise((r) => setTimeout(r, 180));
  }
  return "";
}

function applyPane(pane) {
  const pending = store.get("application");
  if (pending) {
    pane.innerHTML = `<div class="door-welcome"><p class="door-kicker">Application in review</p><h2>We'll let you in soon.</h2>
      <p class="door-code mono">${esc(pending.code)}</p>
      <p class="door-hint">This code is your account. It signs you in the moment you're approved, so keep it. Check any time from Sign in.</p>
      <div class="door-acts"><button class="btn" type="button" id="copyCode">Copy code</button><button class="btn primary" type="button" id="check">Check now</button></div>
      <p class="door-hint"><button class="textbtn" type="button" id="again">Start a new application</button></p></div>`;
    $("#copyCode", pane).onclick = () => copy(pending.code, "Code copied");
    $("#check", pane).onclick = () => goTab("signin");
    $("#again", pane).onclick = () => { if (confirm("Start over? Your current application code will stop being shown here.")) { store.set("application", null); applyPane(pane); } };
    return;
  }
  pane.innerHTML = `<form class="door-form" id="apForm">
    <h2 class="door-title">Apply for an invite</h2>
    <label class="door-field"><span>Your name</span><input class="input" name="name" maxlength="40" autocomplete="name" required></label>
    <label class="door-field"><span>What do you want to learn or build?</span>
      <textarea class="input" name="reason" rows="3" minlength="20" maxlength="600" required placeholder="I want to run models on my own GPU and understand how they work."></textarea></label>
    <details class="door-more"><summary>Add your X or GitHub <i>optional, helps us say yes</i></summary>
    <div class="door-two">
      <label class="door-field"><span>X handle</span><input class="input" name="x" maxlength="16" autocomplete="off" autocapitalize="off" placeholder="@you"></label>
      <label class="door-field"><span>GitHub</span><input class="input" name="github" maxlength="40" autocomplete="off" autocapitalize="off" placeholder="you"></label>
    </div></details>
    <input class="door-trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn primary door-go" type="submit">Apply for an invite</button>
    <p class="door-hint">You get a code right away. It becomes your account the moment we approve you.</p>
    <div class="door-msg" aria-live="polite"></div>
  </form>
  <p class="door-back"><button class="textbtn" type="button" data-tab="invite">I have an invite</button><span class="door-sep" aria-hidden="true"></span><button class="textbtn" type="button" data-tab="signin">Sign in</button></p>`;
  const form = $("#apForm", pane);
  let ready = prepare();
  form.onsubmit = (e) => {
    e.preventDefault();
    const msg = $(".door-msg", pane);
    msg.innerHTML = "";
    withCheck(form.querySelector(".door-go"), "Checking you're human", async (p) => {
      const d = await apply({ name: form.name.value, reason: form.reason.value, website: form.website.value,
        links: { x: form.x.value.replace(/^@/, ""), github: form.github.value } }, { onProgress: p, ready: ((r) => (ready = prepare(), r))(ready) });
      store.set("application", { code: d.code, ts: Date.now() });
      applyPane(pane);
    }).catch((err) => fail(msg, err));
  };
}

