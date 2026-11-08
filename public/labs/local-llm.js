import { h, fmt, lessonCSS, renderLesson } from "./lab-kit.js";
import { makeToolRunner, argText } from "./local-llm-tools.js";

export const meta = {
  slug: "local-llm",
  title: "Run a model in this tab, with tools",
  blurb: "Run a small open model on your own device, then give it a calculator and search and compare the answers.",
  minutes: 15,
  topic: "local",
};

// Sizes in MB are sums of the Hugging Face file listings: the onnx/ files the loader fetches plus tokenizer and config files.
// Scores come from each model's card. BFCL is the Berkeley Function Calling Leaderboard, a tool-calling benchmark.
// Files per backend: q4f16 for WebGPU with 16-bit float shaders, q4 for other WebGPU, and a CPU file for WASM.
// The WASM file comes from LiquidAI's repo and is named outright: ONNX Runtime's WASM build has no kernel for the
// 4-bit embedding lookup (GatherBlockQuantized) that the onnx-community q4, q4f16 and q8 files use.
const MODELS = [
  {
    id: "lfm350", name: "LFM2.5 350M", short: "LFM2.5 350M", repo: "onnx-community/LFM2.5-350M-ONNX", tier: "Tiny. Works on a phone.",
    params: "350 million parameters",
    why: "Liquid AI built it for tool use. Its card reports 44 on BFCL v3, ahead of Qwen3.5 0.8B (35) at under half the size.",
    files: {
      q4f16: { dtype: "q4f16", mb: 255.1 }, q4: { dtype: "q4", mb: 293.8 },
      wasm: { repo: "LiquidAI/LFM2.5-350M-ONNX", dtype: "fp32", file: "model_q4f32", mb: 481.2 },
    },
    extra: 3.3,
    gen: { do_sample: false, repetition_penalty: 1.05 },
  },
  {
    id: "lfm3", name: "LFM3 1.7B", short: "LFM3 1.7B", repo: "onnx-community/LFM3-1.7B-ONNX", tier: "Best at tools. About 1.1 GB.",
    params: "1.7 billion parameters",
    why: "Liquid AI's newest model, from October 2026. Its card reports 71 on BFCL v4, ahead of Qwen3.5 4B (55) and Qwen3.5 9B (63).",
    files: { q4f16: { dtype: "q4f16", mb: 1088.1 }, q4: { dtype: "q4", mb: 1297.5 }, wasm: null }, extra: 17.9,
    gen: { do_sample: false, repetition_penalty: 1.05 },
  },
  {
    id: "qwen2", name: "Qwen3.5 2B", short: "Qwen3.5 2B", repo: "onnx-community/Qwen3.5-2B-ONNX-OPT", tier: "More facts. About 1.4 GB.",
    params: "2 billion parameters",
    why: "Qwen's newest small model, from a different lab. Its card reports 55 on MMLU-Pro without thinking, ahead of Qwen3 1.7B (40).",
    files: { q4f16: { dtype: "q4f16", mb: 1383.6 }, q4: { dtype: "q4", mb: 1533.7 }, wasm: null }, extra: 19.2,
    gen: { do_sample: false, presence_penalty: 0.4 },
  },
];
const DEFAULT_GPU = "lfm3", DEFAULT_SMALL = "lfm350";

const SYS_PLAIN = "You are a helpful assistant. Answer briefly and plainly. If you do not know, say so in one sentence.";
const SYS_TOOLS = "You are a helpful assistant. You can write, explain and chat on your own. Your knowledge stops at your training data, " +
  "and you do not know today's date. Use a tool when a question needs one: calculate for arithmetic, search_wikipedia for facts " +
  "about people and events, search_localtube for videos on this site, get_current_date for the date. After a tool result, answer " +
  "in one to three sentences using only facts from the result.";
const MAX_NEW = 320;
const PRESETS = [
  "What is 17 times 23?",
  "Who won the 2024 Nobel Prize in Physics, and for what?",
  "Find me a good video on how attention works",
  "What's today's date?",
  "Write a haiku about autumn leaves.",
];
const TOOL_LABEL = { calculate: "calculate", search_wikipedia: "search_wikipedia", search_localtube: "search_localtube", get_current_date: "get_current_date" };

const CSS = `
.lab-local-llm { font: 400 var(--t-m)/1.5 var(--font); color: var(--fg); }
.lab-local-llm * { box-sizing: border-box; }
.lab-local-llm .ll-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); }
.lab-local-llm fieldset { border: 0; padding: 0; margin: 0 0 var(--s4); min-width: 0; }
.lab-local-llm legend { font-size: var(--t-s); color: var(--fg-2); padding: 0; margin-bottom: var(--s2); }
.lab-local-llm .ll-seg { display: inline-flex; border: 1px solid var(--line); border-radius: var(--r-pill); padding: 3px; gap: 2px; background: var(--bg-2); }
.lab-local-llm .ll-seg label { position: relative; display: inline-flex; align-items: center; min-height: 36px; padding: 0 var(--s4); border-radius: var(--r-pill);
  font: 500 var(--t-s)/1 var(--font); cursor: pointer; color: var(--fg-2); }
.lab-local-llm .ll-seg input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.lab-local-llm .ll-seg label:has(input:checked) { background: var(--bg-3); color: var(--fg); }
.lab-local-llm .ll-seg label:has(input:disabled) { opacity: .45; cursor: not-allowed; }
.lab-local-llm .ll-seg label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.lab-local-llm .ll-hint { font-size: var(--t-s); color: var(--fg-2); margin: var(--s2) 0 0; }
.lab-local-llm .ll-models { display: grid; gap: var(--s2); }
@media (min-width: 720px) { .lab-local-llm .ll-models { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.lab-local-llm .ll-model { position: relative; display: flex; flex-direction: column; gap: 2px; padding: var(--s3) var(--s4); border: 1px solid var(--line); border-radius: var(--r);
  background: var(--bg-2); cursor: pointer; }
.lab-local-llm .ll-model input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.lab-local-llm .ll-model:has(input:checked) { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.lab-local-llm .ll-model:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.lab-local-llm .ll-model:has(input:disabled) { opacity: .5; cursor: not-allowed; }
.lab-local-llm .ll-model .ll-tier { font: 500 var(--t-xs)/1.4 var(--font); color: var(--fg-2); text-transform: uppercase; letter-spacing: .04em; }
.lab-local-llm .ll-model b { font-weight: 600; }
.lab-local-llm .ll-model .mono { font-size: var(--t-s); color: var(--accent-text); }
.lab-local-llm .ll-model span.ll-why { font-size: var(--t-s); color: var(--fg-2); line-height: 1.45; }
.lab-local-llm .ll-warn { margin: var(--s3) 0 0; padding: var(--s2) var(--s3); border-left: 3px solid var(--accent); background: var(--bg-2); font-size: var(--t-s); }
.lab-local-llm .ll-actions { margin-top: var(--s4); }
.lab-local-llm .ll-actions .btn.primary { min-height: 44px; }
.lab-local-llm .ll-progress { margin-top: var(--s4); }
.lab-local-llm .ll-bar { height: 8px; border-radius: 4px; background: var(--bg-3); overflow: hidden; }
.lab-local-llm .ll-bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s linear; }
.lab-local-llm .ll-pmeta { display: flex; justify-content: space-between; gap: var(--s2); font-size: var(--t-s); color: var(--fg-2); margin-top: var(--s2); }
.lab-local-llm .ll-pmeta .mono { color: var(--fg); }
.lab-local-llm .ll-error { margin-top: var(--s4); padding: var(--s3) var(--s4); border: 1px solid var(--line); border-left: 3px solid var(--bad); border-radius: var(--r-s); background: var(--bg-2); }
.lab-local-llm .ll-error strong { color: var(--bad); display: block; }
.lab-local-llm .ll-error code { overflow-wrap: anywhere; }
.lab-local-llm .ll-chat { margin-top: var(--s5); border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-2); min-width: 0; }
.lab-local-llm .ll-chathead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--s2) var(--s3); padding: var(--s3) var(--s4); border-bottom: 1px solid var(--line); font-size: var(--t-s); }
.lab-local-llm .ll-chathead .on { color: var(--ok); }
.lab-local-llm .ll-switch { display: inline-flex; align-items: center; gap: var(--s2); min-height: 40px; cursor: pointer; font: 500 var(--t-s)/1.2 var(--font); }
.lab-local-llm .ll-switch input { appearance: none; -webkit-appearance: none; position: relative; width: 40px; height: 24px; margin: 0; border-radius: 12px;
  background: var(--bg-3); border: 1px solid var(--line); cursor: pointer; flex: none; }
.lab-local-llm .ll-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--fg-2); transition: transform .15s ease; }
.lab-local-llm .ll-switch input:checked { background: var(--accent); border-color: var(--accent); }
.lab-local-llm .ll-switch input:checked::after { transform: translateX(16px); background: var(--accent-ink); }
.lab-local-llm .ll-switch input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lab-local-llm .ll-switch input:disabled { opacity: .5; cursor: not-allowed; }
.lab-local-llm .ll-switch small { font-weight: 400; color: var(--fg-2); }
.lab-local-llm .ll-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--line); }
.lab-local-llm .ll-stat { padding: var(--s2) var(--s4); min-width: 0; }
.lab-local-llm .ll-stat + .ll-stat { border-left: 1px solid var(--line); }
.lab-local-llm .ll-stat span { display: block; font-size: var(--t-xs); color: var(--fg-2); }
.lab-local-llm .ll-stat b { font: 500 var(--t-l)/1.3 var(--mono); }
.lab-local-llm .ll-log { list-style: none; margin: 0; padding: var(--s3) var(--s4); display: grid; gap: var(--s4); min-height: 140px; max-height: min(70vh, 640px); overflow-y: auto; }
.lab-local-llm .ll-log > li { display: grid; gap: var(--s1); min-width: 0; }
.lab-local-llm .ll-who { font: 500 var(--t-xs)/1.4 var(--mono); color: var(--fg-2); }
.lab-local-llm .ll-log p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.lab-local-llm .ll-log li.user > p { color: var(--fg-2); }
.lab-local-llm .ll-log li.empty { color: var(--fg-2); font-size: var(--t-s); }
.lab-local-llm .ll-log a { color: var(--accent-text); }
.lab-local-llm .ll-turn { display: grid; gap: var(--s2); min-width: 0; }
.lab-local-llm .ll-turn .cursor::after { content: ""; display: inline-block; width: .5em; height: 1em; vertical-align: -2px; margin-left: 2px; background: var(--accent); }
.lab-local-llm .ll-meta { font: 400 var(--t-xs)/1.4 var(--mono); color: var(--fg-2); }
.lab-local-llm .ll-meta.bad { color: var(--bad); }
.lab-local-llm .ll-call { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--r-s); background: var(--bg); padding: var(--s2) var(--s3); font-size: var(--t-s); min-width: 0; }
.lab-local-llm .ll-call[data-state="err"] { border-left-color: var(--bad); }
.lab-local-llm .ll-call-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s2); }
.lab-local-llm .ll-call-h .ll-tag { font: 500 var(--t-xs)/1.4 var(--font); color: var(--fg-2); text-transform: uppercase; letter-spacing: .04em; }
.lab-local-llm .ll-call-h code { font: 600 var(--t-s)/1.4 var(--mono); background: none; padding: 0; color: var(--fg); }
.lab-local-llm .ll-call-h .ll-ms { margin-left: auto; font: 400 var(--t-xs)/1.4 var(--mono); color: var(--fg-2); }
.lab-local-llm .ll-call-args { font: 400 var(--t-s)/1.45 var(--mono); color: var(--accent-text); overflow-wrap: anywhere; margin-top: 2px; }
.lab-local-llm .ll-call-res { margin: var(--s1) 0 0; font: 400 var(--t-xs)/1.5 var(--mono); color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.lab-local-llm .ll-call details { margin-top: var(--s1); }
.lab-local-llm .ll-call summary { cursor: pointer; font: 400 var(--t-xs)/1.5 var(--mono); color: var(--fg-2); min-height: 28px; display: list-item; overflow-wrap: anywhere; }
.lab-local-llm .ll-call summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lab-local-llm .ll-cols { display: grid; gap: var(--s3); min-width: 0; }
@media (min-width: 720px) { .lab-local-llm .ll-cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.lab-local-llm .ll-col { border: 1px solid var(--line); border-radius: var(--r); padding: var(--s3); background: var(--bg); min-width: 0; display: grid; gap: var(--s2); align-content: start; }
.lab-local-llm .ll-col h3 { margin: 0; font: 600 var(--t-s)/1.3 var(--font); display: flex; justify-content: space-between; gap: var(--s2); }
.lab-local-llm .ll-col h3 span { font-weight: 400; color: var(--fg-2); }
.lab-local-llm .ll-col.tools h3 { color: var(--accent-text); }
.lab-local-llm .ll-chips { padding: 0 var(--s4) var(--s3); }
.lab-local-llm .ll-chips p { margin: 0 0 var(--s2); font-size: var(--t-s); color: var(--fg-2); }
.lab-local-llm .ll-chips div { display: flex; flex-wrap: wrap; gap: var(--s2); }
.lab-local-llm .ll-chips .btn { font-weight: 400; min-height: 40px; white-space: normal; text-align: left; }
.lab-local-llm .ll-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s2); padding: var(--s3) var(--s4) var(--s4); border-top: 1px solid var(--line); }
.lab-local-llm .ll-form textarea { width: 100%; resize: vertical; min-height: 48px; }
.lab-local-llm .ll-form .btn { min-height: 44px; }
.lab-local-llm .ll-form .ll-row { justify-content: flex-end; }
.lab-local-llm .ll-tools { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); }
.lab-local-llm .ll-privacy { margin-top: var(--s5); padding-left: var(--s4); border-left: 3px solid var(--ok); }
.lab-local-llm .ll-privacy p { margin: 0 0 var(--s2); }
.lab-local-llm .ll-privacy p:last-child { margin: 0; color: var(--fg-2); font-size: var(--t-s); }
.lab-local-llm [hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { .lab-local-llm .ll-bar i, .lab-local-llm .ll-switch input::after { transition: none; } }
${lessonCSS("lab-local-llm")}
`;

// Render model text with links for URLs and /watch/ paths, and **bold** as strong. No HTML from the model is trusted.
function rich(el, text) {
  el.replaceChildren();
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/watch\/[\w-]{11})\)|(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?'])|(\/watch\/[\w-]{11})|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) el.append(text.slice(last, m.index));
    if (m[1]) el.append(h("a", { href: m[2], target: "_blank", rel: "noopener", text: m[1] }));
    else if (m[3] || m[4]) el.append(h("a", { href: m[3] || m[4], target: "_blank", rel: "noopener", text: m[3] || m[4] }));
    else el.append(h("strong", { text: m[5] }));
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

export function mount(root, ctx) {
  root.classList.add("lab-local-llm");
  root.append(h("style", { text: CSS }));

  const coarse = matchMedia("(pointer: coarse)").matches;
  const state = { gpu: false, f16: false, backend: "wasm", model: MODELS[0], worker: null, ready: false, busy: false, history: [], loadedKey: null, tools: true };
  let alive = true;

  const fileFor = (m, backend) => (backend === "webgpu" ? (state.f16 ? m.files.q4f16 : m.files.q4) : m.files.wasm);
  const sizeMB = (m, backend) => (fileFor(m, backend)?.mb ?? 0) + m.extra;

  // Tools run here in the page. Only the two search tools touch the network, and only when the model calls them.
  const runTool = makeToolRunner({ loadCatalog: async () => { const m = await import("/js/data.js"); await m.load(); try { await m.D.full; } catch {} return m; } });

  // Backend picker
  const backendInputs = {};
  const backendSeg = h("div", { class: "ll-seg" }, ["webgpu", "wasm"].map((b) => {
    const input = h("input", { type: "radio", name: "ll-backend", value: b });
    backendInputs[b] = input;
    input.addEventListener("change", () => { state.backend = b; refresh(); });
    return h("label", {}, input, b === "webgpu" ? "WebGPU (GPU)" : "WASM (CPU)");
  }));
  const backendHint = h("p", { class: "ll-hint ll-backend", text: "Checking for WebGPU..." });

  // Model picker
  const modelEls = MODELS.map((m, i) => {
    const input = h("input", { type: "radio", name: "ll-model", value: m.id, checked: i === 0 });
    input.addEventListener("change", () => { state.model = m; refresh(); });
    const size = h("b", { class: "mono" });
    const el = h("label", { class: "ll-model" }, input, h("span", { class: "ll-tier", text: m.tier }), h("b", { text: m.name }), size,
      h("span", { class: "ll-why", text: `${m.params}. ${m.why}` }));
    return { m, input, size, el };
  });
  const memWarn = h("p", { class: "ll-warn", hidden: true });
  const gpuWarn = h("p", { class: "ll-warn", hidden: true });
  if (navigator.deviceMemory && navigator.deviceMemory <= 4) {
    memWarn.hidden = false;
    memWarn.textContent = `This device reports about ${navigator.deviceMemory} GB of memory. Start with the smallest model. The larger ones may run out of memory and close the tab.`;
  }

  const dlBtn = h("button", { class: "btn primary", type: "button" });
  const dlNote = h("p", { class: "ll-hint", text: "Nothing downloads until you tap. The model files come from huggingface.co. The browser also fetches about 5 MB of engine code (transformers.js and ONNX Runtime) from jsdelivr." });

  const bar = h("i");
  const pText = h("span");
  const pNums = h("span", { class: "mono" });
  const progress = h("div", { class: "ll-progress", hidden: true, role: "status", "aria-live": "polite" },
    h("div", { class: "ll-bar", role: "progressbar", "aria-label": "Download progress", "aria-valuemin": "0", "aria-valuemax": "100" }, bar),
    h("div", { class: "ll-pmeta" }, pText, pNums));
  const errBox = h("div", { class: "ll-error", hidden: true, role: "alert" });

  // Chat
  const status = h("span");
  const toolsBox = h("input", { type: "checkbox", role: "switch", id: "ll-tools", checked: true });
  toolsBox.addEventListener("change", () => { state.tools = toolsBox.checked; });
  const toolsSwitch = h("label", { class: "ll-switch", for: "ll-tools" }, toolsBox, h("span", {}, "Tools ", h("small", { text: "calculator, Wikipedia, site search, date" })));
  const tpsEl = h("b", { text: "0" });
  const countEl = h("b", { text: "0" });
  const ttftEl = h("b", { text: "0" });
  const emptyLi = () => h("li", { class: "empty", text: "Pick a prompt below to compare the model with tools off and on, or type your own." });
  const log = h("ol", { class: "ll-log", "aria-label": "Conversation" }, emptyLi());
  const input = h("textarea", { id: "ll-input", class: "input", rows: "2", placeholder: "Type a message", maxlength: "600" });
  const send = h("button", { class: "btn primary", type: "submit", text: "Send" });
  const compareBtn = h("button", { class: "btn", type: "button", text: "Compare tools off and on" });
  const stopBtn = h("button", { class: "btn", type: "button", text: "Stop", hidden: true });
  const form = h("form", { class: "ll-form" },
    h("label", { for: "ll-input", class: "sr-only", text: "Message" }), input, h("div", { class: "ll-row" }, stopBtn, compareBtn, send));
  const chips = h("div", { class: "ll-chips" }, h("p", { text: "Compare on a preset. Each runs twice: tools off, then tools on." }),
    h("div", {}, PRESETS.map((t) => h("button", { class: "btn", type: "button", text: t, onclick: () => { input.value = t; compare(); } }))));
  const unload = h("button", { class: "btn", type: "button", text: "Unload model" });
  const clearCache = h("button", { class: "btn", type: "button", text: "Delete downloaded files" });
  const cacheNote = h("p", { class: "ll-hint", hidden: true });
  const live = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const chat = h("section", { class: "ll-chat", hidden: true, "aria-label": "Chat with the local model" },
    h("div", { class: "ll-chathead" }, status, toolsSwitch),
    h("div", { class: "ll-stats" },
      h("div", { class: "ll-stat" }, h("span", { text: "Tokens/second" }), tpsEl),
      h("div", { class: "ll-stat" }, h("span", { text: "Reply tokens" }), countEl),
      h("div", { class: "ll-stat" }, h("span", { text: "First token" }), ttftEl)),
    log, chips, form, live);

  root.append(
    h("fieldset", {}, h("legend", { text: "Where the math runs" }), backendSeg, backendHint),
    h("fieldset", {}, h("legend", { text: "Model" }), h("div", { class: "ll-models" }, modelEls.map((x) => x.el)), memWarn, gpuWarn),
    h("div", { class: "ll-actions" }, dlBtn, dlNote),
    progress, errBox, chat,
    h("div", { class: "ll-tools" }, unload, clearCache), cacheNote,
    h("div", { class: "ll-privacy" },
      h("p", { text: "The model and your chat stay on this device. With tools on, a Wikipedia search sends only its search words to wikipedia.org, and only when the model calls it. The site search, the calculator and the date run in this tab." }),
      h("p", { text: "The browser keeps the model files in its cache, so the next visit loads them from disk instead of the network. Delete them any time with the button above." })),
  );

  function refresh() {
    const b = state.backend;
    for (const x of modelEls) x.size.textContent = fileFor(x.m, b) ? `about ${fmt(sizeMB(x.m, b))} MB download` : "WebGPU only";
    // A model with no file for this backend cannot be picked. Fall back to the first that has one.
    if (!fileFor(state.model, b) && !state.busy) { const ok = modelEls.find((x) => fileFor(x.m, b)); state.model = ok.m; ok.input.checked = true; }
    const key = `${state.model.id}:${b}`;
    const loaded = state.ready && state.loadedKey === key;
    dlBtn.textContent = loaded ? `${state.model.short} is loaded` : `Download ${state.model.short} (${fmt(sizeMB(state.model, b))} MB)`;
    dlBtn.disabled = state.busy || loaded;
    dlBtn.className = loaded ? "btn" : "btn primary";
    for (const x of modelEls) x.input.disabled = state.busy || !fileFor(x.m, b);
    backendInputs.webgpu.disabled = state.busy || !state.gpu;
    backendInputs.wasm.disabled = state.busy;
    gpuWarn.hidden = b !== "wasm";
    gpuWarn.textContent = `On the CPU only ${MODELS[0].short} runs, and slowly: expect a few tokens per second and up to a minute before a reply with tools starts. The larger models need WebGPU.`;
    unload.hidden = !state.worker;
    unload.textContent = state.ready ? "Unload model" : "Cancel download";
    const idle = state.ready && !state.busy;
    send.disabled = compareBtn.disabled = !idle;
    toolsBox.disabled = !idle;
    for (const c of chips.querySelectorAll("button")) c.disabled = !idle;
  }

  function showError(msg) {
    const lowMem = /memory|alloc|oom|rangeerror|aborted|device.?lost|buffer|out of/i.test(msg);
    const hints = [];
    const small = MODELS.find((m) => fileFor(m, state.backend));
    if (lowMem || state.model !== small) hints.push(`Try ${small.short}, the smallest model here. It needs far less memory.`);
    if (state.backend === "webgpu") hints.push("Or switch to WASM (CPU), which works in every modern browser.");
    if (/fetch|network|load transformers/i.test(msg)) hints.push("Check your connection and try again.");
    errBox.replaceChildren(h("strong", { text: "That did not work." }), h("p", { style: { margin: "4px 0" } }, h("code", { text: msg.slice(0, 300) })),
      ...hints.map((t) => h("p", { style: { margin: "4px 0 0" }, text: t })));
    errBox.hidden = false;
  }

  function killWorker() {
    state.worker?.terminate();
    state.worker = null; state.ready = false; state.loadedKey = null; state.busy = false;
    if (job) { job.reject?.(new Error("unloaded")); job = null; }
    chat.hidden = true;
  }

  function startWorker() {
    const w = new Worker(new URL("./local-llm-worker.js", import.meta.url), { type: "module" });
    w.onerror = (e) => { e.preventDefault?.(); showError(e.message || "The model worker crashed. The device may be out of memory."); killWorker(); progress.hidden = true; refresh(); };
    w.onmessage = ({ data: d }) => { if (alive) onMsg(d); };
    return w;
  }

  // One reply in progress. view = the DOM pieces for that reply.
  let job = null;
  let jobSeq = 0;

  function turnView(container) {
    const turn = h("div", { class: "ll-turn" });
    const meta = h("span", { class: "ll-meta" });
    container.append(turn, meta);
    const view = { turn, meta, paras: new Map(), calls: new Map(), toolCount: 0 };
    view.para = (round) => {
      let p = view.paras.get(round);
      if (!p) { p = h("p", { class: "cursor" }); view.paras.set(round, p); turn.append(p); }
      return p;
    };
    return view;
  }

  function callBlock(e) {
    const ms = h("span", { class: "ll-ms", text: "running" });
    const res = h("div");
    const el = h("div", { class: "ll-call", "data-state": "running", role: "group", "aria-label": `Tool call ${e.name}` },
      h("div", { class: "ll-call-h" }, h("span", { class: "ll-tag", text: "Tool call" }), h("code", { text: TOOL_LABEL[e.name] || e.name }), ms),
      argText(e.args) ? h("div", { class: "ll-call-args", text: argText(e.args) }) : null, res);
    return { el, ms, res };
  }

  function fillResult(b, e) {
    b.el.dataset.state = e.ok ? "ok" : "err";
    b.ms.textContent = e.ms < 1000 ? `${fmt(e.ms)} ms` : `${fmt(e.ms / 1000, 1)} s`;
    const lines = e.result.split("\n");
    const first = lines[0].length > 110 ? lines[0].slice(0, 110) + " ..." : lines[0];
    if (lines.length === 1 && e.result.length <= 140) {
      const pre = h("p", { class: "ll-call-res" }); rich(pre, "Result: " + e.result); b.res.replaceChildren(pre);
    } else {
      const pre = h("p", { class: "ll-call-res" }); rich(pre, e.result);
      b.res.replaceChildren(h("details", {}, h("summary", { text: "Result: " + first }), pre));
    }
  }

  function onJobEvent(d) {
    const v = job?.view;
    if (!v) return;
    if (d.type === "tick") {
      tpsEl.textContent = d.count > 1 && d.tps ? fmt(d.tps, 1) : "...";
      countEl.textContent = fmt(d.count);
      ttftEl.textContent = `${fmt(d.ttft / 1000, 2)} s`;
    } else if (d.type === "text") {
      rich(v.para(d.round), d.text);
      if (job.follow) log.scrollTop = log.scrollHeight;
    } else if (d.type === "round") {
      const p = v.para(d.round);
      p.classList.remove("cursor");
      if (d.before) rich(p, d.before); else p.remove();
      job.tps = d.tps || job.tps;
    } else if (d.type === "tool_start") {
      const b = callBlock(d);
      v.calls.set(d.id, b);
      v.turn.append(b.el);
      v.toolCount++;
      live.textContent = `The model called ${d.name}.`;
      if (job.follow) log.scrollTop = log.scrollHeight;
    } else if (d.type === "tool_end") {
      const b = v.calls.get(d.id);
      if (b) fillResult(b, d);
    } else if (d.type === "answer") {
      const p = v.para(d.round);
      p.classList.remove("cursor");
      rich(p, d.text || (d.stopped ? "" : "(no reply)"));
      job.tps = d.tps || job.tps;
    } else if (d.type === "done") {
      const r = d.result;
      const bits = [`${fmt(r.stats.tokens)} tokens`, `${fmt(r.stats.tps, 1)} tok/s`, `first token ${fmt(r.stats.ttft / 1000, 1)} s`, `${fmt(d.ms / 1000, 1)} s total`];
      if (v.toolCount) bits.push(`${v.toolCount} tool call${v.toolCount > 1 ? "s" : ""}`);
      v.meta.textContent = bits.map((x) => x.replace(/ /g, "\u00a0")).join(" · ");
      if (r.looped) { v.meta.append(" · stopped: it began repeating itself"); v.meta.classList.add("bad"); }
      if (r.stopped) v.meta.append(" · stopped");
      if (r.capped) v.meta.append(" · hit the 4 tool round limit");
      tpsEl.textContent = fmt(r.stats.tps, 1);
      live.textContent = "Reply finished.";
      const j = job; job = null; j.resolve(r);
    } else if (d.type === "error") {
      v.meta.textContent = "Error: " + d.message;
      v.meta.classList.add("bad");
      for (const p of v.paras.values()) p.classList.remove("cursor");
      const j = job; job = null; j.reject(new Error(d.message));
    }
  }

  function onMsg(d) {
    if (d.job != null) {
      if (d.type === "run_tool") {
        runTool(d.call).then((result) => ({ ok: true, result }), (err) => ({ ok: false, result: "Error: " + (err?.message || err) }))
          .then((r) => state.worker?.postMessage({ type: "tool_result", cid: d.cid, ...r }));
        return;
      }
      if (job && d.job === job.id) onJobEvent(d);
      return;
    }
    if (d.type === "status") { pText.textContent = d.text; }
    else if (d.type === "progress") {
      // Files start one by one, so their running total undercounts. Measure against the known size.
      const total = Math.max(d.total, sizeMB(state.model, state.backend) * 1e6);
      const pct = Math.min(100, (d.loaded / total) * 100);
      bar.style.width = pct.toFixed(1) + "%";
      bar.parentElement.setAttribute("aria-valuenow", pct.toFixed(0));
      pText.textContent = "Downloading";
      pNums.textContent = `${fmt(d.loaded / 1e6, 1)} of about ${fmt(total / 1e6)} MB`;
    } else if (d.type === "ready") {
      state.ready = true; state.busy = false; state.loadedKey = `${state.model.id}:${state.backend}`;
      bar.style.width = "100%";
      pText.textContent = `Ready in ${fmt(d.ms / 1000, 1)} s`;
      pNums.textContent = `${fmt(d.bytes / 1e6, 1)} MB of model files`;
      status.replaceChildren(h("span", { class: "on", text: "Running locally: " }), `${state.model.short} on ${state.backend === "webgpu" ? "WebGPU" : "WASM"}`);
      chat.hidden = false;
      refresh();
      input.focus({ preventScroll: true });
    } else if (d.type === "error") {
      showError(d.message);
      if (d.where === "load") { killWorker(); progress.hidden = true; }
      state.busy = false;
      refresh();
    }
  }

  // Run one reply in `container`. Resolves with the loop's result.
  function runJob(container, messages, useTools, follow = true) {
    const id = ++jobSeq;
    const view = turnView(container);
    return new Promise((resolve, reject) => {
      job = { id, view, resolve, reject, follow };
      tpsEl.textContent = "..."; countEl.textContent = "0"; ttftEl.textContent = "...";
      state.worker.postMessage({ type: "chat", job: id, messages, useTools, gen: state.model.gen, maxNewTokens: MAX_NEW });
    });
  }

  const sys = (useTools) => ({ role: "system", content: useTools ? SYS_TOOLS : SYS_PLAIN });
  const who = (useTools) => `${state.model.short}${useTools ? ", tools on" : ", tools off"}`;

  function begin(text) {
    errBox.hidden = true;
    log.querySelector(".empty")?.remove();
    log.append(h("li", { class: "user" }, h("span", { class: "ll-who", text: "You" }), h("p", { text })));
    input.value = ""; input.disabled = true;
    state.busy = true; send.hidden = true; stopBtn.hidden = false;
    stopped = false;
    refresh();
  }
  function end() {
    state.busy = false; send.hidden = false; stopBtn.hidden = true; input.disabled = false;
    refresh();
  }
  let stopped = false;

  async function chatOnce() {
    const text = input.value.trim();
    if (!text || !state.ready || state.busy) return;
    begin(text);
    const useTools = state.tools;
    const li = h("li", {}, h("span", { class: "ll-who", text: who(useTools) }));
    log.append(li);
    log.scrollTop = log.scrollHeight;
    state.history.push({ role: "user", content: text });
    try {
      const r = await runJob(li, [sys(useTools), ...state.history.slice(-6)], useTools);
      state.history.push({ role: "assistant", content: r.text });
    } catch { state.history.pop(); }
    end();
  }

  async function compare() {
    const text = input.value.trim();
    if (!text || !state.ready || state.busy) return;
    begin(text);
    const off = h("section", { class: "ll-col", "aria-label": "Tools off" }, h("h3", {}, "Tools off", h("span", { text: "model alone" })));
    const on = h("section", { class: "ll-col tools", "aria-label": "Tools on" }, h("h3", {}, "Tools on", h("span", { text: "model plus tools" })));
    const li = h("li", { class: "ll-compare" }, h("span", { class: "ll-who", text: `${state.model.short}, same prompt twice` }), h("div", { class: "ll-cols" }, off, on));
    log.append(li);
    log.scrollTop = log.scrollHeight;
    const msgs = (t) => [sys(t), { role: "user", content: text }];
    try {
      await runJob(off, msgs(false), false);
      if (!stopped) await runJob(on, msgs(true), true);
    } catch {}
    end();
  }

  dlBtn.addEventListener("click", () => {
    errBox.hidden = true;
    if (state.worker) killWorker();
    state.history = [];
    log.replaceChildren(emptyLi());
    state.busy = true;
    state.worker = startWorker();
    progress.hidden = false; bar.style.width = "0%"; pText.textContent = "Starting"; pNums.textContent = "";
    refresh();
    const f = fileFor(state.model, state.backend);
    state.worker.postMessage({ type: "load", repo: f.repo || state.model.repo, dtype: f.dtype, file: f.file, device: state.backend });
  });

  form.addEventListener("submit", (e) => { e.preventDefault(); chatOnce(); });
  compareBtn.addEventListener("click", () => compare());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  stopBtn.addEventListener("click", () => { stopped = true; state.worker?.postMessage({ type: "stop" }); });
  unload.addEventListener("click", () => { killWorker(); progress.hidden = true; end(); });
  clearCache.addEventListener("click", async () => {
    cacheNote.hidden = false;
    try {
      const ok = "caches" in self ? await caches.delete("transformers-cache") : false;
      cacheNote.textContent = ok ? "Deleted the cached model files. The next load downloads them again." : "No cached model files found.";
    } catch (err) { cacheNote.textContent = "Could not delete the cache: " + err.message; }
  });

  // Detect WebGPU without downloading anything.
  (async () => {
    let adapter = null;
    try { adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null; } catch { adapter = null; }
    if (!alive) return;
    state.gpu = !!adapter;
    state.f16 = !!adapter?.features?.has?.("shader-f16");
    state.backend = state.gpu ? "webgpu" : "wasm";
    backendInputs[state.backend].checked = true;
    backendHint.textContent = state.gpu
      ? `WebGPU found${state.f16 ? " with 16-bit float support" : ""}. The model will run on your graphics chip. WASM is the slower CPU fallback.`
      : "No WebGPU adapter here, so the model runs on your CPU with WebAssembly (WASM). It works everywhere, just slower.";
    // Default pick: the best tool caller on a roomy computer with WebGPU, otherwise the tiny one.
    const roomy = !navigator.deviceMemory || navigator.deviceMemory >= 8;
    const pick = state.gpu && !coarse && roomy ? DEFAULT_GPU : DEFAULT_SMALL;
    if (!state.busy && !state.ready) {
      const el = modelEls.find((x) => x.m.id === pick);
      state.model = el.m;
      el.input.checked = true;
    }
    refresh();
  })();
  refresh();

  renderLesson(root, {
    happening: [
      "The Download button fetches the model's weights, the numbers it learned in training, from Hugging Face. transformers.js runs them with ONNX Runtime: on your graphics chip through WebGPU, or on your CPU through WebAssembly (WASM).",
      "The model writes one token at a time. It predicts likely text, so it can state a wrong product or an old fact with full confidence. It has no clock and knows nothing after its training data ends.",
      "With tools on, the prompt also lists four tools as JSON schemas. When a question needs one, a model trained for tool use writes a call in its own format instead of an answer, such as <code>&lt;tool_call&gt;</code> tags for LFM3 and Qwen or a Python-style list for LFM2.5.",
      "This page reads that call, runs the tool here, and adds the result to the chat as a <code>tool</code> message. The model then reads the result and writes its answer. The loop stops after 4 tool rounds.",
      "The model never runs code and never reaches the network itself. It only writes text. The page decides what that text is allowed to do.",
    ],
    tryThis: [
      "Load the smallest model and tap \"What is 17 times 23?\" The answer is 391. Watch whether the tools off side gets it, then find the calculate call on the tools on side.",
      "Tap the Nobel Prize question. With tools off the model guesses from memory. With tools on it searches Wikipedia and should name John Hopfield and Geoffrey Hinton, for work on artificial neural networks.",
      "After the model loads, turn off Wi-Fi and ask the date and a math question. Both still work. A Wikipedia search now returns an error, and the model has to say it could not look it up.",
    ],
    check: {
      q: "With tools on, the model answers that 17 times 23 is 391. What did the multiplying?",
      options: [
        { t: "The calculator in this page. The model wrote a calculate call and then repeated the result.", right: true,
          why: "The model only produced the text of a call. The page ran the exact calculator and handed 391 back as a tool message for the model to read." },
        { t: "The model. Turning tools on made its math better.", right: false,
          why: "The weights did not change. The tools off reply uses the same model. The difference is the calculator result added to the chat." },
        { t: "Wikipedia, through a search.", right: false,
          why: "Math goes to the calculate tool, which runs in this tab. Only search_wikipedia talks to Wikipedia, and only with the search words." },
      ],
    },
  }, ctx);

  return () => {
    alive = false;
    state.worker?.postMessage({ type: "stop" });
    state.worker?.terminate();
    state.worker = null;
  };
}
