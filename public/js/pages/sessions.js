// /sessions: live teaching sessions from professors and tutors. RSVP, join when it starts, chat in its own room.
import { api, signedIn, user, can } from "../account.js";
import { esc, toast, badges, userAvatar } from "../ui.js";
import { icon } from "../icons.js";
import { $, setTitle, cssReady, loader, go, on, busy } from "./_shared.js";
import { mountChat } from "./chat.js";

const now = () => Date.now() / 1000;
export const when = (s) => new Date(s.starts * 1000).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
export const live = (s) => !s.cancelled && now() >= s.starts - 600 && now() < s.starts + s.minutes * 60;
export function soon(s) {
  const d = s.starts - now();
  if (s.cancelled) return "Cancelled";
  if (d <= 0) return now() < s.starts + s.minutes * 60 ? "Live now" : "Ended";
  if (d < 3600) return `Starts in ${Math.max(1, Math.round(d / 60))} min`;
  if (d < 86400) return `In ${Math.round(d / 3600)} h`;
  return "";
}
// The next full hour in the viewer's zone, in the format a datetime-local input wants.
function nextHour() {
  const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

// "Host a session": shared by this page and /teach.
export const hostForm = (open = false) => `<details class="host" id="host"${open ? " open" : ""}><summary><span>Host a session</span>${icon("down")}</summary>
  <form class="form" id="hostForm">
    <label class="field">Title<input class="input" name="title" maxlength="90" required placeholder="Build a tokenizer together"></label>
    <label class="field">What you'll cover <span class="opt">optional</span><textarea class="input" name="about" rows="3" maxlength="1500"></textarea></label>
    <div class="two">
      <label class="field">Starts<input class="input" name="starts" type="datetime-local" required value="${nextHour()}"></label>
      <label class="field">Minutes<input class="input" name="minutes" type="number" min="15" max="240" step="15" value="60" required></label>
    </div>
    <label class="field">Meeting link <span class="opt">optional</span><input class="input" name="link" type="url" inputmode="url" placeholder="https://" pattern="https://.*"></label>
    <p class="hint">Leave the link empty and we make a free Jitsi Meet room. Nobody needs an account or an app to join it.</p>
    <div class="acts"><button class="btn primary" type="submit">Schedule it</button></div>
  </form></details>`;
export function bindHost(form, done) {
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const starts = Math.floor(new Date(String(f.get("starts"))).getTime() / 1000);
    if (!starts) return toast("Pick a start time.");
    busy(e.submitter, async () => {
      await api("/api/sessions", { method: "POST", body: { title: f.get("title"), about: f.get("about"), starts, minutes: +f.get("minutes"), link: String(f.get("link") || "").trim() } });
      form.reset(); form.starts.value = nextHour(); form.closest("details").open = false;
      toast("Session scheduled"); await done();
    });
  };
}

export async function render(el) {
  await cssReady;
  setTitle("Live sessions");
  const u = user();
  const host = !!(u && (u.teach || can("admin")));
  el.innerHTML = `<div class="pg pg-sessions">
    <header class="page-h"><div><h1>Live sessions</h1><p>RSVP, then join here when it starts.</p></div></header>
    ${host ? hostForm() : ""}
    <div id="list">${loader("loading sessions")}</div>
  </div>`;
  const list = $("#list", el);
  let open = null, stopChat = null, sessions = [];
  const closeChat = () => { if (stopChat) stopChat(); stopChat = null; if (open) { const b = el.querySelector(`[data-chat="${CSS.escape(open)}"]`); if (b) b.setAttribute("aria-expanded", "false"); const p = $("#chat-" + CSS.escape(open), el); if (p) { p.hidden = true; p.innerHTML = ""; } } open = null; };

  const over = (s) => s.cancelled || now() >= s.starts + s.minutes * 60;
  const row = (s) => {
    const mine = u && u.id === s.host.id, tag = soon(s);
    // Past sessions are a record: no RSVP, no Join, no Cancel.
    if (over(s)) return `<article class="ses past" id="${esc(s.id)}"><p class="ses-when"><time datetime="${new Date(s.starts * 1000).toISOString()}">${esc(when(s))}</time><span class="dot"></span>${s.cancelled ? "Cancelled" : "Ended"}</p><h2>${esc(s.title)}</h2><p class="ses-host"><a href="/u/${esc(s.host.id)}">${userAvatar(s.host, "s")}<b>${esc(s.host.name)}</b></a>${badges(s.host)}</p></article>`;
    return `<article class="ses${s.cancelled ? " off" : ""}" id="${esc(s.id)}">
      <p class="ses-when"><time datetime="${new Date(s.starts * 1000).toISOString()}">${esc(when(s))}</time><span class="dot"></span>${s.minutes} min${tag ? `<span class="dot"></span><b class="${live(s) ? "now" : ""}">${tag}</b>${mine ? `<span class="dot"></span><span>You're hosting</span>` : ""}` : ""}</p>
      <h2>${esc(s.title)}</h2>
      ${s.about ? `<p class="ses-about">${esc(s.about)}</p>` : ""}
      <p class="ses-host"><a href="/u/${esc(s.host.id)}">${userAvatar(s.host, "s")}<b>${esc(s.host.name)}</b></a>${badges(s.host)}<span class="dot"></span><span>${s.going} going</span></p>
      ${s.cancelled ? "" : `<div class="acts">
        ${live(s) ? `<a class="btn primary" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${icon("ext")}${mine ? "Start session" : "Join"}</a>` : ""}
        ${live(s) || mine ? "" : s.mine ? `<button class="btn going" type="button" data-unrsvp="${esc(s.id)}" aria-pressed="true">${icon("check")}Going</button>` : `<button class="btn" type="button" data-rsvp="${esc(s.id)}">RSVP</button>`}
        <button class="btn" type="button" data-chat="${esc(s.id)}" aria-expanded="false" aria-controls="chat-${esc(s.id)}">${icon("chat")}Chat</button>
        ${mine || can("mod") ? `<button class="textbtn danger ses-cancel" type="button" data-cancel="${esc(s.id)}">Cancel session</button>` : ""}
      </div>
      <div class="ses-chat" id="chat-${esc(s.id)}" hidden></div>`}
    </article>`;
  };
  // Live and upcoming first, soonest at the top; past ones folded below, newest first.
  const render = () => {
    const up = sessions.filter((s) => !over(s)).sort((a, b) => a.starts - b.starts);
    const past = sessions.filter(over).sort((a, b) => b.starts - a.starts);
    const empty = `<div class="empty-card"><h2>Nothing scheduled yet</h2><p>${host ? "Host the first session: it shows up here for everyone." : "Professors and tutors post sessions here. Check back soon."}</p></div>`;
    return (up.length ? up.map(row).join("") : empty) + (past.length ? `<details class="ses-past"><summary>Past sessions (${past.length})</summary>${past.map(row).join("")}</details>` : "");
  };
  const load = async () => {
    closeChat();
    try {
      sessions = (await api("/api/sessions")).sessions;
      list.innerHTML = render();
      const h = decodeURIComponent(location.hash.slice(1));
      const t = h && document.getElementById(h);
      if (t && list.contains(t)) { t.classList.add("hl"); t.scrollIntoView({ block: "center" }); }
    } catch (e) { list.innerHTML = `<div class="empty"><p>Sessions didn't load.</p></div>`; toast(e.message); }
  };
  const form = $("#hostForm", el);
  if (form) bindHost(form, load);
  await load();
  // Refresh the "Live now" and Join state every minute without refetching.
  const tick = setInterval(() => { if (!open) list.innerHTML = render(); }, 60000);

  const need = () => { toast("Get your free code first. It takes one tap."); go("/me"); };
  const offs = [
    on(list, "[data-rsvp],[data-unrsvp]", (b) => {
      if (!signedIn()) return need();
      const id = b.dataset.rsvp || b.dataset.unrsvp, act = b.dataset.rsvp ? "rsvp" : "unrsvp";
      busy(b, async () => { await api(`/api/sessions/${encodeURIComponent(id)}/${act}`, { method: "POST" }); toast(act === "rsvp" ? "You're going" : "RSVP cancelled"); await load(); });
    }),
    on(list, "[data-cancel]", (b) => {
      if (!confirm("Cancel this session for everyone who RSVP'd?")) return;
      busy(b, async () => { await api(`/api/sessions/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: "POST" }); toast("Session cancelled"); await load(); });
    }),
    on(list, "[data-chat]", (b) => {
      const id = b.dataset.chat, was = open === id;
      closeChat();
      if (was) return;
      open = id; b.setAttribute("aria-expanded", "true");
      const p = $("#chat-" + CSS.escape(id), el); p.hidden = false;
      stopChat = mountChat(p, "s-" + id, { compact: true });
    }),
  ];
  return () => { clearInterval(tick); closeChat(); offs.forEach((f) => f()); };
}
