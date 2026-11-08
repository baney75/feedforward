// Citation formatting shared by the Research page and the MCP server.
// Paper: { title, authors: [{family, given}], year, venue, volume, issue, pages, doi, arxiv, url }

const initials = (given = "") => given.split(/\s+/).filter(Boolean)
  .map((part) => part.split("-").map((p) => (p.endsWith(".") && p.length <= 3 ? p : p[0] + ".")).join("-")).join(" ");
// Group authors ("OpenAI", "DeepSeek-AI") arrive as { literal }.
const fam = (x) => x.literal || x.family || "";
const giv = (x) => (x.literal ? "" : x.given || "");
const isPreprint = (p) => !p.venue || /arxiv/i.test(p.venue);
const doiUrl = (p) => (p.doi ? `https://doi.org/${p.doi}` : p.arxiv ? `https://doi.org/10.48550/arXiv.${p.arxiv}` : p.url || "");
const endDot = (s) => (/[.?!]$/.test(s) ? s : s + ".");

export function apa(p) {
  const a = p.authors || [];
  const names = a.map((x) => (x.literal ? x.literal : `${x.family}, ${initials(x.given)}`.trim().replace(/,$/, "")));
  let who;
  if (names.length === 1) who = names[0];
  else if (names.length <= 20) who = names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
  else who = names.slice(0, 19).join(", ") + ", . . . " + names[names.length - 1];
  const head = `${endDot(who)} (${p.year}). ${endDot(p.title)}`;
  if (isPreprint(p)) return `${head} arXiv. ${doiUrl(p)}`;
  let src = `*${p.venue}*`;
  if (p.volume) src += `, *${p.volume}*`;
  if (p.issue) src += `(${p.issue})`;
  if (p.pages) src += `, ${p.pages.replace(/-+/, "-")}`;
  return `${head} ${src}. ${doiUrl(p)}`.trim();
}

export function mla(p) {
  const a = p.authors || [];
  let who = "";
  const inv = (x) => (x.literal ? x.literal : `${x.family}, ${x.given}`);
  const fwd = (x) => (x.literal ? x.literal : `${x.given} ${x.family}`);
  if (a.length === 1) who = inv(a[0]);
  else if (a.length === 2) who = `${inv(a[0])}, and ${fwd(a[1])}`;
  else if (a.length > 2) who = `${inv(a[0])}, et al`;
  const parts = [`${endDot(who)} "${endDot(p.title)}"`];
  const tail = [];
  tail.push(isPreprint(p) ? "*arXiv*" : `*${p.venue}*`);
  if (p.volume) tail.push(`vol. ${p.volume}`);
  if (p.issue) tail.push(`no. ${p.issue}`);
  tail.push(String(p.year));
  if (p.pages) tail.push(`pp. ${p.pages.replace("--", "-")}`);
  const link = p.doi ? `https://doi.org/${p.doi}` : p.arxiv ? `arxiv.org/abs/${p.arxiv}` : p.url;
  return `${parts[0]} ${tail.join(", ")}${link ? ", " + link : ""}.`;
}

export function chicago(p) {
  const a = p.authors || [];
  const list = a.length > 10 ? a.slice(0, 7) : a;
  const names = list.map((x, i) => (x.literal ? x.literal : i === 0 ? `${x.family}, ${x.given}` : `${x.given} ${x.family}`));
  let who = names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + (a.length > 10 ? ", " + names[names.length - 1] + ", et al" : ", and " + names[names.length - 1]);
  let src = isPreprint(p) ? `arXiv preprint` : `*${p.venue}*`;
  if (!isPreprint(p) && p.volume) src += ` ${p.volume}`;
  if (!isPreprint(p) && p.issue) src += ` (${p.issue})`;
  if (!isPreprint(p) && p.pages) src += `: ${p.pages.replace("--", "-")}`;
  return `${endDot(who)} ${p.year}. "${endDot(p.title)}" ${src}. ${doiUrl(p)}`.trim();
}

export function bibtex(p) {
  const a = p.authors || [];
  const first = (p.title.match(/[A-Za-z0-9]+/g) || ["paper"]).find((w) => !/^(a|an|the|on|of|in|for|and|to)$/i.test(w)) || "paper";
  const key = `${(a[0] ? fam(a[0]) : "anon").replace(/[^A-Za-z]/g, "").toLowerCase()}${p.year}${first.toLowerCase()}`;
  const pre = isPreprint(p);
  const type = pre ? "misc" : /proceedings|conference|advances in neural|international conference|workshop|symposium/i.test(p.venue) ? "inproceedings" : "article";
  const f = [["title", `{${p.title}}`], ["author", a.map((x) => (x.literal ? `{${x.literal}}` : `${x.family}, ${x.given}`)).join(" and ")], ["year", String(p.year)]];
  if (!pre) f.push([type === "inproceedings" ? "booktitle" : "journal", p.venue]);
  if (p.volume) f.push(["volume", String(p.volume)]);
  if (p.issue) f.push(["number", String(p.issue)]);
  if (p.pages) f.push(["pages", p.pages.replace(/-+/, "--")]);
  if (p.doi) f.push(["doi", p.doi]);
  if (p.arxiv) { f.push(["eprint", p.arxiv]); f.push(["archivePrefix", "arXiv"]); }
  f.push(["url", p.url || doiUrl(p)]);
  return `@${type}{${key},\n${f.map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
}

export const STYLES = { apa: ["APA 7", apa], mla: ["MLA 9", mla], chicago: ["Chicago", chicago], bibtex: ["BibTeX", bibtex] };
export const plain = (s) => s.replace(/\*/g, ""); // the *italic* markers, for plain-text copies
