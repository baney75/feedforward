// /admin: one calm place for staff. Owners and admins get the whole page; moderators get the overview,
// reports, the skills queue and bans for people below them. Controls appear only where the API allows them:
// the owner names admins; admins name mods and contributors, set verified and set teaching roles;
// mods ban people below them. Professors name tutors at /teach. Every destructive action asks first.
import { api, user, can, refreshMe, RANK } from "../account.js";
import { TOPICS } from "../data.js";
import { esc, toast, badges, userAvatar, ago } from "../ui.js";
import { $, SITE, setTitle, cssReady, loader, copy, go, fmtDate, on, busy, itemHref, itemLabel } from "./_shared.js";

const TABS = [["applications", "Applications"], ["people", "People"], ["catalog", "Catalog", "admin"], ["reports", "Reports"], ["skills", "Skills"], ["suggestions", "Suggestions", "admin"], ["invites", "Invites"], ["log", "Log", "admin"]];
const ROLE = { user: "Learner", contributor: "Contributor", mod: "Moderator", admin: "Admin", owner: "Founder" };
const ACTION = { ban: "banned", unban: "unbanned", verify: "verified", unverify: "removed verified from", "remove-avatar": "removed the photo of",
  "hide-comment": "hid comment", "unhide-comment": "unhid comment", "delete-comment": "deleted comment", "cancel-session": "cancelled session", invite: "made invite", "invite:verified": "made verified invite",
  "add-person": "added to the catalog:", "remove-person": "removed from the catalog:" };
const say = (a) => ACTION[a] || a.replace(/^role:(\w+)$/, (_, r) => "made " + (ROLE[r] || r) + ":").replace(/^teach:(\w+)$/, (_, t) => (t === "none" ? "removed teaching role from" : "made " + t + ":")).replace(/^(skill|suggestion):(\w+)$/, "$2 $1");

export async function render(el, qs) {
  await cssReady;
  try { await refreshMe(); } catch {}
  if (!can("mod")) { toast(user() ? "Staff only." : "Sign in first."); go("/me", true); return null; }
  const me = user(), admin = can("admin");
  setTitle(admin ? "Admin" : "Moderation");
  // Moderators see reports first; admins see people first.
  const tabs = TABS.filter((t) => !t[2] || can(t[2])).sort((a, b) => (admin ? 0 : (a[0] === "reports" ? -1 : b[0] === "reports" ? 1 : 0)));
  let tab = tabs.some((t) => t[0] === qs.get("tab")) ? qs.get("tab") : tabs[0][0];
  el.innerHTML = `<div class="pg pg-admin">
    <header class="page-h"><div><h1>${admin ? "Admin" : "Moderation"}</h1><p>${admin ? "Run the community and the catalog." : "Keep comments, chat and skills kind and on topic."} You can act on people below your role (${esc(ROLE[me.role] || me.role)}).</p></div></header>
    <section class="pulse" id="pulse" aria-label="Overview">${loader()}</section>
    <div class="tabs admin-tabs" role="group" aria-label="Sections">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join("")}</div>
    <div id="pane"></div>
  </div>`;
  const pane = $("#pane", el);
  let offPane = null, seq = 0;
  // Each tab renders into its own box, so a slow tab that finishes late paints into a detached node.
  const show = async () => {
    if (offPane) offPane(); offPane = null;
    const my = ++seq, box = document.createElement("div");
    box.innerHTML = loader();
    pane.replaceChildren(box);
    try {
      const off = await PANES[tab](box, me);
      if (my === seq) offPane = off; else if (typeof off === "function") off();
    } catch (e) { if (my === seq) { box.innerHTML = `<div class="empty"><p>This didn't load.</p></div>`; toast(e.message); } }
  };
  const pick = (k) => {
    if (!tabs.some((t) => t[0] === k)) return;
    tab = k;
    el.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.tab === k));
    history.replaceState(null, "", "/admin?tab=" + tab);
    show();
  };
  const offs = [on(el, "[data-tab]", (b) => pick(b.dataset.tab)), on(el, "[data-goto]", (b) => { pick(b.dataset.goto); $(".admin-tabs", el).scrollIntoView({ block: "start", behavior: "smooth" }); })];
  overview($("#pulse", el), admin);
  await show();
  return () => { offs.forEach((f) => f()); if (offPane) offPane(); };
}

// The numbers staff act on, first. Work waiting is marked; a zero stays quiet.
async function overview(box, admin) {
  const [pulse, feed, skills, sessions, apps] = await Promise.all([
    fetch("/api/pulse").then((r) => r.json()).catch(() => ({})),
    api("/api/admin/feed").catch(() => ({ comments: [], suggestions: [] })),
    api("/api/skills").catch(() => ({ skills: [] })),
    api("/api/sessions").catch(() => ({ sessions: [] })),
    api("/api/admin/applications").catch(() => ({ applications: [] })),
  ]);
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const t0 = day.getTime() / 1000, t1 = t0 + 86400;
  const stats = [
    ["Applications waiting", apps.applications.filter((a) => a.status === "pending").length, "applications", true],
    ["Learners", pulse.learners ?? "?", "people", false],
    ["Reported comments", feed.comments.filter((c) => c.reports > 0).length, "reports", true],
    ["Skills waiting", skills.skills.filter((s) => s.status === "pending").length, "skills", true],
    admin ? ["Open suggestions", feed.suggestions.filter((s) => s.status === "open").length, "suggestions", true] : null,
    ["Sessions today", sessions.sessions.filter((s) => !s.cancelled && s.starts >= t0 && s.starts < t1).length, "", false],
  ].filter(Boolean);
  box.innerHTML = stats.map(([label, n, tab, work]) => {
    const due = work && n > 0;
    const inner = `<b class="mono">${esc(String(n))}</b><span>${label}</span>`;
    return tab ? `<button type="button" class="stat${due ? " due" : ""}" data-goto="${tab}" aria-label="${esc(label)}: ${esc(String(n))}${due ? ", needs a look" : ""}">${inner}</button>` : `<div class="stat">${inner}</div>`;
  }).join("");
}

const R = (role) => RANK[role] || 0;
const post = (path, body) => api(path, { method: "POST", body });

// ---------- People ----------
async function people(pane, me) {
  pane.innerHTML = `<form class="inline search-row" id="pq" role="search"><label class="sr-only" for="pqIn">Search people by name or id</label>
    <input class="input" id="pqIn" type="search" placeholder="Search by name or id" autocomplete="off"><button class="btn" type="submit">Find</button></form>
    <ul class="rows people-list" id="pl">${loader()}</ul>`;
  const pl = $("#pl", pane);
  let users = [];
  const above = (t) => R(t.role) < R(me.role) && t.id !== me.id;
  const roleOpts = (t) => (can("admin") && above(t) ? ["user", "contributor", "mod", "admin"].filter((r) => R(r) < R(me.role)) : []);
  const teachOpts = (t) => (t.banned || !can("admin") ? [] : ["", "tutor", "professor"]);
  const row = (t) => {
    const roles = roleOpts(t), teach = teachOpts(t), ver = can("admin") && above(t), ban = above(t), rmav = above(t) && t.avatar;
    const any = roles.length || teach.length || ver || ban;
    return `<li class="person" data-uid="${esc(t.id)}">
      <div class="person-top">${userAvatar(t, "s")}
        <div class="person-t"><span><a href="/u/${esc(t.id)}"><b>${esc(t.name)}</b></a>${badges(t)}${t.banned ? ` <span class="kind bad">Banned</span>` : ""}</span>
        <span class="muted"><span class="mono">${esc(t.id)}</span>${t.comments ? `<span class="dot"></span>${t.comments} comment${t.comments > 1 ? "s" : ""}` : ""}${t.referrals ? `<span class="dot"></span>${t.referrals} referred` : ""}<span class="dot"></span>${fmtDate(t.created, { month: "short", year: "numeric" })}</span></div>
        ${any ? `<button class="textbtn" type="button" data-manage aria-expanded="false" aria-controls="ctl-${esc(t.id)}">Manage</button>` : ""}
      </div>
      ${any ? `<div class="person-ctl" id="ctl-${esc(t.id)}" hidden>
        ${roles.length ? `<label class="field">Role<select class="input" data-role>${roles.map((r) => `<option value="${r}"${r === t.role ? " selected" : ""}>${ROLE[r]}</option>`).join("")}</select></label>` : ""}
        ${teach.length ? `<label class="field">Teaching<select class="input" data-teach>${teach.map((r) => `<option value="${r}"${r === (t.teach || "") ? " selected" : ""}>${r ? r[0].toUpperCase() + r.slice(1) : "None"}</option>`).join("")}${t.teach && !teach.includes(t.teach) ? `<option selected disabled>${esc(t.teach)}</option>` : ""}</select></label>` : ""}
        <div class="ctl-acts">
          ${ver ? `<label class="toggle"><input type="checkbox" data-verified${t.verified ? " checked" : ""}>Verified</label>` : ""}
          ${rmav ? `<button class="textbtn" type="button" data-rmav>Remove photo</button>` : ""}
          ${ban ? `<button class="textbtn${t.banned ? "" : " danger"}" type="button" data-ban="${t.banned ? 0 : 1}">${t.banned ? "Unban" : "Ban"}</button>` : ""}
        </div>
      </div>` : ""}
    </li>`;
  };
  let loads = 0;
  const load = async (q = "") => {
    // A slow earlier load must not overwrite a newer search.
    const my = ++loads, got = (await api("/api/admin/users?q=" + encodeURIComponent(q))).users;
    if (my !== loads) return;
    users = got;
    pl.innerHTML = users.map(row).join("") || `<li class="muted empty-row">Nobody matches.</li>`;
  };
  $("#pq", pane).onsubmit = (e) => { e.preventDefault(); busy(e.submitter, () => load($("#pqIn", pane).value.trim())); };
  await load();
  const who = (li) => users.find((x) => x.id === li.dataset.uid);
  const redo = async (li) => { const q = $("#pqIn", pane).value.trim(); await load(q); const n = pl.querySelector(`[data-uid="${CSS.escape(li.dataset.uid)}"]`); if (n) { n.querySelector("[data-manage]")?.click(); } };
  const offs = [
    on(pl, "[data-manage]", (b) => { const c = b.closest(".person").querySelector(".person-ctl"); c.hidden = !c.hidden; b.setAttribute("aria-expanded", !c.hidden); }),
    on(pl, "[data-role]", (s) => {
      const li = s.closest(".person"), t = who(li);
      if (!confirm(`Make ${t.name} a ${ROLE[s.value]}?`)) { s.value = t.role; return; }
      busy(s, async () => { await post("/api/admin/users/" + t.id, { role: s.value }); toast("Role changed"); await redo(li); });
    }, "change"),
    on(pl, "[data-teach]", (s) => {
      const li = s.closest(".person"), t = who(li);
      if (!confirm(s.value ? `Make ${t.name} a ${s.value}? They'll be able to host live sessions.` : `Remove ${t.name}'s teaching role?`)) { s.value = t.teach || ""; return; }
      busy(s, async () => { await post("/api/teach/" + t.id, { teach: s.value }); toast("Teaching role changed"); await redo(li); });
    }, "change"),
    on(pl, "[data-verified]", (c) => {
      const li = c.closest(".person"), t = who(li);
      if (!confirm(c.checked ? `Give ${t.name} the verified check?` : `Remove ${t.name}'s verified check?`)) { c.checked = !c.checked; return; }
      busy(c, async () => { await post("/api/admin/users/" + t.id, { verified: c.checked }); toast("Saved"); await redo(li); });
    }, "change"),
    on(pl, "[data-ban]", (b) => {
      const li = b.closest(".person"), t = who(li), banning = b.dataset.ban === "1";
      if (!confirm(banning ? `Ban ${t.name}? They're signed out everywhere, kicked from chat, and their comments are hidden.` : `Unban ${t.name}?`)) return;
      busy(b, async () => { await post("/api/admin/users/" + t.id, { banned: banning }); toast(banning ? "Banned" : "Unbanned"); await redo(li); });
    }),
    on(pl, "[data-rmav]", (b) => {
      const li = b.closest(".person"), t = who(li);
      if (!confirm(`Remove ${t.name}'s photo? This can't be undone.`)) return;
      busy(b, async () => { await post("/api/admin/users/" + t.id, { removeAvatar: true }); toast("Photo removed"); await redo(li); });
    }),
  ];
  return () => offs.forEach((f) => f());
}

// ---------- Reports ----------
async function reports(pane, me) {
  const load = async () => {
    const { comments: cs } = await api("/api/admin/feed");
    pane.innerHTML = cs.length ? `<p class="hint top">Reported comments come first. Three reports hide a comment until a moderator looks.</p><ul class="rows">${cs.map((c) => {
      const href = itemHref(c.item), del = R(me.role) > R(c.user.role) || c.user.id === me.id;
      return `<li class="cmt${c.hidden ? " hidden-c" : ""}" data-cid="${esc(c.id)}">${userAvatar(c.user, "s")}<div style="min-width:0">
        <div class="cmt-h"><a href="/u/${esc(c.user.id)}"><b>${esc(c.user.name)}</b></a>${badges(c.user)}<span class="muted">${ago(c.ts, true)}</span>
          <span class="muted">on ${href ? `<a class="link" href="${esc(href)}">${itemLabel(c.item)}</a>` : itemLabel(c.item)}</span>
          ${c.reports ? `<span class="kind bad">${c.reports} report${c.reports > 1 ? "s" : ""}</span>` : ""}${c.hidden ? `<span class="kind">Hidden</span>` : ""}</div>
        <p>${esc(c.body)}</p>
        <div class="cmt-a"><button type="button" data-hide="${c.hidden ? "unhide" : "hide"}">${c.hidden ? "Unhide" : "Hide"}</button>${del ? `<button type="button" class="danger" data-del>Delete</button>` : ""}</div></div></li>`;
    }).join("")}</ul>` : `<div class="empty"><p>No comments yet.</p></div>`;
  };
  await load();
  const offs = [
    on(pane, "[data-hide]", (b) => busy(b, async () => { await post(`/api/comments/${b.closest("[data-cid]").dataset.cid}/${b.dataset.hide}`); toast(b.dataset.hide === "hide" ? "Hidden" : "Visible again"); await load(); })),
    on(pane, "[data-del]", (b) => {
      if (!confirm("Delete this comment for good?")) return;
      busy(b, async () => { await api("/api/comments/" + b.closest("[data-cid]").dataset.cid, { method: "DELETE" }); toast("Deleted"); await load(); });
    }),
  ];
  return () => offs.forEach((f) => f());
}

// ---------- Suggestions ----------
async function suggestions(pane) {
  const load = async () => {
    const { suggestions: ss } = await api("/api/admin/feed");
    pane.innerHTML = ss.length ? `${can("admin") ? "" : `<p class="hint top">Admins approve suggestions.</p>`}<ul class="rows">${ss.map((s) => `<li class="sug" data-sid="${esc(s.id)}">
      <p class="sug-h"><span class="kind">${esc(s.kind)}</span><span class="muted">${esc(s.name || "Learner")}<span class="dot"></span>${ago(s.ts, true)}</span>${s.status !== "open" ? `<span class="kind">${esc(s.status)}</span>` : ""}</p>
      <p class="sug-b">${esc(s.body)}</p>
      ${s.url ? `<p><a class="link mono sug-url" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.url.replace(/^https:\/\//, ""))}</a></p>` : ""}
      ${can("admin") && s.status === "open" ? `<div class="acts"><button class="btn sm" type="button" data-st="approved">Approve</button><button class="textbtn danger" type="button" data-st="declined">Decline</button></div>` : ""}
    </li>`).join("")}</ul>` : `<div class="empty"><p>No suggestions yet.</p></div>`;
  };
  await load();
  return on(pane, "[data-st]", (b) => {
    if (b.dataset.st === "declined" && !confirm("Decline this suggestion?")) return;
    busy(b, async () => { await post("/api/admin/suggestions/" + b.closest("[data-sid]").dataset.sid, { status: b.dataset.st }); toast(b.dataset.st === "approved" ? "Approved" : "Declined"); await load(); });
  });
}

// ---------- Skills queue ----------
async function skills(pane) {
  const load = async () => {
    const pend = (await api("/api/skills")).skills.filter((s) => s.status === "pending");
    pane.innerHTML = pend.length ? `<ul class="rows">${pend.map((s) => `<li class="qrow"><div class="qrow-t"><a href="/skills?id=${esc(s.id)}"><b class="mono">${esc(s.name)}</b></a><span class="muted">${esc(s.summary)} · ${esc(s.by.name)}</span></div>
      <div class="acts"><a class="btn sm" href="/skills?id=${esc(s.id)}">Read</a><button class="btn sm" type="button" data-act="approve" data-id="${esc(s.id)}">Approve</button><button class="textbtn danger" type="button" data-act="decline" data-id="${esc(s.id)}">Decline</button></div></li>`).join("")}</ul>`
      : `<div class="empty"><p>No skills are waiting.</p></div>`;
  };
  await load();
  return on(pane, "[data-act]", (b) => {
    if (b.dataset.act === "decline" && !confirm("Decline this skill?")) return;
    busy(b, async () => { await post(`/api/skills/${encodeURIComponent(b.dataset.id)}/${b.dataset.act}`); toast(b.dataset.act === "approve" ? "Published" : "Declined"); await load(); });
  });
}

// ---------- Applications ----------
// Newest pending first. Approving makes the account on the spot; the applicant's own code signs them in.
async function applications(pane) {
  const load = async () => {
    const { applications: list } = await api("/api/admin/applications");
    const linkOf = (l) => [l.x && `<a class="link" href="https://x.com/${esc(l.x)}" target="_blank" rel="noopener noreferrer">@${esc(l.x)}</a>`, l.github && `<a class="link" href="https://github.com/${esc(l.github)}" target="_blank" rel="noopener noreferrer">github.com/${esc(l.github)}</a>`].filter(Boolean).join('<span class="dot"></span>');
    pane.innerHTML = list.length ? `<ul class="rows">${list.map((a) => `<li class="sug" data-aid="${esc(a.id)}">
      <p class="sug-h"><b>${esc(a.name)}</b><span class="muted">${ago(a.created, true)}${linkOf(a.links) ? '<span class="dot"></span>' + linkOf(a.links) : ""}</span>${a.status !== "pending" ? `<span class="kind">${esc(a.status)}${a.decider ? " by " + esc(a.decider) : ""}</span>` : ""}</p>
      <p class="sug-b">${esc(a.reason)}</p>
      ${a.status === "pending" ? `<div class="acts"><button class="btn sm primary" type="button" data-dec="approve">Approve</button><button class="textbtn danger" type="button" data-dec="deny">Deny</button></div>` : ""}
    </li>`).join("")}</ul>` : `<div class="empty"><p>No applications yet.</p></div>`;
  };
  await load();
  return on(pane, "[data-dec]", (b) => {
    const row = b.closest("[data-aid]");
    if (b.dataset.dec === "deny" && !confirm("Deny this application?")) return;
    busy(b, async () => { await post("/api/admin/applications/" + row.dataset.aid, { decision: b.dataset.dec }); toast(b.dataset.dec === "approve" ? "Approved. Their code works now." : "Denied"); await load(); });
  });
}

// ---------- Invites ----------
// An invite can carry permissions: a role below the maker's own, and (admins) a teaching role and the check.
const GRANTABLE = ["user", "contributor", "mod", "admin"];
const ROLE_LABEL = { user: "Member", contributor: "Contributor", mod: "Moderator", admin: "Admin" };
async function invites(pane, me) {
  const myRank = R(me.role), isAdmin = myRank >= R("admin");
  const roles = GRANTABLE.filter((r) => R(r) < myRank || r === "user");
  pane.innerHTML = `<form class="form inv-form" id="invForm">
      <label class="field">Note <span class="opt">optional, only staff see it</span><input class="input" name="note" maxlength="80" placeholder="Launch day, Discord"></label>
      <div class="two">
        <label class="field">Joins as<select class="input" name="role">${roles.map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join("")}</select></label>
        ${isAdmin ? `<label class="field">Teaching role<select class="input" name="teach"><option value="">None</option><option value="tutor">Tutor</option><option value="professor">Professor</option></select></label>` : ""}
      </div>
      <div class="two"><label class="field">Uses <span class="opt" id="usesHint">0 is no limit</span><input class="input" name="max_uses" type="number" min="0" max="10000" value="1"></label>
      <label class="field">Expires in days <span class="opt">0 never</span><input class="input" name="days" type="number" min="0" max="365" value="14"></label></div>
      ${isAdmin ? `<label class="toggle inv-ver"><input type="checkbox" name="verified">Verified: everyone who joins gets the check</label>` : ""}
      <div class="acts"><button class="btn primary" type="submit">Make invite link</button></div>
    </form><ul class="rows" id="invList"></ul>`;
  const list = $("#invList", pane);
  const load = async () => {
    const { invites: inv } = await api("/api/admin/feed");
    list.innerHTML = inv.map((i) => `<li class="inv${i.disabled ? " off" : ""}" data-inv="${esc(i.code)}"><div class="inv-t"><span class="mono">/join/${esc(i.code)}</span>
      <span class="muted">${i.disabled ? "Off<span class=\"dot\"></span>" : ""}${i.role && i.role !== "user" ? esc(ROLE_LABEL[i.role] || i.role) + '<span class="dot"></span>' : ""}${i.teach ? esc(i.teach) + '<span class="dot"></span>' : ""}${i.verified ? "Verified<span class=\"dot\"></span>" : ""}${i.expires ? (i.expires * 1000 < Date.now() ? "Expired" : "Expires " + fmtDate(i.expires, { month: "short", day: "numeric" })) + '<span class="dot"></span>' : ""}${i.uses} used${i.note ? `<span class="dot"></span>${esc(i.note)}` : ""}</span></div>
      <div class="inv-acts"><label class="inv-uses"><span class="sr-only">Total uses for /join/${esc(i.code)}, 0 for no limit</span><input class="input mono" type="number" min="0" max="10000" value="${i.max_uses}" data-uses aria-describedby="usesHint"><span class="muted">uses</span></label>
      <button class="btn sm" type="button" data-toggle="${i.disabled ? "on" : "off"}">${i.disabled ? "Turn on" : "Turn off"}</button>
      <button class="btn sm" type="button" data-copy="${esc(SITE + "/join/" + i.code)}"${i.disabled ? " disabled" : ""}>Copy</button></div></li>`).join("") || `<li class="muted empty-row">No invites yet.</li>`;
  };
  $("#invForm", pane).onsubmit = (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy(e.submitter, async () => {
      const d = await post("/api/admin/invites", { note: f.note.value, max_uses: +f.max_uses.value || 0, days: +f.days.value || 0, role: f.role.value, teach: f.teach ? f.teach.value : "", verified: !!(f.verified && f.verified.checked) });
      f.reset(); await load(); copy(`${SITE}/join/${d.code}`, "Invite link made and copied");
    });
  };
  await load();
  const save = (row, body, done) => post("/api/admin/invites/" + row.dataset.inv, body).then(() => { toast(done); return load(); }).catch((e) => toast(e.message));
  // Total uses save when the field changes (0 means no limit).
  list.addEventListener("change", (e) => { const f = e.target.closest("[data-uses]"); if (f) save(f.closest("[data-inv]"), { max_uses: +f.value || 0 }, +f.value ? `Limit set to ${+f.value}` : "No limit"); });
  const offs = [
    on(list, "[data-copy]", (b) => copy(b.dataset.copy, "Link copied")),
    on(list, "[data-toggle]", (b) => { const off = b.dataset.toggle === "off"; if (off && !confirm("Turn this invite link off? Nobody can join with it until you turn it back on.")) return; busy(b, () => save(b.closest("[data-inv]"), { disabled: off }, off ? "Invite link turned off" : "Invite link is on again")); }),
  ];
  return () => offs.forEach((f) => f());
}

// ---------- Log ----------
async function log(pane) {
  const { log: rows } = await api("/api/admin/feed");
  pane.innerHTML = rows.length ? `<ul class="rows log">${rows.map((r) => `<li><span><b>${esc(r.name || "Someone")}</b> ${esc(say(r.action))} <span class="mono">${esc(r.target)}</span></span><span class="muted mono">${ago(r.ts, true)}</span></li>`).join("")}</ul>`
    : `<div class="empty"><p>Nothing logged yet.</p></div>`;
  return null;
}

// ---------- Catalog: people added at runtime ----------
async function catalog(pane) {
  pane.innerHTML = `<details class="host" open><summary><span>Add a person to Feedforward</span></summary>
      <form class="form" id="addP">
        <div class="two"><label class="field">Name<input class="input" name="name" maxlength="60" required placeholder="Andrej Karpathy"></label>
        <label class="field">Topic<select class="input" name="topic" required>${TOPICS.map((t) => `<option value="${t.code}">${esc(t.label)}</option>`).join("")}</select></label></div>
        <label class="field">Why they're worth learning from<input class="input" name="why" maxlength="160" required placeholder="One line, like: Builds neural nets from scratch and explains every step."></label>
        <div class="two even"><label class="field">X handle<input class="input" name="x" maxlength="60" placeholder="karpathy" autocapitalize="none" spellcheck="false"></label>
        <label class="field">YouTube<input class="input" name="yt" maxlength="80" placeholder="@AndrejKarpathy" autocapitalize="none" spellcheck="false"></label></div>
        <fieldset class="field plain"><legend>Which videos</legend>
          <label class="toggle"><input type="radio" name="mode" value="ai" checked>Only their AI and computer science videos</label>
          <label class="toggle"><input type="radio" name="mode" value="all">Everything they post, because it's all on topic</label></fieldset>
        <p class="hint">Add an X handle, a YouTube channel or both. The feed starts following them right away.</p>
        <div class="acts"><button class="btn primary" type="submit">Add person</button></div>
      </form></details>
    <h2 class="set-h">Added here</h2><ul class="rows" id="xl"></ul>`;
  const list = $("#xl", pane);
  const load = async () => {
    const { people } = await fetch("/api/people/extra", { cache: "no-store" }).then((r) => r.json());
    list.innerHTML = people.map((p) => `<li class="xp"><div class="xp-t"><b>${esc(p.name)}</b><span class="muted">${esc((TOPICS.find((t) => t.code === p.topic) || {}).label || p.topic)}${p.x ? `<span class="dot"></span>@${esc(p.x)}` : ""}${p.yt ? `<span class="dot"></span>${esc(p.yt)}` : ""}<span class="dot"></span>${p.mode === "all" ? "everything" : "AI only"}</span><span class="xp-why">${esc(p.why)}</span></div>
      <button class="textbtn danger" type="button" data-rm="${esc(p.slug)}" data-name="${esc(p.name)}">Remove</button></li>`).join("") || `<li class="muted empty-row">Nobody added here yet. The main list lives in data/roster.json.</li>`;
  };
  $("#addP", pane).onsubmit = (e) => {
    e.preventDefault();
    const f = e.currentTarget, b = Object.fromEntries(new FormData(f));
    if (!b.x.trim() && !b.yt.trim()) return toast("Add an X handle or a YouTube channel.");
    busy(e.submitter, async () => { await post("/api/admin/people", b); toast(`${b.name} added`); f.reset(); await load(); });
  };
  await load();
  return on(list, "[data-rm]", (b) => {
    if (!confirm(`Remove ${b.dataset.name} from Feedforward? Their videos and posts leave the feed.`)) return;
    busy(b, async () => { await post(`/api/admin/people/${encodeURIComponent(b.dataset.rm)}/remove`); toast("Removed"); await load(); });
  });
}

const PANES = { applications, people, catalog, reports, suggestions, skills, invites, log };
