// /oauth/authorize: a learner approves an MCP client (claude.ai, ChatGPT and others) for their library.
// The app name and the address it returns to are shown big, so a look-alike is easy to spot.
// Refuses to render for anything but response_type=code with PKCE S256, and inside a frame.
import { api, signedIn, user, signIn, signOut } from "../account.js";
import { esc, toast, userAvatar } from "../ui.js";
import { icon } from "../icons.js";
import { $, setTitle, cssReady, loader, busy } from "./_shared.js";

const refuse = (el, title, why) => {
  setTitle("Can't connect");
  el.innerHTML = `<div class="pg narrow-pg pg-consent"><header class="page-h"><div><h1>${esc(title)}</h1><p>${esc(why)}</p></div></header><div class="acts"><a class="btn" href="/">Go to Feedforward</a></div></div>`;
  return null;
};
// Where we may send the browser back to: https anywhere, or http on this computer (desktop clients).
const safeBack = (u) => { try { const x = new URL(u); return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname)); } catch { return false; } };

export async function render(el, qs) {
  await cssReady;
  // A consent screen inside someone else's frame is how clickjacking works. Don't draw one.
  if (window.top !== window.self) return refuse(el, "Open this in its own tab", "For your safety, Feedforward won't approve apps inside another page.");
  const q = Object.fromEntries(["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method"].map((k) => [k, qs.get(k) || ""]));
  if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge) || !q.client_id || !safeBack(q.redirect_uri)) {
    return refuse(el, "This link isn't valid", "The app sent an incomplete or unsafe sign-in request. Go back to the app and try connecting again.");
  }
  el.innerHTML = loader("checking the app");
  let app;
  try { app = await api(`/api/oauth/client?id=${encodeURIComponent(q.client_id)}&redirect_uri=${encodeURIComponent(q.redirect_uri)}`); }
  catch (e) { return refuse(el, "We don't recognize this app", e.message || "Go back to the app and try connecting again."); }
  const wantsWrite = /\bwrite\b/.test(q.scope);
  const deny = () => {
    const back = new URL(q.redirect_uri);
    back.searchParams.set("error", "access_denied");
    if (q.state) back.searchParams.set("state", q.state);
    location.assign(back.toString());
  };

  const paint = () => {
    setTitle("Connect " + app.name);
    const u = user();
    el.innerHTML = `<div class="pg narrow-pg pg-consent">
      <p class="kind">Connect an app</p>
      <h1><span class="app-name">${esc(app.name)}</span> wants to use your Feedforward library</h1>
      <div class="dest"><span class="muted">When you're done, you go back to</span><b class="mono">${esc(app.redirect_host)}</b>
        <p class="dest-warn">${icon("info")}<span>Only continue if you started this from that app just now. If you don't trust this address, choose Deny.</span></p></div>
      <section class="set perm" aria-labelledby="permH">
        <h2 class="set-h" id="permH">It will be able to</h2>
        <ul class="rows">
          <li>${icon("check")}<span><b>Read</b>: search the catalog and see what you've saved and watched.</span></li>
          ${wantsWrite ? `<li><label class="toggle"><input type="checkbox" id="allowWrite" checked><span><b>Save</b>: add videos, posts, books and papers to your library.</span></label></li>` : ""}
        </ul>
        <p class="hint">It can't comment, chat, change your account or see your code.</p>
      </section>
      ${u ? `<p class="consent-who">${userAvatar(u, "s")}<span>Signed in as <b>${esc(u.name || "Learner")}</b></span><button class="textbtn" type="button" id="notMe">Not you?</button></p>
        <div class="acts consent-acts"><button class="btn primary big" type="button" id="allow">Allow</button><button class="btn big" type="button" id="deny">Deny</button></div>`
      : `<form class="set signin-inline" id="si"><h2 class="set-h"><label for="siCode">Sign in with your code to continue</label></h2>
          <div class="inline"><input class="input mono" id="siCode" data-code enterkeyhint="go" required autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="otter-river-cedar-acorn-42" maxlength="60"><button class="btn primary" type="submit">Sign in</button></div>
          <p class="hint">No code yet? <a class="link" href="/me" target="_blank" rel="noopener">Get one free</a>, then come back to this tab.</p>
          <div class="acts"><button class="textbtn" type="button" id="deny">Deny</button></div></form>`}
      <p class="hint end-hint">You can revoke access any time on your account page, under Agent tokens.</p>
    </div>`;
    $("#deny", el).onclick = deny;
    const si = $("#si", el);
    if (si) si.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await signIn($("#siCode", el).value); toast("Signed in"); }); }; // the account event repaints once
    const notMe = $("#notMe", el);
    if (notMe) notMe.onclick = () => busy(notMe, () => signOut());
    const allow = $("#allow", el);
    if (allow) allow.onclick = () => busy(allow, async () => {
      const w = $("#allowWrite", el);
      const d = await api("/api/oauth/approve", { method: "POST", body: { ...q, scope: w && w.checked ? "write" : "read" } });
      // The server builds the redirect from the registered address; check it before following it.
      if (!d.redirect || !safeBack(d.redirect) || new URL(d.redirect).origin !== new URL(q.redirect_uri).origin) throw new Error("The app's return address didn't match. Nothing was shared.");
      el.querySelector(".consent-acts").innerHTML = `<p class="muted">Connected. Taking you back to ${esc(app.redirect_host)}.</p>`;
      location.assign(d.redirect);
    });
  };
  paint();
  // Signing in or out in another tab changes what this page should show.
  let was = signedIn();
  const onAcct = () => { if (signedIn() !== was) { was = signedIn(); paint(); } };
  addEventListener("ff:account", onAcct);
  return () => removeEventListener("ff:account", onAcct);
}
