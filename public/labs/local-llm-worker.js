// Module worker for the local-llm lab. Loads transformers.js only when asked and runs generation off the main thread.
// The tool loop lives in local-llm-tools.js. Tools themselves run in the page: the worker asks, the page answers.
import { chatTurn } from "./local-llm-tools.js";

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js";

let T = null;          // the library
let tok = null, model = null, stopper = null;
const pending = new Map(); // tool call id -> resolve
let cidSeq = 0;

const post = (m) => self.postMessage(m);

self.onmessage = async ({ data }) => {
  if (data.type === "stop") { stopper?.interrupt(); return; }
  if (data.type === "tool_result") {
    const done = pending.get(data.cid);
    pending.delete(data.cid);
    done?.(data);
    return;
  }
  try {
    if (data.type === "load") await load(data);
    else if (data.type === "chat") await chat(data);
  } catch (err) {
    post({ type: "error", job: data.job, message: String(err?.message || err), where: data.type });
  }
};

async function load({ repo, dtype, file, device }) {
  post({ type: "status", text: "Loading the transformers.js library" });
  try {
    T = T || (await import(LIB));
  } catch (err) {
    throw new Error("Could not load transformers.js from jsdelivr. Check your connection. " + (err?.message || ""));
  }
  const files = {};
  const progress_callback = (p) => {
    if (p.status === "progress" && p.file) {
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      let loaded = 0, total = 0;
      for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
      post({ type: "progress", loaded, total, file: p.file });
    } else if (p.status === "done" && p.file) {
      post({ type: "filedone", file: p.file });
      if (/onnx_data/.test(p.file)) post({ type: "status", text: "Preparing the model. Large models take a minute." });
    }
  };
  const t0 = performance.now();
  tok = await T.AutoTokenizer.from_pretrained(repo, { progress_callback });
  const opts = { dtype, device, progress_callback };
  if (file) opts.model_file_name = file;
  model = await T.AutoModelForCausalLM.from_pretrained(repo, opts);
  post({ type: "status", text: "Warming up" });
  // One tiny pass compiles shaders or kernels so the first real reply is not slowed by setup.
  const warm = tok("Hi");
  await model.generate({ ...warm, max_new_tokens: 1 });
  let downloaded = 0;
  for (const f of Object.values(files)) downloaded += f.total;
  post({ type: "ready", ms: performance.now() - t0, bytes: downloaded });
}

function runTool(job, call) {
  return new Promise((resolve, reject) => {
    const cid = ++cidSeq;
    pending.set(cid, (r) => (r.ok ? resolve(r.result) : reject(new Error(String(r.result).replace(/^Error: /, "")))));
    post({ type: "run_tool", job, cid, call });
  });
}

async function chat({ job, messages, useTools, gen, maxNewTokens }) {
  if (!model) throw new Error("Model not loaded");
  stopper = new T.InterruptableStoppingCriteria();
  const t0 = performance.now();
  const r = await chatTurn({
    T, tok, model, messages, useTools, gen, maxNewTokens, stopper,
    runTool: (call) => runTool(job, call),
    emit: (e) => post({ ...e, job }),
  });
  const { convo, ...result } = r;
  post({ type: "done", job, result, ms: performance.now() - t0 });
  stopper = null;
}
