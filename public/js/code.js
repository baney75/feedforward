// A member's code: three or four words and two digits. Must accept everything the Worker's newCode() makes.
import { WORDS } from "./words.js";

export const isCode = (s) => /^[a-z]+[-\s_]+[a-z]+[-\s_]+[a-z]+(?:[-\s_]+[a-z]+)?[-\s_]+\d{2}$/i.test(s);

const KNOWN = new Set(WORDS);
const continues = (w) => WORDS.some((x) => x.startsWith(w));
const hasLonger = (w) => WORDS.some((x) => x.length > w.length && x.startsWith(w));
// Tidy a code as it is typed: lowercase, spaces become dashes, and a dash appears the moment a word can't go on.
// Words that begin longer words ("art", "artist") wait for the next letter. Old codes with other words keep their typed dashes.
export function formatCode(raw) {
  const s = String(raw).toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
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

// Any input marked data-code formats itself, and signs in by itself when the last digit lands.
if (typeof document !== "undefined") {
  let tried = "";
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches?.("[data-code]") && !isCode(el.value)) tried = "";
    if (!el.matches?.("[data-code]") || e.isComposing || e.inputType?.startsWith("delete") || el.selectionStart !== el.value.length) return;
    el.value = formatCode(el.value);
    if (isCode(el.value) && el.value !== tried) { tried = el.value; el.form?.requestSubmit(el.form.querySelector("[type=submit]") || undefined); }
  });
}
