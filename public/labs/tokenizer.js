import { h, scopeStyle, stat, learnSections, code, p } from "./_kit.js";

export const meta = {
  slug: "tokenizer",
  title: "See how a model reads",
  blurb: "Type anything and watch it split into the tokens GPT-4o actually sees.",
  minutes: 5,
  topic: "foundations",
};

const LIB = "https://cdn.jsdelivr.net/npm/gpt-tokenizer@4.0.3/esm/encoding/o200k_base.js";
const MAX_CHIPS = 1500;

const PRESETS = [
  ["Sentence", "The quick brown fox jumps over the lazy dog."],
  ["Code", "function add(a, b) {\n  return a + b;\n}"],
  ["Number", "1234567"],
  ["German", "Die Katze schläft auf dem Sofa."],
  ["Emoji", "I love pizza 🍕 and 🧑\u200d💻 code 👍"],
];

const STYLE = `
& .ta { width: 100%; min-height: 104px; resize: vertical; font: 400 var(--t-m)/1.5 var(--font); }
& .presets .btn { min-width: 0; }
& .chips { display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; min-height: 88px; padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); outline: none; }
& .chips:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
& .chip { display: inline-flex; align-items: center; min-height: 30px; padding: 2px 6px; border-radius: var(--r-s); font: 400 15px/1.35 var(--mono); white-space: pre; color: var(--fg); cursor: default; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
& .chip.t0 { background: color-mix(in srgb, var(--accent) 24%, var(--bg-2)); }
& .chip.t1 { background: color-mix(in srgb, var(--fg) 12%, var(--bg-2)); }
& .chip.t2 { background: color-mix(in srgb, var(--accent) 14%, var(--bg-2)); }
& .chip.t3 { background: color-mix(in srgb, var(--fg) 21%, var(--bg-2)); }
& .chip .ws { color: var(--fg-2); }
& .chip .hex { font-size: 12px; color: var(--fg-2); letter-spacing: .02em; }
& .chip[aria-selected="true"] { box-shadow: 0 0 0 2px var(--accent); }
& .brk { flex-basis: 100%; height: 0; }
& .info { min-height: 48px; font-size: var(--t-s); color: var(--fg-2); display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); align-items: baseline; }
& .info b { font: 500 var(--t-s)/1.4 var(--mono); color: var(--fg); }
& .legend { font-size: var(--t-s); color: var(--fg-2); margin: 0; }
& .legend .mono { color: var(--fg); }
& .status { font-size: var(--t-s); color: var(--fg-2); }
`;

// Walk UTF-8 bytes and split them into whole characters and loose bytes.
function utf8Parts(bytes) {
  const parts = [];
  let i = 0;
  const dec = new TextDecoder("utf-8", { fatal: true });
  while (i < bytes.length) {
    const b = bytes[i];
    const n = b < 0x80 ? 1 : (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 0;
    let ok = n > 0 && i + n <= bytes.length;
    for (let k = 1; ok && k < n; k++) ok = (bytes[i + k] & 0xc0) === 0x80;
    if (ok) {
      try { parts.push({ text: dec.decode(bytes.subarray(i, i + n)) }); i += n; continue; } catch { /* fall through */ }
    }
    parts.push({ hex: b.toString(16).toUpperCase().padStart(2, "0") });
    i += 1;
  }
  return parts;
}

export function mount(root, ctx) {
  scopeStyle(root, meta.slug, STYLE);
  let enc = null;
  let timer = 0;
  let tokens = [];
  let sel = -1;
  let alive = true;

  const taId = "tok-text";
  const ta = h("textarea", { id: taId, class: "ta input", rows: 4, maxlength: 6000, spellcheck: "false" });
  ta.value = PRESETS[0][1];
  const presetBtns = PRESETS.map(([name, text]) => h("button", { type: "button", class: "btn", onclick: () => { ta.value = text; sel = -1; run(); ta.focus(); } }, name));

  const sTok = stat("Tokens", "0"), sChr = stat("Characters", "0"), sCpt = stat("Characters per token", "0");
  const chips = h("div", { class: "chips", role: "listbox", tabindex: "0", "aria-label": "Tokens. Use the arrow keys to move between tokens.", "aria-orientation": "horizontal" });
  const info = h("div", { class: "info", "aria-live": "polite" });
  const status = h("div", { class: "status", role: "status" }, "Loading the o200k_base tokenizer (about 2.4 MB)...");

  const stage = h("div", { class: "stage" },
    h("div", { class: "field" }, h("label", { for: taId }, "Text"), ta),
    h("div", { class: "row presets", role: "group", "aria-label": "Examples" }, h("span", { class: "lbl" }, "Examples"), ...presetBtns),
    h("div", { class: "stats" }, sTok.el, sChr.el, sCpt.el),
    status,
    chips,
    info,
    h("p", { class: "legend" }, h("span", { class: "mono" }, "·"), " marks a space and ", h("span", { class: "mono" }, "↵"), " a new line. Gray hex like ", h("span", { class: "mono" }, "F0 9F"), " is a piece of a character that was split across tokens, and ", h("span", { class: "mono" }, "U+200D"), " names an invisible character. Hover, tap or use the arrow keys to see a token's id."),
  );

  const learn = learnSections({
    happening: [
      "A language model never sees letters or words. It sees a list of whole numbers called token ids, and each id stands for a chunk of bytes.",
      p("This lab runs the real ", code("o200k_base"), " encoding used by GPT-4o. Its vocabulary has about 200,000 chunks, learned by byte pair encoding: start from single bytes and keep merging the pairs that show up most often in training text."),
      "Common words become one token, and rare words split into pieces. A space usually rides on the front of the next word, so \" cat\" and \"cat\" are different tokens with different ids.",
      "Digits split into groups of at most three, read from the left. A character the vocabulary lacks, like many emoji, falls back to its raw UTF-8 bytes, which can take several tokens.",
      "Prices, context limits and speed are all counted in tokens, so characters per token tells you how efficiently a kind of text packs.",
    ],
    tryThis: [
      "Press Number, then add one digit at a time. Watch where the groups of three break.",
      "Type cat, then a space and cat again. Compare the two ids by hovering each chip.",
      "Press German and Emoji. Compare their characters per token with the English sentence.",
    ],
    check: {
      q: "How does o200k_base split the number 1234567?",
      options: [
        { text: "1 | 234 | 567", right: false, why: "The groups start at the left, not the right. Try it with the Number button: it is 123 | 456 | 7." },
        { text: "123 | 456 | 7", right: true, why: "The tokenizer cuts runs of digits into chunks of up to three, starting from the left, so the leftover digit lands at the end." },
        { text: "One token for the whole number", right: false, why: "Long numbers are not in the vocabulary as single tokens. Digits are split into chunks of at most three." },
        { text: "One token per digit", right: false, why: "Single digits are tokens, but this encoding merges up to three digits at a time." },
      ],
    },
  }, ctx);

  root.append(stage, learn);

  function setSel(i, scroll) {
    const prev = chips.children[chipIndex(sel)];
    if (prev) prev.setAttribute("aria-selected", "false");
    sel = i;
    const el = chips.children[chipIndex(i)];
    if (!el) { info.replaceChildren(); chips.removeAttribute("aria-activedescendant"); return; }
    el.setAttribute("aria-selected", "true");
    chips.setAttribute("aria-activedescendant", el.id);
    if (scroll) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const t = tokens[i];
    info.replaceChildren(
      h("span", null, "Token ", h("b", null, `${i + 1} of ${tokens.length}`)),
      h("span", null, "id ", h("b", null, String(t.id))),
      h("span", null, "text ", h("b", null, JSON.stringify(t.label))),
      ...(t.part ? [h("span", null, "part of ", h("b", null, t.part))] : []),
    );
  }
  // Map token index to child index (line breaks add extra children).
  let childOf = [];
  const chipIndex = (i) => (i >= 0 && i < childOf.length ? childOf[i] : -1);

  function render(text) {
    const ids = enc.encode(text);
    const core = enc.default.bytePairEncodingCoreProcessor;
    const te = new TextEncoder();
    // Raw bytes for each token, read straight from the vocabulary.
    const byteList = ids.map((id) => {
      const v = core.tryDecodeToken(id);
      return typeof v === "string" ? te.encode(v) : v || new Uint8Array();
    });
    // Find characters that span more than one token.
    const all = te.encode(text);
    const owner = [];
    byteList.forEach((b, ti) => { for (let k = 0; k < b.length; k++) owner.push(ti); });
    const partOf = new Map();
    for (let i = 0; i < all.length;) {
      const b = all[i];
      const n = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      if (owner[i] !== owner[i + n - 1]) {
        const ch = new TextDecoder().decode(all.subarray(i, i + n));
        for (let k = i; k < i + n; k++) if (!partOf.has(owner[k])) partOf.set(owner[k], ch);
      }
      i += n;
    }
    tokens = ids.map((id, i) => {
      const parts = utf8Parts(byteList[i]);
      const label = parts.map((x) => x.text ?? `\\x${x.hex}`).join("");
      return { id, parts, label, part: partOf.get(i) };
    });

    const frag = document.createDocumentFragment();
    childOf = [];
    let n = 0;
    const shown = Math.min(tokens.length, MAX_CHIPS);
    for (let i = 0; i < shown; i++) {
      const t = tokens[i];
      const chip = h("span", { class: `chip t${i % 4}`, role: "option", id: `tok-c${i}`, "aria-selected": "false", title: `id ${t.id}` });
      chip.dataset.i = i;
      let breaks = 0;
      for (const part of t.parts) {
        if (part.hex) { chip.append(h("span", { class: "hex" }, (chip.lastChild && chip.lastChild.className === "hex" ? " " : "") + part.hex)); continue; }
        for (const c of part.text) {
          if (c === " ") chip.append(h("span", { class: "ws" }, "·"));
          else if (c === "\n") { chip.append(h("span", { class: "ws" }, "↵")); breaks++; }
          else if (c === "\t") chip.append(h("span", { class: "ws" }, "→"));
          else if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(c)) chip.append(h("span", { class: "hex" }, `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`));
          else chip.append(c);
        }
      }
      chip.setAttribute("aria-label", `${t.label.replace(/ /g, "space ").replace(/\n/g, "new line ")}, id ${t.id}`);
      frag.append(chip);
      childOf[i] = n++;
      for (let b = 0; b < breaks; b++) { frag.append(h("span", { class: "brk", "aria-hidden": "true" })); n++; }
    }
    if (tokens.length > shown) frag.append(h("span", { class: "lbl" }, `and ${tokens.length - shown} more tokens`));
    chips.replaceChildren(frag);

    let chars = 0;
    if (typeof Intl !== "undefined" && Intl.Segmenter) for (const _ of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) chars++;
    else chars = [...text].length;
    sTok.set(String(tokens.length));
    sChr.set(String(chars));
    sCpt.set(tokens.length ? (chars / tokens.length).toFixed(2) : "0");
    if (sel >= tokens.length) sel = -1;
    setSel(sel, false);
  }

  function run() {
    if (!enc) return;
    clearTimeout(timer);
    timer = setTimeout(() => render(ta.value), 40);
  }

  ta.addEventListener("input", run);
  const pick = (e) => { const c = e.target.closest(".chip"); if (c) setSel(+c.dataset.i, false); };
  chips.addEventListener("pointerover", (e) => { if (e.pointerType === "mouse") pick(e); });
  chips.addEventListener("click", pick);
  chips.addEventListener("keydown", (e) => {
    const last = Math.min(tokens.length, MAX_CHIPS) - 1;
    if (last < 0) return;
    let i = sel;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = Math.min(last, sel + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = Math.max(0, sel < 0 ? 0 : sel - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = last;
    else return;
    e.preventDefault();
    setSel(i, true);
  });
  chips.addEventListener("focus", () => { if (sel < 0 && tokens.length) setSel(0, false); });

  import(LIB).then((m) => {
    if (!alive) return;
    enc = m;
    status.remove();
    render(ta.value);
  }).catch((err) => {
    if (!alive) return;
    status.replaceWith(h("div", { class: "err", role: "alert" }, h("strong", null, "The tokenizer did not load. "), "It comes from cdn.jsdelivr.net, so check your connection or any blocker, then reload. ", h("span", { class: "muted" }, `(${err && err.message ? err.message : err})`)));
  });

  return () => { alive = false; clearTimeout(timer); };
}
