// Clickable terms: words from the dictionary get a dotted underline in post text and video titles, and tapping one
// opens a small card in place. The glossary loads only once a page has text to mark.
import { gatedFetch, TOPICS } from "./data.js";
import { esc } from "./ui.js";

let terms = null;
export function glossary() {
  if (!terms) terms = gatedFetch("/data/glossary.json").then((r) => { if (!r.ok) throw new Error("glossary"); return r.json(); }).then((j) => j.terms).catch((e) => { terms = null; throw e; });
  return terms;
}

// Plain English words that only sometimes mean the technical thing stay unmarked: "agent", "attention", "temperature".
// A name is safe when it is several words, is written like an acronym or product, or is on this short list.
const SAFE = new Set(["backpropagation", "backprop", "embedding", "transformer", "overfitting", "hallucination", "tokenizer", "softmax", "logits", "quantization", "regularization", "interpretability", "jailbreak", "tensor", "subagent", "pretraining", "ollama", "safetensors", "fine-tuning", "cuda"]);
const acronym = (s) => (s.match(/[A-Z]/g) || []).length >= 2 || /[a-z][A-Z]/.test(s);
const safe = (s) => /[\s.]/.test(s) || acronym(s) || SAFE.has(s.toLowerCase());
let matcher = null;
function build(list) {
  const exact = new Map(), loose = new Map();
  for (const t of list) for (const name of [t.term, ...(t.aka || []), ...(t.slug === "backpropagation" ? ["backprop"] : [])]) {
    if (!safe(name)) continue;
    (acronym(name) ? exact.set(name, t) : loose.set(name.toLowerCase(), t));
  }
  const names = [...exact.keys(), ...loose.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  try { return { re: new RegExp(`(?<![\\w-])(${names.join("|")})s?(?![\\w-])`, "gi"), exact, loose }; } catch { return null; }
}
const find = (word, m) => {
  const bare = (w) => m.exact.get(w) || m.loose.get(w.toLowerCase());
  return bare(word) || (word.endsWith("s") ? bare(word.slice(0, -1)) : undefined);
};
const MAX_PER_BLOCK = 3;
export function markTerms(el, m = matcher) {
  if (!m) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest("a,button,code,pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const used = new Set();
  for (const node of nodes) {
    const text = node.nodeValue; let last = 0; const out = document.createDocumentFragment();
    m.re.lastIndex = 0;
    for (const hit of text.matchAll(m.re)) {
      if (used.size >= MAX_PER_BLOCK) break;
      const t = find(hit[1], m) || find(hit[0], m);
      if (!t || used.has(t.slug)) continue;
      used.add(t.slug);
      out.append(text.slice(last, hit.index));
      const b = document.createElement("button");
      b.type = "button"; b.className = "term"; b.dataset.term = t.slug; b.textContent = hit[0];
      out.append(b);
      last = hit.index + hit[0].length;
    }
    if (last) { out.append(text.slice(last)); node.replaceWith(out); }
  }
}

const card = document.createElement("div");
card.id = "termCard"; card.hidden = true; card.setAttribute("role", "dialog"); card.tabIndex = -1;
document.body.appendChild(card);
let anchor = null;
function close(refocus) {
  if (card.hidden) return;
  card.hidden = true;
  if (refocus && anchor?.isConnected) anchor.focus();
  anchor = null;
}
async function open(btn) {
  const list = await glossary();
  const t = list.find((x) => x.slug === btn.dataset.term);
  if (!t) return;
  anchor = btn;
  const topic = TOPICS.find((x) => x.code === t.topic)?.label || "";
  card.setAttribute("aria-label", t.term);
  card.innerHTML = `<h3>${esc(t.term)}</h3>${topic ? `<span class="muted">${esc(topic)}</span>` : ""}<p>${esc(t.short)}</p><a href="/dictionary#${esc(t.slug)}">Open in dictionary</a>`;
  card.hidden = false;
  const r = btn.getBoundingClientRect(), c = card.getBoundingClientRect(), gap = 8, edge = 12;
  const below = r.bottom + gap + c.height < innerHeight - edge;
  card.style.left = Math.max(edge, Math.min(r.left, innerWidth - c.width - edge)) + "px";
  card.style.top = (below ? r.bottom + gap : Math.max(edge, r.top - gap - c.height)) + "px";
  card.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".term");
  if (b) { e.preventDefault(); if (anchor === b) close(); else open(b).catch(() => {}); return; }
  if (!card.hidden && (!card.contains(e.target) || e.target.closest("a"))) close();
});
addEventListener("keydown", (e) => { if (e.key === "Escape") close(true); });
addEventListener("scroll", () => close(), { passive: true });
addEventListener("popstate", () => close());

// Watch the page for new text: infinite scroll adds posts long after the route changes.
export function watchTerms(view) {
  const SEL = ".post-text:not([data-t]), .watch h1:not([data-t])";
  let queued = false;
  const scan = async () => {
    queued = false;
    if (!view.querySelector(SEL)) return;
    try { if (!matcher) matcher = build(await glossary()); } catch { return; }
    if (!matcher) return;
    view.querySelectorAll(SEL).forEach((el) => { el.dataset.t = "1"; markTerms(el); });
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(scan); } }).observe(view, { childList: true, subtree: true });
}
