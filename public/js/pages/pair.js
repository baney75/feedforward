// /pair: approve signing in another screen (a TV, a laptop) from this phone.
// The other screen shows a six-letter code and a QR that opens this page with the code filled in.
import { api } from "../account.js";
import { esc, toast } from "../ui.js";
import { $, setTitle, cssReady, busy } from "./_shared.js";
import { haptic } from "../haptics.js";

export async function render(el) {
  await cssReady;
  setTitle("Sign in another screen");
  const fromHash = (location.hash.slice(1) || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (location.hash) history.replaceState(null, "", "/pair");
  el.innerHTML = `<div class="pg narrow-pg pg-pair">
    <header class="page-h"><div><h1>Sign in another screen</h1><p>Enter the code on your TV or other device. Only approve a screen you're looking at.</p></div></header>
    <form class="form" id="pairForm"><label class="field">Code<input class="input mono pair-in" name="code" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" value="${esc(fromHash ? fromHash.slice(0, 3) + "-" + fromHash.slice(3) : "")}" required></label>
      <div id="pairInfo"></div>
      <div class="acts"><button class="btn primary" type="submit">Approve</button></div></form></div>`;
  const form = $("#pairForm", el), info = $("#pairInfo", el);
  const norm = () => form.code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const look = async () => {
    const c = norm(); info.innerHTML = "";
    if (c.length !== 6) return;
    try { const d = await api("/api/pair/" + c); info.innerHTML = `<p class="hint">This signs in a <b>${esc(d.device)}</b> as you. It can watch, save and comment as you until you change your code.</p>`; }
    catch (e) { info.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; }
  };
  form.code.addEventListener("input", look);
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const d = await api("/api/pair/" + norm(), { method: "POST" });
      haptic.success();
      el.querySelector(".pg-pair").innerHTML = `<header class="page-h"><div><h1>Signed in</h1><p>Your ${esc(d.device)} is signed in. Enjoy.</p></div></header><a class="btn primary" href="/">Back to Feedforward</a>`;
      toast("Signed in");
    });
  };
  if (fromHash) look();
  return null;
}
