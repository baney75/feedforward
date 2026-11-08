// /me: the account page. Signed out: get a code or sign in with one. Signed in: name, photo, code and QR,
// referral link, badges, agent tokens, sign out. /link#<code>: sign in on this device from a scanned QR.
import { haptic, hapticsOn, setHaptics } from "../haptics.js";
import { api, account, signedIn, user, can, createAccount, signIn, signOut, refreshMe, updateUser, setCode } from "../account.js";
import { esc, toast, badges, userAvatar } from "../ui.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { isCode } from "../code.js";
import { SITE, $, setTitle, cssReady, loader, copy, go, fmtDate, on, busy, qrSvg, LINK_FIELDS, linkChips } from "./_shared.js";

// The optional links offered at sign-up. Everything else can be added later on this page.
const JOIN_LINKS = ["x", "youtube", "twitch", "github", "scholar", "site"];
const linkInputs = (keys, cur = {}, prefix = "lk") => LINK_FIELDS.filter(([k]) => keys.includes(k)).map(([k, label, ph]) =>
  `<label class="field">${label}<input class="input" name="${k}" id="${prefix}-${k}" value="${esc(cur[k] || "")}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="200"${k === "site" || k === "scholar" ? ' inputmode="url"' : ""}></label>`).join("");
const readLinks = (form) => Object.fromEntries(LINK_FIELDS.map(([k]) => [k, (form.elements[k] ? form.elements[k].value : "").trim()]).filter(([, v]) => v));

// While the new code is on screen, account events must not repaint over it.
let holdReveal = false;
const BADGE_TEXT = { owner: "Founder", admin: "Admin", mod: "Moderator", contributor: "Contributor", professor: "Professor", tutor: "Tutor", verified: "Verified" };
const BADGE_WHY = { owner: "Started Feedforward.", admin: "Runs the community.", mod: "Keeps comments and chat kind.", contributor: "Adds to the catalog.", professor: "Teaches live sessions and names tutors.", tutor: "Hosts live sessions.", verified: "Joined with a verified invite." };

export async function render(el, qs, parts) {
  await cssReady;
  if (parts[0] === "link") return linkPage(el);
  holdReveal = false;
  let off = null;
  const paint = async () => { if (off) off(); off = signedIn() ? await signedInView(el) : signedOutView(el); };
  await paint();
  // Re-render if the account changes underneath us (signed out on another tab, token revoked).
  let was = signedIn();
  const onAcct = () => { if (signedIn() !== was) { was = signedIn(); if (!holdReveal) paint(); } };
  addEventListener("ff:account", onAcct);
  return () => { removeEventListener("ff:account", onAcct); if (off) off(); };
}

// ---------- Signed out ----------
function signedOutView(el) {
  setTitle("Join");
  const join = store.get("join", null);
  el.innerHTML = `<div class="pg narrow-pg pg-me">
    <header class="page-h"><div><h1>Join Feedforward</h1><p>Free. No email and no password. One code is your key on every device.</p></div></header>
    ${join ? `<p class="hint join-note">${icon("check")}${join.invite ? "You have an invite. It's applied when you get your code." : "A friend sent you. Welcome."}</p>` : ""}
    <section class="choice" aria-labelledby="newH">
      <h2 id="newH">New here</h2>
      <p class="muted">Get a code made of three words and two digits, like otter-maple-rocket-42.</p>
      <button class="btn primary big" id="getCode" type="button">Get your code</button>
      <details class="extra"><summary>Add your name and links <span class="opt">optional</span></summary>
        <form class="form" id="joinLinks" autocomplete="off">
          <label class="field">Name<input class="input" name="name" maxlength="40" placeholder="What should people call you?" autocomplete="nickname"></label>
          ${linkInputs(JOIN_LINKS, {}, "jl")}
          <p class="hint">Add your X handle and we use your X photo until you upload one.</p>
        </form>
      </details>
    </section>
    <div class="or" aria-hidden="true"><span>or</span></div>
    <form class="choice" id="signin" aria-labelledby="haveH">
      <h2 id="haveH">I have a code</h2>
      <div class="inline">
        <label class="sr-only" for="codeIn">Your code</label>
        <input class="input mono" id="codeIn" name="code" data-code enterkeyhint="go" required autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="otter-river-cedar-acorn-42" maxlength="60">
        <button class="btn" type="submit">Sign in</button>
      </div>
    </form>
  </div>`;
  $("#getCode", el).onclick = (e) => busy(e.currentTarget, async () => {
    holdReveal = true;
    const f = $("#joinLinks", el), name = f.elements.name.value.trim(), links = readLinks(f);
    let d;
    try { d = await createAccount(); } catch (err) { holdReveal = false; throw err; }
    // The account exists now. Links are a bonus: if they fail, the code still shows.
    if (name || Object.keys(links).length) {
      try { const r = await api("/api/me", { method: "PATCH", body: { ...(name ? { name } : {}), links } }); updateUser(r.user); }
      catch (err) { toast(err.message + " You can add them later."); }
    }
    reveal(el, d.code);
  });
  $("#signin", el).onsubmit = (e) => {
    e.preventDefault();
    const code = $("#codeIn", el).value;
    busy(e.submitter || $("#signin button", el), async () => { await signIn(code); toast("Signed in"); });
  };
  return null;
}

// Shown once, right after the account is made.
function reveal(el, code) {
  setTitle("Your code");
  el.innerHTML = `<div class="pg narrow-pg pg-me reveal">
    <header class="page-h"><div><h1>Here's your code</h1><p>It works on every device. There is no other way in.</p></div></header>
    <p class="code-big mono" id="newCode">${esc(code)}</p>
    <div class="acts"><button class="btn" id="copyNew" type="button">${icon("check")}Copy code</button></div>
    <p class="note">${icon("info")}<span>Save it now, in a password manager or a note only you can read. If you lose it, nobody can get the account back. Not even us.</span></p>
    <div class="acts"><button class="btn primary big" id="saved" type="button">I saved it</button></div>
  </div>`;
  $("#copyNew", el).onclick = () => copy(code, "Code copied");
  $("#saved", el).onclick = () => { holdReveal = false; go("/me", true); };
}

// ---------- Signed in ----------
async function signedInView(el) {
  el.innerHTML = loader("loading your account");
  let me;
  try { me = await refreshMe(); } catch (e) { if (!signedIn()) return signedOutView(el); toast(e.message); }
  const u = user();
  if (!u) return signedOutView(el);
  setTitle(u.name || "Your account");
  const refs = me ? me.referrals : 0;
  const refLink = `${SITE}/join/${u.ref}`;
  const keys = [u.verified && "verified", u.role !== "user" && u.role, u.teach].filter(Boolean);
  const links = u.links || {};
  const tools = [
    can("admin") ? ["/admin", "Admin", "People, catalog, reports, invites"] : can("mod") ? ["/admin", "Moderation", "Reports, skills, bans"] : null,
    u.teach || can("admin") ? ["/teach", "Teaching", u.teach === "professor" ? "Your sessions and tutors" : "Host and run your sessions"] : null,
  ].filter(Boolean);

  el.innerHTML = `<div class="pg narrow-pg pg-me">
    <header class="me-h">
      <button class="av-edit" id="avBtn" type="button" aria-label="Change your photo">${userAvatar(u, "l")}<span class="av-pen">${icon("pencil")}</span></button>
      <input type="file" id="avFile" accept="image/png,image/jpeg,image/webp" hidden>
      <div class="me-id">
        <h1>${esc(u.name || "Learner")}${badges(u)}</h1>
        <p class="muted">Joined ${fmtDate(u.created, { month: "long", year: "numeric" })}<span class="dot"></span><a class="link" href="/u/${esc(u.id)}">Public profile</a></p>
        ${u.verified ? "" : `<p class="hint top">Not verified yet. Verified members can comment. You get the check by joining with a verified invite, or when staff review your account.</p>`}
        ${u.uploaded ? `<p class="photo-note"><button class="textbtn" id="avDel" type="button">${links.x ? "Use your X photo" : "Remove photo"}</button></p>` : ""}
      </div>
    </header>
    ${tools.length ? `<nav class="tools-row" aria-label="Your tools"><span class="kind">Your tools</span>${tools.map(([h, l, d]) => `<a class="tool" href="${h}"><b>${l}</b><span class="muted">${d}</span>${icon("right")}</a>`).join("")}</nav>` : ""}

    <section class="set" aria-labelledby="nameH">
      <h2 class="set-h" id="nameH"><label for="nameIn">Name</label></h2>
      <form class="inline" id="nameForm">
        <input class="input" id="nameIn" name="name" maxlength="40" autocomplete="nickname" value="${esc(u.name || "")}" placeholder="What should people call you?">
        <button class="btn" type="submit">Save</button>
      </form>
    </section>

    <section class="set" aria-labelledby="linksH">
      <div class="set-top"><h2 class="set-h" id="linksH">Links</h2><button class="textbtn" id="editLinks" type="button" aria-expanded="false" aria-controls="linksForm">${Object.keys(links).length ? "Edit" : "Add links"}</button></div>
      <div id="linksView">${linkChips(links) || `<p class="hint top">Show people where else to find you. They appear on your public profile.</p>`}</div>
      <form class="form links-form" id="linksForm" hidden>
        ${linkInputs(LINK_FIELDS.map((f) => f[0]), links, "ml")}
        <div class="acts"><button class="btn" type="submit">Save links</button><button class="textbtn" type="button" id="cancelLinks">Cancel</button></div>
      </form>
    </section>

    <section class="set" aria-labelledby="codeH">
      <h2 class="set-h" id="codeH">Sign-in code</h2>
      <div class="code-row">
        <span class="mono code-mask" id="codeText" aria-live="polite">${mask()}</span>
        <div class="acts"><button class="btn" id="showCode" type="button" aria-pressed="false" aria-controls="qrBox">Show</button><button class="btn" id="copyCode" type="button">Copy</button></div>
      </div>
      <div class="qr-box" id="qrBox" hidden></div>
      <p class="hint">Use it to sign in on another device. Anyone with it can use your account. <button class="textbtn" id="rotate" type="button">Get a new code</button></p>
    </section>

    <section class="set" aria-labelledby="refH">
      <h2 class="set-h" id="refH">Invite friends</h2>
      <div class="code-row"><span class="mono ref-link" title="${esc(refLink)}">${esc(refLink.replace("https://", ""))}</span><div class="acts"><button class="btn" id="copyRef" type="button">Copy link</button></div></div>
      <p class="hint"><b class="mono">${refs}</b> ${refs === 1 ? "person has" : "people have"} joined with your link.</p>
    </section>

    ${keys.length ? `<section class="set" aria-labelledby="badgeH"><h2 class="set-h" id="badgeH">Badges</h2>
      <ul class="rows badge-list">${keys.map((k) => `<li>${badges(k === "verified" ? { verified: true } : k === "tutor" || k === "professor" ? { teach: k } : { role: k })}<b>${BADGE_TEXT[k]}</b><span class="muted">${BADGE_WHY[k]}</span></li>`).join("")}</ul></section>` : ""}

    <section class="set" aria-labelledby="tokH">
      <h2 class="set-h" id="tokH">Agent tokens</h2>
      <p class="hint top">Let an AI agent search the catalog with your library and saves. <a class="link" href="/agents">How to connect an agent</a></p>
      <ul class="rows" id="tokList">${loader("loading tokens")}</ul>
      <div id="tokNew" hidden></div>
      <form class="tok-form" id="tokForm">
        <label class="sr-only" for="tokName">Token name</label>
        <input class="input" id="tokName" maxlength="40" placeholder="Name it, like Claude Code" required>
        <div class="seg" role="group" aria-label="What the token can do">
          <button type="button" data-scope="read" aria-pressed="true">Read</button><button type="button" data-scope="write" aria-pressed="false">Read and save</button>
        </div>
        <button class="btn" type="submit">Create token</button>
      </form>
    </section>

    <section class="set" aria-labelledby="setH"><h2 class="set-h" id="setH">Settings</h2>
      <ul class="rows prefs">
        <li><span><b>Theme</b><span class="muted">Ink, Paper, Terminal and more</span></span><button class="btn sm" id="themePick" type="button">Change</button></li>
        <li><label class="switch-row"><span><b>Turn off Shorts</b><span class="muted">Hide Shorts everywhere on this device</span></span><input type="checkbox" role="switch" id="prefShorts"${store.shortsOff() ? " checked" : ""}></label></li>
        <li><label class="switch-row"><span><b>Haptics</b><span class="muted">A light tap when you like, save or swipe (phones)</span></span><input type="checkbox" role="switch" id="prefHaptics"${hapticsOn() ? " checked" : ""}></label></li>
      </ul>
    </section>
    <section class="set end"><button class="textbtn danger" id="signOut" type="button">Sign out of this device</button></section>
  </div>`;

  const offs = [];
  // Name
  $("#nameForm", el).onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const d = await api("/api/me", { method: "PATCH", body: { name: $("#nameIn", el).value } });
      updateUser(d.user); toast("Name saved");
      $(".me-id h1", el).innerHTML = esc(d.user.name || "Learner") + badges(d.user);
    });
  };
  // Links
  const lf = $("#linksForm", el), le = $("#editLinks", el);
  const toggleLinks = (open) => { lf.hidden = !open; le.setAttribute("aria-expanded", open); $("#linksView", el).hidden = open; if (open) lf.querySelector("input").focus(); };
  le.onclick = () => toggleLinks(lf.hidden);
  $("#cancelLinks", el).onclick = () => toggleLinks(false);
  lf.onsubmit = (e) => {
    e.preventDefault();
    const sent = readLinks(lf);
    busy(e.submitter, async () => {
      const d = await api("/api/me", { method: "PATCH", body: { links: sent } });
      updateUser(d.user);
      const kept = Object.keys(d.user.links || {}).length, dropped = Object.keys(sent).filter((k) => !(d.user.links || {})[k]);
      toast(dropped.length ? `Saved. Check ${dropped.map((k) => LINK_FIELDS.find((f) => f[0] === k)[1]).join(", ")}: ${dropped.length > 1 ? "those didn't" : "that didn't"} look right.` : kept ? "Links saved" : "Links removed");
      if (!dropped.length) go("/me", true);
    });
  };
  // Photo
  const del = $("#avDel", el);
  if (del) del.onclick = () => {
    if (!confirm(links.x ? "Remove your uploaded photo and use your X photo?" : "Remove your photo?")) return;
    busy(del, async () => { const d = await api("/api/me/avatar", { method: "DELETE" }); updateUser(d.user); toast("Photo removed"); go("/me", true); });
  };
  const file = $("#avFile", el);
  $("#avBtn", el).onclick = () => file.click();
  file.onchange = () => {
    const f = file.files && file.files[0]; file.value = "";
    if (!f) return;
    busy($("#avBtn", el), async () => {
      const blob = await squareImage(f, 256);
      const d = await api("/api/me/avatar", { method: "PUT", raw: true, type: blob.type, body: blob });
      updateUser(d.user); toast("Photo updated");
      go("/me", true);
    });
  };
  // Code, QR, rotate
  let shown = false;
  const codeText = $("#codeText", el), qrBox = $("#qrBox", el), showBtn = $("#showCode", el);
  const paintCode = async () => {
    const code = (account() || {}).code;
    showBtn.setAttribute("aria-pressed", shown);
    showBtn.textContent = shown ? "Hide" : "Show";
    codeText.textContent = shown ? code || "Not saved on this device" : mask();
    codeText.classList.toggle("on", shown);
    qrBox.hidden = !shown || !code;
    if (shown && code) {
      qrBox.innerHTML = loader("drawing the QR code");
      try {
        qrBox.innerHTML = `${await qrSvg(`${SITE}/link#${code}`, "QR code that signs another device in to your account")}<p class="hint">Scan it with your other device's camera to sign in there. Only show it to yourself.</p>`;
      } catch (e) { qrBox.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
    }
  };
  showBtn.onclick = () => { shown = !shown; paintCode(); };
  $("#copyCode", el).onclick = () => { const c = (account() || {}).code; c ? copy(c, "Code copied") : toast("This device doesn't have your code. Rotate it to get a new one."); };
  $("#rotate", el).onclick = (e) => {
    if (!confirm("Get a new code? Your old code stops working, and every other device is signed out.")) return;
    busy(e.currentTarget, async () => {
      const d = await api("/api/me/code", { method: "POST" });
      setCode(d.code); shown = true; await paintCode();
      toast("New code ready. Save it now.");
    });
  };
  // Referral
  $("#copyRef", el).onclick = () => copy(refLink, "Link copied");
  // Tokens
  let scope = "read";
  offs.push(on($("#tokForm", el), "[data-scope]", (b) => {
    scope = b.dataset.scope;
    el.querySelectorAll("#tokForm [data-scope]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  const tokList = $("#tokList", el), tokNew = $("#tokNew", el);
  const paintTokens = async () => {
    try {
      const d = await api("/api/tokens");
      tokList.innerHTML = d.tokens.map((t) => `<li class="tok"><div class="tok-t"><b>${esc(t.name)}</b><span class="muted mono">${t.scope === "write" ? "read and save" : "read"}<span class="dot"></span>made ${fmtDate(t.created, { month: "short", day: "numeric" })}<span class="dot"></span>${t.last_used ? "used " + fmtDate(t.last_used, { month: "short", day: "numeric" }) : "never used"}</span></div>
        <button class="textbtn danger" type="button" data-revoke="${esc(t.id)}" data-name="${esc(t.name)}">Revoke</button></li>`).join("") || `<li class="muted empty-row">No tokens yet.</li>`;
    } catch (e) { tokList.innerHTML = `<li class="muted empty-row">Tokens didn't load.</li>`; }
  };
  paintTokens();
  offs.push(on(tokList, "[data-revoke]", (b) => {
    if (!confirm(`Revoke "${b.dataset.name}"? Any agent using it stops working right away.`)) return;
    busy(b, async () => { await api("/api/tokens/" + encodeURIComponent(b.dataset.revoke), { method: "DELETE" }); toast("Token revoked"); tokNew.hidden = true; await paintTokens(); });
  }));
  $("#tokForm", el).onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const d = await api("/api/tokens", { method: "POST", body: { name: $("#tokName", el).value, scope } });
      $("#tokName", el).value = "";
      tokNew.hidden = false;
      tokNew.innerHTML = `<div class="once"><p><b>${esc(d.name)}</b> is ready. Copy it now. It won't be shown again.</p>
        <pre class="code"><code id="tokVal">${esc(d.token)}</code></pre>
        <div class="acts"><button class="btn" type="button" id="copyTok">Copy token</button><a class="btn" href="/agents">Set up an agent</a></div></div>`;
      $("#copyTok", el).onclick = () => copy(d.token, "Token copied");
      await paintTokens();
    });
  };
  // Settings
  $("#prefShorts", el).onchange = (e) => { store.setShortsOff(e.target.checked); toast(e.target.checked ? "Shorts are off on this device" : "Shorts are back"); };
  $("#prefHaptics", el).onchange = (e) => { setHaptics(e.target.checked); if (e.target.checked) haptic.tick(); };
  // Sign out
  $("#signOut", el).onclick = (e) => {
    if (!confirm("Sign out on this device? You'll need your code to sign back in.")) return;
    busy(e.currentTarget, async () => { await signOut(); toast("Signed out"); });
  };
  return () => offs.forEach((f) => f());
}

const mask = () => "••••-••••-••••-••";

// Center-crops any image to a square and encodes it as WebP (JPEG where the browser can't make WebP).
async function squareImage(file, size) {
  if (!/^image\//.test(file.type)) throw new Error("Pick an image file.");
  if (file.size > 25e6) throw new Error("That image is too big. Pick one under 25 MB.");
  const img = await new Promise((res, rej) => {
    const url = URL.createObjectURL(file), i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That image didn't open. Try a PNG or JPEG.")); };
    i.src = url;
  });
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  const enc = (type, q) => new Promise((res) => c.toBlob(res, type, q));
  let blob = await enc("image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = await enc("image/jpeg", 0.88);
  if (!blob) throw new Error("This browser couldn't resize the image.");
  return blob;
}

// ---------- /link#<code> ----------
function linkPage(el) {
  setTitle("Sign in on this device");
  // Read the code, then wipe it from the address bar and history right away.
  let code = "";
  try { code = decodeURIComponent(location.hash.slice(1)); } catch {}
  code = code.trim().slice(0, 60);
  if (location.hash) history.replaceState(null, "", "/link");
  const valid = isCode(code);
  const cur = user();
  if (!valid) {
    el.innerHTML = `<div class="pg narrow-pg pg-me"><header class="page-h"><div><h1>This link has no code</h1><p>Open your account on the other device and scan its QR code again, or type your code instead.</p></div></header>
      <div class="acts"><a class="btn primary big" href="/me">Go to your account</a></div></div>`;
    return null;
  }
  const first = code.split(/[-\s_]+/)[0].toLowerCase();
  el.innerHTML = `<div class="pg narrow-pg pg-me">
    <header class="page-h"><div><h1>Sign in on this device</h1><p>You opened a sign-in link for the account whose code starts with <b class="mono">${esc(first)}</b>.</p></div></header>
    ${cur ? `<p class="note">${icon("info")}<span>This device is signed in as <b>${esc(cur.name || "Learner")}</b>. Signing in switches it to the other account.</span></p>` : ""}
    <div class="acts"><button class="btn primary big" id="linkGo" type="button">Sign in as this device</button><a class="btn" href="/">Not now</a></div>
    <p class="hint">Didn't scan your own code? Choose Not now. Never use a code someone else sends you.</p>
  </div>`;
  $("#linkGo", el).onclick = (e) => busy(e.currentTarget, async () => {
    await signIn(code); code = "";
    toast("Signed in on this device"); go("/me", true);
  });
  return () => { code = ""; };
}
