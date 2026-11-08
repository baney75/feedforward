// Helpers shared by the lazily loaded pages. Every string from a user or a data file goes through esc().
import { esc, toast } from "../ui.js";

export const SITE = "https://feedforward.dbaney.com";
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const setTitle = (t) => { document.title = t ? `${t} · Feedforward` : "Feedforward: learn AI from the people building it"; };

// pages.css loads once, the first time any page module runs. Pages await it so they never paint unstyled.
export const cssReady = new Promise((res) => {
  const href = "/css/pages.css";
  const have = document.querySelector(`link[href="${href}"]`);
  if (have) { if (have.sheet) res(); else { have.addEventListener("load", res, { once: true }); have.addEventListener("error", res, { once: true }); } return; }
  const l = Object.assign(document.createElement("link"), { rel: "stylesheet", href });
  l.addEventListener("load", res, { once: true }); l.addEventListener("error", res, { once: true });
  document.head.appendChild(l);
  setTimeout(res, 1500);
});

export const loader = (label) => `<div class="ascii" role="status" aria-label="${esc(label || "Loading")}"${label ? ` data-label="${esc(label)}"` : ""}></div>`;

export async function copy(text, done = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch {
    // Older browsers and non-secure origins: a hidden textarea and execCommand.
    const t = Object.assign(document.createElement("textarea"), { value: text });
    t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); toast(done); } catch { toast("Copy didn't work. Select the text and copy it."); }
    t.remove();
  }
}

// Navigate inside the single-page app (the router listens for popstate).
export function go(href, replace = false) {
  replace ? history.replaceState(null, "", href) : history.pushState(null, "", href);
  dispatchEvent(new PopStateEvent("popstate"));
}

export const fmtDate = (ts, opts = { month: "short", day: "numeric", year: "numeric" }) => new Date(ts * 1000).toLocaleDateString(undefined, opts);

// Where an item key (v:, s:, p:, b:, r:, l:, d:, k:) lives on the site.
export function itemHref(item) {
  const [k, ...rest] = String(item || "").split(":");
  const id = rest.join(":");
  return ({ v: `/watch/${id}`, s: `/shorts/${id}`, b: "/books", r: `/research#${id}`, l: `/lab/${id}`, d: `/dictionary#${id}`, k: `/skills?id=${id}` })[k] || "";
}
export const itemLabel = (item) => ({ v: "a video", s: "a Short", p: "a post", b: "a book", r: "a paper", l: "a lab", d: "a term", k: "a skill", e: "an item" })[String(item || "")[0]] || "an item";

// A delegated click handler: on(root, "[data-x]", fn). Returns an unbind function.
export function on(root, sel, fn, type = "click") {
  const h = (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(t, e); };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}

// Runs an async action with its button disabled and errors shown as a toast.
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message || "Something went wrong."); return undefined; }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

// A pinned QR library from jsDelivr, checked against its hash, loaded only when a QR code is shown.
const QR_SRC = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
const QR_SRI = "sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k";
let qrLib = null;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLib) qrLib = new Promise((res, rej) => {
    const s = Object.assign(document.createElement("script"), { src: QR_SRC, integrity: QR_SRI, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
    s.onload = () => (window.qrcode ? res(window.qrcode) : rej(new Error("The QR code didn't load.")));
    s.onerror = () => { qrLib = null; rej(new Error("The QR code didn't load. Check your connection.")); };
    document.head.appendChild(s);
  });
  return qrLib;
}
// Returns an SVG string: black modules on white with a quiet zone, which every phone camera reads.
export async function qrSvg(text, label) {
  const qrcode = await loadQR();
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- Profile links ----------
// The server validates and normalizes every link (worker/api.js LINK_RULES). These build the public URLs.
// Brand marks are from Simple Icons 16.36.0 (CC0). LinkedIn and personal sites get a plain link icon.
const MARKS = {
  github: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  twitch: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
  bluesky: "M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026",
  googlescholar: "M5.242 13.769L0 9.5 12 0l12 9.5-5.242 4.269C17.548 11.249 14.978 9.5 12 9.5c-2.977 0-5.548 1.748-6.758 4.269zM12 10a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  x: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
  youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
};
export const LINK_FIELDS = [
  ["x", "X", "handle, like karpathy", (v) => `https://x.com/${v}`, "x"],
  ["youtube", "YouTube", "@handle", (v) => `https://www.youtube.com/${v}`, "youtube"],
  ["github", "GitHub", "username", (v) => `https://github.com/${v}`, "github"],
  ["scholar", "Google Scholar", "your Scholar profile link", (v) => `https://scholar.google.com/citations?user=${encodeURIComponent(v)}`, "googlescholar"],
  ["twitch", "Twitch", "channel name", (v) => `https://www.twitch.tv/${v}`, "twitch"],
  ["bluesky", "Bluesky", "handle, like you.bsky.social", (v) => `https://bsky.app/profile/${v}`, "bluesky"],
  ["linkedin", "LinkedIn", "profile name or link", (v) => `https://www.linkedin.com/in/${v}`, ""],
  ["site", "Website", "https://", (v) => v, ""],
];
const PLAIN = '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>';
const mark = (k) => `<svg class="lk-i" viewBox="0 0 24 24" aria-hidden="true">${MARKS[k] ? `<path d="${MARKS[k]}" fill="currentColor"/>` : PLAIN}</svg>`;
// Small labeled icon links. Only https URLs survive, and every one is nofollow ugc.
export function linkChips(links) {
  const out = [];
  for (const [k, label, , url, m] of LINK_FIELDS) {
    const v = links && links[k];
    if (!v) continue;
    const href = url(String(v));
    if (!/^https:\/\//.test(href)) continue;
    const text = k === "site" ? (() => { try { return new URL(href).host.replace(/^www\./, ""); } catch { return "Website"; } })() : label;
    out.push(`<a class="lk" href="${esc(href)}" target="_blank" rel="nofollow ugc noopener" title="${esc(label)}: ${esc(v)}">${mark(m)}<span>${esc(text)}</span></a>`);
  }
  return out.length ? `<div class="lks">${out.join("")}</div>` : "";
}
