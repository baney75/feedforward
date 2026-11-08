// Builds public/data/repos.json: a hand-picked list of open repos for learning and doing AI, CS and making.
// Live metadata comes from the GitHub API through the gh CLI (stars, language, license, last push).
// Usage: node scripts/build_repos.mjs   (needs `gh auth status` to pass)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const run = promisify(execFile);
const OUT = new URL("../public/data/repos.json", import.meta.url);

// [owner/name, topic, why]. Topics use the site's codes (public/js/data.js TOPICS). No em or en dashes.
const LIST = [
  // How models work
  ["karpathy/nanoGPT", "foundations", "The smallest readable GPT you can train yourself. Start here to see a transformer end to end."],
  ["karpathy/micrograd", "foundations", "Backpropagation in about 150 lines. You can read all of autograd in one sitting."],
  ["karpathy/llm.c", "foundations", "GPT-2 training in plain C and CUDA, so nothing hides behind a framework."],
  ["karpathy/nanochat", "foundations", "A full ChatGPT-style pipeline, from tokenizer to chat UI, on one GPU node."],
  ["karpathy/minbpe", "foundations", "Byte pair encoding, the tokenizer behind most LLMs, written to be read."],
  ["karpathy/nn-zero-to-hero", "foundations", "Notebooks for the Zero to Hero course, from a single neuron to a GPT."],
  ["rasbt/LLMs-from-scratch", "foundations", "Build, pretrain and fine-tune a GPT-like model step by step in PyTorch."],
  ["huggingface/transformers", "foundations", "The standard library for loading and running open models in Python."],
  ["pytorch/pytorch", "foundations", "The framework most research and most open models are written in."],
  ["jax-ml/jax", "foundations", "NumPy that compiles and differentiates, used for large-scale training."],
  ["tinygrad/tinygrad", "foundations", "A tiny deep learning framework you can read, with real GPU backends."],
  ["labmlai/annotated_deep_learning_paper_implementations", "foundations", "Famous papers implemented in PyTorch with side-by-side notes."],
  ["d2l-ai/d2l-en", "foundations", "Dive into Deep Learning: a free textbook where every idea runs as code."],
  ["unslothai/unsloth", "foundations", "Fine-tune open models faster and with less memory on one GPU."],
  // Local AI
  ["ggml-org/llama.cpp", "local", "Runs LLMs on almost any hardware. The engine under most local AI apps."],
  ["ollama/ollama", "local", "The easiest way to download and run open models on your own machine."],
  ["ml-explore/mlx", "local", "Apple's array framework built for the unified memory of Apple silicon."],
  ["ml-explore/mlx-lm", "local", "Run and fine-tune LLMs on a Mac with MLX, from one command."],
  ["vllm-project/vllm", "local", "High-throughput model serving. What many teams run in production."],
  ["sgl-project/sglang", "local", "A fast serving engine with structured generation and smart caching."],
  ["exo-explore/exo", "local", "Pool the phones, laptops and desktops you own into one AI cluster."],
  ["ggml-org/whisper.cpp", "local", "Speech to text on your own device, fast enough for real time."],
  ["open-webui/open-webui", "local", "A self-hosted chat interface for local and remote models."],
  ["comfyanonymous/ComfyUI", "local", "Node graphs for image and video generation that run locally."],
  // Agents and harnesses
  ["earendil-works/pi", "agents", "Pi, a minimal coding agent harness that is easy to read and extend."],
  ["anthropics/claude-code", "agents", "Anthropic's agentic coding tool for the terminal."],
  ["openai/codex", "agents", "OpenAI's open source coding agent that runs in your terminal."],
  ["anomalyco/opencode", "agents", "An open source coding agent for the terminal that works with many models."],
  ["google-gemini/gemini-cli", "agents", "Google's open source agent for the terminal, built on Gemini."],
  ["Aider-AI/aider", "agents", "Pair programming with an LLM in your terminal, on your git repo."],
  ["OpenHands/OpenHands", "agents", "An open platform for software agents that write, run and fix code."],
  ["SWE-agent/SWE-agent", "agents", "The research agent that fixes real GitHub issues, with its benchmark tooling."],
  ["aaif-goose/goose", "agents", "An open source, extensible agent that runs on your machine."],
  ["huggingface/smolagents", "agents", "A small library for agents that think in code. Easy to read."],
  ["modelcontextprotocol/modelcontextprotocol", "agents", "The Model Context Protocol spec: how agents connect to tools and data."],
  ["modelcontextprotocol/servers", "agents", "Reference MCP servers to learn from and build on."],
  ["anthropics/skills", "agents", "Example agent skills: folders of instructions and scripts an agent loads on demand."],
  // Research
  ["EleutherAI/lm-evaluation-harness", "research", "The common tool for running standard benchmarks on language models."],
  ["TransformerLensOrg/TransformerLens", "research", "Open up a model and study its internals. The base kit for interpretability."],
  // GPUs and systems
  ["triton-lang/triton", "systems", "Write fast GPU kernels in Python instead of CUDA C++."],
  ["Dao-AILab/flash-attention", "systems", "The attention kernel that made long contexts practical. Worth studying."],
  ["HazyResearch/ThunderKittens", "systems", "Small, readable building blocks for fast GPU kernels."],
  ["srush/GPU-Puzzles", "systems", "Short puzzles that teach GPU programming by doing."],
  ["gpu-mode/resource-stream", "systems", "The GPU MODE community's reading list for kernels and performance."],
  // Computer science
  ["ossu/computer-science", "cs", "A complete computer science education from free online courses."],
  ["codecrafters-io/build-your-own-x", "cs", "Guides to building your own database, Git, shell, compiler and more."],
  ["donnemartin/system-design-primer", "cs", "How large systems are designed, with worked examples."],
  ["mit-pdos/xv6-riscv", "cs", "MIT's small teaching operating system. Read a whole OS."],
  ["TheAlgorithms/Python", "cs", "Classic algorithms written plainly in Python."],
  ["rust-lang/rustlings", "cs", "Small exercises that teach Rust by fixing code."],
  // CAD and 3D printing
  ["OrcaSlicer/OrcaSlicer", "making", "A popular open source slicer with calibration tools built in."],
  ["prusa3d/PrusaSlicer", "making", "Prusa's slicer, a mature and well documented reference."],
  ["Ultimaker/Cura", "making", "One of the most used open source slicers."],
  ["Klipper3d/klipper", "making", "Printer firmware that moves the math to a small computer for speed."],
  ["MarlinFirmware/Marlin", "making", "The firmware that runs most hobby 3D printers."],
  ["FreeCAD/FreeCAD", "making", "Open source parametric CAD for real mechanical parts."],
  ["openscad/openscad", "making", "Model solid parts by writing code. Great for exact, repeatable designs."],
  ["BelfrySCAD/BOSL2", "making", "The OpenSCAD library for threads, gears, rounding and attachments."],
  ["CadQuery/cadquery", "making", "Parametric CAD as a Python library, built on the OCCT kernel."],
  ["gumyr/build123d", "making", "Modern Python CAD on the same kernel as CadQuery, with clean syntax."],
];

async function meta(name) {
  const { stdout } = await run("gh", ["api", `repos/${name}`, "--jq", "{full_name, description, stargazers_count, language, pushed_at, archived, license: .license.spdx_id, html_url}"], { maxBuffer: 1 << 20 });
  return JSON.parse(stdout);
}

const out = [], failed = [];
for (let i = 0; i < LIST.length; i += 8) {
  const batch = LIST.slice(i, i + 8);
  const got = await Promise.allSettled(batch.map(([n]) => meta(n)));
  got.forEach((g, k) => {
    const [name, topic, why] = batch[k];
    if (g.status !== "fulfilled") { failed.push(name); return; }
    const m = g.value;
    if (/[–—]/.test(why)) throw new Error("Dash in why for " + name);
    out.push({
      repo: m.full_name, desc: (m.description || "").trim(), stars: m.stargazers_count, lang: m.language || "",
      pushed: Math.floor(Date.parse(m.pushed_at) / 1000), license: m.license && m.license !== "NOASSERTION" ? m.license : "",
      archived: !!m.archived, url: m.html_url, topic, why,
    });
  });
}
if (failed.length) console.error("Could not fetch: " + failed.join(", "));
out.sort((a, b) => b.stars - a.stars);
writeFileSync(OUT, JSON.stringify({ built: Math.floor(Date.now() / 1000), repos: out }, null, 1) + "\n");
console.log(`Wrote ${out.length} repos to public/data/repos.json`);
if (failed.length) process.exitCode = 1;
