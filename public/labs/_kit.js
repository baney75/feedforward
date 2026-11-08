// Shared helpers for Feedforward labs: DOM building, scoped styles, theme colors,
// and the standard What's happening / Try this / Check sections.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let uid = 0;
export const nextId = (p) => `${p}-${++uid}`;

// Base styles every lab shares. "&" is replaced with the lab's scope class.
const BASE = `
& [hidden] { display: none !important; }
& { display: grid; gap: var(--s6); font: 400 var(--t-m)/1.5 var(--font); color: var(--fg); min-width: 0; }
& *, & *::before, & *::after { box-sizing: border-box; }
& .stage { display: grid; gap: var(--s4); min-width: 0; }
& .panel { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--r); padding: var(--s4); min-width: 0; }
& .row { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; }
& .lbl { font-size: var(--t-s); color: var(--fg-2); }
& .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
& .stat { display: flex; flex-direction: column; justify-content: space-between; gap: 2px; padding: var(--s2) var(--s3); border-left: 1px solid var(--line); margin-left: -1px; min-width: 0; }
& .stat .k { display: block; font-size: var(--t-xs); color: var(--fg-2); letter-spacing: .02em; }
& .stat .v { display: block; font: 500 var(--t-l)/1.3 var(--mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 480px) { & .stat .v { font-size: var(--t-m); } }
& .seg { display: inline-flex; flex-wrap: wrap; gap: var(--s1); padding: 3px; border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--bg); }
& .seg button { min-height: 36px; padding: 0 var(--s3); border: 0; border-radius: var(--r-pill); background: transparent; color: var(--fg-2); font: 500 var(--t-s)/1 var(--font); cursor: pointer; }
& .seg button:hover { color: var(--fg); }
& .seg button[aria-pressed="true"] { background: var(--bg-3); color: var(--fg); box-shadow: inset 0 0 0 1px var(--line); }
& .slider { display: grid; gap: var(--s1); }
& .slider .top { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s2); }
& .slider label { font-size: var(--t-s); color: var(--fg-2); }
& .slider output { font: 500 var(--t-m)/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--fg); }
& input[type="range"] { height: 40px; margin: 0; }
& .field select, & .field input { min-height: 40px; width: 100%; }
& .learn { display: grid; gap: var(--s5); }
& .learn section { border-top: 1px solid var(--line); padding-top: var(--s5); }
& .learn h2 { font: 600 var(--t-m)/1.4 var(--font); margin: 0 0 var(--s3); color: var(--fg); }
& .learn p { margin: 0 0 var(--s2); max-width: 64ch; }
& .learn p:last-child { margin-bottom: 0; }
& .learn ol { margin: 0; padding-left: 1.4em; max-width: 64ch; }
& .learn li + li { margin-top: var(--s2); }
& .learn li::marker { color: var(--fg-2); font-family: var(--mono); font-size: var(--t-s); }
& .learn code, & .learn .mono { font-family: var(--mono); font-size: .92em; background: var(--bg-3); padding: 1px 5px; border-radius: 4px; }
& .q { margin: 0 0 var(--s3); font-weight: 500; max-width: 64ch; }
& .opts { display: grid; gap: var(--s2); max-width: 560px; }
& .opts .btn { justify-content: flex-start; text-align: left; min-height: 44px; padding: var(--s2) var(--s4); border-radius: var(--r); line-height: 1.35; font-size: var(--t-m); font-weight: 400; }
& .opts .btn[data-state="right"] { border-color: var(--ok); box-shadow: inset 0 0 0 1px var(--ok); }
& .opts .btn[data-state="wrong"] { border-color: var(--bad); box-shadow: inset 0 0 0 1px var(--bad); }
& .fb { margin-top: var(--s3); max-width: 64ch; min-height: 1.5em; }
& .fb strong { font-weight: 600; }
& .fb[data-state="right"] strong { color: var(--ok); }
& .fb[data-state="wrong"] strong { color: var(--bad); }
& .err { border: 1px solid var(--bad); color: var(--fg); border-radius: var(--r); padding: var(--s3) var(--s4); background: var(--bg-2); }
& .err strong { color: var(--bad); }
`;

export function scopeStyle(root, slug, css) {
  const cls = `lab-${slug}`;
  root.classList.add(cls);
  const style = h("style", { "data-lab": slug });
  style.textContent = (BASE + css).replaceAll("&", `.${cls}`);
  root.append(style);
  return cls;
}

// Read a CSS custom property as [r, g, b]. Works for #rgb, #rrggbb and rgb().
export function rgbOf(el, name) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  if (v.startsWith("#")) {
    let x = v.slice(1);
    if (x.length === 3) x = x.split("").map((c) => c + c).join("");
    const n = parseInt(x.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = v.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
export const css = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Call cb when the theme changes, from the OS setting or a data-theme switch.
export function onTheme(cb) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const run = () => requestAnimationFrame(() => cb());
  mq.addEventListener("change", run);
  const mo = new MutationObserver(run);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => { mq.removeEventListener("change", run); mo.disconnect(); };
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function slider({ label, min, max, step, value, format = String, oninput }) {
  const id = nextId("sl");
  const out = h("output", { for: id }, format(value));
  const input = h("input", { type: "range", id, min, max, step, value });
  input.addEventListener("input", () => { out.textContent = format(+input.value); oninput(+input.value); });
  const el = h("div", { class: "slider" }, h("div", { class: "top" }, h("label", { for: id }, label), out), input);
  return { el, input, out, set(v) { input.value = v; out.textContent = format(+input.value); } };
}

// A row of toggle buttons where one is pressed. Labelled by a visible label.
export function segmented({ label, options, value, onchange }) {
  const id = nextId("seg");
  const wrap = h("div", { class: "seg", role: "group", "aria-labelledby": id });
  const btns = options.map(([v, text]) => {
    const b = h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => { set(v); onchange(v); } }, text);
    b.dataset.v = v;
    wrap.append(b);
    return b;
  });
  function set(v) { for (const b of btns) b.setAttribute("aria-pressed", String(b.dataset.v === String(v))); }
  const el = h("div", { class: "field" }, h("span", { id }, label), wrap);
  return { el, set };
}

export function stat(k, v = "") {
  const val = h("span", { class: "v" }, v);
  return { el: h("div", { class: "stat" }, h("span", { class: "k" }, k), val), set: (x) => { val.textContent = x; } };
}

// The three teaching sections in the order LABS.md asks for.
// check: { q, options: [{ text, right, why }] }
export function learnSections({ happening, tryThis, check }, ctx) {
  const fb = h("div", { class: "fb", "aria-live": "polite" });
  const opts = h("div", { class: "opts" });
  let done = false;
  for (const o of check.options) {
    const b = h("button", { type: "button", class: "btn" }, o.text);
    b.addEventListener("click", () => {
      for (const x of opts.children) x.removeAttribute("data-state");
      b.dataset.state = o.right ? "right" : "wrong";
      fb.dataset.state = b.dataset.state;
      fb.replaceChildren(h("strong", null, o.right ? "Right. " : "Not quite. "), o.why);
      if (o.right && !done) { done = true; try { ctx && ctx.markDone && ctx.markDone(); } catch (e) { console.warn(e); } }
    });
    opts.append(b);
  }
  const para = (x) => (typeof x === "string" ? h("p", null, x) : x);
  return h("div", { class: "learn" },
    h("section", null, h("h2", null, "What's happening"), ...happening.map(para)),
    h("section", null, h("h2", null, "Try this"), h("ol", null, ...tryThis.map((t) => h("li", null, t)))),
    h("section", null, h("h2", null, "Check"), h("p", { class: "q" }, check.q), opts, fb),
  );
}

// Inline code-styled text for teaching copy.
export const code = (t) => h("code", null, t);
export const p = (...kids) => h("p", null, ...kids);
