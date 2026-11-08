// /dictionary: AI and CS terms in plain words. Each entry opens to a longer definition, related terms,
// references and the best videos on it from the catalog. Deep links: /dictionary#<slug>.
import { gatedFetch } from "../data.js";
import { TOPICS, load, D, search } from "../data.js";
import { esc } from "../ui.js";
import { icon } from "../icons.js";
import { $, setTitle, cssReady, loader, on } from "./_shared.js";

const topicName = (c) => (TOPICS.find((t) => t.code === c) || {}).label || (c ? c[0].toUpperCase() + c.slice(1) : "");
const letterOf = (t) => { const c = t.term.trim()[0].toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };
const safe = (u) => (/^https:\/\//.test(u || "") ? u : "");

export async function render(el, qs) {
  await cssReady;
  setTitle("Dictionary");
  el.innerHTML = `<div class="pg pg-dictionary">
    <header class="page-h"><div><h1>Dictionary</h1><p>The words you'll hear in AI and computer science, in plain English, with sources and videos that explain them well.</p></div></header>
    <div id="body">${loader("loading terms")}</div>
  </div>`;
  let terms = [];
  try { const r = await gatedFetch("/data/glossary.json"); if (r.ok) terms = (await r.json()).terms || []; } catch {}
  const body = $("#body", el);
  if (!terms.length) { body.innerHTML = `<div class="empty"><p>The dictionary is on its way. Check back soon.</p></div>`; return null; }
  terms.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
  const bySlug = new Map(terms.map((t) => [t.slug, t]));
  const topics = [...new Set(terms.map((t) => t.topic).filter(Boolean))];
  let q = "", topic = topics.includes(qs.get("topic")) ? qs.get("topic") : "";

  body.innerHTML = `<div class="filters">
      <div class="inline"><label class="sr-only" for="dq">Search terms</label><input class="input" id="dq" type="search" placeholder="Search ${terms.length} terms" autocomplete="off"></div>
      ${topics.length > 1 ? `<div class="chips" role="group" aria-label="Topics"><button class="chip" type="button" data-topic="" aria-pressed="${!topic}">All</button>${topics.map((t) => `<button class="chip" type="button" data-topic="${esc(t)}" aria-pressed="${t === topic}">${esc(topicName(t))}</button>`).join("")}</div>` : ""}
      <nav class="az" aria-label="Jump to a letter" id="az"></nav>
    </div>
    <div id="dl"></div>`;
  const list = $("#dl", body), az = $("#az", body);

  const entry = (t) => `<details class="term" id="${esc(t.slug)}" data-slug="${esc(t.slug)}">
      <summary><span class="term-h"><b>${esc(t.term)}</b>${t.aka && t.aka.length ? `<span class="muted">${esc([].concat(t.aka).join(", "))}</span>` : ""}</span><span class="term-s">${esc(t.short)}</span>${icon("down")}</summary>
      <div class="term-b">
        ${t.long ? `<p>${esc(t.long)}</p>` : ""}
        ${t.related && t.related.length ? `<p class="term-rel"><span class="kind">Related</span>${t.related.map((s) => bySlug.get(s)).filter(Boolean).map((r) => `<a class="link" href="/dictionary#${esc(r.slug)}" data-go="${esc(r.slug)}">${esc(r.term)}</a>`).join("")}</p>` : ""}
        ${t.refs && t.refs.length ? `<div class="term-sec"><span class="kind">Read more</span><ul class="refs">${t.refs.filter((r) => safe(r.url)).map((r) => `<li><a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>${r.kind ? ` <span class="tag">${esc(r.kind)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
        <div class="term-sec"><span class="kind">Watch</span><ul class="refs watch" data-watch="${esc(t.term)}"><li class="muted">Finding videos</li></ul></div>
      </div>
    </details>`;
  const paint = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    // keywords help search find a term; they are never shown (only aka is a true synonym).
    const hay = (t) => [t.term, ...[].concat(t.aka || []), ...[].concat(t.keywords || []), t.short].join(" ").toLowerCase();
    const shown = terms.filter((t) => (!topic || t.topic === topic) && words.every((w) => hay(t).includes(w)));
    const groups = new Map();
    for (const t of shown) { const L = letterOf(t); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(t); }
    az.innerHTML = [...(groups.has("#") ? ["#"] : []), ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((L) => groups.has(L) ? `<a href="#L-${L === "#" ? "0" : L}" data-letter="${L === "#" ? "0" : L}" aria-label="${L === "#" ? "Numbers" : L}">${L}</a>` : `<span aria-hidden="true">${L}</span>`).join("");
    list.innerHTML = [...groups].map(([L, ts]) => `<section class="letter" id="L-${L === "#" ? "0" : L}" aria-label="${L === "#" ? "Numbers" : L}"><h2 class="letter-h">${L}</h2>${ts.map(entry).join("")}</section>`).join("")
      || `<div class="empty"><p>No terms match. Try fewer words.</p></div>`;
  };
  paint();

  // Videos are searched in the full catalog the first time an entry opens.
  const watched = new Map();
  async function fillWatch(d) {
    const ul = d.querySelector("[data-watch]");
    if (!ul || ul.dataset.done) return;
    ul.dataset.done = "1";
    const term = ul.dataset.watch;
    try {
      if (!watched.has(term)) { await load(); await D.full.catch(() => {}); watched.set(term, search(term).videos.slice(0, 3)); }
      const vs = watched.get(term);
      ul.innerHTML = vs.length ? vs.map((v) => `<li><a class="link" href="/watch/${esc(v.id)}">${esc(v.title)}</a> <span class="muted">${esc((D.people[v.person] || {}).name || "")}</span></li>`).join("") : `<li class="muted">No videos on this yet.</li>`;
    } catch { ul.innerHTML = `<li class="muted">Videos didn't load.</li>`; }
  }
  const openTerm = (slug, focus = true) => {
    let d = document.getElementById(slug);
    if (!d || !list.contains(d)) { q = ""; topic = ""; $("#dq", body).value = ""; body.querySelectorAll("[data-topic]").forEach((x) => x.setAttribute("aria-pressed", !x.dataset.topic)); paint(); d = document.getElementById(slug); }
    if (!d) return;
    d.open = true;
    history.replaceState(null, "", location.pathname + location.search + "#" + slug);
    d.scrollIntoView({ block: "start" });
    if (focus) d.querySelector("summary").focus({ preventScroll: true });
  };
  const h = decodeURIComponent(location.hash.slice(1));
  if (h && bySlug.has(h)) openTerm(h, false);

  let t;
  const dq = $("#dq", body);
  dq.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = dq.value.trim(); paint(); }, 80); });
  const onToggle = (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("term")) return;
    if (d.open) { fillWatch(d); history.replaceState(null, "", location.pathname + location.search + "#" + d.dataset.slug); }
    else if (location.hash === "#" + d.dataset.slug) history.replaceState(null, "", location.pathname + location.search);
  };
  list.addEventListener("toggle", onToggle, true);
  // The app router drops hashes, so in-page links are handled here.
  const intercept = (fn) => (n, e) => { e.preventDefault(); e.stopPropagation(); fn(n); };
  const offs = [
    on(body, "[data-topic]", (b) => { topic = b.dataset.topic; body.querySelectorAll("[data-topic]").forEach((x) => x.setAttribute("aria-pressed", x === b)); paint(); }),
    on(list, "[data-go]", intercept((a) => openTerm(a.dataset.go))),
    on(az, "[data-letter]", intercept((a) => { const s = document.getElementById("L-" + a.dataset.letter); if (s) { s.scrollIntoView({ block: "start" }); s.querySelector("summary")?.focus({ preventScroll: true }); } })),
  ];
  return () => { clearTimeout(t); list.removeEventListener("toggle", onToggle, true); offs.forEach((f) => f()); };
}
