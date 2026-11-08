// /research: landmark papers with why each matters, links to read them, and citations in four styles.
import { TOPICS } from "../data.js";
import { loadStats } from "../account.js";
import { esc } from "../ui.js";
import { STYLES, plain } from "../cite.js";
import { likeButton, bindSocial } from "../social.js";
import { $, setTitle, cssReady, loader, copy, on } from "./_shared.js";

const topicName = (c) => (TOPICS.find((t) => t.code === c) || {}).label || (c ? c[0].toUpperCase() + c.slice(1) : "");
// One line of authors however long the list: "Vaswani, Shazeer and Parmar", "Achiam, Adler and 278 more".
const who = (a) => (a.literal ? a.literal : a.family || a.given || "");
function authorsShort(a = []) {
  const f = a.map(who).filter(Boolean);
  if (f.length <= 2) return f.join(" and ");
  if (f.length === 3) return `${f[0]}, ${f[1]} and ${f[2]}`;
  return `${f[0]}, ${f[1]} and ${f.length - 2} more`;
}
const absUrl = (p) => (p.arxiv ? `https://arxiv.org/abs/${p.arxiv}` : p.doi ? `https://doi.org/${p.doi}` : p.url || "");
const pdfUrl = (p) => p.pdf || (p.arxiv ? `https://arxiv.org/pdf/${p.arxiv}` : "");
const safe = (u) => (/^https:\/\//.test(u || "") ? u : "");
// cite.js marks italics with *asterisks*. On screen they become <i>; copies drop them.
const italic = (s) => esc(s).replace(/\*([^*]+)\*/g, "<i>$1</i>");

export async function render(el, qs) {
  await cssReady;
  setTitle("Research");
  el.innerHTML = `<div class="pg pg-research">
    <header class="page-h"><div><h1>Research</h1><p>The papers that shaped modern AI, with a plain note on why each one matters and a citation ready to copy.</p></div></header>
    <div id="body">${loader("loading papers")}</div>
  </div>`;
  let papers = [];
  try {
    const r = await fetch("/data/papers.json");
    if (r.ok) papers = (await r.json()).papers || [];
  } catch {}
  loadStats().catch(() => {});
  const body = $("#body", el);
  if (!papers.length) { body.innerHTML = `<div class="empty"><p>The reading list is on its way. Check back soon.</p></div>`; return null; }

  const topics = [...new Set(papers.map((p) => p.topic).filter(Boolean))];
  let q = qs.get("q") || "", topic = topics.includes(qs.get("topic")) ? qs.get("topic") : "", sort = qs.get("sort") === "old" ? "old" : "new", openCite = null;
  body.innerHTML = `<div class="filters">
      <div class="inline"><label class="sr-only" for="rq">Search papers</label><input class="input" id="rq" type="search" placeholder="Search titles, authors, ideas" value="${esc(q)}" autocomplete="off"></div>
      <div class="filter-row">
        ${topics.length > 1 ? `<div class="chips" role="group" aria-label="Topics"><button class="chip" type="button" data-topic="" aria-pressed="${!topic}">All</button>${topics.map((t) => `<button class="chip" type="button" data-topic="${esc(t)}" aria-pressed="${t === topic}">${esc(topicName(t))}</button>`).join("")}</div>` : ""}
        <div class="seg" role="group" aria-label="Sort by year"><button type="button" data-sort="new" aria-pressed="${sort === "new"}">Newest</button><button type="button" data-sort="old" aria-pressed="${sort === "old"}">Oldest</button></div>
      </div>
    </div>
    <p class="count muted mono" id="rc" aria-live="polite"></p>
    <div id="rl"></div>`;
  const list = $("#rl", body), count = $("#rc", body);

  const row = (p) => {
    const abs = safe(absUrl(p)), pdf = safe(pdfUrl(p));
    return `<article class="paper" id="paper-${esc(p.id)}" data-id="${esc(p.id)}">
      <h2>${abs ? `<a href="${esc(abs)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</h2>
      <p class="paper-by muted">${esc(authorsShort(p.authors))}<span class="dot"></span>${p.venue && !/arxiv/i.test(p.venue) ? esc(p.venue) + " " : ""}<span class="mono">${esc(p.year)}</span>${p.level ? `<span class="dot"></span>${esc(p.level)}` : ""}</p>
      ${p.why ? `<p class="paper-why">${esc(p.why)}</p>` : ""}
      <div class="acts paper-acts">
        <button class="btn sm" type="button" data-cite="${esc(p.id)}" aria-expanded="false" aria-controls="cite-${esc(p.id)}">Cite</button>
        ${likeButton("r:" + p.id)}
        ${pdf ? `<a class="textbtn" href="${esc(pdf)}" target="_blank" rel="noopener">PDF</a>` : ""}
        ${abs ? `<a class="textbtn" href="${esc(abs)}" target="_blank" rel="noopener">Abstract</a>` : ""}
      </div>
      <div class="cite" id="cite-${esc(p.id)}" hidden></div>
    </article>`;
  };
  const paint = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (p) => [p.title, p.venue, p.why, p.year, topicName(p.topic), ...(p.authors || []).slice(0, 40).map((a) => a.literal || `${a.given || ""} ${a.family || ""}`)].join(" ").toLowerCase();
    const shown = papers.filter((p) => (!topic || p.topic === topic) && words.every((w) => hay(p).includes(w)))
      .sort((a, b) => (sort === "old" ? a.year - b.year : b.year - a.year) || a.title.localeCompare(b.title));
    openCite = null;
    count.textContent = `${shown.length} paper${shown.length === 1 ? "" : "s"}`;
    list.innerHTML = shown.map(row).join("") || `<div class="empty"><p>No papers match. Try fewer words.</p></div>`;
  };
  const sync = () => {
    const u = new URL(location.href);
    q ? u.searchParams.set("q", q) : u.searchParams.delete("q");
    topic ? u.searchParams.set("topic", topic) : u.searchParams.delete("topic");
    sort === "old" ? u.searchParams.set("sort", "old") : u.searchParams.delete("sort");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  };
  paint();
  // Deep link: /research#<paper id>.
  const h = decodeURIComponent(location.hash.slice(1));
  const target = h && document.getElementById("paper-" + h);
  if (target) { target.classList.add("hl"); target.scrollIntoView({ block: "center" }); }

  const citeHtml = (p, style) => {
    const [label, fn] = STYLES[style], text = fn(p);
    return `<div class="seg cite-seg" role="group" aria-label="Citation style">${Object.entries(STYLES).map(([k, [l]]) => `<button type="button" data-style="${k}" aria-pressed="${k === style}">${l}</button>`).join("")}</div>
      ${style === "bibtex" ? `<pre class="code"><code>${esc(text)}</code></pre>` : `<p class="cite-out">${italic(text)}</p>`}
      <div class="acts"><button class="btn sm" type="button" data-copycite="${style}">Copy ${esc(label)}</button></div>`;
  };
  let t;
  const rq = $("#rq", body);
  rq.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = rq.value.trim(); sync(); paint(); }, 120); });
  const find = (n) => papers.find((p) => p.id === n.closest("[data-id]").dataset.id);
  const offs = [
    on(body, "[data-topic]", (b) => { topic = b.dataset.topic; body.querySelectorAll("[data-topic]").forEach((x) => x.setAttribute("aria-pressed", x === b)); sync(); paint(); }),
    on(body, "[data-sort]", (b) => { sort = b.dataset.sort; body.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", x === b)); sync(); paint(); }),
    on(list, "[data-cite]", (b) => {
      const id = b.dataset.cite, was = openCite === id;
      if (openCite) { const o = list.querySelector(`[data-cite="${CSS.escape(openCite)}"]`); const c = document.getElementById("cite-" + openCite); if (o) o.setAttribute("aria-expanded", "false"); if (c) { c.hidden = true; c.innerHTML = ""; } }
      openCite = null;
      if (was) return;
      const box = document.getElementById("cite-" + id);
      box.innerHTML = citeHtml(find(b), "apa"); box.hidden = false; b.setAttribute("aria-expanded", "true"); openCite = id;
    }),
    on(list, "[data-style]", (b) => { const box = b.closest(".cite"); box.innerHTML = citeHtml(find(b), b.dataset.style); box.querySelector(`[data-style="${b.dataset.style}"]`).focus(); }),
    on(list, "[data-copycite]", (b) => {
      const style = b.dataset.copycite, text = STYLES[style][1](find(b));
      copy(style === "bibtex" ? text : plain(text), STYLES[style][0] + " citation copied");
    }),
    bindSocial(list),
  ];
  return () => { clearTimeout(t); offs.forEach((f) => f()); };
}
