// /skills: agent skills (SKILL.md files) shared by learners. Bodies are only ever shown as escaped text.
// Learners' skills wait for a moderator; contributors and staff publish directly.
import { api, signedIn, user, can, loadStats } from "../account.js";
import { esc, toast, badges, userAvatar, num } from "../ui.js";
import { icon } from "../icons.js";
import { likeButton, bindSocial } from "../social.js";
import { $, setTitle, cssReady, loader, copy, go, fmtDate, on, busy } from "./_shared.js";

const tagList = (t) => String(t || "").split(",").filter(Boolean);

export async function render(el, qs) {
  await cssReady;
  const id = qs.get("id");
  return id ? detail(el, id) : listView(el);
}

async function listView(el) {
  setTitle("Skills");
  el.innerHTML = `<div class="pg pg-skills">
    <header class="page-h"><div><h1>Skills</h1><p>Skills shared by learners. A skill is a SKILL.md file of instructions your agent loads when a task calls for it.</p></div></header>
    <div id="queue"></div>
    <div id="list">${loader("loading skills")}</div>
    <div id="share"></div>
  </div>`;
  let skills = [];
  try { skills = (await api("/api/skills")).skills; } catch (e) { $("#list", el).innerHTML = `<div class="empty"><p>Skills didn't load.</p></div>`; toast(e.message); return null; }
  const me = user();
  const pending = can("mod") ? skills.filter((s) => s.status === "pending") : [];
  const shown = skills.filter((s) => s.status === "approved" || (me && s.by.id === me.id && !pending.includes(s)));
  const row = (s) => `<li class="sk"><a href="/skills?id=${esc(s.id)}">
      <span class="sk-top"><b>${esc(s.name)}</b>${s.status !== "approved" ? `<span class="kind">${s.status === "pending" ? "Waiting for review" : "Declined"}</span>` : ""}<span class="sk-likes muted mono" aria-label="${s.likes} likes">${s.likes ? icon("heart") + num(s.likes) : ""}</span></span>
      <span class="sk-sum">${esc(s.summary)}</span>
      <span class="sk-meta muted">${userAvatar(s.by, "s")}${esc(s.by.name)}${badges(s.by)}${tagList(s.tags).length ? `<span class="dot"></span><span class="tag">${tagList(s.tags).map(esc).join(" ")}</span>` : ""}</span>
    </a></li>`;
  $("#list", el).innerHTML = shown.length ? `<ul class="rows sk-list">${shown.map(row).join("")}</ul>` : `<div class="empty"><p>No skills yet. Share the first one.</p></div>`;
  const offs = [];
  if (pending.length) {
    const q = $("#queue", el);
    q.innerHTML = `<section class="queue" aria-labelledby="qH"><h2 class="set-h" id="qH">Waiting for review <span class="muted mono">${pending.length}</span></h2>
      <ul class="rows">${pending.map((s) => `<li class="qrow"><div class="qrow-t"><a href="/skills?id=${esc(s.id)}"><b class="mono">${esc(s.name)}</b></a><span class="muted">${esc(s.summary)} · ${esc(s.by.name)}</span></div>
        <div class="acts"><button class="btn sm" type="button" data-act="approve" data-id="${esc(s.id)}">Approve</button><button class="textbtn danger" type="button" data-act="decline" data-id="${esc(s.id)}">Decline</button></div></li>`).join("")}</ul></section>`;
    offs.push(on(q, "[data-act]", (b) => {
      if (b.dataset.act === "decline" && !confirm("Decline this skill? Only its author will see it.")) return;
      busy(b, async () => { await api(`/api/skills/${encodeURIComponent(b.dataset.id)}/${b.dataset.act}`, { method: "POST" }); toast(b.dataset.act === "approve" ? "Approved and published" : "Declined"); go("/skills", true); });
    }));
  }
  const share = $("#share", el);
  if (!signedIn()) share.innerHTML = `<p class="hint share-line"><a class="link" href="/me">Get a free code</a> to share a skill.</p>`;
  else {
    share.innerHTML = `<details class="host"><summary><span>Share a skill</span>${icon("down")}</summary>
      <form class="form" id="shareForm">
        <label class="field">Name<input class="input mono" name="name" required maxlength="49" pattern="[a-z0-9][a-z0-9\\-]{1,48}" placeholder="pdf-tables" autocapitalize="none" spellcheck="false"><span class="hint">Lowercase letters, numbers and hyphens.</span></label>
        <label class="field">What it does<input class="input" name="summary" required maxlength="200" placeholder="Pull tables out of PDFs as CSV"></label>
        <label class="field">Tags <span class="opt">optional, up to 5</span><input class="input" name="tags" maxlength="120" placeholder="pdf, data"></label>
        <label class="field">SKILL.md<textarea class="input mono" name="body" rows="10" required minlength="40" maxlength="30000" spellcheck="false" placeholder="---&#10;name: pdf-tables&#10;description: Use when...&#10;---"></textarea></label>
        <p class="hint">${can("contributor") ? "Contributors publish right away." : "A moderator reads every new skill before anyone else can see it."} No secrets, keys or personal paths.</p>
        <div class="acts"><button class="btn primary" type="submit">Share skill</button></div>
      </form></details>`;
    $("#shareForm", el).onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      busy(e.submitter, async () => {
        const d = await api("/api/skills", { method: "POST", body: Object.fromEntries(f) });
        toast(d.status === "approved" ? "Published" : "Sent for review");
        go("/skills?id=" + d.id);
      });
    };
  }
  return () => offs.forEach((f) => f());
}

async function detail(el, id) {
  el.innerHTML = loader("loading the skill");
  let s;
  try { [s] = await Promise.all([api("/api/skills/" + encodeURIComponent(id)).then((d) => d.skill), loadStats()]); }
  catch (e) {
    setTitle("Skill not found");
    el.innerHTML = `<div class="pg pg-skills"><p class="crumbs"><a href="/skills">${icon("left")}All skills</a></p><div class="empty"><p>${esc(e.message)}</p></div></div>`;
    return null;
  }
  setTitle(s.name);
  const item = "k:" + s.id;
  el.innerHTML = `<div class="pg pg-skills">
    <p class="crumbs"><a href="/skills">${icon("left")}All skills</a></p>
    <header class="page-h"><div><h1 class="mono sk-h">${esc(s.name)}</h1><p>${esc(s.summary)}</p>
      <p class="sk-meta muted">By ${esc(s.by)}<span class="dot"></span>${fmtDate(s.updated)}${tagList(s.tags).length ? `<span class="dot"></span><span class="tag">${tagList(s.tags).map(esc).join(" ")}</span>` : ""}${s.status !== "approved" ? `<span class="dot"></span><span class="kind">${s.status === "pending" ? "Waiting for review" : "Declined"}</span>` : ""}</p></div></header>
    <p class="note">${icon("info")}<span><b>Read a skill before you install it.</b> It runs with your agent's permissions.</span></p>
    <div class="acts sk-acts">
      <button class="btn" type="button" id="cp">Copy</button>
      <button class="btn" type="button" id="dl">${icon("install")}Download SKILL.md</button>
      ${s.status === "approved" ? likeButton(item) : ""}
      ${can("mod") && s.status !== "approved" ? `<button class="btn" type="button" data-act="approve">Approve</button>` : ""}
      ${can("mod") && s.status === "pending" ? `<button class="textbtn danger" type="button" data-act="decline">Decline</button>` : ""}
      ${can("mod") ? `<button class="textbtn danger" type="button" data-act="delete">Delete</button>` : ""}
    </div>
    <pre class="code sk-body" tabindex="0" aria-label="SKILL.md contents"><code>${esc(s.body)}</code></pre>
    <p class="hint">To install it, save it as <span class="mono">SKILL.md</span> in a folder named <span class="mono">${esc(s.name)}</span> inside your agent's skills folder. For Claude Code that's <span class="mono">~/.claude/skills/${esc(s.name)}/SKILL.md</span>.</p>
  </div>`;
  $("#cp", el).onclick = () => copy(s.body, "Skill copied");
  $("#dl", el).onclick = () => {
    const url = URL.createObjectURL(new Blob([s.body], { type: "text/markdown;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "SKILL.md" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const off = on(el, "[data-act]", (b) => {
    const act = b.dataset.act;
    if (act !== "approve" && !confirm(act === "delete" ? "Delete this skill for good?" : "Decline this skill? Only its author will see it.")) return;
    busy(b, async () => { await api(`/api/skills/${encodeURIComponent(s.id)}/${act}`, { method: "POST" }); toast(act === "approve" ? "Approved and published" : act === "delete" ? "Deleted" : "Declined"); go(act === "approve" ? "/skills?id=" + s.id : "/skills", true); });
  });
  const offSocial = bindSocial(el);
  return () => { off(); offSocial(); };
}
