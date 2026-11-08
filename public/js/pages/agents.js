// /agents: connect an AI agent to Feedforward over MCP. Config syntax checked against each client's docs (2026-11-07):
// Claude Code (code.claude.com/docs/en/mcp), Codex (developers.openai.com/codex/mcp), Cursor (cursor.com/docs/context/mcp).
import { signedIn } from "../account.js";
import { esc } from "../ui.js";
import { icon } from "../icons.js";
import { $, SITE, setTitle, cssReady, loader, copy, on } from "./_shared.js";

const URL_ = `${SITE}/mcp`;
const CLIENTS = [
  ["claude", "Claude Code", "Run this in a terminal.",
    `claude mcp add --transport http feedforward ${URL_}`,
    "With a token, for your library and saves:",
    `claude mcp add --transport http feedforward ${URL_} \\\n  --header "Authorization: Bearer ffk_your_token"`],
  ["codex", "Codex", "Add this to ~/.codex/config.toml.",
    `[mcp_servers.feedforward]\nurl = "${URL_}"`,
    "With a token, keep it in an environment variable and name it here:",
    `[mcp_servers.feedforward]\nurl = "${URL_}"\nbearer_token_env_var = "FEEDFORWARD_TOKEN"`],
  ["cursor", "Cursor", "Add this to ~/.cursor/mcp.json, or .cursor/mcp.json in a project.",
    JSON.stringify({ mcpServers: { feedforward: { url: URL_ } } }, null, 2),
    "With a token, Cursor reads it from an environment variable:",
    JSON.stringify({ mcpServers: { feedforward: { url: URL_, headers: { Authorization: "Bearer ${env:FEEDFORWARD_TOKEN}" } } } }, null, 2)],
  ["other", "Other", "Most clients that speak Streamable HTTP take a JSON entry like this.",
    JSON.stringify({ mcpServers: { feedforward: { type: "http", url: URL_ } } }, null, 2),
    "With a token, send it as a header:",
    JSON.stringify({ mcpServers: { feedforward: { type: "http", url: URL_, headers: { Authorization: "Bearer ffk_your_token" } } } }, null, 2)],
];
const CURL = `curl -s ${URL_} \\\n  -H "Authorization: Bearer ffk_your_token" \\\n  -H "content-type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"define","arguments":{"term":"attention"}}}'`;
const TOKEN_TOOLS = new Set(["save", "my_library"]);
const ME_URL = `${SITE}/mcp/me`;
// Click paths checked against the current docs on 2026-11-07:
// support.claude.com "Get started with custom connectors using remote MCP", developers.openai.com/apps-sdk/deploy/connect-chatgpt.
const APPS = [
  ["claude", "claude.ai", [
    `Open <a class="link" href="https://claude.ai/customize/connectors" target="_blank" rel="noopener">Customize &gt; Connectors</a> on claude.ai.`,
    "Click <b>+ Add</b>, then <b>Add custom connector</b>.",
    "Name it Feedforward, paste the address above and click <b>Continue</b>, then <b>Add</b>.",
    "Click <b>Connect</b>. Feedforward asks you to approve it.",
  ], "On a Team or Enterprise plan, an owner adds it under Organization settings &gt; Connectors first."],
  ["chatgpt", "ChatGPT", [
    `Open <a class="link" href="https://chatgpt.com/plugins" target="_blank" rel="noopener">chatgpt.com/plugins</a>.`,
    "Click <b>+</b>, then <b>Add custom MCP server</b>.",
    "Name it Feedforward, add a short description and paste the address above.",
    "Pick <b>OAuth</b>. Read the warning and choose <b>I understand and want to continue</b>.",
    "Click <b>Create as a plugin</b>. Feedforward asks you to approve it.",
  ], "Workspace policies decide whether custom servers are allowed on business plans."],
];

export async function render(el, qs) {
  await cssReady;
  setTitle("Connect an agent");
  let pick = CLIENTS.some((c) => c[0] === qs.get("client")) ? qs.get("client") : "claude";
  el.innerHTML = `<div class="pg pg-agents">
    <header class="page-h"><div><h1>Connect an agent</h1><p>Feedforward runs an MCP server. Your agent can search the catalog, define terms, cite papers and plan what to learn next.</p></div></header>

    <section class="set" aria-labelledby="appsH">
      <h2 class="set-h" id="appsH">Add to claude.ai or ChatGPT</h2>
      <ul class="rows urls">
        <li><div class="url-t"><b>Connector address</b><span class="muted">Adds your saves and history. You approve it on Feedforward and can revoke it any time.</span><span class="mono url">${esc(ME_URL)}</span></div><button class="btn sm" type="button" data-copy="${esc(ME_URL)}" aria-label="Copy the library address">Copy</button></li>
      </ul>
      <div class="seg app-seg" role="tablist" aria-label="App">${APPS.map(([k, l], i) => `<button type="button" role="tab" id="app-${k}" data-app="${k}" aria-selected="${i === 0}" aria-pressed="${i === 0}" aria-controls="steps">${l}</button>`).join("")}</div>
      <div id="steps" role="tabpanel"></div>
    </section>

    <section class="set" aria-labelledby="setupH">
      <h2 class="set-h" id="setupH">Coding agents</h2>
      <div class="seg client-seg" role="tablist" aria-label="Agent">${CLIENTS.map(([k, l]) => `<button type="button" role="tab" id="tab-${k}" data-client="${k}" aria-selected="${k === pick}" aria-pressed="${k === pick}" aria-controls="cfg">${l}</button>`).join("")}</div>
      <div id="cfg" role="tabpanel"></div>
    </section>

    <section class="set" aria-labelledby="toolsH">
      <h2 class="set-h" id="toolsH">Tools</h2>
      <ul class="rows tools" id="tools">${loader("asking the server")}</ul>
      <div class="try"><div class="cfg-block"><div class="cfg-head"><p class="hint">Try one from a terminal with curl:</p><button class="btn sm" type="button" data-copy="${esc(CURL)}" aria-label="Copy the curl example">Copy</button></div><pre class="code"><code>${esc(CURL)}</code></pre></div></div>
    </section>

    <section class="set" aria-labelledby="safeH">
      <h2 class="set-h" id="safeH">How it stays safe</h2>
      <ul class="safe">
        <li>Every call needs your token, or the connector's sign-in. Feedforward is invite-only, so agents connect as you.</li>
        <li>A token only adds your own library. A read token can see your saves and history. A read and save token can also save things for you.</li>
        <li>Tokens are stored hashed, so nobody can read them back, not even us. You see each one once.</li>
        <li>Connecting your library in claude.ai or ChatGPT makes a token named after the app, after you approve it on Feedforward.</li>
        <li>You can revoke a token at any time, and it stops working right away.</li>
        <li>Agents can't comment, chat, moderate, make tokens or change your account. Those stay with people.</li>
      </ul>
      <div class="acts end-acts">${signedIn() ? `<a class="btn primary" href="/me">Make a token</a>` : `<a class="btn primary" href="/me">Get a free code to make a token</a>`}</div>
    </section>
  </div>`;

  const cfg = $("#cfg", el);
  const block = (lead, text, label) => `<div class="cfg-block"><div class="cfg-head"><p class="hint">${esc(lead)}</p><button class="btn sm" type="button" data-copy="${esc(text)}" aria-label="Copy ${esc(label)}">Copy</button></div><pre class="code"><code>${esc(text)}</code></pre></div>`;
  const paint = () => {
    const [, label, lead, plain, tokLead, tok] = CLIENTS.find((c) => c[0] === pick);
    cfg.setAttribute("aria-labelledby", "tab-" + pick);
    // Feedforward is invite-only, so every setup carries the member's token.
    void plain; void tokLead;
    cfg.innerHTML = block(lead + " Make a token on your profile first.", tok, label + " setup");
  };
  paint();
  const steps = $("#steps", el);
  const paintApp = (k) => {
    const [, , list, foot] = APPS.find((a) => a[0] === k);
    steps.setAttribute("aria-labelledby", "app-" + k);
    // Step text is fixed copy from this file, not data, so it may carry markup.
    steps.innerHTML = `<ol class="steps-list">${list.map((t) => `<li>${t}</li>`).join("")}</ol><p class="hint">${foot}</p>`;
  };
  paintApp("claude");
  const offs = [
    on(el, "[data-app]", (b) => { el.querySelectorAll("[data-app]").forEach((x) => { x.setAttribute("aria-pressed", x === b); x.setAttribute("aria-selected", x === b); }); paintApp(b.dataset.app); }),
    on(el, "[data-client]", (b) => {
      pick = b.dataset.client;
      el.querySelectorAll("[data-client]").forEach((x) => { x.setAttribute("aria-pressed", x === b); x.setAttribute("aria-selected", x === b); });
      history.replaceState(null, "", pick === "claude" ? "/agents" : "/agents?client=" + pick);
      paint();
    }),
    on(el, "[data-copy]", (b) => copy(b.dataset.copy)),
  ];
  // Arrow keys move between the client tabs.
  const seg = $(".client-seg", el);
  const onKey = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const bs = [...seg.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
    n.focus(); n.click();
  };
  seg.addEventListener("keydown", onKey);

  // The tool list comes live from the server, so this page never drifts from what agents actually see.
  const tools = $("#tools", el);
  try {
    const r = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const d = await r.json();
    if (!d.result) throw new Error();
    tools.innerHTML = d.result.tools.map((t) => `<li><span class="tool-n"><b class="mono">${esc(t.name)}</b>${TOKEN_TOOLS.has(t.name) ? `<span class="kind">Needs a token</span>` : ""}</span><span class="muted">${esc(t.description)}</span></li>`).join("");
  } catch { tools.innerHTML = `<li class="muted empty-row" role="alert">The tool list didn't load. <button class="textbtn" type="button" onclick="location.reload()">Try again</button></li>`; }
  return () => { offs.forEach((f) => f()); seg.removeEventListener("keydown", onKey); };
}
