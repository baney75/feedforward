// Pure helpers for the local-llm lab: tool schemas, an exact calculator, and parsers for the
// tool-call formats small models write. No DOM and no network, so the worker, the page and tests share it.

export const TOOL_SPECS = [
  {
    name: "calculate",
    description: "Evaluate an arithmetic expression exactly. Supports + - * / ^ %, parentheses, sqrt(). Use it for any math.",
    parameters: { type: "object", properties: { expression: { type: "string", description: "The expression, for example 17*23 or (2+3)^4" } }, required: ["expression"] },
  },
  {
    name: "search_wikipedia",
    description: "Search English Wikipedia for facts, people, events, places and recent history. Returns short article summaries.",
    parameters: { type: "object", properties: { query: { type: "string", description: "A short search query, for example 2024 Nobel Prize in Physics" } }, required: ["query"] },
  },
  {
    name: "search_localtube",
    description: "Search this site's catalog of AI learning videos. Use it when the user wants a video, talk, course or person to learn from.",
    parameters: { type: "object", properties: { query: { type: "string", description: "One to three keywords, for example attention or transformers" } }, required: ["query"] },
  },
  {
    name: "get_current_date",
    description: "Get today's date, weekday and local time from the user's device. You cannot know the date without it.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

export const toolsForTemplate = () => TOOL_SPECS.map((f) => ({ type: "function", function: f }));

// ---------- Exact calculator: a recursive descent parser over BigInt fractions. No eval. ----------

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
function frac(n, d = 1n) {
  if (d === 0n) throw new Error("division by zero");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const isInt = (x) => x.d === 1n;
const toNum = (x) => (typeof x === "number" ? x : Number(x.n) / Number(x.d));
function fromNum(v) {
  if (!Number.isFinite(v)) throw new Error("result is not a finite number");
  return v; // floats stay floats after sqrt or fractional powers
}
function fromDecimal(s) {
  const [i, f = ""] = s.split(".");
  return frac(BigInt((i || "0") + f), 10n ** BigInt(f.length));
}
const OPS = {
  "+": (a, b) => (typeof a === "number" || typeof b === "number" ? fromNum(toNum(a) + toNum(b)) : frac(a.n * b.d + b.n * a.d, a.d * b.d)),
  "-": (a, b) => (typeof a === "number" || typeof b === "number" ? fromNum(toNum(a) - toNum(b)) : frac(a.n * b.d - b.n * a.d, a.d * b.d)),
  "*": (a, b) => (typeof a === "number" || typeof b === "number" ? fromNum(toNum(a) * toNum(b)) : frac(a.n * b.n, a.d * b.d)),
  "/": (a, b) => {
    if (typeof a === "number" || typeof b === "number") { if (toNum(b) === 0) throw new Error("division by zero"); return fromNum(toNum(a) / toNum(b)); }
    if (b.n === 0n) throw new Error("division by zero");
    return frac(a.n * b.d, a.d * b.n);
  },
  "%": (a, b) => {
    if (typeof a !== "number" && typeof b !== "number" && isInt(a) && isInt(b)) { if (b.n === 0n) throw new Error("division by zero"); return frac(a.n % b.n); }
    return fromNum(toNum(a) % toNum(b));
  },
  "^": (a, b) => {
    if (typeof a !== "number" && typeof b !== "number" && isInt(b)) {
      const e = b.n < 0n ? -b.n : b.n;
      if (e > 4096n) throw new Error("exponent too large");
      const p = frac(a.n ** e, a.d ** e);
      return b.n < 0n ? frac(p.d, p.n) : p;
    }
    return fromNum(Math.pow(toNum(a), toNum(b)));
  },
};
const FUNCS = {
  sqrt: (x) => {
    if (toNum(x) < 0) throw new Error("square root of a negative number");
    if (typeof x !== "number") { const r = isqrtFrac(x); if (r) return r; }
    return fromNum(Math.sqrt(toNum(x)));
  },
  abs: (x) => (typeof x === "number" ? Math.abs(x) : frac(x.n < 0n ? -x.n : x.n, x.d)),
};
function isqrt(n) { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; }
function isqrtFrac(x) { const a = isqrt(x.n), b = isqrt(x.d); return a * a === x.n && b * b === x.d ? frac(a, b) : null; }

function tokenize(src) {
  const s = String(src)
    .replace(/[×xX]/g, "*").replace(/[÷]/g, "/").replace(/\*\*/g, "^").replace(/[−]/g, "-")
    .replace(/(\d),(?=\d{3}\b)/g, "$1") // 1,000 -> 1000
    .replace(/\btimes\b/gi, "*").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-").replace(/\bdivided by\b/gi, "/");
  const out = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)(?:e([+-]?\d+))?|([a-z]+)|(.))/gy;
  let m;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[1] !== undefined) {
      let v = fromDecimal(m[1]);
      if (m[2]) { const e = BigInt(m[2]); v = e >= 0n ? frac(v.n * 10n ** e, v.d) : frac(v.n, v.d * 10n ** -e); }
      out.push({ t: "num", v });
    } else if (m[3] !== undefined) out.push({ t: "id", v: m[3].toLowerCase() });
    else if (m[4] !== undefined && m[4].trim()) out.push({ t: "op", v: m[4] });
  }
  return out;
}

export function calculate(expression) {
  const toks = tokenize(expression);
  if (!toks.length) throw new Error("empty expression");
  let i = 0;
  const peek = () => toks[i];
  const eat = (v) => { const t = toks[i]; if (!t || t.v !== v) throw new Error(`expected "${v}"`); i++; };
  // expr := term (('+'|'-') term)*
  const expr = () => { let a = term(); while (peek()?.t === "op" && "+-".includes(peek().v)) { const o = toks[i++].v; a = OPS[o](a, term()); } return a; };
  // term := unary (('*'|'/'|'%') unary | implicit multiply)*
  const term = () => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && "*/%".includes(t.v)) { i++; a = OPS[t.v](a, unary()); }
      else if (t && (t.v === "(" || t.t === "num" || t.t === "id")) a = OPS["*"](a, unary());
      else return a;
    }
  };
  const unary = () => {
    const t = peek();
    if (t?.t === "op" && t.v === "-") { i++; return OPS["-"](frac(0n), unary()); }
    if (t?.t === "op" && t.v === "+") { i++; return unary(); }
    return power();
  };
  // power := atom ('^' unary)?   (right associative)
  const power = () => { const a = atom(); if (peek()?.t === "op" && peek().v === "^") { i++; return OPS["^"](a, unary()); } return a; };
  const atom = () => {
    const t = toks[i++];
    if (!t) throw new Error("expression ends too early");
    if (t.t === "num") {
      const nx = toks[i + 1];
      const pct = peek()?.t === "op" && peek().v === "%" && (!nx || (nx.t === "op" && nx.v !== "(") || (nx.t === "id" && nx.v === "of"));
      if (pct) { i++; return OPS["/"](t.v, frac(100n)); }
      return t.v;
    }
    if (t.t === "op" && t.v === "(") { const v = expr(); eat(")"); return v; }
    if (t.t === "id") {
      if (t.v === "pi") return Math.PI;
      if (t.v === "e") return Math.E;
      if (t.v === "of") return frac(1n); // "20% of 50"
      const f = FUNCS[t.v];
      if (!f) throw new Error(`unknown name "${t.v}"`);
      eat("("); const v = expr(); eat(")");
      return f(v);
    }
    throw new Error(`unexpected "${t.v}"`);
  };
  const v = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  return formatValue(v);
}

function formatValue(v) {
  if (typeof v === "number") return String(Number(v.toPrecision(12)));
  if (isInt(v)) return v.n.toString();
  // Terminating decimal? (denominator only has factors 2 and 5)
  let d = v.d; while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n;
  const approx = String(Number((Number(v.n) / Number(v.d)).toPrecision(12)));
  return d === 1n ? approx : `${v.n}/${v.d} (about ${approx})`;
}

// ---------- Tool-call parsing ----------
// Handles three formats:
//  1. Qwen3.5 (qwen3_coder XML): <tool_call><function=NAME><parameter=KEY>VALUE</parameter></function></tool_call>
//  2. Hermes JSON (Qwen3, SmolLM3): <tool_call>{"name": "...", "arguments": {...}}</tool_call>
//  3. LFM2 / LFM2.5 Pythonic: <|tool_call_start|>[name(key="value"), other()]<|tool_call_end|>

export function parseToolCalls(text) {
  const calls = [];
  let firstAt = -1;
  const mark = (i) => { if (firstAt < 0 || i < firstAt) firstAt = i; };

  const lfm = /<\|tool_call_start\|>([\s\S]*?)(?:<\|tool_call_end\|>|$)/g;
  for (const m of text.matchAll(lfm)) {
    const body = m[1].trim();
    if (!body) continue;
    mark(m.index);
    const json = tryJSON(body);
    if (json) calls.push(...jsonCalls(json));
    else calls.push(...pythonicCalls(body));
  }

  const tc = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
  for (const m of text.matchAll(tc)) {
    const body = m[1].trim();
    if (!body) continue;
    mark(m.index);
    const fn = /<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/g;
    let found = false;
    for (const f of body.matchAll(fn)) {
      found = true;
      const args = {};
      for (const p of f[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)(?:<\/parameter>|$)/g)) args[p[1]] = coerce(p[2].trim());
      calls.push({ name: f[1], args });
    }
    if (!found) { const json = tryJSON(body); if (json) calls.push(...jsonCalls(json)); }
  }
  const before = firstAt >= 0 ? text.slice(0, firstAt) : text;
  return { calls: calls.filter((c) => c && typeof c.name === "string" && c.name), before: stripThink(before).trim() };
}

export function stripThink(s) { return s.replace(/<think>[\s\S]*?(<\/think>|$)/g, ""); }

function tryJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function jsonCalls(j) {
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((c) => {
    const f = c?.function || c;
    let args = f?.arguments ?? f?.parameters ?? {};
    if (typeof args === "string") args = tryJSON(args) || {};
    return { name: f?.name, args };
  });
}
function coerce(v) {
  if (/^-?\d+(\.\d+)?$/.test(v)) return v; // keep numbers as text so expressions stay exact
  const j = tryJSON(v);
  return j !== null && typeof j === "object" ? j : v;
}

// Parse a Python-style list of calls: [a(x="1", y=2), b()]
export function pythonicCalls(src) {
  const s = src.trim().replace(/^\[/, "").replace(/\]$/, "");
  const out = [];
  let i = 0;
  const ws = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  while (i < s.length) {
    ws();
    const nm = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
    if (!nm) break;
    i += nm[0].length;
    while (s[i] === " ") i++;
    if (s[i] !== "(") break;
    i++;
    const args = {};
    for (;;) {
      ws();
      if (i >= s.length) break;
      if (s[i] === ")") { i++; break; }
      const k = /^[A-Za-z_]\w*/.exec(s.slice(i));
      if (!k) break;
      i += k[0].length;
      while (s[i] === " ") i++;
      if (s[i] !== "=") break;
      i++;
      while (s[i] === " ") i++;
      const [val, next] = pyValue(s, i);
      args[k[0]] = val;
      i = next;
    }
    out.push({ name: nm[0], args });
  }
  return out;
}
function pyValue(s, i) {
  const q = s[i];
  if (q === '"' || q === "'") {
    let j = i + 1, v = "";
    while (j < s.length && s[j] !== q) { if (s[j] === "\\" && j + 1 < s.length) { v += s[j + 1]; j += 2; } else v += s[j++]; }
    return [v, j + 1];
  }
  let j = i, depth = 0;
  while (j < s.length) {
    const c = s[j];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) break;
    j++;
  }
  const raw = s.slice(i, j).trim();
  if (raw === "True") return [true, j];
  if (raw === "False") return [false, j];
  if (raw === "None") return [null, j];
  return [raw, j];
}

// ---------- Runaway repetition ----------
// True when the tail of `ids` is the same block of 1 to 40 tokens repeated, covering at least `minSpan` tokens.
export function isLooping(ids, { minSpan = 48, maxPeriod = 40 } = {}) {
  const n = ids.length;
  if (n < minSpan) return false;
  for (let p = 1; p <= maxPeriod && p * 2 <= n; p++) {
    const need = Math.max(minSpan, p * 3);
    if (need > n) continue;
    let ok = true;
    for (let k = 1; k <= need - p; k++) if (ids[n - k] !== ids[n - k - p]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// Short, readable summary of a tool's arguments for the chat log.
export function argText(args) {
  const e = Object.entries(args || {});
  if (!e.length) return "";
  if (e.length === 1) return typeof e[0][1] === "string" ? e[0][1] : JSON.stringify(e[0][1]);
  return e.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}

// ---------- The chat loop ----------
// Text the learner should see while a reply streams: no special tokens, no tool-call markup, no empty think block.
const SPECIAL = /<\|(?:im_end|im_start|endoftext|startoftext|eot_id|end_of_text|return|end)\|>|<end_of_turn>|<eos>|<\/s>/g;
export function visible(raw) {
  let s = stripThink(raw).replace(SPECIAL, "");
  const cut = s.search(/<tool_call>|<\|tool_call_start\|>/);
  if (cut >= 0) s = s.slice(0, cut);
  return s.replace(/<[^>\s]*$/, "").replace(/^\s+/, "");
}

/**
 * Run one user turn: generate, run any tool calls, feed results back, repeat until the model answers.
 * T is the transformers.js module. emit(event) reports progress. runTool(call) returns a string.
 */
export async function chatTurn({ T, tok, model, messages, useTools, gen, maxNewTokens = 320, maxRounds = 4, runTool, emit, stopper }) {
  const convo = messages.slice();
  // tps counts only decoding: tokens after the first in each round, over the time they took.
  const stats = { tokens: 0, ms: 0, ttft: 0, prompt: 0, tps: 0, decTokens: 0, decMs: 0 };
  const tStart = performance.now();
  // Thinking is off. Some models (LFM3) open a <think> block anyway, so when it is one token, never sample it.
  const thinkIds = tok.encode("<think>", { add_special_tokens: false });
  const noThink = thinkIds.length === 1 ? thinkIds[0] : null;
  for (let round = 0; ; round++) {
    const capped = round >= maxRounds;
    const inputs = tok.apply_chat_template(convo, {
      tools: useTools && !capped ? toolsForTemplate() : undefined,
      add_generation_prompt: true, return_dict: true, enable_thinking: false,
    });
    const promptLen = inputs.input_ids.dims.at(-1);
    stats.prompt = promptLen;
    let raw = "", count = 0, tFirst = 0, looped = false;
    const t0 = performance.now();
    class LoopStop extends T.StoppingCriteria {
      _call(ids) { return ids.map((row) => { const gen = row.slice(promptLen); const hit = isLooping(gen); if (hit) looped = true; return hit; }); }
    }
    // Presence penalty on the reply so far, as the Qwen3.5 card recommends. It leaves the prompt alone,
    // so the model can still copy numbers and names out of a tool result.
    class Shape extends T.LogitsProcessor {
      constructor(p) { super(); this.p = p; }
      _call(ids, logits) {
        for (let i = 0; i < ids.length; i++) {
          const data = logits[i].data;
          if (this.p) for (const t of new Set(ids[i].slice(promptLen))) data[Number(t)] -= this.p;
          if (noThink != null) data[noThink] = -Infinity;
        }
        return logits;
      }
    }
    const streamer = new T.TextStreamer(tok, {
      skip_prompt: true, skip_special_tokens: false,
      token_callback_function: () => {
        count++;
        const now = performance.now();
        if (count === 1) { tFirst = now; if (!stats.ttft) stats.ttft = now - tStart; }
        emit({ type: "tick", count: stats.tokens + count, tps: count > 1 ? (count - 1) / ((now - tFirst) / 1000) : 0, ttft: stats.ttft });
      },
      callback_function: (text) => { raw += text; emit({ type: "text", round, text: visible(raw) }); },
    });
    const { presence_penalty = 0, ...rest } = gen || {};
    await model.generate({
      ...inputs, ...rest, max_new_tokens: maxNewTokens, streamer,
      stopping_criteria: [stopper, new LoopStop()].filter(Boolean),
      logits_processor: presence_penalty || noThink != null ? [new Shape(presence_penalty)] : null,
    });
    const tEnd = performance.now();
    stats.tokens += count;
    stats.ms += tEnd - t0;
    if (count > 1) { stats.decTokens += count - 1; stats.decMs += tEnd - tFirst; }
    stats.tps = stats.decMs ? stats.decTokens / (stats.decMs / 1000) : 0;
    const clean = raw.replace(SPECIAL, "").trim();
    const { calls, before } = useTools && !capped ? parseToolCalls(clean) : { calls: [], before: clean };
    const genTps = count > 1 ? (count - 1) / ((tEnd - tFirst) / 1000) : 0;
    if (!calls.length || stopper?.interrupted) {
      const text = visible(clean);
      emit({ type: "answer", round, text, looped, stopped: !!stopper?.interrupted, capped, tps: genTps });
      return { text, convo, stats, looped, rounds: round, stopped: !!stopper?.interrupted, capped };
    }
    emit({ type: "round", round, before, calls, tps: genTps });
    convo.push({ role: "assistant", content: clean });
    for (const call of calls.slice(0, 3)) {
      const id = `${round}-${call.name}-${Math.random().toString(36).slice(2, 7)}`;
      emit({ type: "tool_start", id, round, name: call.name, args: call.args });
      const t = performance.now();
      let result, ok = true;
      try { result = await runTool(call); } catch (err) { ok = false; result = "Error: " + (err?.message || err); }
      result = String(result).slice(0, 2400);
      emit({ type: "tool_end", id, round, name: call.name, args: call.args, result, ok, ms: performance.now() - t });
      convo.push({ role: "tool", name: call.name, content: result });
    }
  }
}

// ---------- Tool implementations ----------
// deps: fetch (for Wikipedia), loadCatalog() -> data.js module after load(), now() -> Date.
const STOP = new Set("a an and are best can do find for from good give how i in is it me of on or please show some that the this to video videos what where which who why with works work about".split(" "));
const trimTo = (s, n) => { s = s.replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const cut = s.slice(0, n); const dot = cut.lastIndexOf(". "); return (dot > n * 0.5 ? cut.slice(0, dot + 1) : cut.replace(/\s\S*$/, "")) + " ..."; };
const mmss = (sec) => {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
};

export function makeToolRunner({ fetch: f = globalThis.fetch, loadCatalog, now = () => new Date(), origin = globalThis.location?.origin || "" } = {}) {
  const impl = {
    calculate: ({ expression }) => {
      if (!expression) throw new Error("no expression given");
      const e = String(expression);
      return `${e} = ${calculate(e)}`;
    },
    get_current_date: () => {
      const d = now();
      const day = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
      return `Today is ${day}. The local time is ${time}${tz ? ` (${tz})` : ""}.`;
    },
    search_wikipedia: async ({ query }) => {
      const q = String(query || "").trim().slice(0, 200);
      if (!q) throw new Error("no query given");
      const api = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query";
      const getJSON = async (u, tries = 2) => {
        const r = await f(u);
        if (r.status === 429 && tries > 1) { await new Promise((ok) => setTimeout(ok, 1200)); return getJSON(u, tries - 1); }
        if (!r.ok) throw new Error("Wikipedia answered " + r.status + (r.status === 429 ? " (too many requests, try again in a minute)" : ""));
        return r.json();
      };
      const search = (s) => getJSON(api + "&list=search&srlimit=5&srprop=snippet&srsearch=" + encodeURIComponent(s)).then((j) => j?.query?.search || []);
      // The plain search finds the topic's own article. The exact phrase finds pages that state the fact
      // ("jointly awarded the 2024 Nobel Prize in Physics"). Keep the best of each.
      // Words like "winner" or "who" rarely sit next to the fact, so trim them off the ends of the phrase.
      const FILLER = /^(who|what|when|where|which|why|how|is|was|are|were|did|does|the|a|an|winners?|won|win|recipients?|list|latest|current|today|now|about|info|information|facts?)$/i;
      const words = q.replace(/["?!.,]/g, " ").split(/\s+/).filter(Boolean);
      while (words.length && FILLER.test(words[0])) words.shift();
      while (words.length && FILLER.test(words[words.length - 1])) words.pop();
      const [phrase, plain] = await Promise.all([words.length > 1 ? search(`"${words.join(" ")}"`).catch(() => []) : [], search(q)]);
      const seen = new Set();
      // A year or number in the query means a specific event, so pages that state it go first.
      const specific = words.some((w) => /\d/.test(w));
      const order = specific ? [...phrase.slice(0, 2), ...plain] : [...plain.slice(0, 1), ...phrase.slice(0, 2), ...plain.slice(1)];
      const hits = order.filter((x) => !seen.has(x.title) && seen.add(x.title)).slice(0, 3);
      if (!hits.length) return `No Wikipedia articles matched "${q}".`;
      const ex = await getJSON(api + "&prop=extracts&exintro=1&explaintext=1&exlimit=3&titles=" + encodeURIComponent(hits.map((x) => x.title).join("|"))).catch(() => null);
      const intro = new Map((ex?.query?.pages || []).map((p) => [p.title, p.extract || ""]));
      const clean = (html) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      // Matching passages first: small models lean on whatever comes first.
      const passages = hits.map((x) => `- ${x.title}: ...${clean(x.snippet || "")}...`);
      const summaries = hits.map((x, i) => `${i + 1}. ${x.title}: ${trimTo(intro.get(x.title) || "", 300)}`);
      return ["Passages that match the search:", ...passages, "", "Article summaries:", ...summaries].join("\n");
    },
    search_localtube: async ({ query }) => {
      const q = String(query || "").trim();
      if (!q) throw new Error("no query given");
      const m = await loadCatalog();
      const terms = q.toLowerCase().split(/[^\p{L}\p{N}.+#-]+/u).filter((w) => w && !STOP.has(w));
      if (!terms.length) terms.push(q.toLowerCase());
      // Every term first; if that finds little, rank by how many terms each title matches.
      let vids = m.search(terms.join(" ")).videos;
      if (vids.length < 3 && terms.length > 1) {
        const hits = new Map();
        for (const t of terms) for (const v of m.search(t).videos) { const h = hits.get(v.id) || { v, n: 0 }; h.n++; hits.set(v.id, h); }
        vids = [...hits.values()].sort((a, b) => b.n - a.n || b.v.score - a.v.score).map((x) => x.v);
      }
      const people = m.search(terms.join(" ")).people.slice(0, 2);
      if (!vids.length && !people.length) return `No videos in the catalog matched "${q}".`;
      const name = (i) => m.D.people[i]?.name || "unknown";
      const lines = vids.slice(0, 4).map((v, i) => `${i + 1}. "${v.title}" by ${name(v.person)}${v.sec ? `, ${mmss(v.sec)}` : ""}, ${origin}/watch/${v.id}`);
      if (people.length) lines.push("People: " + people.map((p) => p.name).join(", "));
      return lines.join("\n");
    },
  };
  return async (call) => {
    const fn = impl[call.name];
    if (!fn) throw new Error(`there is no tool named ${call.name}`);
    return fn(call.args || {});
  };
}
