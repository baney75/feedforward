import { h, scopeStyle, slider, segmented, learnSections, nextId, code, p } from "./_kit.js";

export const meta = {
  slug: "will-it-run",
  title: "Will it run on my machine?",
  blurb: "Pick a model, a quantization and your hardware to see if it fits in memory and roughly how fast it can talk.",
  minutes: 6,
  topic: "local-ai",
};

// Every row comes from the model's config.json on Hugging Face, fetched 2026-11-07.
// params: all text weights, counted from the config shapes (matches the Hub's safetensors
//   total, except Gemma 3, where the Hub total also has the ~0.42B vision encoder).
// read: weights used to make one token. It leaves out the input embedding table (one row is
//   looked up per token) unless it is tied to the output layer, and for MoE counts only the
//   experts picked per token.
// swa: layers that use sliding-window attention and their window, from layer_types
//   (gpt-oss) or sliding_window_pattern (Gemma 3: every 6th layer is global).
// experts: expert weights total and per token, for gpt-oss's native MXFP4 split.
export const MODELS = [
  { id: "qwen3-0.6b", name: "Qwen3 0.6B", repo: "Qwen/Qwen3-0.6B", layers: 28, kvHeads: 8, headDim: 128, params: 596049920, read: 596049920, maxCtx: 40960 },
  { id: "qwen3-4b", name: "Qwen3 4B", repo: "Qwen/Qwen3-4B", layers: 36, kvHeads: 8, headDim: 128, params: 4022468096, read: 4022468096, maxCtx: 40960 },
  { id: "qwen3-8b", name: "Qwen3 8B", repo: "Qwen/Qwen3-8B", layers: 36, kvHeads: 8, headDim: 128, params: 8190735360, read: 7568405504, maxCtx: 40960 },
  { id: "qwen3-14b", name: "Qwen3 14B", repo: "Qwen/Qwen3-14B", layers: 40, kvHeads: 8, headDim: 128, params: 14768307200, read: 13990394880, maxCtx: 40960 },
  { id: "qwen3-32b", name: "Qwen3 32B", repo: "Qwen/Qwen3-32B", layers: 64, kvHeads: 8, headDim: 128, params: 32762123264, read: 31984210944, maxCtx: 40960 },
  { id: "qwen3-30b-a3b", name: "Qwen3 30B-A3B (MoE)", repo: "Qwen/Qwen3-30B-A3B", layers: 48, kvHeads: 4, headDim: 128, params: 30532122624, read: 3041867776, maxCtx: 40960, moe: "128 experts, 8 per token" },
  { id: "llama-3.1-8b", name: "Llama 3.1 8B", repo: "unsloth/Llama-3.1-8B-Instruct", layers: 32, kvHeads: 8, headDim: 128, params: 8030261248, read: 7504924672, maxCtx: 131072 },
  { id: "llama-3.1-70b", name: "Llama 3.1 70B", repo: "unsloth/Meta-Llama-3.1-70B-Instruct", layers: 80, kvHeads: 8, headDim: 128, params: 70553706496, read: 69503033344, maxCtx: 131072 },
  { id: "gemma-3-12b", name: "Gemma 3 12B", repo: "unsloth/gemma-3-12b-it", layers: 48, kvHeads: 8, headDim: 256, params: 11766034176, read: 11766034176, maxCtx: 131072, swa: { layers: 40, window: 1024 } },
  { id: "gemma-3-27b", name: "Gemma 3 27B", repo: "unsloth/gemma-3-27b-it", layers: 62, kvHeads: 16, headDim: 128, params: 27009346304, read: 27009346304, maxCtx: 131072, swa: { layers: 52, window: 1024 } },
  { id: "mistral-small-24b", name: "Mistral Small 3 24B", repo: "mistralai/Mistral-Small-24B-Instruct-2501", layers: 40, kvHeads: 8, headDim: 128, params: 23572403200, read: 22901314560, maxCtx: 32768 },
  { id: "gpt-oss-20b", name: "gpt-oss-20b (MoE)", repo: "openai/gpt-oss-20b", layers: 24, kvHeads: 8, headDim: 64, params: 20914757184, read: 3608307264, maxCtx: 131072, swa: { layers: 12, window: 128 }, experts: { total: 19110297600, read: 2388787200 }, moe: "32 experts, 4 per token" },
  { id: "gpt-oss-120b", name: "gpt-oss-120b (MoE)", repo: "openai/gpt-oss-120b", layers: 36, kvHeads: 8, headDim: 64, params: 116829156672, read: 5132849472, maxCtx: 131072, swa: { layers: 18, window: 128 }, experts: { total: 114661785600, read: 3583180800 }, moe: "128 experts, 4 per token" },
];

// Approximate average bits per weight for llama.cpp quant types.
export const QUANTS = [
  { id: "F16", bits: 16 }, { id: "Q8_0", bits: 8.5 }, { id: "Q6_K", bits: 6.56 }, { id: "Q5_K_M", bits: 5.69 },
  { id: "Q4_K_M", bits: 4.85 }, { id: "Q3_K_M", bits: 3.91 }, { id: "IQ2_XS", bits: 2.31 }, { id: "MXFP4", bits: 4.25 },
];

// mem in GB (1024^3 bytes, as sold), bandwidth in GB/s (10^9 bytes per second, as quoted).
export const HARDWARE = [
  { id: "rtx3060", name: "RTX 3060 12GB", mem: 12, bw: 360 },
  { id: "rtx4090", name: "RTX 4090 24GB", mem: 24, bw: 1008 },
  { id: "rtx5090", name: "RTX 5090 32GB", mem: 32, bw: 1792 },
  { id: "m4", name: "Mac M4 16GB", mem: 16, bw: 120, mac: true },
  { id: "m4pro", name: "Mac M4 Pro 48GB", mem: 48, bw: 273, mac: true },
  { id: "m4max", name: "Mac M4 Max 128GB", mem: 128, bw: 546, mac: true },
  { id: "m3ultra", name: "Mac M3 Ultra 512GB", mem: 512, bw: 819, mac: true },
  { id: "pi5", name: "Raspberry Pi 5 8GB", mem: 8, bw: 17 },
  { id: "spark", name: "DGX Spark 128GB", mem: 128, bw: 273 },
  { id: "custom", name: "Custom" },
];

const CTX = [2048, 4096, 8192, 16384, 32768, 65536, 131072];
const KV_BYTES = { FP16: 2, Q8_0: 34 / 32 };
const GiB = 1024 ** 3;
const OVERHEAD = 1 * GiB;
const MAC_USABLE = 0.75;

export function estimate({ model, quant, ctx, kv, windowOnly, hw }) {
  const q = QUANTS.find((x) => x.id === quant);
  const nativeMx = quant === "MXFP4" && model.experts;
  const weights = nativeMx
    ? (model.experts.total * q.bits) / 8 + (model.params - model.experts.total) * 2
    : (model.params * q.bits) / 8;
  const readW = nativeMx
    ? (model.experts.read * q.bits) / 8 + (model.read - model.experts.read) * 2
    : (model.read * q.bits) / 8;
  const perTokLayer = 2 * model.kvHeads * model.headDim * KV_BYTES[kv];
  const swaLayers = model.swa && windowOnly ? model.swa.layers : 0;
  const fullLayers = model.layers - swaLayers;
  const swaTokens = model.swa ? Math.min(ctx, model.swa.window) : 0;
  const kvBytes = perTokLayer * (fullLayers * ctx + swaLayers * swaTokens);
  const need = weights + kvBytes + OVERHEAD;
  const usable = hw.mem * GiB * (hw.mac ? MAC_USABLE : 1);
  const verdict = need <= 0.9 * usable ? "fits" : need <= usable ? "tight" : "no";
  // Decode reads the active weights once per token, plus the whole KV cache for attention.
  const tps = (hw.bw * 1e9) / (readW + kvBytes);
  return { weights, readW, kvBytes, need, usable, verdict, tps, perTokLayer, fullLayers, swaLayers, swaTokens, nativeMx };
}

const STYLE = `
& .ctrls { display: grid; gap: var(--s4); grid-template-columns: 1fr; }
@media (min-width: 620px) { & .ctrls { grid-template-columns: 1fr 1fr; column-gap: var(--s5); } }
& .ctrls .wide { grid-column: 1 / -1; }
& .chk { display: flex; gap: var(--s2); align-items: center; min-height: 40px; font-size: var(--t-s); color: var(--fg-2); cursor: pointer; }
& .chk input { width: 20px; height: 20px; accent-color: var(--accent); margin: 0; flex: none; }
& .custom { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
& .custom .chk { grid-column: 1 / -1; }
& .result { display: grid; gap: var(--s4); }
& .verdict { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s1) var(--s3); }
& .verdict b { font: 700 var(--t-2xl)/1.1 var(--font); letter-spacing: -.01em; }
& .verdict[data-v="fits"] b { color: var(--ok); }
& .verdict[data-v="tight"] b { color: var(--accent-text); }
& .verdict[data-v="no"] b { color: var(--bad); }
& .verdict span { color: var(--fg-2); }
& .barbox { position: relative; padding-top: 26px; }
& .bar { display: flex; height: 28px; border-radius: var(--r-s); overflow: hidden; background: var(--bg-3); }
& .bar > i { display: block; height: 100%; min-width: 0; transition: width .2s ease; }
& .bar > i + i { box-shadow: inset 1px 0 0 var(--bg-2); }
& .sw-w, & .bar .w { background: var(--accent); }
& .sw-k, & .bar .k { background: color-mix(in srgb, var(--accent) 45%, var(--bg-3)); }
& .sw-o, & .bar .o { background: color-mix(in srgb, var(--fg-2) 45%, var(--bg-3)); }
& .mark { position: absolute; top: 18px; bottom: -6px; width: 2px; margin-left: -1px; background: var(--fg); transition: left .2s ease; }
& .mark span { position: absolute; bottom: 100%; transform: translateX(-50%); white-space: nowrap; font: 500 var(--t-xs)/1.2 var(--mono); color: var(--fg); padding-bottom: 3px; }
& .mark.end span { transform: translateX(-100%); }
& .mark.start span { transform: none; }
@media (prefers-reduced-motion: reduce) { & .bar > i, & .mark { transition: none; } }
& .legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: var(--s2) var(--s4); margin: 0; font-size: var(--t-s); }
& .legend div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s2); border-bottom: 1px solid var(--line); padding: var(--s1) 0; }
& .legend dt { color: var(--fg-2); display: flex; align-items: baseline; gap: var(--s2); white-space: nowrap; }
& .legend dt i { align-self: center; }
& .legend dt i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
& .legend dd { margin: 0; white-space: nowrap; font-family: var(--mono); font-variant-numeric: tabular-nums; }
& .legend .tot dt, & .legend .tot dd { color: var(--fg); font-weight: 600; }
& .speed { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s1) var(--s3); border-top: 1px solid var(--line); padding-top: var(--s4); }
& .speed b { font: 500 var(--t-xl)/1.2 var(--mono); font-variant-numeric: tabular-nums; }
& .speed span { color: var(--fg-2); font-size: var(--t-s); }
& .math { display: grid; gap: var(--s1); margin: 0; font: 400 13px/1.5 var(--mono); color: var(--fg-2); overflow-wrap: anywhere; }
& .math div::before { content: ""; }
& .notes { display: grid; gap: var(--s1); margin: 0; padding: 0; list-style: none; font-size: var(--t-s); color: var(--fg-2); }
& .notes li { padding-left: var(--s4); position: relative; }
& .notes li::before { content: ""; position: absolute; left: 4px; top: .65em; width: 4px; height: 4px; border-radius: 50%; background: var(--fg-2); }
& .notes .warn { color: var(--fg); }
& details { border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-2); }
& summary { cursor: pointer; padding: var(--s3) var(--s4); min-height: 44px; display: flex; align-items: center; font-weight: 500; }
& .tblwrap { overflow-x: auto; padding: 0 var(--s4) var(--s4); }
& table { border-collapse: collapse; font-size: var(--t-s); width: 100%; min-width: 640px; }
& th, & td { text-align: right; padding: 6px var(--s2); border-top: 1px solid var(--line); white-space: nowrap; font-variant-numeric: tabular-nums; }
& th:first-child, & td:first-child, & td.src { text-align: left; }
& th { color: var(--fg-2); font-weight: 500; font-size: var(--t-xs); border-top: 0; }
& td { font-family: var(--mono); font-size: 13px; }
& td:first-child { font-family: var(--font); font-size: var(--t-s); }
& td a { color: var(--accent-text); }
`;

const gb = (b) => (b / GiB >= 100 ? (b / GiB).toFixed(0) : (b / GiB).toFixed(1)) + " GB";
const bn = (n) => (n / 1e9 >= 10 ? (n / 1e9).toFixed(1) : (n / 1e9).toFixed(2)) + "B";
const ctxLabel = (c) => `${c / 1024}K`;
const int = (n) => n.toLocaleString("en-US");

export function mount(root, ctx) {
  scopeStyle(root, meta.slug, STYLE);
  const st = { model: "qwen3-8b", quant: "Q4_K_M", ctxIdx: 3, kv: "FP16", windowOnly: true, hw: "rtx3060", cMem: 24, cBw: 400, cMac: false };

  const sel = (label, options, value, onchange) => {
    const id = nextId("sel");
    const s = h("select", { id }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t)));
    s.addEventListener("change", () => onchange(s.value));
    return { el: h("div", { class: "field" }, h("label", { for: id }, label), s), s };
  };
  const modelSel = sel("Model", MODELS.map((m) => [m.id, m.name]), st.model, (v) => { st.model = v; update(); });
  const quantSel = sel("Quantization (bits per weight)", QUANTS.map((q) => [q.id, `${q.id}  (${q.bits} bits)`]), st.quant, (v) => { st.quant = v; update(); });
  const ctxSl = slider({ label: "Context length (tokens)", min: 0, max: CTX.length - 1, step: 1, value: st.ctxIdx, format: (i) => `${ctxLabel(CTX[i])}  (${int(CTX[i])})`, oninput: (v) => { st.ctxIdx = v; update(); } });
  const kvSeg = segmented({ label: "KV cache precision", value: st.kv, options: [["FP16", "FP16"], ["Q8_0", "Q8_0"]], onchange: (v) => { st.kv = v; update(); } });
  const hwSel = sel("Hardware", HARDWARE.map((x) => [x.id, x.name]), st.hw, (v) => { st.hw = v; update(); });

  const swaBox = h("input", { type: "checkbox", checked: st.windowOnly });
  swaBox.addEventListener("change", () => { st.windowOnly = swaBox.checked; update(); });
  const swaRow = h("label", { class: "chk wide" }, swaBox, h("span", null, "Keep only the window for sliding-window layers (llama.cpp does this unless you pass --swa-full)"));

  const num = (label, value, step, on) => {
    const id = nextId("num");
    const i = h("input", { id, type: "number", min: "1", step, value, inputmode: "decimal" });
    i.addEventListener("input", () => { const v = parseFloat(i.value); if (v > 0) { on(v); update(); } });
    return h("div", { class: "field" }, h("label", { for: id }, label), i);
  };
  const macBox = h("input", { type: "checkbox" });
  macBox.addEventListener("change", () => { st.cMac = macBox.checked; update(); });
  const customBox = h("div", { class: "custom wide" },
    num("Memory (GB)", st.cMem, "1", (v) => { st.cMem = v; }),
    num("Bandwidth (GB/s)", st.cBw, "1", (v) => { st.cBw = v; }),
    h("label", { class: "chk" }, macBox, h("span", null, "Mac unified memory (use about 75%)")));

  const verdict = h("div", { class: "verdict", "aria-live": "polite" });
  const segW = h("i", { class: "w" }), segK = h("i", { class: "k" }), segO = h("i", { class: "o" });
  const mark = h("div", { class: "mark", "aria-hidden": "true" }, h("span"));
  const bar = h("div", { class: "barbox", role: "img" }, h("div", { class: "bar" }, segW, segK, segO), mark);
  const dd = () => h("dd");
  const lW = dd(), lK = dd(), lO = dd(), lT = dd(), lU = dd();
  const legend = h("dl", { class: "legend" },
    h("div", null, h("dt", null, h("i", { class: "sw-w" }), "Weights"), lW),
    h("div", null, h("dt", null, h("i", { class: "sw-k" }), "KV cache"), lK),
    h("div", null, h("dt", null, h("i", { class: "sw-o" }), "Overhead"), lO),
    h("div", { class: "tot" }, h("dt", null, "Total needed"), lT),
    h("div", null, h("dt", null, "Usable"), lU));
  const speedV = h("b"), speedS = h("span");
  const speed = h("div", { class: "speed" }, h("span", null, "Decode speed, upper bound"), speedV, speedS);
  const math = h("div", { class: "math" });
  const notes = h("ul", { class: "notes" });

  const stage = h("div", { class: "stage" },
    h("div", { class: "ctrls" }, modelSel.el, quantSel.el, h("div", { class: "wide" }, ctxSl.el), kvSeg.el, hwSel.el, swaRow, customBox),
    h("div", { class: "panel result" }, verdict, bar, legend, speed, math, notes),
    h("details", null, h("summary", null, "Model data and sources"), h("div", { class: "tblwrap" }, h("table", null,
      h("thead", null, h("tr", null, ["Model", "Layers", "KV heads", "head_dim", "Weights", "Read per token", "Sliding layers", "Config"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, MODELS.map((m) => h("tr", null,
        h("td", null, m.name), h("td", null, m.layers), h("td", null, m.kvHeads), h("td", null, m.headDim),
        h("td", null, bn(m.params)), h("td", null, bn(m.read)),
        h("td", null, m.swa ? `${m.swa.layers} of ${m.layers}, window ${int(m.swa.window)}` : "none"),
        h("td", { class: "src" }, h("a", { href: `https://huggingface.co/${m.repo}/blob/main/config.json`, target: "_blank", rel: "noopener" }, m.repo)))))))),
  );

  const learn = learnSections({
    happening: [
      p("Memory needed is the weights, plus the KV cache, plus about 1 GB for the runtime. Weights take parameters times bits per weight, divided by 8. The bits per weight are approximate llama.cpp averages, since each quant type keeps some tensors at higher precision."),
      p("The KV cache stores a key and a value for every past token in every layer: ", code("2 × layers × KV heads × head_dim × tokens × bytes"), ". It grows with context, which is why a long chat can stop fitting. Q8_0 stores 8.5 bits per value instead of 16."),
      "Gemma 3 and gpt-oss use sliding-window attention in some layers, so those layers only ever look at the last 1,024 or 128 tokens. A runtime that stores just that window needs far less cache at long context.",
      "Generating one token means reading every weight it uses from memory, so speed is capped near bandwidth divided by bytes read per token. A mixture of experts (MoE) model keeps all experts in memory but reads only the few it picks per token, so it runs like a much smaller model. Real speed is lower: this ignores compute, prompt processing and software overhead.",
      "Macs share memory between the CPU and GPU. By default macOS lets the GPU use about two thirds to three quarters of it, depending on the Mac, so the usable line here is 75%: a rough rule, not a promise. Memory is shown in GB of 1024³ bytes, the way memory is sold. Bandwidth is in GB/s of 10⁹ bytes, the way vendors quote it.",
    ],
    tryThis: [
      "Pick Qwen3 32B on the RTX 4090. Move context from 2K to 128K and watch the KV cache grow, then switch the KV cache to Q8_0.",
      "Compare Qwen3 32B and Qwen3 30B-A3B on a Mac M4 Pro at Q4_K_M. The memory is close; the speed is not.",
      "Pick Gemma 3 27B at 128K context and turn the sliding-window box off and on.",
    ],
    check: {
      q: "Qwen3 30B-A3B and Qwen3 32B have about the same number of weights. At the same quantization on the same machine, what is true?",
      options: [
        { text: "30B-A3B needs about 10 times less memory.", right: false, why: "All 128 experts have to sit in memory, because any of them can be picked for the next token. Memory tracks total weights: about 30.5B against 32.8B." },
        { text: "They need similar memory, but 30B-A3B can decode many times faster.", right: true, why: "Memory tracks all the weights, but speed tracks the weights read per token. 30B-A3B reads about 3B per token against about 32B, so its bandwidth limit is roughly 10 times higher." },
        { text: "They run at the same speed because the bandwidth is the same.", right: false, why: "Bandwidth is the same, but the bytes read per token are not. Dividing the same bandwidth by about a tenth of the bytes gives about 10 times the speed limit." },
      ],
    },
  }, ctx);

  root.append(stage, learn);

  function update() {
    const model = MODELS.find((m) => m.id === st.model);
    const hwBase = HARDWARE.find((x) => x.id === st.hw);
    const hw = st.hw === "custom" ? { name: "Custom", mem: st.cMem, bw: st.cBw, mac: st.cMac } : hwBase;
    const c = CTX[st.ctxIdx];
    const r = estimate({ model, quant: st.quant, ctx: c, kv: st.kv, windowOnly: st.windowOnly, hw });
    const q = QUANTS.find((x) => x.id === st.quant);

    swaRow.hidden = !model.swa;
    customBox.hidden = st.hw !== "custom";

    const word = { fits: "Fits", tight: "Tight", no: "Won't fit" }[r.verdict];
    verdict.dataset.v = r.verdict;
    const spare = r.usable - r.need;
    verdict.replaceChildren(h("b", null, word), h("span", null,
      r.verdict === "no" ? `Needs ${gb(r.need)}, which is ${gb(-spare)} more than the ${gb(r.usable)} usable.`
        : `Needs ${gb(r.need)} of ${gb(r.usable)} usable, leaving ${gb(spare)}.`));

    const scale = Math.max(r.need, r.usable) * 1.04;
    segW.style.width = `${(r.weights / scale) * 100}%`;
    segK.style.width = `${(r.kvBytes / scale) * 100}%`;
    segO.style.width = `${(OVERHEAD / scale) * 100}%`;
    const left = (r.usable / scale) * 100;
    mark.style.left = `${left}%`;
    mark.className = "mark" + (left > 75 ? " end" : left < 25 ? " start" : "");
    mark.firstChild.textContent = `usable ${gb(r.usable)}`;
    bar.setAttribute("aria-label", `Memory needed ${gb(r.need)}: weights ${gb(r.weights)}, KV cache ${gb(r.kvBytes)}, overhead ${gb(OVERHEAD)}. Usable on ${hw.name}: ${gb(r.usable)}.`);
    lW.textContent = gb(r.weights); lK.textContent = gb(r.kvBytes); lO.textContent = gb(OVERHEAD);
    lT.textContent = gb(r.need); lU.textContent = gb(r.usable) + (hw.mac ? " (75%)" : "");

    const perTok = r.readW + r.kvBytes;
    if (r.verdict === "no") {
      speedV.textContent = "n/a";
      speedS.textContent = "It does not fit, so the bandwidth estimate does not apply.";
    } else {
      speedV.textContent = `${r.tps >= 100 ? r.tps.toFixed(0) : r.tps.toFixed(1)} tokens/s`;
      speedS.textContent = `${hw.bw} GB/s ÷ ${(perTok / 1e9).toFixed(2)} billion bytes read per token`;
    }

    const lines = [];
    if (r.nativeMx) lines.push(`Weights: ${bn(model.experts.total)} expert weights × 4.25 bits + ${bn(model.params - model.experts.total)} other weights × 16 bits = ${gb(r.weights)}`);
    else lines.push(`Weights: ${bn(model.params)} × ${q.bits} bits ÷ 8 = ${gb(r.weights)}`);
    const kvb = st.kv === "FP16" ? "2" : "1.0625";
    if (r.swaLayers) {
      lines.push(`KV: 2 × ${model.kvHeads} KV heads × ${model.headDim} × ${kvb} bytes × (${r.fullLayers} full layers × ${int(c)} + ${r.swaLayers} sliding layers × ${int(r.swaTokens)}) tokens = ${gb(r.kvBytes)}`);
    } else {
      lines.push(`KV: 2 × ${model.layers} layers × ${model.kvHeads} KV heads × ${model.headDim} × ${int(c)} tokens × ${kvb} bytes = ${gb(r.kvBytes)}`);
    }
    lines.push(`Read per token: ${bn(model.read)} weights${model.moe ? ` (${model.moe})` : ""} = ${(r.readW / 1e9).toFixed(2)} billion bytes, plus the KV cache`);
    math.replaceChildren(...lines.map((t) => h("div", null, t)));

    const n = [];
    if (c > model.maxCtx) n.push(h("li", { class: "warn" }, `${int(c)} tokens is past this model's max_position_embeddings of ${int(model.maxCtx)} in its config.`));
    if (r.nativeMx) n.push(h("li", null, "gpt-oss ships with MXFP4 experts and 16-bit attention, embeddings and router, so this splits the weights that way."));
    else if (st.quant === "MXFP4") n.push(h("li", null, "MXFP4 is gpt-oss's native format. For other models it is applied here as a flat 4.25 bits."));
    if (model.swa && !st.windowOnly) n.push(h("li", null, "Sliding-window layers are counted at full context, as a runtime that caches every layer in full would store them."));
    if (r.verdict === "tight") n.push(h("li", null, "Tight means under 10% spare. Other apps, a bigger prompt batch or a different runtime can push it over."));
    if (/^Q|^IQ/.test(st.quant) && st.quant !== "Q8_0") n.push(h("li", null, `${st.quant} bits per weight are approximate llama.cpp averages; real files vary by model.`));
    if (st.hw === "pi5" || st.hw === "spark") n.push(h("li", null, "This device shares memory with its operating system, which also needs some of it."));
    notes.replaceChildren(...n);
    notes.hidden = !n.length;
  }

  update();
  return () => {};
}
