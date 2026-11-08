// /u/<id>: a learner's public page. Professors and admins can name tutors from here.
import { api, user, can } from "../account.js";
import { esc, toast, badges, userAvatar, ago } from "../ui.js";
import { setTitle, cssReady, loader, fmtDate, busy, go, itemHref, itemLabel, linkChips } from "./_shared.js";

const ROLE = { contributor: "Contributor", mod: "Moderator", admin: "Admin", owner: "Founder" };

export async function render(el, qs, parts) {
  await cssReady;
  const id = parts[1] || "";
  el.innerHTML = loader();
  let d;
  try { d = await api("/api/u/" + encodeURIComponent(id)); }
  catch (e) {
    setTitle("Not found");
    el.innerHTML = `<div class="empty"><h1 style="font-size:28px;color:var(--fg)">No such learner.</h1><p style="margin:12px 0 24px">They may have left, or the link is wrong.</p><a class="btn primary" href="/">Go home</a></div>`;
    return null;
  }
  const u = d.user, me = user(), self = me && me.id === u.id;
  setTitle(u.name);
  const roles = [ROLE[u.role], u.teach && u.teach[0].toUpperCase() + u.teach.slice(1), u.verified && "Verified"].filter(Boolean);
  // Admins set any teaching role; professors add or remove tutors (not other professors, not themselves).
  const teachBtn = !self && me && (can("admin") || (me.teach === "professor" && u.teach !== "professor"))
    ? (u.teach === "tutor" ? `<button class="textbtn" type="button" data-teach="">Remove tutor</button>` : !u.teach ? `<button class="btn" type="button" data-teach="tutor">Make tutor</button>` : "") : "";
  el.innerHTML = `<div class="pg pg-profile">
    <header class="prof-h">${userAvatar(u, "l")}
      <div class="me-id"><h1>${esc(u.name)}${badges(u)}</h1>
        <p class="muted">${roles.length ? esc(roles.join(", ")) + '<span class="dot"></span>' : ""}Joined ${fmtDate(u.created, { month: "long", year: "numeric" })}</p>
        ${linkChips(d.links)}
        <p class="prof-stats"><span><b class="mono">${d.likes}</b> likes</span><span><b class="mono">${d.referrals}</b> referred</span><span><b class="mono">${d.comments.length}</b> recent comments</span></p>
      </div>
    </header>
    ${self || teachBtn ? `<div class="acts prof-acts">${self ? `<a class="btn" href="/me">Edit your profile</a>` : ""}${teachBtn}</div>` : ""}
    <section class="set" aria-labelledby="rcH"><h2 class="set-h" id="rcH">Recent comments</h2>
      ${d.comments.length ? `<ul class="rows prof-cmts">${d.comments.map((c) => { const h = itemHref(c.item); return `<li><p class="muted pc-h">On ${h ? `<a class="link" href="${esc(h)}">${itemLabel(c.item)}</a>` : itemLabel(c.item)}<span class="dot"></span>${ago(c.ts)}</p><p class="pc-b">${esc(c.body)}</p></li>`; }).join("")}</ul>`
        : `<p class="muted empty-row">No comments yet.</p>`}
    </section>
  </div>`;
  const b = el.querySelector("[data-teach]");
  if (b) b.onclick = () => {
    const t = b.dataset.teach;
    if (!confirm(t ? `Make ${u.name} a tutor? Tutors can host live sessions.` : `Remove ${u.name} as a tutor?`)) return;
    busy(b, async () => { await api("/api/teach/" + encodeURIComponent(u.id), { method: "POST", body: { teach: t } }); toast(t ? "Now a tutor" : "Tutor role removed"); go(location.pathname, true); });
  };
  return null;
}
