// Small helpers shared by the Feedforward labs. No dependencies.

/** Build an element. attrs: class, text, html, on{Event}, style, and plain attributes. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Read CSS custom properties from an element (so canvas colors follow the theme). */
export function readVars(el, names) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const n of names) out[n] = cs.getPropertyValue(`--${n}`).trim();
  return out;
}

/** Call cb when the theme may have changed: system scheme or the app's data-theme attribute. */
export function watchTheme(cb) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const run = () => requestAnimationFrame(() => cb());
  mq.addEventListener("change", run);
  const mo = new MutationObserver(run);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => { mq.removeEventListener("change", run); mo.disconnect(); };
}

/** CSS for the lesson sections, scoped under the lab's class. */
export function lessonCSS(scope) {
  const s = `.${scope}`;
  return `
${s} .lk-section { border-top: 1px solid var(--line); margin-top: var(--s7); padding-top: var(--s5); }
${s} .lk-section h2 { font-size: var(--t-l); line-height: 1.3; font-weight: 600; margin: 0 0 var(--s3); }
${s} .lk-section p, ${s} .lk-section li { font-size: var(--t-m); line-height: 1.5; }
${s} .lk-section p { margin: 0 0 var(--s3); max-width: 68ch; }
${s} .lk-try { margin: 0; padding-left: var(--s5); display: grid; gap: var(--s2); max-width: 68ch; }
${s} .lk-q { font-weight: 500; margin: 0 0 var(--s3); }
${s} .lk-opts { display: grid; gap: var(--s2); }
${s} .lk-opt { justify-content: flex-start; text-align: left; border-radius: var(--r); min-height: 48px; padding: var(--s2) var(--s4);
  font: 400 var(--t-m)/1.4 var(--font); white-space: normal; }
${s} .lk-opt[aria-pressed="true"].is-right { border-color: var(--ok); }
${s} .lk-opt[aria-pressed="true"].is-wrong { border-color: var(--bad); }
${s} .lk-feedback { margin-top: var(--s3); padding: var(--s3) var(--s4); border-radius: var(--r); background: var(--bg-2);
  border: 1px solid var(--line); border-left: 3px solid var(--line); }
${s} .lk-feedback:empty { display: none; }
${s} .lk-feedback.is-right { border-left-color: var(--ok); }
${s} .lk-feedback.is-wrong { border-left-color: var(--bad); }
${s} .lk-feedback strong { display: block; margin-bottom: var(--s1); }
${s} .lk-feedback.is-right strong { color: var(--ok); }
${s} .lk-feedback.is-wrong strong { color: var(--bad); }
${s} code, ${s} .lk-code { font-family: var(--mono); font-size: .92em; background: var(--bg-3); padding: 1px 5px; border-radius: 4px; }
`;
}

/**
 * Render What's happening / Try this / Check into `parent`.
 * check = { q, options: [{ t, right, why }] }
 */
export function renderLesson(parent, { happening, tryThis, check }, ctx) {
  const para = (t) => h("p", { html: t });
  parent.append(
    h("section", { class: "lk-section" },
      h("h2", { text: "What's happening" }), ...happening.map(para)),
    h("section", { class: "lk-section" },
      h("h2", { text: "Try this" }),
      h("ol", { class: "lk-try" }, ...tryThis.map((t) => h("li", { html: t })))),
  );
  const fb = h("div", { class: "lk-feedback", role: "status", "aria-live": "polite" });
  let done = false;
  const buttons = check.options.map((o) => {
    const b = h("button", { class: "btn lk-opt", type: "button", "aria-pressed": "false", text: o.t });
    b.addEventListener("click", () => {
      buttons.forEach((x) => { x.setAttribute("aria-pressed", "false"); x.classList.remove("is-right", "is-wrong"); });
      b.setAttribute("aria-pressed", "true");
      b.classList.add(o.right ? "is-right" : "is-wrong");
      fb.className = "lk-feedback " + (o.right ? "is-right" : "is-wrong");
      fb.replaceChildren(h("strong", { text: o.right ? "Right." : "Not quite." }), h("span", { html: o.why }));
      if (o.right && !done) { done = true; try { ctx?.markDone?.(); } catch {} }
    });
    return b;
  });
  parent.append(h("section", { class: "lk-section" },
    h("h2", { text: "Check" }),
    h("p", { class: "lk-q", text: check.q }),
    h("div", { class: "lk-opts", role: "group", "aria-label": "Answers" }, ...buttons),
    fb));
}
