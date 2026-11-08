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
        <p class="prof-stats"><span><b>${d.likes}</b> like${d.likes === 1 ? "" : "s"}</span><span><b>${d.referrals}</b> invited</span><span><b>${d.comments.length}</b> comment${d.comments.length === 1 ? "" : "s"}</span></p>
      </div>
    </header>
    <div id="profFeed"></div>
    ${self || teachBtn ? `<div class="acts prof-acts">${self ? `<a class="btn" href="/me">Edit your profile</a>` : ""}${teachBtn}</div>` : ""}
    <section class="set" aria-labelledby="rcH"><h2 class="set-h" id="rcH">Recent comments</h2>
      ${d.comments.length ? `<ul class="rows prof-cmts">${d.comments.map((c) => { const h = itemHref(c.item); return `<li><p class="muted pc-h">On ${h ? `<a class="link" href="${esc(h)}">${itemLabel(c.item)}</a>` : itemLabel(c.item)}<span class="dot"></span>${ago(c.ts)}</p><p class="pc-b">${esc(c.body)}</p></li>`; }).join("")}</ul>`
        : `<p class="muted empty-row">No comments yet.</p>`}
    </section>
  </div>`;
  if (u.verified && (d.links.x || d.links.youtube || d.links.github)) showFeed(el.querySelector("#profFeed"), u, d.links);
  const b = el.querySelector("[data-teach]");
  if (b) b.onclick = () => {
    const t = b.dataset.teach;
    if (!confirm(t ? `Make ${u.name} a tutor? Tutors can host live sessions.` : `Remove ${u.name} as a tutor?`)) return;
    busy(b, async () => { await api("/api/teach/" + encodeURIComponent(u.id), { method: "POST", body: { teach: t } }); toast(t ? "Now a tutor" : "Tutor role removed"); go(location.pathname, true); });
  };
  return null;
}

// Latest posts on X and uploads on YouTube, for verified members. Loads after the page so it never holds it up.
async function showFeed(box, u, links) {
  let f;
  try { f = await api("/api/u/" + encodeURIComponent(u.id) + "/feed"); } catch { return; }
  if (!box.isConnected) return;
  const vids = f.videos.length ? `<section class="set" aria-labelledby="pfV"><h2 class="set-h" id="pfV">Latest on YouTube</h2>
    <ul class="pf-vids">${f.videos.map((v) => `<li><a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy"><b>${esc(v.title)}</b><span class="muted">${ago(v.ts)}</span></a></li>`).join("")}</ul></section>` : "";
  const posts = f.posts.length ? `<section class="set" aria-labelledby="pfX"><h2 class="set-h" id="pfX">Latest on X</h2>
    <ul class="rows pf-posts">${f.posts.map((p) => `<li><a class="pf-post" href="https://x.com/${esc(links.x)}/status/${esc(p.id)}" target="_blank" rel="noopener"><p class="pc-b">${esc(p.text)}</p>${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : ""}<p class="muted pc-h">@${esc(links.x)}<span class="dot"></span>${ago(p.ts)}</p></a></li>`).join("")}</ul></section>` : "";
  const repos = (f.repos || []).length ? `<section class="set" aria-labelledby="pfG"><h2 class="set-h" id="pfG">On GitHub</h2>
    <ul class="pf-repos">${f.repos.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name)}</b>${r.desc && r.desc.trim() ? `<span>${esc(r.desc.trim())}</span>` : ""}<small class="muted">${r.lang ? esc(r.lang) + '<span class="dot"></span>' : ""}${r.stars ? `${r.stars} star${r.stars === 1 ? "" : "s"}<span class="dot"></span>` : ""}updated ${ago(r.ts)}</small></a></li>`).join("")}</ul></section>` : "";
  box.innerHTML = posts + vids + repos;
}
