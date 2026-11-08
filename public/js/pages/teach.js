// /teach: the professor and tutor dashboard. Your upcoming sessions with RSVP counts, hosting a new one,
// and for professors, naming tutors (POST /api/teach/<id>). Admins can also name professors here.
import { api, user, can, refreshMe } from "../account.js";
import { esc, toast, badges, userAvatar } from "../ui.js";
import { icon } from "../icons.js";
import { $, setTitle, cssReady, loader, go, on, busy } from "./_shared.js";
import { hostForm, bindHost, when, soon, live } from "./sessions.js";

const TEACH = { "": "Learner", tutor: "Tutor", professor: "Professor" };

export async function render(el) {
  await cssReady;
  try { await refreshMe(); } catch {}
  const me = user();
  if (!me) { toast("Sign in first."); go("/me", true); return null; }
  const admin = can("admin"), prof = me.teach === "professor";
  setTitle("Teaching");
  if (!me.teach && !admin) {
    el.innerHTML = `<div class="pg narrow-pg pg-teach"><header class="page-h"><div><h1>Teaching</h1><p>This is where professors and tutors run live sessions. A professor or an admin can name you a tutor.</p></div></header>
      <div class="acts"><a class="btn" href="/sessions">See live sessions</a></div></div>`;
    return null;
  }
  el.innerHTML = `<div class="pg pg-teach">
    <header class="page-h"><div><h1>Teaching</h1><p>${prof || admin ? "Host live sessions and name the tutors who help you teach." : "Host live sessions. Learners RSVP, then join from the Live sessions page."}</p></div></header>
    ${hostForm()}
    <section class="set" aria-labelledby="mineH"><h2 class="set-h" id="mineH">Your sessions</h2><div id="mine">${loader()}</div></section>
    ${prof || admin ? `<section class="set" aria-labelledby="tutH">
      <h2 class="set-h" id="tutH">${admin ? "Tutors and professors" : "Your tutors"}</h2>
      <p class="hint top">Paste a learner's profile link or id. They can copy it from their public profile.</p>
      <form class="inline" id="findT" role="search"><label class="sr-only" for="findIn">Profile link or id</label>
        <input class="input" id="findIn" placeholder="feedforward.dbaney.com/u/..." autocomplete="off" autocapitalize="none" spellcheck="false" required><button class="btn" type="submit">Find</button></form>
      <div id="found"></div>
    </section>` : ""}
  </div>`;

  const mine = $("#mine", el);
  const load = async () => {
    const all = (await api("/api/sessions")).sessions.filter((s) => s.host.id === me.id);
    mine.innerHTML = all.length ? `<ul class="rows my-ses">${all.map((s) => {
      const tag = soon(s);
      return `<li class="${s.cancelled ? "off" : ""}"><div class="my-t"><span class="ses-when"><time datetime="${new Date(s.starts * 1000).toISOString()}">${esc(when(s))}</time><span class="dot"></span>${s.minutes} min${tag ? `<span class="dot"></span><b class="${live(s) ? "now" : ""}">${tag}</b>` : ""}</span>
        <a href="/sessions#${esc(s.id)}"><b>${esc(s.title)}</b></a><span class="muted"><b class="mono going">${s.going}</b> going</span></div>
        <div class="acts">${live(s) ? `<a class="btn primary sm" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${icon("ext")}Start</a>` : ""}${s.cancelled ? "" : `<button class="textbtn danger" type="button" data-cancel="${esc(s.id)}" data-going="${s.going}">Cancel</button>`}</div></li>`;
    }).join("")}</ul>` : `<p class="muted empty-row">Nothing scheduled. Host your first session above.</p>`;
  };
  bindHost($("#hostForm", el), load);
  const offs = [on(mine, "[data-cancel]", (b) => {
    const n = +b.dataset.going;
    if (!confirm(n ? `Cancel this session? ${n} ${n === 1 ? "person has" : "people have"} RSVP'd.` : "Cancel this session?")) return;
    busy(b, async () => { await api(`/api/sessions/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: "POST" }); toast("Session cancelled"); await load(); });
  })];

  const find = $("#findT", el);
  if (find) {
    const found = $("#found", el);
    let person = null;
    const card = (u) => {
      const opts = admin ? ["", "tutor", "professor"] : u.teach === "professor" || u.id === me.id ? [] : ["", "tutor"];
      return `<div class="found-card">${userAvatar(u, "s")}<div class="found-t"><span><a href="/u/${esc(u.id)}"><b>${esc(u.name)}</b></a>${badges(u)}</span><span class="muted">${TEACH[u.teach || ""]}</span></div>
        <div class="acts">${opts.length ? (admin
          ? `<div class="seg" role="group" aria-label="Teaching role">${opts.map((t) => `<button type="button" data-set="${t}" aria-pressed="${(u.teach || "") === t}">${TEACH[t] === "Learner" ? "None" : TEACH[t]}</button>`).join("")}</div>`
          : u.teach === "tutor" ? `<button class="textbtn danger" type="button" data-set="">Remove tutor</button>` : `<button class="btn" type="button" data-set="tutor">Make tutor</button>`)
          : `<span class="muted">${u.id === me.id ? "That's you." : "Only admins change professors."}</span>`}</div></div>`;
    };
    find.onsubmit = (e) => {
      e.preventDefault();
      const raw = $("#findIn", el).value.trim();
      const id = (raw.match(/\/u\/([\w]+)/) || raw.match(/^([\w]{4,20})$/) || [])[1];
      if (!id) return toast("Paste a profile link like feedforward.dbaney.com/u/abc123.");
      busy(e.submitter, async () => { person = (await api("/api/u/" + encodeURIComponent(id))).user; found.innerHTML = card(person); });
    };
    offs.push(on(found, "[data-set]", (b) => {
      const t = b.dataset.set;
      if ((person.teach || "") === t) return;
      if (!confirm(t ? `Make ${person.name} a ${t}? ${t === "professor" ? "Professors host sessions and name tutors." : "Tutors can host live sessions."}` : `Remove ${person.name}'s teaching role?`)) return;
      busy(b, async () => {
        await api("/api/teach/" + encodeURIComponent(person.id), { method: "POST", body: { teach: t } });
        person = { ...person, teach: t }; found.innerHTML = card(person);
        toast(t ? `${person.name} is now a ${t}` : "Teaching role removed");
      });
    }));
  }
  // Handlers are bound before this await, so a fast click never falls through to a native form submit.
  try { await load(); } catch (e) { mine.innerHTML = `<p class="muted empty-row">Sessions didn't load.</p>`; }
  return () => offs.forEach((f) => f());
}
