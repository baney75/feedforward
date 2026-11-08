import { h, fmt, lessonCSS, renderLesson, prefersReducedMotion } from "./lab-kit.js";

export const meta = {
  slug: "agent-loop",
  title: "What a harness actually does",
  blurb: "Step through one coding-agent run and watch the harness send context, run tools, and compact.",
  minutes: 8,
  topic: "agents",
};

const LIMIT = 12000;   // demo window, small on purpose
const RESERVE = 2000;  // kept free for the reply
const LINE = LIMIT - RESERVE;

// Every block that can sit in the context window. Tokens are approximate.
const BLOCKS = {
  sys: { kind: "harness", label: "System prompt", tokens: 1150,
    text: "You are a coding agent working in /repo. Use the tools to inspect files, run commands, and edit code. Be concise.\n+ AGENTS.md: run tests with pytest" },
  tools: { kind: "harness", label: "Tool definitions", tokens: 1300,
    text: "read(path)\nbash(command)\nedit(path, old_text, new_text)\nwrite(path, content)\nEach one has a JSON schema the reply must follow." },
  u1: { kind: "user", label: "You", tokens: 15, text: "test_parse_price is failing. Can you fix it?" },
  c1: { kind: "model", label: "Model: tool call", tokens: 35, text: "bash\n  command: pytest tests/test_price.py -q" },
  r1: { kind: "result", label: "Tool result: bash", tokens: 620,
    text: "F..\nFAILED tests/test_price.py::test_parse_price\n  assert parse_price(\"$1,299.00\") == 1299.0\nE assert None == 1299.0\n1 failed, 2 passed in 0.12s" },
  c2: { kind: "model", label: "Model: tool call", tokens: 30, text: "read\n  path: src/shop/price.py" },
  r2: { kind: "result", label: "Tool result: read", tokens: 2100,
    text: "41  def parse_price(text):\n42      m = re.match(r\"\\$(\\d+\\.\\d{2})\", text)\n43      return float(m[1].replace(\",\", \"\")) if m else None\n... 260 lines in all" },
  c3: { kind: "model", label: "Model: text + tool call", tokens: 160,
    text: "The pattern has no room for the comma in \"$1,299.00\".\nedit\n  path: src/shop/price.py\n  old_text: r\"\\$(\\d+\\.\\d{2})\"\n  new_text: r\"\\$([\\d,]+\\.\\d{2})\"" },
  r3: { kind: "result", label: "Tool result: edit", tokens: 25, text: "Edited src/shop/price.py: 1 line changed" },
  c4: { kind: "model", label: "Model: tool call", tokens: 25, text: "bash\n  command: pytest -v" },
  r4: { kind: "result", label: "Tool result: bash", tokens: 5400,
    text: "tests/test_cart.py::test_add_item PASSED\ntests/test_cart.py::test_remove_item PASSED\n... 209 more PASSED lines ...\n212 passed in 4.81s" },
  sum: { kind: "summary", label: "Summary of earlier turns", tokens: 380,
    text: "test_parse_price failed: the regex in src/shop/price.py rejected commas. Edited the pattern to allow them. Ran the full suite next." },
  a5: { kind: "model", label: "Model: answer, no tool call", tokens: 60,
    text: "Fixed. parse_price now accepts prices like $1,299.00. The regex allowed only digits before the decimal point. All 212 tests pass." },
};

const PHASES = [
  ["build", "Build"], ["send", "Send"], ["model", "Model"], ["run", "Run tool"],
  ["append", "Append"], ["compact", "Compact"], ["stop", "Stop"],
];

// call: this step includes one model call; its input is the context before the step's additions.
const STEPS = [
  { ph: ["build"], add: ["sys", "tools", "u1"],
    say: "You type a request. The harness builds the first context: its system prompt, the tool definitions, and your message." },
  { ph: ["send"], sendAll: true,
    say: "The harness sends the whole context to the model. The model sees only these tokens. It has no files, no terminal, and no memory of past sessions." },
  { ph: ["model"], add: ["c1"], call: true,
    say: "The model predicts text, one token at a time. This text is a tool call, written in the format the tool definitions describe." },
  { ph: ["run"], running: "c1",
    say: "The harness parses the tool call and runs <code>pytest</code> on your machine. The model runs nothing. It only wrote the request." },
  { ph: ["append"], add: ["r1"],
    say: "The harness appends the output as a tool result. Then it loops back to Send." },
  { ph: ["send", "model"], add: ["c2"], call: true,
    say: "Loop. The harness sends the whole context again, now with the failure in it. The model asks to read <code>src/shop/price.py</code>." },
  { ph: ["run", "append"], add: ["r2"],
    say: "The harness reads the file from disk and appends it. One 260-line file costs about 2,100 tokens." },
  { ph: ["send", "model"], add: ["c3"], call: true,
    say: "Send again. The model explains the bug and calls <code>edit</code> so the pattern accepts commas." },
  { ph: ["run", "append"], add: ["r3"],
    say: "The harness changes the file on disk and appends a one-line confirmation." },
  { ph: ["send", "model"], add: ["c4"], call: true,
    say: "Send again. The model asks for the full test suite with verbose output." },
  { ph: ["run", "append"], add: ["r4"],
    say: "212 lines of passing tests come back: about 5,400 tokens. The context is now past the compaction line." },
  { ph: ["compact"], mark: ["c1", "r1", "c2", "r2", "c3", "r3"],
    say: "Before the next send, the harness checks the total. It is above the window minus a reserve kept free for the reply, so it compacts." },
  { ph: ["compact"], remove: ["c1", "r1", "c2", "r2", "c3", "r3"], addAt: { id: "sum", after: "u1" }, call: true,
    say: "The harness asks the model to summarize the older turns (one more model call), then swaps them for that summary. The newest turns stay word for word." },
  { ph: ["send", "model"], add: ["a5"], call: true,
    say: "Send again. The model answers in plain text, with no tool call." },
  { ph: ["stop"],
    say: "No tool call means the run is over. The harness shows you the answer and waits for your next message." },
];

// Replay steps 0..i into a state.
function stateAt(i) {
  let ids = [];
  let calls = 0, sent = 0;
  for (let k = 0; k <= i; k++) {
    const s = STEPS[k];
    if (s.call) { calls++; sent += ids.reduce((a, id) => a + BLOCKS[id].tokens, 0); }
    if (s.remove) ids = ids.filter((id) => !s.remove.includes(id));
    if (s.addAt) ids.splice(ids.indexOf(s.addAt.after) + 1, 0, s.addAt.id);
    if (s.add) ids = ids.concat(s.add);
  }
  const s = STEPS[i];
  const fresh = new Set([...(s.add || []), ...(s.addAt ? [s.addAt.id] : [])]);
  return { ids, calls, sent, fresh, mark: new Set(s.mark || []), running: s.running, sendAll: !!s.sendAll };
}

const HARNESSES = [
  {
    name: "Pi", href: "https://github.com/earendil-works/pi",
    who: "By Mario Zechner. Open source (MIT), TypeScript.",
    facts: [
      "Calls itself a minimal, extensible agent harness.",
      "Four tools on by default: <code>read</code>, <code>bash</code>, <code>edit</code>, <code>write</code>. <code>grep</code>, <code>find</code>, and <code>ls</code> are built in but off.",
      "The default system prompt opens with one sentence, then lists the tools and a few rules.",
      "No sub-agents, plan mode, or permission system built in. You add what you want as extensions.",
      "Compacts when the context passes the window minus a 16,384-token reserve.",
    ],
    src: [["README", "https://github.com/earendil-works/pi#readme"],
      ["tools", "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md"],
      ["system prompt", "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts"],
      ["compaction", "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md"]],
  },
  {
    name: "Claude Code", href: "https://code.claude.com/docs/en/how-claude-code-works",
    who: "By Anthropic.",
    facts: [
      "Its docs define the harness as the layer around the model that provides the tools and manages the context the model sees.",
      "Many built-in tools, including <code>Read</code>, <code>Edit</code>, <code>Write</code>, <code>Bash</code>, <code>WebFetch</code>, and <code>Agent</code> for subagents.",
      "Tools that change things, such as <code>Bash</code> and <code>Edit</code>, need your permission by default.",
      "Subagents work in their own context window and hand back a summary.",
      "Compacts the conversation into a summary near the limit. <code>/compact</code> does it on demand.",
    ],
    src: [["how it works", "https://code.claude.com/docs/en/how-claude-code-works"],
      ["tools reference", "https://code.claude.com/docs/en/tools-reference"]],
  },
  {
    name: "Codex CLI", href: "https://github.com/openai/codex",
    who: "By OpenAI. Open source (Apache-2.0), Rust.",
    facts: [
      "A coding agent that runs locally on your computer.",
      "Network access is off by default. An OS-enforced sandbox limits what it can touch, typically the current workspace.",
      "An approval policy decides when it must stop and ask you before acting.",
      "Reads <code>AGENTS.md</code> files before doing any work, from your global file down to the current folder.",
    ],
    src: [["README", "https://github.com/openai/codex#readme"],
      ["sandbox and approvals", "https://developers.openai.com/codex/agent-approvals-security"],
      ["AGENTS.md", "https://developers.openai.com/codex/guides/agents-md"]],
  },
  {
    name: "opencode", href: "https://github.com/anomalyco/opencode",
    who: "Open source (MIT).",
    facts: [
      "Two built-in agents you switch with Tab: <code>build</code> has full access; <code>plan</code> is read-only and asks before running bash.",
      "A <code>general</code> subagent handles complex searches and multistep tasks.",
      "Built-in tools include read, edit, write, patch, grep, glob, shell, web fetch, and web search.",
      "Compacts automatically, keeps a set amount of recent context, and leaves a share of the window free.",
    ],
    src: [["README", "https://github.com/anomalyco/opencode#readme"],
      ["tools", "https://opencode.ai/docs/tools/"],
      ["config", "https://opencode.ai/docs/config/"]],
  },
];

const CSS = `
.lab-agent-loop { --k-harness: var(--fg-2); --k-user: var(--fg); --k-model: var(--accent);
  --k-result: color-mix(in srgb, var(--fg-2) 40%, var(--bg-3)); --k-summary: var(--ok);
  font: 400 var(--t-m)/1.5 var(--font); color: var(--fg); }
.lab-agent-loop * { box-sizing: border-box; }
.lab-agent-loop .al-phases { list-style: none; margin: 0 0 var(--s4); padding: 0; display: flex; flex-wrap: wrap; gap: var(--s1) var(--s2); }
.lab-agent-loop .al-phases li { display: inline-flex; align-items: center; gap: var(--s2); font: 500 var(--t-xs)/1 var(--mono); color: var(--fg-2); }
.lab-agent-loop .al-phases li span { padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--r-pill); }
.lab-agent-loop .al-phases li:not(:last-child)::after { content: "\\2192"; color: var(--line); font-family: var(--font); }
.lab-agent-loop .al-phases li.on span { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.lab-agent-loop .al-grid { display: grid; gap: var(--s5); }
@media (min-width: 720px) {
  .lab-agent-loop .al-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); align-items: start; }
  .lab-agent-loop .al-left { position: sticky; top: var(--s4); }
}
.lab-agent-loop .al-steplabel { font: 500 var(--t-xs)/1 var(--mono); color: var(--fg-2); margin: 0 0 var(--s2); }
.lab-agent-loop .al-say { margin: 0; min-height: 4.5em; font-size: var(--t-m); line-height: 1.5; }
.lab-agent-loop .al-controls { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--s2); margin: var(--s4) 0 var(--s5); }
.lab-agent-loop .al-controls .btn { min-height: 44px; padding: 0 var(--s3); }
.lab-agent-loop .al-controls .grow { grid-column: span 2; }
.lab-agent-loop .al-controls .wide { grid-column: span 2; }
.lab-agent-loop .al-meterhead { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s2); font-size: var(--t-s); margin-bottom: var(--s2); }
.lab-agent-loop .al-meterhead b { font: 500 var(--t-s)/1.2 var(--mono); }
.lab-agent-loop .al-meterhead b.over { color: var(--bad); }
.lab-agent-loop .al-meter { position: relative; height: 16px; border-radius: 4px; background: var(--bg-3); display: flex; overflow: visible; }
.lab-agent-loop .al-seg { height: 100%; border-right: 1px solid var(--bg); transition: flex-basis .35s ease; }
.lab-agent-loop .al-seg:first-child { border-radius: 4px 0 0 4px; }
.lab-agent-loop .al-tick { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--fg-2); }
.lab-agent-loop .al-tick.over { background: var(--bad); }
.lab-agent-loop .al-ticklabel { display: flex; justify-content: space-between; font: 400 var(--t-xs)/1.4 var(--mono); color: var(--fg-2); margin-top: var(--s2); }
.lab-agent-loop .al-legend { list-style: none; padding: 0; margin: var(--s3) 0 0; display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); font-size: var(--t-xs); color: var(--fg-2); }
.lab-agent-loop .al-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.lab-agent-loop .al-stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); margin-top: var(--s4); }
.lab-agent-loop .al-stat { border-top: 1px solid var(--line); padding-top: var(--s2); }
.lab-agent-loop .al-stat span { display: block; font-size: var(--t-xs); color: var(--fg-2); }
.lab-agent-loop .al-stat b { font: 500 var(--t-l)/1.3 var(--mono); }
.lab-agent-loop .al-stackhead { display: flex; justify-content: space-between; gap: var(--s2); font-size: var(--t-xs); color: var(--fg-2); margin: 0 0 var(--s2); }
.lab-agent-loop .al-stack { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s2); }
.lab-agent-loop .al-block { display: grid; grid-template-columns: 4px minmax(0, 1fr); border: 1px solid var(--line); border-radius: var(--r-s);
  background: var(--bg-2); overflow: hidden; transition: opacity .3s, border-color .3s; }
.lab-agent-loop .al-block > i { background: var(--k); }
.lab-agent-loop .al-block > div { padding: var(--s2) var(--s3); min-width: 0; }
.lab-agent-loop .al-bh { display: flex; justify-content: space-between; gap: var(--s2); font: 500 var(--t-xs)/1.4 var(--mono); color: var(--fg-2); }
.lab-agent-loop .al-bh em { font-style: normal; color: var(--accent-text); }
.lab-agent-loop .al-bt { margin: var(--s1) 0 0; font: 400 var(--t-s)/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; }
.lab-agent-loop .al-block.fresh { border-color: var(--accent); }
.lab-agent-loop .al-block.sendall { border-color: var(--accent); }
.lab-agent-loop .al-block.running { border-style: dashed; border-color: var(--accent); }
.lab-agent-loop .al-block.marked { opacity: .45; border-style: dashed; }
.lab-agent-loop .al-compare { border-top: 1px solid var(--line); margin-top: var(--s7); padding-top: var(--s5); }
.lab-agent-loop .al-compare h2 { font-size: var(--t-l); line-height: 1.3; margin: 0 0 var(--s2); }
.lab-agent-loop .al-compare > p { margin: 0 0 var(--s4); color: var(--fg-2); max-width: 68ch; }
.lab-agent-loop .al-hgrid { display: grid; gap: var(--s4); }
@media (min-width: 720px) { .lab-agent-loop .al-hgrid { grid-template-columns: 1fr 1fr; } }
.lab-agent-loop .al-h { border: 1px solid var(--line); border-radius: var(--r); padding: var(--s4); background: var(--bg-2); }
.lab-agent-loop .al-h h3 { margin: 0; font-size: var(--t-m); font-weight: 600; }
.lab-agent-loop .al-h h3 a { color: var(--fg); text-decoration-color: var(--accent); text-underline-offset: 3px; }
.lab-agent-loop .al-h .who { margin: 2px 0 var(--s3); font-size: var(--t-s); color: var(--fg-2); }
.lab-agent-loop .al-h ul { margin: 0; padding-left: var(--s4); display: grid; gap: var(--s2); font-size: var(--t-s); line-height: 1.5; }
.lab-agent-loop .al-h .src { margin: var(--s3) 0 0; font-size: var(--t-xs); color: var(--fg-2); }
.lab-agent-loop .al-h .src a { color: var(--fg-2); text-underline-offset: 2px; }
.lab-agent-loop .al-h .src a:hover { color: var(--accent-text); }
@media (prefers-reduced-motion: reduce) { .lab-agent-loop .al-seg, .lab-agent-loop .al-block { transition: none; } }
${lessonCSS("lab-agent-loop")}
`;

const KINDS = [["harness", "Harness"], ["user", "You"], ["model", "Model wrote"], ["result", "Tool results"], ["summary", "Summary"]];

export function mount(root, ctx) {
  root.classList.add("lab-agent-loop");
  root.append(h("style", { text: CSS }));

  let step = 0;
  let timer = null;

  const phaseEls = PHASES.map(([id, name]) => h("li", { "data-ph": id }, h("span", { text: name })));
  const stepLabel = h("p", { class: "al-steplabel" });
  const say = h("p", { class: "al-say", "aria-live": "polite" });
  const back = h("button", { class: "btn", type: "button", text: "Back" });
  const next = h("button", { class: "btn primary grow", type: "button", text: "Next step" });
  const play = h("button", { class: "btn wide", type: "button", "aria-pressed": "false", text: "Auto-play" });
  const reset = h("button", { class: "btn", type: "button", text: "Restart" });

  const meterNums = h("b");
  const meter = h("div", { class: "al-meter", role: "img" });
  const tick = h("div", { class: "al-tick", style: { left: `calc(${(LINE / LIMIT) * 100}% - 1px)` } });
  meter.append(tick);
  const calls = h("b");
  const sent = h("b");
  const stack = h("ol", { class: "al-stack", "aria-label": "Context window, oldest first" });

  root.append(
    h("ol", { class: "al-phases", "aria-label": "Loop phases" }, phaseEls),
    h("div", { class: "al-grid" },
      h("div", { class: "al-left" },
        stepLabel, say,
        h("div", { class: "al-controls" }, back, next, play, reset),
        h("div", { class: "al-meterhead" }, h("span", { text: "Context window" }), meterNums),
        meter,
        h("div", { class: "al-ticklabel", "aria-hidden": "true" },
          h("span", { text: "0" }), h("span", { text: `compact line ${fmt(LINE)}` }), h("span", { text: fmt(LIMIT) })),
        h("ul", { class: "al-legend" }, KINDS.map(([k, n]) => h("li", {}, h("i", { style: { background: `var(--k-${k})` } }), n))),
        h("div", { class: "al-stats" },
          h("div", { class: "al-stat" }, h("span", { text: "Model calls" }), calls),
          h("div", { class: "al-stat" }, h("span", { text: "Input tokens sent, all calls" }), sent)),
      ),
      h("div", { class: "al-right" },
        h("p", { class: "al-stackhead" }, h("span", { text: "What the model receives, oldest first" }), h("span", { text: "tokens, approx." })),
        stack),
    ),
  );

  function render() {
    const s = STEPS[step];
    const st = stateAt(step);
    phaseEls.forEach((el) => el.classList.toggle("on", s.ph.includes(el.dataset.ph)));
    stepLabel.textContent = `Step ${step + 1} of ${STEPS.length}`;
    say.innerHTML = s.say;
    back.disabled = step === 0;
    next.disabled = step === STEPS.length - 1;

    const total = st.ids.reduce((a, id) => a + BLOCKS[id].tokens, 0);
    const over = total > LINE;
    meterNums.textContent = `${fmt(total)} of ${fmt(LIMIT)} tokens`;
    meterNums.classList.toggle("over", over);
    tick.classList.toggle("over", over);
    meter.setAttribute("aria-label", `Context holds ${fmt(total)} of ${fmt(LIMIT)} tokens. Compaction starts above ${fmt(LINE)}.${over ? " Over the line." : ""}`);
    meter.querySelectorAll(".al-seg").forEach((e) => e.remove());
    for (const id of st.ids) {
      const b = BLOCKS[id];
      meter.insertBefore(h("div", { class: "al-seg", style: { flex: `0 0 ${(b.tokens / LIMIT) * 100}%`, background: `var(--k-${b.kind})` } }), tick);
    }
    calls.textContent = fmt(st.calls);
    sent.textContent = fmt(st.sent);

    stack.replaceChildren(...st.ids.map((id) => {
      const b = BLOCKS[id];
      const cls = ["al-block"];
      if (st.fresh.has(id)) cls.push("fresh");
      if (st.sendAll) cls.push("sendall");
      if (st.running === id) cls.push("running");
      if (st.mark.has(id)) cls.push("marked");
      const tag = st.running === id ? h("em", { text: " running on your machine" })
        : st.mark.has(id) ? h("em", { text: " to be summarized" })
        : st.fresh.has(id) ? h("em", { text: " new" }) : null;
      return h("li", { class: cls.join(" "), style: { "--k": `var(--k-${b.kind})` } },
        h("i", { "aria-hidden": "true" }),
        h("div", {},
          h("div", { class: "al-bh" }, h("span", {}, b.label, tag), h("span", { text: fmt(b.tokens) })),
          h("p", { class: "al-bt", text: b.text })));
    }));
  }

  function go(n) { step = Math.max(0, Math.min(STEPS.length - 1, n)); render(); if (step === STEPS.length - 1) stop(); }
  function stop() { if (timer) clearInterval(timer); timer = null; play.textContent = "Auto-play"; play.setAttribute("aria-pressed", "false"); }
  function start() {
    if (step === STEPS.length - 1) go(0);
    play.textContent = "Pause"; play.setAttribute("aria-pressed", "true");
    timer = setInterval(() => go(step + 1), prefersReducedMotion() ? 4000 : 2800);
  }

  back.addEventListener("click", () => { stop(); go(step - 1); });
  next.addEventListener("click", () => { stop(); go(step + 1); });
  reset.addEventListener("click", () => { stop(); go(0); });
  play.addEventListener("click", () => (timer ? stop() : start()));
  const onKey = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight") { stop(); go(step + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { stop(); go(step - 1); e.preventDefault(); }
  };
  root.addEventListener("keydown", onKey);

  // Harness comparison
  root.append(h("section", { class: "al-compare" },
    h("h2", { text: "Four real harnesses" }),
    h("p", { text: "All four run the same loop. They differ in which tools they ship, how they guard your machine, and how they manage context. Each fact below comes from the project's own README or docs." }),
    h("div", { class: "al-hgrid" }, HARNESSES.map((x) => h("article", { class: "al-h" },
      h("h3", {}, h("a", { href: x.href, target: "_blank", rel: "noopener", text: x.name })),
      h("p", { class: "who", text: x.who }),
      h("ul", {}, x.facts.map((f) => h("li", { html: f }))),
      h("p", { class: "src" }, "Sources: ", ...x.src.flatMap(([t, u], i) => [i ? ", " : "", h("a", { href: u, target: "_blank", rel: "noopener", text: t })])),
    ))),
  ));

  renderLesson(root, {
    happening: [
      "A language model only predicts text. Given a context, it writes the next tokens and stops.",
      "The harness is everything around it: the loop, the tools, and the context. It sends the context, parses any tool call in the reply, runs that tool on your machine, appends the result, and sends again.",
      "The loop ends when the model replies without a tool call.",
      "Every call resends the whole context, so a big tool output costs tokens on every later call. Providers offer prompt caching to make that repeated prefix cheaper, and harnesses use it.",
      "Near the limit, the harness compacts: it replaces old turns with a summary. Details in those turns are gone after that.",
      "This demo uses a 12,000-token window so compaction shows up in a short run. Real windows are far larger, but long tasks still fill them.",
    ],
    tryThis: [
      "Step to the end. Compare the input tokens sent across all calls with what is left in the window. Each call resent everything.",
      "Go to step 11 and find the block that pushed the context past the line. Running <code>pytest -q</code> instead of <code>pytest -v</code> would have printed one line.",
      "Look only at the amber blocks. They are the only text the model wrote. Everything else came from you or the harness.",
    ],
    check: {
      q: "The model replies with a tool call that runs npm test. What runs the tests?",
      options: [
        { t: "The harness, on your machine. Then it appends the output.", right: true,
          why: "The model only writes the request as text. The harness parses it, runs the command, and puts the real output into the next call." },
        { t: "The model, on its provider's servers.", right: false,
          why: "The model has no shell. It predicts text. Running anything is the harness's job." },
        { t: "Nothing runs. The model imagines the output.", right: false,
          why: "A model with no tools can only guess. Here the harness has a bash tool, so it runs the command and appends the true output." },
      ],
    },
  }, ctx);

  render();

  return () => {
    stop();
    root.removeEventListener("keydown", onKey);
  };
}
