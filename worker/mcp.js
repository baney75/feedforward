// Feedforward MCP server (Streamable HTTP, stateless JSON responses).
// Read tools work without a token. Write tools need a personal token with the "write" scope.
// Agents can't comment, chat, moderate or change accounts: those stay with people.
import { agentUser, rate, json } from "./api.js";
import { STYLES, plain } from "../public/js/cite.js";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TOPICS = ["foundations", "local", "agents", "research", "math", "cs", "systems", "making", "labs"];
const SITE = "https://feedforward.dbaney.com";

const TOOLS = [
  { name: "search", description: "Search Feedforward's curated AI and CS catalog: the best videos, X posts, people, free books, landmark papers and dictionary terms.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, kind: { type: "string", enum: ["all", "videos", "posts", "people", "books", "papers", "terms"] }, limit: { type: "integer", minimum: 1, maximum: 25 } }, required: ["query"] } },
  { name: "define", description: "Define an AI or CS term in plain words, with reputable references.",
    inputSchema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] } },
  { name: "cite", description: "Format a citation for a paper in the Research section. Styles: apa, mla, chicago, bibtex.",
    inputSchema: { type: "object", properties: { paper: { type: "string", description: "Paper id or title words" }, style: { type: "string", enum: ["apa", "mla", "chicago", "bibtex"] } }, required: ["paper"] } },
  { name: "learning_path", description: "List the learning tracks, or the ordered steps of one track (videos, labs, readings).",
    inputSchema: { type: "object", properties: { track: { type: "string", description: "Track slug; omit to list all tracks" } } } },
  { name: "recommend", description: "Recommend standout videos on a topic.",
    inputSchema: { type: "object", properties: { topic: { type: "string", enum: TOPICS }, limit: { type: "integer", minimum: 1, maximum: 10 } } } },
  { name: "upcoming_sessions", description: "List upcoming live teaching sessions hosted by professors and tutors.", inputSchema: { type: "object", properties: {} } },
  { name: "save", description: "Save a video, post, book or paper to the signed-in learner's library. Needs a write token.",
    inputSchema: { type: "object", properties: { item: { type: "string", description: "Item key such as v:<videoId>, p:<postId>, b:<book title>, r:<paper id>" } }, required: ["item"] } },
  { name: "my_library", description: "Read the signed-in learner's saved items and recent history. Needs a token.", inputSchema: { type: "object", properties: {} } },
];

let cache = null, cachedAt = 0;
async function data(env, req) {
  if (cache && Date.now() - cachedAt < 600000) return cache;
  const get = async (p, d) => { try { const r = await env.ASSETS.fetch(new Request(new URL(p, req.url))); return r.ok ? await r.json() : d; } catch { return d; } };
  const [home, learn, books, papers, glossary] = await Promise.all([get("/data/home.json", {}), get("/data/learn.json", {}), get("/data/books.json", []), get("/data/papers.json", { papers: [] }), get("/data/glossary.json", { terms: [] })]);
  cache = { home, learn, books, papers: papers.papers || [], terms: glossary.terms || [] };
  cachedAt = Date.now();
  return cache;
}

const words = (q) => String(q || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
const hit = (ws, s) => { const t = String(s || "").toLowerCase(); return ws.every((w) => t.includes(w)); };
const text = (t) => ({ content: [{ type: "text", text: t }] });

async function call(name, args, env, req, user) {
  const D = await data(env, req);
  const people = D.home.people || [];
  if (name === "search") {
    const ws = words(args.query), kind = args.kind || "all", lim = Math.min(25, args.limit || 8), out = [];
    if (!ws.length) return text("Give me a few words to search for.");
    if (kind === "all" || kind === "videos") for (const v of D.home.videos || []) if (hit(ws, v[1] + " " + (people[v[5]] || {}).name)) out.push(`video: ${v[1]} (${(people[v[5]] || {}).name}) ${SITE}/watch/${v[0]}`);
    if (kind === "all" || kind === "posts") for (const p of D.home.posts || []) if (hit(ws, p.t)) out.push(`post by ${(people[p.p] || {}).name}: ${p.t.slice(0, 200)} https://x.com/${(people[p.p] || {}).x}/status/${p.id}`);
    if (kind === "all" || kind === "people") for (const p of people) if (hit(ws, p.name + " " + p.why)) out.push(`person: ${p.name}. ${p.why} ${SITE}/p/${p.slug}`);
    if (kind === "all" || kind === "books") for (const b of D.books) if (hit(ws, b.title + " " + b.authors + " " + b.why)) out.push(`book (free): ${b.title} by ${b.authors}. ${b.url}`);
    if (kind === "all" || kind === "papers") for (const p of D.papers) if (hit(ws, p.title + " " + p.why)) out.push(`paper: ${p.title} (${p.year}) id=${p.id} ${p.url}`);
    if (kind === "all" || kind === "terms") for (const t of D.terms) if (hit(ws, t.term + " " + (t.aka || []).join(" ") + " " + (t.keywords || []).join(" "))) out.push(`term: ${t.term}: ${t.short} ${SITE}/dictionary#${t.slug}`);
    return text(out.slice(0, lim).join("\n") || "Nothing matched. Try fewer or different words.");
  }
  if (name === "define") {
    const ws = words(args.term);
    const t = D.terms.find((x) => x.term.toLowerCase() === String(args.term).toLowerCase()) || D.terms.find((x) => hit(ws, x.term + " " + (x.aka || []).join(" ") + " " + (x.keywords || []).join(" ")));
    if (!t) return text("That term isn't in the dictionary yet.");
    return text(`${t.term}: ${t.short}\n\n${t.long}\n\nReferences:\n${(t.refs || []).map((r) => `- ${r.title}: ${r.url}`).join("\n")}\n\n${SITE}/dictionary#${t.slug}`);
  }
  if (name === "cite") {
    const ws = words(args.paper);
    const p = D.papers.find((x) => x.id === args.paper) || D.papers.find((x) => hit(ws, x.title));
    if (!p) return text("That paper isn't in the Research section.");
    const st = STYLES[args.style || "apa"] || STYLES.apa;
    return text(`${st[0]}:\n${args.style === "bibtex" ? st[1](p) : plain(st[1](p))}`);
  }
  if (name === "learning_path") {
    const tracks = (D.learn.tracks || []);
    if (!args.track) return text(tracks.map((t) => `${t.slug}: ${t.title} (${t.level}). ${t.blurb}`).join("\n"));
    const t = tracks.find((x) => x.slug === args.track);
    if (!t) return text("No such track. Call learning_path with no track to list them.");
    return text(`${t.title}\n${t.blurb}\n\n` + t.steps.map((s, i) => `${i + 1}. ${s.kind}: ${s.kind === "video" ? `${s.title || ""} ${SITE}/watch/${s.id}` : s.kind === "lab" ? `${SITE}/lab/${s.slug}` : `${s.title} ${s.url}`} ${s.note || ""}`).join("\n"));
  }
  if (name === "recommend") {
    const ti = TOPICS.indexOf(args.topic);
    const list = (D.home.videos || []).filter((v) => ti < 0 || v[6] === ti).sort((a, b) => b[8] - a[8]).slice(0, Math.min(10, args.limit || 5));
    return text(list.map((v) => `${v[1]} (${(people[v[5]] || {}).name}) ${SITE}/watch/${v[0]}`).join("\n") || "Nothing on that topic yet.");
  }
  if (name === "upcoming_sessions") {
    const rows = await env.DB.prepare("SELECT s.title, s.starts, s.minutes, s.id, u.name FROM sessions_live s JOIN users u ON u.id = s.host_id WHERE s.cancelled = 0 AND s.starts > ? ORDER BY s.starts LIMIT 20").bind(Math.floor(Date.now() / 1000) - 3600).all();
    return text(rows.results.map((r) => `${new Date(r.starts * 1000).toISOString()} ${r.title} with ${r.name} (${r.minutes} min) ${SITE}/sessions#${r.id}`).join("\n") || "No sessions are scheduled yet.");
  }
  if (name === "my_library") {
    if (!user) return text("This tool needs a personal token. Make one on your Feedforward profile.");
    const rows = await env.DB.prepare("SELECT kind, json FROM userdata WHERE user_id = ? AND kind IN ('saved', 'history')").bind(user.id).all();
    const d = Object.fromEntries(rows.results.map((r) => [r.kind, JSON.parse(r.json)]));
    return text(`Saved: ${Object.keys(d.saved || {}).slice(0, 50).join(", ") || "nothing yet"}\nRecently watched: ${(d.history || []).slice(0, 20).join(", ") || "nothing yet"}`);
  }
  if (name === "save") {
    if (!user || user.scope !== "write") return text("Saving needs a token with the write scope.");
    if (!/^(v|s|p|b|r|d):[\w.:-]{1,80}$/.test(args.item || "")) return text("Use an item key like v:<videoId>.");
    const row = await env.DB.prepare("SELECT json FROM userdata WHERE user_id = ? AND kind = 'saved'").bind(user.id).first();
    const saved = row ? JSON.parse(row.json) : {};
    saved[args.item] = Date.now();
    await env.DB.prepare("INSERT OR REPLACE INTO userdata (user_id, kind, json, updated) VALUES (?, 'saved', ?, ?)").bind(user.id, JSON.stringify(saved), Math.floor(Date.now() / 1000)).run();
    return text(`Saved ${args.item}.`);
  }
  throw Object.assign(new Error("Unknown tool"), { code: -32602 });
}

export async function mcp(req, env, { personal = false } = {}) {
  if (req.method === "GET") return new Response("Feedforward MCP server. POST JSON-RPC to this URL. Setup: " + SITE + "/agents", { status: 405, headers: { allow: "POST" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  // Agents call this from servers. A browser page may only call it from this site itself.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
  const h = req.headers.get("authorization") || "";
  const user = h.startsWith("Bearer ") ? await agentUser(env, h.slice(7)) : null;
  // The personal endpoint always needs a token; the 401 points connectors at the OAuth metadata.
  const challenge = { "www-authenticate": `Bearer resource_metadata="${new URL(req.url).origin}/.well-known/oauth-protected-resource/mcp/me"` };
  if ((h && !user) || (personal && !user)) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to Feedforward to use your library." } }, 401, challenge);
  const who = user ? "tok:" + user.tid : "ip:" + (req.headers.get("cf-connecting-ip") || "local");
  if (!(await rate(env, "mcp:" + who, user ? 600 : 120, 3600))) return json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Rate limit reached. Try again later." } }, 429);
  let msg;
  try { const t = await req.text(); if (t.length > 20000) throw 0; msg = JSON.parse(t); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  if (Array.isArray(msg)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported." } }, 400);
  const { id, method, params = {} } = msg;
  const ok = (result) => json({ jsonrpc: "2.0", id, result });
  if (id === undefined) return new Response(null, { status: 202 }); // notifications
  try {
    if (method === "initialize") {
      const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1];
      return ok({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "feedforward", version: "1.0.0" },
        instructions: "Feedforward is a curated AI and computer science learning hub. Use search to find the best videos, posts, free books, papers and terms; cite to format citations; learning_path for ordered study plans." });
    }
    if (method === "ping") return ok({});
    if (method === "tools/list") return ok({ tools: TOOLS });
    if (method === "tools/call") {
      if (!TOOLS.some((t) => t.name === params.name)) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool: " + params.name } });
      return ok(await call(params.name, params.arguments || {}, env, req, user));
    }
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (e) {
    return json({ jsonrpc: "2.0", id, error: { code: e.code || -32603, message: e.code ? e.message : "Internal error" } });
  }
}
