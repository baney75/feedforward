// /repos: open source repos worth studying or using, from public/data/repos.json (scripts/build_repos.mjs).
import { TOPICS } from "../data.js";
import { esc, num, ago } from "../ui.js";
import { icon } from "../icons.js";
import { $, setTitle, cssReady, loader, on } from "./_shared.js";

const topicName = (c) => (TOPICS.find((t) => t.code === c) || {}).label || c;

export async function render(el, qs) {
  await cssReady;
  setTitle("Repos");
  el.innerHTML = `<div class="pg pg-repos">
    <header class="page-h"><div><h1>Repos</h1><p>Open source code worth reading, running or building on. For learning how AI works, running it at home, building agents, and making things.</p></div></header>
    <div id="body">${loader("loading repos")}</div>
  </div>`;
  let data = null;
  try { const r = await fetch("/data/repos.json"); if (r.ok) data = await r.json(); } catch {}
  const body = $("#body", el);
  if (!data || !data.repos || !data.repos.length) { body.innerHTML = `<div class="empty"><p>The repo list didn't load. Try again in a moment.</p></div>`; return null; }
  const repos = data.repos.filter((r) => /^https:\/\/github\.com\//.test(r.url));
  const order = TOPICS.map((t) => t.code);
  const topics = [...new Set(repos.map((r) => r.topic))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  let topic = topics.includes(qs.get("topic")) ? qs.get("topic") : "", sort = qs.get("sort") === "recent" ? "recent" : "stars";
  body.innerHTML = `<div class="filters"><div class="filter-row">
      <div class="chips" role="group" aria-label="Topics"><button class="chip" type="button" data-topic="" aria-pressed="${!topic}">All</button>${topics.map((t) => `<button class="chip" type="button" data-topic="${esc(t)}" aria-pressed="${t === topic}">${esc(topicName(t))}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Sort"><button type="button" data-sort="stars" aria-pressed="${sort === "stars"}">Most stars</button><button type="button" data-sort="recent" aria-pressed="${sort === "recent"}">Recently active</button></div>
    </div></div>
    <ul class="rows repos" id="rl"></ul>
    <p class="hint">Stars and activity from GitHub, updated ${esc(new Date(data.built * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }))}.</p>`;
  const list = $("#rl", body);
  const paint = () => {
    const shown = repos.filter((r) => !topic || r.topic === topic).sort((a, b) => (sort === "recent" ? b.pushed - a.pushed : b.stars - a.stars));
    list.innerHTML = shown.map((r) => {
      const [owner, name] = r.repo.split("/");
      return `<li><a class="repo" href="${esc(r.url)}" target="_blank" rel="noopener">
        <span class="repo-top"><span class="repo-n mono"><span class="muted">${esc(owner)}/</span><b>${esc(name)}</b></span><span class="repo-stars mono" aria-label="${r.stars} stars">${icon("star")}${num(r.stars)}</span></span>
        <span class="repo-why">${esc(r.why)}</span>
        <span class="repo-meta muted">${[r.lang, r.license, "active " + ago(r.pushed), r.archived ? "archived" : ""].filter(Boolean).map(esc).join('<span class="dot"></span>')}</span>
      </a></li>`;
    }).join("");
  };
  paint();
  const sync = () => { const u = new URL(location.href); topic ? u.searchParams.set("topic", topic) : u.searchParams.delete("topic"); sort === "recent" ? u.searchParams.set("sort", "recent") : u.searchParams.delete("sort"); history.replaceState(null, "", u.pathname + u.search); };
  const off = on(body, "[data-topic],[data-sort]", (b) => {
    if (b.dataset.sort) { sort = b.dataset.sort; body.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
    else { topic = b.dataset.topic; body.querySelectorAll("[data-topic]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
    sync(); paint();
  });
  return off;
}
