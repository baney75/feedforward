import { h, scopeStyle, slider, stat, learnSections, code, p } from "./_kit.js";

export const meta = {
  slug: "sampling",
  title: "Temperature and top-p",
  blurb: "Move two sliders and see exactly how a model picks its next word.",
  minutes: 6,
  topic: "foundations",
};

const PROMPT = "The best way to learn is to";
// Hand-set logits for ten candidate next tokens. Each token starts with a space.
const CANDS = [
  [" practice", 3.2], [" teach", 2.9], [" do", 2.6], [" read", 2.2], [" ask", 1.9],
  [" fail", 1.5], [" build", 1.3], [" play", 0.9], [" listen", 0.6], [" sleep", -0.5],
];
const WINDOW = 20;

// softmax(logits / T). At T = 0 this is greedy: all mass on the top logit.
export function probs(logits, T) {
  if (T <= 0) {
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
    return logits.map((_, i) => (i === best ? 1 : 0));
  }
  const z = logits.map((l) => l / T);
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

// Top-p keeps the smallest set of most likely tokens whose total reaches p.
export function nucleus(pr, topP) {
  const order = pr.map((v, i) => i).sort((a, b) => pr[b] - pr[a]);
  const keep = new Array(pr.length).fill(false);
  let cum = 0;
  for (const i of order) {
    keep[i] = true;
    cum += pr[i];
    if (cum >= topP - 1e-12) break;
  }
  const kept = pr.map((v, i) => (keep[i] ? v : 0));
  const s = kept.reduce((a, b) => a + b, 0);
  return { keep, final: kept.map((v) => v / s) };
}

const STYLE = `
& .prompt { font: 400 var(--t-l)/1.45 var(--font); margin: 0; }
& .prompt .pick { font-weight: 600; color: var(--accent-text); border-bottom: 2px solid var(--accent); }
& .prompt .blank { display: inline-block; width: 4.5em; border-bottom: 2px dashed var(--line); vertical-align: -0.1em; height: 1.1em; }
& .ctrls { display: grid; gap: var(--s4); grid-template-columns: 1fr; }
@media (min-width: 620px) { & .ctrls { grid-template-columns: 1fr 1fr; gap: var(--s5); } }
& .hint { font-size: var(--t-s); color: var(--fg-2); margin: 0; min-height: 1.5em; }
& table { width: 100%; border-collapse: collapse; font-size: var(--t-s); table-layout: fixed; }
& th { text-align: left; font-weight: 500; color: var(--fg-2); font-size: var(--t-xs); padding: 0 0 var(--s2); }
& th.n, & td.n { text-align: right; }
& td { padding: 5px 0; vertical-align: middle; border-top: 1px solid var(--line); }
& td.tok { padding-right: var(--s2); }
& td.tok .w { display: block; font: 500 var(--t-m)/1.25 var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
& td.tok .lg { display: block; font: 400 var(--t-xs)/1.3 var(--mono); color: var(--fg-2); }
& .bar { height: 14px; border-radius: 3px; background: var(--bg-3); overflow: hidden; }
& .bar i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 3px; transition: width .18s ease; }
& td.n { font-family: var(--mono); font-variant-numeric: tabular-nums; padding-left: var(--s2); white-space: nowrap; }
& tr.cut td.tok .w, & tr.cut td.n { color: var(--fg-2); }
& tr.cut td.tok .w { text-decoration: line-through; text-decoration-color: var(--fg-2); }
& tr.cut .bar i { background: color-mix(in srgb, var(--fg-2) 45%, var(--bg-3)); }
& tr.hit td { background: color-mix(in srgb, var(--accent) 9%, transparent); }
& .tally { font-weight: 500; }
& col.c-tok { width: 30%; }
& col.c-p, & col.c-f { width: 17%; }
& col.c-t { width: 11%; }
@media (max-width: 480px) { & col.c-tok { width: 32%; } & col.c-p, & col.c-f { width: 19%; } & col.c-t { width: 12%; } }
@media (prefers-reduced-motion: reduce) { & .bar i { transition: none; } }
& .btns { display: flex; flex-wrap: wrap; gap: var(--s2); }
`;

export function mount(root, ctx) {
  scopeStyle(root, meta.slug, STYLE);
  const logits = CANDS.map((c) => c[1]);
  let T = 1, topP = 0.9;
  let draws = []; // indices of the last WINDOW draws
  let last = -1;

  const pick = h("span", { class: "blank", "aria-hidden": "true" });
  const promptEl = h("p", { class: "prompt", "aria-live": "polite" }, PROMPT, " ", pick);

  const tSl = slider({ label: "Temperature", min: 0, max: 2, step: 0.05, value: T, format: (v) => v.toFixed(2), oninput: (v) => { T = v; update(); } });
  const pSl = slider({ label: "Top-p", min: 0.05, max: 1, step: 0.01, value: topP, format: (v) => v.toFixed(2), oninput: (v) => { topP = v; update(); } });
  const hint = h("p", { class: "hint", "aria-live": "polite" });

  const sKept = stat("Kept by top-p", ""), sTop = stat("Top token", ""), sDraws = stat(`Tally (last ${WINDOW})`, "0");

  const rows = CANDS.map(([w, l]) => {
    const bar = h("i");
    const pc = h("td", { class: "n" }), fc = h("td", { class: "n" }), tc = h("td", { class: "n tally" });
    const tr = h("tr", null,
      h("td", { class: "tok" }, h("span", { class: "w" }, w.trim()), h("span", { class: "lg" }, `logit ${l.toFixed(1)}`)),
      h("td", null, h("div", { class: "bar", "aria-hidden": "true" }, bar)),
      pc, fc, tc);
    return { tr, bar, pc, fc, tc };
  });
  const table = h("table", null,
    h("caption", { class: "sr-only" }, "Candidate next tokens with probability after temperature, probability after top-p, and draw tally"),
    h("colgroup", null, h("col", { class: "c-tok" }), h("col"), h("col", { class: "c-p" }), h("col", { class: "c-f" }), h("col", { class: "c-t" })),
    h("thead", null, h("tr", null, h("th", { scope: "col" }, "Next token"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Bar")), h("th", { scope: "col", class: "n" }, "Softmax"), h("th", { scope: "col", class: "n" }, "After top-p"), h("th", { scope: "col", class: "n" }, "Tally"))),
    h("tbody", null, rows.map((r) => r.tr)));

  const sampleBtn = h("button", { type: "button", class: "btn primary", onclick: () => draw(1) }, "Sample");
  const twentyBtn = h("button", { type: "button", class: "btn", onclick: () => draw(WINDOW) }, `Sample ${WINDOW}`);
  const resetBtn = h("button", { type: "button", class: "btn", onclick: () => { draws = []; last = -1; T = 1; topP = 0.9; tSl.set(T); pSl.set(topP); update(); } }, "Reset");

  const stage = h("div", { class: "stage" },
    h("div", { class: "panel" }, h("span", { class: "lbl" }, "Prompt and sampled next token"), promptEl),
    h("div", { class: "ctrls" }, tSl.el, pSl.el),
    hint,
    h("div", { class: "stats" }, sKept.el, sTop.el, sDraws.el),
    table,
    h("div", { class: "btns" }, sampleBtn, twentyBtn, resetBtn),
  );

  const learn = learnSections({
    happening: [
      p("The model gives every possible next token a score called a logit. Here ten candidates have fixed, hand-set logits. Softmax turns them into probabilities: ", code("p = exp(logit / T) / sum of exp(logit / T)"), "."),
      "Temperature T divides every logit before softmax. Below 1 it widens the gaps, so the top token takes more of the probability. Above 1 it shrinks the gaps and flattens the spread. At 0 the model is greedy and always takes the top token.",
      "Top-p sorts tokens from most to least likely and keeps the smallest group whose probabilities add up to at least p. Everything else is cut, and the kept probabilities are scaled back up to sum to 1. That is the After top-p column.",
      "Sample draws one token at random from the After top-p column. The tally counts the last 20 draws, so with enough draws it tracks those percentages.",
    ],
    tryThis: [
      "Set temperature to 0 and press Sample 20. Every draw is practice.",
      "Set temperature to 2 and top-p to 1. Press Sample 20 and see how often the rare words show up.",
      "Keep temperature at 1 and drag top-p down until only two tokens are left. Note where the cut happens.",
    ],
    check: {
      q: "Set top-p to 0.05. Why does Sample always return practice, at any temperature above 0?",
      options: [
        { text: "Top-p turns the temperature off.", right: false, why: "Temperature still reshapes the probabilities. Watch the Softmax column move while top-p stays at 0.05." },
        { text: "The top token alone already has at least 5%, so the kept group is one token.", right: true, why: "With ten candidates the most likely one always has at least 10%. That reaches 0.05 by itself, so top-p keeps only practice and its After top-p value is 100%." },
        { text: "Low top-p makes the model greedy by picking the highest logit on purpose.", right: false, why: "Top-p has no rule about logits. It just keeps the smallest group that reaches p, and here that group happens to hold one token." },
      ],
    },
  }, ctx);

  root.append(stage, learn);

  const pct = (v) => (v >= 0.9995 ? "100%" : v < 0.0005 && v > 0 ? "<0.1%" : `${(v * 100).toFixed(1)}%`);
  let cur = null;

  function update() {
    const pr = probs(logits, T);
    const { keep, final } = nucleus(pr, topP);
    cur = final;
    const tally = new Array(CANDS.length).fill(0);
    for (const d of draws) tally[d]++;
    let top = 0;
    pr.forEach((v, i) => { if (v > pr[top]) top = i; });
    rows.forEach((r, i) => {
      r.bar.style.width = `${(pr[i] * 100).toFixed(2)}%`;
      r.pc.textContent = pct(pr[i]);
      r.fc.textContent = keep[i] ? pct(final[i]) : "cut";
      r.tc.textContent = draws.length ? String(tally[i]) : "";
      r.tr.classList.toggle("cut", !keep[i]);
      r.tr.classList.toggle("hit", i === last);
    });
    const nk = keep.filter(Boolean).length;
    sKept.set(`${nk} of ${CANDS.length}`);
    sTop.set(pct(pr[top]));
    sDraws.set(`${draws.length} draws`);
    hint.textContent = T === 0
      ? "Temperature 0 is greedy decoding: the top token gets 100%."
      : T < 1 ? "Below 1: the gaps between logits grow, so the top tokens gain."
      : T > 1 ? "Above 1: the gaps shrink, so the spread flattens."
      : "At 1 the logits pass through softmax unchanged.";
    if (last >= 0) { pick.className = "pick"; pick.removeAttribute("aria-hidden"); pick.textContent = CANDS[last][0].trim(); }
    else { pick.className = "blank"; pick.setAttribute("aria-hidden", "true"); pick.textContent = ""; }
  }

  function sampleOnce() {
    const r = Math.random();
    let c = 0;
    for (let i = 0; i < cur.length; i++) { c += cur[i]; if (r < c && cur[i] > 0) return i; }
    for (let i = cur.length - 1; i >= 0; i--) if (cur[i] > 0) return i;
    return 0;
  }
  function draw(n) {
    for (let k = 0; k < n; k++) { last = sampleOnce(); draws.push(last); }
    if (draws.length > WINDOW) draws = draws.slice(-WINDOW);
    update();
  }

  update();
  return () => {};
}
