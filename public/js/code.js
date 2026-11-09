// A member's code: three or four words and two digits. Must accept everything the Worker's newCode() makes.
import { WORDS } from "./words.js";

export const isCode = (s) => /^[a-z]+[-\s_]+[a-z]+[-\s_]+[a-z]+(?:[-\s_]+[a-z]+)?[-\s_]+\d{2}$/i.test(s);

const KNOWN = new Set(WORDS);
const continues = (w) => WORDS.some((x) => x.startsWith(w));
const hasLonger = (w) => WORDS.some((x) => x.length > w.length && x.startsWith(w));
// Tidy a code as it is typed: lowercase, spaces become dashes, and a dash appears the moment a word can't go on.
// Words that begin longer words ("art", "artist") wait for the next letter. Old codes with other words keep their typed dashes.
export function formatCode(raw) {
  const s = String(raw).toLowerCase().replace(/[\s_\u2010-\u2015]+/g, "-").replace(/[^a-z0-9-]/g, ""); // Phones turn "--" into a long dash.
  if (isCode(s)) return s.replace(/-+/g, "-"); // A whole code, pasted or typed with its dashes, is left as it is.
  const parts = []; let w = "", digits = "";
  const close = () => { if (w) { parts.push(w); w = ""; } };
  for (const c of s) {
    if (/\d/.test(c)) { close(); digits += c; continue; }
    if (digits) break;
    if (c === "-") { close(); continue; }
    if (KNOWN.has(w) && !continues(w + c)) close();
    w += c;
  }
  if (digits) return [...parts, w].filter(Boolean).concat(digits.slice(0, 2)).join("-");
  const done = KNOWN.has(w) && !hasLonger(w);
  if (done) close();
  const typedDash = s.endsWith("-");
  if (w) return [...parts, w].join("-");
  return parts.length ? parts.join("-") + (done || typedDash ? "-" : "") : "";
}

// One keystroke. Typing your own dash or space, or deleting a dash, means you know better than the auto dashes,
// so they stay off until the field is empty. Old codes with words outside the list need that ("maple" begins with "map").
const tidy = (v) => String(v).toLowerCase().replace(/[\s_\u2010-\u2015]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-/, "");
export function stepCode(st, value, e = {}) {
  if (!value) st.manual = st.held = false;
  if (e.inputType?.startsWith("delete")) {
    // Deleting a dash and then a letter is fixing a typo, so the auto dashes come back. Deleting a dash and typing on is an old code.
    if (st.last?.endsWith("-") && value === st.last.slice(0, -1)) { st.manual = true; st.held = true; }
    else if (st.held) st.manual = st.held = false;
    return (st.last = value);
  }
  if (e.data?.length === 1 && /[-\s_]/.test(e.data)) { st.manual = true; st.held = false; }
  return (st.last = st.manual ? tidy(value) : formatCode(value));
}

// Any input marked data-code formats itself, and signs in by itself when the last digit lands.
if (typeof document !== "undefined") {
  let tried = "";
  const states = new WeakMap();
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches?.("[data-code]")) return;
    if (!isCode(el.value)) tried = "";
    if (!states.has(el)) states.set(el, {});
    const st = states.get(el);
    if (e.isComposing || el.selectionStart !== el.value.length) { st.last = el.value; return; }
    el.value = stepCode(st, el.value, e);
    if (e.inputType?.startsWith("delete")) return;
    if (isCode(el.value) && el.value !== tried) { tried = el.value; el.form?.requestSubmit(el.form.querySelector("[type=submit]") || undefined); }
  });
}
