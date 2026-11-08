// Feedforward API: device-code accounts, sync, likes, ratings, comments, referrals, invites, roles and moderation.
// Codes and tokens are only ever stored hashed. Every write is rate limited. Staff actions go to the mod log.
import { WORDS } from "./words.js";
import { gateCookie, clearGate, powChallenge, checkPow } from "./gate.js";

export const RANK = { user: 1, contributor: 2, mod: 3, admin: 4, owner: 5 };
const ITEM = /^(v|s|p|b|r|l|d|k|e):[\w.:-]{1,80}$/;
const ROOMS = ["general", "local-ai", "agents", "research", "making", "help"];
// Same backstop as the catalog: the site stays on AI, CS and making.
const OFFTOPIC = /\b(trump|biden|harris|vance|democrats?|republicans?|maga|election|congress|senate|immigra\w*|abortion|israel|gaza|palestin\w*|ukraine|putin|woke|left-wing|right-wing)\b/i;
const PROFANE = /\b(fuck\w*|shit\w*|cunt\w*|bitch\w*|nigg\w*|fag\w*|retard\w*|whore\w*|slut\w*|pussy\w*|dickhead\w*|kys)\b/i;

const enc = new TextEncoder();
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function rnd(n) { return crypto.getRandomValues(new Uint32Array(n)); }
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
export function rid(len = 10) { return [...rnd(len)].map((x) => ALPHA[x % ALPHA.length]).join(""); }
export function newCode() {
  const r = rnd(5);
  // Four words and two digits: about 47 bits. (The first codes had three words; they still sign in.)
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${WORDS[r[2] % WORDS.length]}-${WORDS[r[3] % WORDS.length]}-${String(r[4] % 100).padStart(2, "0")}`;
}
export const normCode = (c) => String(c || "").toLowerCase().trim().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");

export const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const err = (status, error) => json({ error }, status);
const now = () => Math.floor(Date.now() / 1000);
// Rate-limit keys. IPv6 users control at least a /64 (often a /48), so IPv6 keys on the expanded /64,
// with a second, wider limit on the /48. Compressed forms like 2001:db8::1 are expanded first.
export function expand6(a) {
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const mid = a.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...mid, ...t].map((x) => x.toLowerCase().padStart(4, "0"));
}
const ip = (req, width = 64) => {
  const a = req.headers.get("cf-connecting-ip") || "local";
  if (!a.includes(":")) return a;
  const g = expand6(a);
  return g.slice(0, width / 16).join(":") + "::/" + width;
};

async function rate(env, key, limit, windowSec) {
  // One atomic upsert: SQLite runs it as a single statement, so a burst of parallel requests can't all slip under the limit.
  const t = now();
  const row = await env.DB.prepare(`INSERT INTO rl (key, n, reset) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET n = CASE WHEN rl.reset <= ?3 THEN 1 ELSE rl.n + 1 END, reset = CASE WHEN rl.reset <= ?3 THEN ?2 ELSE rl.reset END
    RETURNING n`).bind(key, t + windowSec, t).first();
  return !row || row.n <= limit;
}

// Invisible and direction-changing characters (zero-width, bidi, tag, variation selectors, fillers).
// Written only as escapes: no invisible character appears in this source file.
export const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
const INVISIBLE_G = new RegExp(INVISIBLE.source, "gu");

// Clean user text. Returns [text, error].
export function clean(s, max) {
  const t = String(s || "").replace(INVISIBLE_G, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return ["", "Write something first."];
  if (t.length > max) return ["", `Keep it under ${max} characters.`];
  if (PROFANE.test(t)) return ["", "Please keep it clean."];
  if (OFFTOPIC.test(t)) return ["", "Feedforward stays on AI, computer science and making. No politics."];
  return [t, null];
}

// Tokens come from the Authorization header. A browser WebSocket can't set headers, so chat sends the
// token as a subprotocol ("ff", "t.<token>") instead of in the URL, where it would land in logs.
export function wsToken(req) {
  const p = (req.headers.get("sec-websocket-protocol") || "").split(",").map((x) => x.trim()).find((x) => x.startsWith("t."));
  return p ? p.slice(2) : "";
}
export async function auth(req, env) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : new URL(req.url).pathname.startsWith("/api/chat/") ? wsToken(req) : "";
  return tokenUser(env, tok);
}
export async function tokenUser(env, tok) {
  // Agent and connector tokens (ffk_) only reach /mcp. They never act on the account API, so they can't mint tokens.
  if (!tok || tok.startsWith("ffk_") || tok.length < 20 || tok.length > 100) return null;
  const th = await sha(tok);
  const u = await env.DB.prepare("SELECT u.*, s.seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(th).first();
  if (!u || u.banned) return null;
  if (now() - u.seen > 3600) await env.DB.prepare("UPDATE sessions SET seen = ? WHERE token_hash = ?").bind(now(), th).run();
  return u;
}
async function session(env, userId, device) {
  const tok = rid(40);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created, seen, device) VALUES (?, ?, ?, ?, ?)").bind(await sha(tok), userId, now(), now(), String(device || "").slice(0, 60)).run();
  return tok;
}
export const pub = (u) => u && { id: u.id, name: u.name || "Learner", avatar: u.avatar ? `/u/a/${u.avatar}` : u.avatar_x || "", role: u.role, teach: u.teach || "", verified: !!u.verified, created: u.created };
const linksOf = (u) => { try { return JSON.parse(u.links || "{}"); } catch { return {}; } };

// ---------- Profile links ----------
// Each link is validated and normalized; anything that doesn't match is dropped, never stored raw.
const LINK_RULES = {
  x: (v) => (v.match(/^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?@?([A-Za-z0-9_]{1,15})\/?$/) || [])[1],
  youtube: (v) => (v.match(/^(?:https?:\/\/(?:www\.)?youtube\.com\/)?(@[A-Za-z0-9._-]{3,30}|channel\/UC[\w-]{22})\/?$/) || [])[1] || ((v.match(/^@?([A-Za-z0-9._-]{3,30})$/) || [])[1] && "@" + v.replace(/^@/, "")),
  twitch: (v) => (v.match(/^(?:https?:\/\/(?:www\.)?twitch\.tv\/)?([A-Za-z0-9_]{4,25})\/?$/) || [])[1],
  github: (v) => (v.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/?$/) || [])[1],
  scholar: (v) => (v.match(/^https:\/\/scholar\.google\.[a-z.]{2,6}\/citations\?(?:[^#\s]*&)?user=([\w-]{12})(?:[&#].*)?$/) || [])[1],
  bluesky: (v) => (v.match(/^(?:https:\/\/bsky\.app\/profile\/)?@?([a-z0-9][a-z0-9.-]{2,60}\.[a-z]{2,})\/?$/i) || [])[1],
  linkedin: (v) => (v.match(/^(?:https:\/\/(?:www\.)?linkedin\.com\/in\/)?([A-Za-z0-9-]{3,100})\/?$/) || [])[1],
  site: (v) => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && v.length <= 200 && !/[<>"']/.test(v) ? u.toString() : undefined; } catch { return undefined; } },
};
// Nobody may claim a listed person's X handle or exact name unless an admin has verified the account.
let LISTED_X = new Set(), LISTED_NAMES = new Set();
// The Worker passes its source list in at startup (a JSON import here would break the Node tests).
export function setListed(sources) {
  LISTED_X = new Set(sources.filter((s) => s.x).map((s) => s.x.toLowerCase()));
  LISTED_NAMES = new Set(sources.filter((s) => s.name).map((s) => s.name.toLowerCase()));
}
export function impersonates(u, name, links) {
  if (u && u.verified) return false;
  const n = (name || "").trim().toLowerCase();
  // Single-word names (Theo, Claude, Qwen) are too common to reserve; full names are reserved.
  return (links && links.x && LISTED_X.has(links.x.toLowerCase())) || (n.includes(" ") && LISTED_NAMES.has(n));
}
export function cleanLinks(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, rule] of Object.entries(LINK_RULES)) {
    const v = String(input[k] || "").trim();
    if (!v) continue;
    const ok = rule(v);
    if (ok) out[k] = ok;
  }
  return out;
}
// The X profile picture, via the public fxtwitter API. Returns "" when it can't be found.
// fxtwitter sometimes answers 404 for real accounts, so try a few times.
const FX_UA = { "user-agent": "Mozilla/5.0 (compatible; Feedforward/1.0; +https://feedforward.dbaney.com/about)" };
const okAvatar = (a) => (a && /^https:\/\/pbs\.twimg\.com\//.test(a) ? a.replace("_normal.", "_200x200.") : "");
// fxtwitter's profile lookup is case-sensitive for some accounts (baney75 404s, Baney75 works), while the posts
// endpoint isn't. So try the profile first, then read the avatar off the account's own latest post.
export async function xAvatar(handle) {
  for (let k = 0; k < 3; k++) {
    try {
      const d = await (await fetch(`https://api.fxtwitter.com/${handle}`, { headers: FX_UA })).json();
      const a = okAvatar(d && d.user && d.user.avatar_url);
      if (a) return a;
    } catch {}
    try {
      const d = await (await fetch(`https://api.fxtwitter.com/2/profile/${handle}/statuses`, { headers: FX_UA })).json();
      const own = (d && d.results || []).find((r) => r.author && String(r.author.screen_name).toLowerCase() === handle.toLowerCase());
      const a = okAvatar(own && own.author.avatar_url);
      if (a) return a;
    } catch {}
    await new Promise((res) => setTimeout(res, 400 * (k + 1)));
  }
  return "";
}
const me = (u) => ({ ...pub(u), ref: u.ref_code, banned: !!u.banned, links: linksOf(u), uploaded: !!u.avatar });
const log = (env, actor, action, target) => env.DB.prepare("INSERT INTO modlog (actor, action, target, ts) VALUES (?, ?, ?, ?)").bind(actor, action, target, now()).run();
const staff = (u, min) => u && !u.banned && RANK[u.role] >= RANK[min];

async function body(req, max = 20000) {
  const t = await req.text();
  if (t.length > max) throw new Error("too big");
  return t ? JSON.parse(t) : {};
}

// ---------- Handlers ----------
const routes = [];
const on = (method, pattern, fn) => routes.push([method, new RegExp("^" + pattern + "$"), fn]);

// One proof-of-work challenge can be spent once. rate() returns true only the first time it sees a key.
const takePow = (env) => (key) => rate(env, key, 1, 900);
// A filled-in honeypot means a script filled every field. Answer like a success so it learns nothing.
const isBot = (b) => typeof b.website === "string" && b.website.trim() !== "";
// How many people one member can bring in per day. Staff vouch for more; the owner has no cap.
const REF_CAP = { user: 5, contributor: 10, mod: 25, admin: 100 };

// Joining needs an invite: a staff invite link, or a member's referral link. No invite, no account.
on("POST", "/api/account", async (req, env) => {
  if (!(await rate(env, "new:" + ip(req), 5, 3600))) return err(429, "Too many new accounts from here. Try again in an hour.");
  if (!(await rate(env, "new48:" + ip(req, 48), 20, 3600))) return err(429, "Too many new accounts from your network. Try again in an hour.");
  const b = await body(req);
  if (isBot(b)) return err(400, "Something went wrong. Reload and try again.");
  const bad = await checkPow(env, b.pow, { minAge: 2, take: takePow(env) });
  if (bad) return err(400, bad);
  let referrer = null, invite = null;
  if (b.invite) invite = await env.DB.prepare("SELECT i.*, u.role maker_role, u.banned maker_banned FROM invites i JOIN users u ON u.id = i.creator WHERE i.code = ?").bind(String(b.invite).slice(0, 40)).first();
  if (invite && invite.maker_banned) invite = null;
  if (invite && invite.disabled) return err(403, "That invite link was turned off. Ask for a new one.");
  if (invite && invite.max_uses && invite.uses >= invite.max_uses) return err(403, "That invite has been used up. Ask for a new one.");
  if (invite && invite.expires && invite.expires < now()) return err(403, "That invite has expired. Ask for a new one.");
  if (!invite && b.ref) referrer = await env.DB.prepare("SELECT id, role, banned FROM users WHERE ref_code = ?").bind(String(b.ref).slice(0, 20)).first();
  if (referrer && referrer.banned) referrer = null;
  if (!invite && !referrer) return err(403, "Feedforward is invite-only. Use a member's invite link, or apply.");
  if (referrer && referrer.role !== "owner") {
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM users WHERE referred_by = ? AND created > ?").bind(referrer.id, now() - 86400).first();
    if (n.n >= (REF_CAP[referrer.role] || REF_CAP.user)) return err(429, "This invite link has brought in all the people it can today. Try again tomorrow.");
  }
  const code = newCode();
  // The check, like a role, needs the maker to still hold the rank to give it.
  const verified = invite && invite.verified && RANK[invite.maker_role] >= RANK.admin ? 1 : 0;
  const u = { id: rid(10), code_hash: await sha(env.PEPPER + code), ref_code: rid(7), referred_by: (invite && invite.creator) || (referrer && referrer.id) || null, verified, created: now() };
  let links = cleanLinks(b.links);
  let [nm] = b.name ? clean(b.name, 40) : [""];
  if (impersonates({ verified }, nm, links)) { links = { ...links }; delete links.x; nm = ""; }
  const ax = links.x ? await xAvatar(links.x) : "";
  // Permissions come from the invite, re-checked against the maker's role today (they may have been demoted).
  const role = invite && RANK[invite.role] && RANK[invite.role] < RANK[invite.maker_role] && invite.role !== "owner" ? invite.role : "user";
  const teach = invite && invite.teach && RANK[invite.maker_role] >= RANK.admin ? invite.teach : "";
  // Taking a use is atomic, so a limited invite can't be overshot by parallel joins.
  if (invite && invite.max_uses) {
    const took = await env.DB.prepare("UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses").bind(invite.code).run();
    if (!took.meta.changes) return err(403, "That invite has been used up. Ask for a new one.");
  } else if (invite) await env.DB.prepare("UPDATE invites SET uses = uses + 1 WHERE code = ?").bind(invite.code).run();
  // A member's referral cap is checked in the INSERT itself, so parallel joins on one link can't overshoot it.
  const cap = referrer && referrer.role !== "owner" ? REF_CAP[referrer.role] || REF_CAP.user : 1e9;
  const ins = await env.DB.prepare("INSERT INTO users (id, code_hash, ref_code, referred_by, verified, created, name, links, avatar_x, avatar_x_ts, role, teach) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR (SELECT COUNT(*) FROM users WHERE referred_by = ? AND created > ?) < ?")
    .bind(u.id, u.code_hash, u.ref_code, u.referred_by, u.verified, u.created, nm || "", JSON.stringify(links), ax, ax ? now() : 0, role, teach,
      referrer ? 1 : null, referrer ? referrer.id : "", now() - 86400, cap).run();   // NULL: no referrer, no cap
  if (!ins.meta.changes) return err(429, "This invite link has brought in all the people it can today. Try again tomorrow.");
  if (role !== "user" || teach) await log(env, invite.creator, `invite-grant:${role}${teach ? ":" + teach : ""}`, u.id);
  const token = await session(env, u.id, b.device);
  const full = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
  return json({ code, token, user: me(full) }, 200, { "set-cookie": await gateCookie(env, u.id, await sha(token)) });
});

on("POST", "/api/login", async (req, env) => {
  if (!(await rate(env, "login:" + ip(req), 10, 900))) return err(429, "Too many tries. Wait 15 minutes.");
  // A wider limit per IPv6 /48. (No site-wide ceiling: anyone could fill it and lock everyone out.)
  if (!(await rate(env, "login48:" + ip(req, 48), 60, 900))) return err(429, "Too many tries from your network. Wait 15 minutes.");
  const b = await body(req);
  const bad = await checkPow(env, b.pow, { take: takePow(env) });
  if (bad) return err(400, bad);
  const code = normCode(b.code);
  if (!/^[a-z]+-[a-z]+-[a-z]+(-[a-z]+)?-\d{2}$/.test(code)) return err(400, "That doesn't look like a code. It's words and two digits, like otter-maple-rocket-acorn-42.");
  const h = await sha(env.PEPPER + code);
  const u = await env.DB.prepare("SELECT * FROM users WHERE code_hash = ?").bind(h).first();
  if (!u) {
    // An application code signs in once it's approved; until then it tells the applicant where they stand.
    const a = await env.DB.prepare("SELECT status FROM applications WHERE code_hash = ?").bind(h).first();
    if (a && a.status === "pending") return json({ error: "Your application is still being reviewed. This code will let you in the moment it's approved.", status: "pending" }, 409);
    if (a && a.status === "denied") return json({ error: "This application wasn't approved. A member's invite link still gets you in.", status: "denied" }, 403);
    return err(404, "No account has that code.");
  }
  if (u.banned) return err(403, "This account is suspended.");
  const token = await session(env, u.id, b.device);
  return json({ token, user: me(u) }, 200, { "set-cookie": await gateCookie(env, u.id, await sha(token)) });
});

on("POST", "/api/logout", async (req, env) => {
  const tok = (req.headers.get("authorization") || "").slice(7);
  if (tok) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha(tok)).run();
  return json({ ok: true }, 200, { "set-cookie": clearGate });
});

// A signed-in browser refreshes its read-only gate cookie on start.
on("POST", "/api/gate", async (req, env, u) => {
  if (!u || u.banned) return json({ error: "Sign in first." }, 401, { "set-cookie": clearGate });
  return json({ ok: true }, 200, { "set-cookie": await gateCookie(env, u.id, await sha((req.headers.get("authorization") || "").slice(7))) });
});

on("GET", "/api/pow", async (req, env) => {
  if (!(await rate(env, "pow:" + ip(req), 60, 3600))) return err(429, "Slow down.");
  return json(await powChallenge(env));
});

// Who sent this invite, for the front door ("Donovan invited you"). Says nothing about codes that don't exist
// beyond "not found", and is rate limited so it can't be used to guess codes.
on("GET", "/api/invite/([\\w-]{1,40})", async (req, env, _u, [code]) => {
  if (!(await rate(env, "invq:" + ip(req), 30, 3600))) return err(429, "Slow down.");
  const inv = await inviteInfo(env, code);
  if (inv) {
    if (inv.gone) return err(410, inv.gone);
    return json({ kind: inv.kind, verified: inv.verified, role: inv.role, teach: inv.teach, by: inv.by });
  }
  return err(404, "That invite link isn't valid. Check it, or apply.");
});

// The invite behind a /join link: who made it and what it grants. Shared by the front door and the link preview.
export async function inviteInfo(env, code) {
  const i = await env.DB.prepare("SELECT u.*, i.verified grant_verified, i.uses, i.max_uses, i.expires, i.disabled, i.role grant_role, i.teach grant_teach FROM invites i JOIN users u ON u.id = i.creator WHERE i.code = ? AND u.banned = 0").bind(code).first();
  if (i) {
    const gone = i.disabled ? "That invite link was turned off. Ask for a new one." : i.max_uses && i.uses >= i.max_uses ? "That invite has been used up. Ask for a new one." : i.expires && i.expires < now() ? "That invite has expired. Ask for a new one." : "";
    const role = RANK[i.grant_role] && RANK[i.grant_role] < RANK[i.role] ? i.grant_role : "user";
    return { kind: "invite", gone, verified: !!i.grant_verified && RANK[i.role] >= RANK.admin, role, teach: RANK[i.role] >= RANK.admin ? i.grant_teach || "" : "", by: pub(i) };
  }
  const r = await env.DB.prepare("SELECT * FROM users WHERE ref_code = ? AND banned = 0").bind(code).first();
  return r ? { kind: "ref", gone: "", verified: false, role: "user", teach: "", by: pub(r) } : null;
}

// Apply for an invite. The applicant gets their code now; it signs them in once staff approve.
on("POST", "/api/apply", async (req, env) => {
  if (!(await rate(env, "apply:" + ip(req), 3, 86400))) return err(429, "You've applied from here already today. Use your application code to check on it.");
  if (!(await rate(env, "apply48:" + ip(req, 48), 10, 86400))) return err(429, "Too many applications from your network today.");
  const b = await body(req);
  if (isBot(b)) return json({ code: newCode() });
  const bad = await checkPow(env, b.pow, { minAge: 4, take: takePow(env) });
  if (bad) return err(400, bad);
  const [name, e1] = clean(b.name, 40); if (e1 || !name) return err(400, "Add your name.");
  const [reason, e2] = clean(b.reason, 600); if (e2) return err(400, e2);
  if (!reason || reason.length < 20) return err(400, "Tell us a little more: what do you want to learn or build? (A sentence or two.)");
  const links = cleanLinks(b.links);
  if (impersonates({ verified: false }, name, links)) return err(400, "That name or handle belongs to someone listed on Feedforward. If it's you, ask them for an invite.");
  const code = newCode();
  await env.DB.prepare("INSERT INTO applications (id, code_hash, name, links, reason, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(rid(12), await sha(env.PEPPER + code), name, JSON.stringify(links), reason, now()).run();
  return json({ code });
});

on("GET", "/api/me", async (req, env, u) => {
  if (!u) return err(401, "Sign in first.");
  const [data, likes, dislikes, ratings, refs] = await Promise.all([
    env.DB.prepare("SELECT kind, json FROM userdata WHERE user_id = ?").bind(u.id).all(),
    env.DB.prepare("SELECT item FROM likes WHERE user_id = ?").bind(u.id).all(),
    env.DB.prepare("SELECT item FROM dislikes WHERE user_id = ?").bind(u.id).all(),
    env.DB.prepare("SELECT item, stars FROM ratings WHERE user_id = ?").bind(u.id).all(),
    env.DB.prepare("SELECT COUNT(*) n FROM users WHERE referred_by = ?").bind(u.id).first(),
  ]);
  return json({
    user: me(u), referrals: refs.n,
    data: Object.fromEntries(data.results.map((r) => [r.kind, JSON.parse(r.json)])),
    likes: likes.results.map((r) => r.item), dislikes: dislikes.results.map((r) => r.item), ratings: Object.fromEntries(ratings.results.map((r) => [r.item, r.stars])),
  });
});

on("PATCH", "/api/me", async (req, env, u) => {
  if (!u) return err(401, "Sign in first.");
  if (!(await rate(env, "name:" + u.id, 20, 3600))) return err(429, "Slow down.");
  const b = await body(req);
  let name = u.name, links = linksOf(u), avatar_x = u.avatar_x;
  if (b.name !== undefined) { const [n, e] = clean(b.name, 40); if (e) return err(400, e); name = n; }
  if (b.links !== undefined || b.name !== undefined) {
    if (impersonates(u, b.name !== undefined && name !== u.name ? name : "", b.links !== undefined ? cleanLinks(b.links) : {})) return err(403, "That name or X handle belongs to someone listed on Feedforward. An admin can verify you if it's yours.");
  }
  if (b.links !== undefined) {
    const next = cleanLinks(b.links);
    if (next.x !== links.x) avatar_x = next.x ? await xAvatar(next.x) : "";
    links = next;
  }
  await env.DB.prepare("UPDATE users SET name = ?, links = ?, avatar_x = ?, avatar_x_ts = ? WHERE id = ?").bind(name, JSON.stringify(links), avatar_x, now(), u.id).run();
  return json({ user: me({ ...u, name, links: JSON.stringify(links), avatar_x }) });
});

on("POST", "/api/me/code", async (req, env, u) => {
  if (!u) return err(401, "Sign in first.");
  if (!(await rate(env, "rotate:" + u.id, 5, 86400))) return err(429, "Try again tomorrow.");
  const code = newCode();
  await env.DB.prepare("UPDATE users SET code_hash = ? WHERE id = ?").bind(await sha(env.PEPPER + code), u.id).run();
  // A new code signs out every other device and revokes every agent and connector token.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(u.id, await sha((req.headers.get("authorization") || "").slice(7))),
    env.DB.prepare("DELETE FROM api_tokens WHERE user_id = ?").bind(u.id),
  ]);
  return json({ code });
});

on("PUT", "/api/me/avatar", async (req, env, u) => {
  if (!u) return err(401, "Sign in first.");
  if (!(await rate(env, "avatar:" + u.id, 10, 3600))) return err(429, "Slow down.");
  const type = req.headers.get("content-type") || "";
  if (!/^image\/(webp|png|jpeg)$/.test(type)) return err(400, "Use a PNG, JPEG or WebP image.");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 300000) return err(400, "Keep the image under 300 KB.");
  const key = `${u.id}-${rid(6)}`;
  await env.AVATARS.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  if (u.avatar) await env.AVATARS.delete(u.avatar);
  await env.DB.prepare("UPDATE users SET avatar = ? WHERE id = ?").bind(key, u.id).run();
  return json({ user: me({ ...u, avatar: key }) });
});

on("DELETE", "/api/me/avatar", async (req, env, u) => {
  if (!u) return err(401, "Sign in first.");
  if (u.avatar) await env.AVATARS.delete(u.avatar);
  await env.DB.prepare("UPDATE users SET avatar = '' WHERE id = ?").bind(u.id).run();
  return json({ user: me({ ...u, avatar: "" }) });
});

on("POST", "/api/sync", async (req, env, u) => {
  if (!u) return err(401, "Sign in first.");
  if (!(await rate(env, "sync:" + u.id, 600, 3600))) return err(429, "Slow down.");
  const b = await body(req, 200000);
  const rows = await env.DB.prepare("SELECT kind, json FROM userdata WHERE user_id = ?").bind(u.id).all();
  const cur = Object.fromEntries(rows.results.map((r) => [r.kind, JSON.parse(r.json)]));
  const out = {};
  const list = (a, b2, cap) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b2) ? b2 : [])].filter((x) => typeof x === "string" && x.length < 90))].slice(0, cap);
  // Values are timestamps; a negative one is a removal. The latest action wins, whichever device made it.
  const obj = (a, b2) => {
    const o = { ...(b2 || {}) };
    for (const [k, v] of Object.entries(a || {})) if (typeof k === "string" && k.length < 90 && typeof v === "number" && Number.isFinite(v)) { if (Math.abs(v) > Math.abs(o[k] || 0)) o[k] = v; }
    const month = (Date.now() - 30 * 864e5);
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0 || -v > month).slice(0, 2000));
  };
  // Clearing history on one device wins over older history from the others.
  const reset = Math.max(Number(b.historyReset) || 0, (cur.meta && cur.meta.historyReset) || 0);
  const clientReset = (Number(b.historyReset) || 0) > ((cur.meta && cur.meta.historyReset) || 0);
  out.history = clientReset ? list(b.history, [], 500) : list(b.history, cur.history, 500);
  out.meta = { historyReset: reset };
  out.days = list(b.days, cur.days, 400).sort().reverse();
  out.saved = obj(b.saved, cur.saved);
  out.progress = obj(b.progress, cur.progress);
  const stmt = env.DB.prepare("INSERT OR REPLACE INTO userdata (user_id, kind, json, updated) VALUES (?, ?, ?, ?)");
  await env.DB.batch(Object.entries(out).map(([k, v]) => stmt.bind(u.id, k, JSON.stringify(v), now())));
  return json({ data: { ...out, historyReset: reset } });
});

on("POST", "/api/like", async (req, env, u) => {
  if (!u) return err(401, "Get a free code to like things.");
  if (u.banned) return err(403, "This account can't do that.");
  if (!(await rate(env, "like:" + u.id, 300, 3600))) return err(429, "Slow down.");
  const b = await body(req);
  if (!ITEM.test(b.item || "")) return err(400, "Bad item.");
  // Like and dislike are one choice: picking one clears the other. Dislikes stay private.
  const dis = b.kind === "dislike";
  const mine = dis ? "dislikes" : "likes", other = dis ? "likes" : "dislikes";
  await env.DB.batch(b.on
    ? [env.DB.prepare(`INSERT OR IGNORE INTO ${mine} (user_id, item, ts) VALUES (?, ?, ?)`).bind(u.id, b.item, now()), env.DB.prepare(`DELETE FROM ${other} WHERE user_id = ? AND item = ?`).bind(u.id, b.item)]
    : [env.DB.prepare(`DELETE FROM ${mine} WHERE user_id = ? AND item = ?`).bind(u.id, b.item)]);
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM likes WHERE item = ?").bind(b.item).first();
  return json({ item: b.item, on: !!b.on, kind: dis ? "dislike" : "like", likes: n.n });
});

on("POST", "/api/rate", async (req, env, u) => {
  if (!u) return err(401, "Get a free code to rate things.");
  if (u.banned) return err(403, "This account can't do that.");
  if (!(await rate(env, "rate:" + u.id, 200, 3600))) return err(429, "Slow down.");
  const b = await body(req);
  const stars = Math.round(Number(b.stars));
  if (!ITEM.test(b.item || "") || !(stars >= 0 && stars <= 5)) return err(400, "Bad rating.");
  if (stars) await env.DB.prepare("INSERT OR REPLACE INTO ratings (user_id, item, stars, ts) VALUES (?, ?, ?, ?)").bind(u.id, b.item, stars, now()).run();
  else await env.DB.prepare("DELETE FROM ratings WHERE user_id = ? AND item = ?").bind(u.id, b.item).run();
  const r = await env.DB.prepare("SELECT AVG(stars) a, COUNT(*) n FROM ratings WHERE item = ?").bind(b.item).first();
  return json({ item: b.item, stars, avg: r.a || 0, n: r.n });
});

// Community signals for the ranking, cached at the edge for a minute.
on("GET", "/api/stats", async (req, env) => {
  const cache = caches.default, key = new Request(new URL("/api/stats", req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const [l, r, c] = await Promise.all([
    env.DB.prepare("SELECT item, COUNT(*) n FROM likes GROUP BY item").all(),
    env.DB.prepare("SELECT item, AVG(stars) a, COUNT(*) n FROM ratings GROUP BY item").all(),
    env.DB.prepare("SELECT item, COUNT(*) n FROM comments WHERE hidden = 0 GROUP BY item").all(),
  ]);
  const res = json({
    likes: Object.fromEntries(l.results.map((x) => [x.item, x.n])),
    ratings: Object.fromEntries(r.results.map((x) => [x.item, [Math.round(x.a * 10) / 10, x.n]])),
    comments: Object.fromEntries(c.results.map((x) => [x.item, x.n])),
  }, 200, { "cache-control": "public, max-age=60" });
  await cache.put(key, res.clone());
  return res;
});

const COMMENT_SELECT = "SELECT c.id, c.item, c.body, c.ts, c.hidden, c.reports, u.id uid, u.name, u.avatar, u.role, u.teach, u.verified FROM comments c JOIN users u ON u.id = c.user_id";
const pubComment = (r) => ({ id: r.id, item: r.item, body: r.body, ts: r.ts, hidden: !!r.hidden, reports: r.reports, user: pub({ id: r.uid, name: r.name, avatar: r.avatar, role: r.role, teach: r.teach, verified: r.verified }) });

on("GET", "/api/comments", async (req, env, u) => {
  const item = new URL(req.url).searchParams.get("item") || "";
  if (!ITEM.test(item)) return err(400, "Bad item.");
  const mod = staff(u, "mod");
  const rows = await env.DB.prepare(`${COMMENT_SELECT} WHERE c.item = ? ${mod ? "" : "AND c.hidden = 0"} ORDER BY c.ts DESC LIMIT 200`).bind(item).all();
  return json({ comments: rows.results.map(pubComment) });
});

on("POST", "/api/comments", async (req, env, u) => {
  if (!u) return err(401, "Sign in to comment.");
  if (u.banned) return err(403, "This account can't comment.");
  // Replies are for verified members (and staff), so a bot that slips in still can't post. Community channels
  // are open to every member.
  if (!u.verified && RANK[u.role] < RANK.contributor) return err(403, "Replies are for verified members. Staff give the check.");
  if (!(await rate(env, "c:" + u.id, 8, 600)) || !(await rate(env, "cd:" + u.id, 60, 86400))) return err(429, "You're commenting fast. Take a breather.");
  const b = await body(req);
  if (!ITEM.test(b.item || "")) return err(400, "Bad item.");
  const [text, e] = clean(b.body, 1500);
  if (e) return err(400, e);
  // New accounts can't post links, which stops most spam.
  if (/https?:\/\//i.test(text) && now() - u.created < 86400 && RANK[u.role] < RANK.contributor) return err(400, "New accounts can post links after their first day.");
  const id = rid(12);
  await env.DB.prepare("INSERT INTO comments (id, item, user_id, body, ts) VALUES (?, ?, ?, ?, ?)").bind(id, b.item, u.id, text, now()).run();
  return json({ comment: { id, item: b.item, body: text, ts: now(), hidden: false, reports: 0, user: pub(u) } });
});

on("DELETE", "/api/comments/([\\w]+)", async (req, env, u, [id]) => {
  if (!u) return err(401, "Sign in first.");
  const c = await env.DB.prepare("SELECT c.*, u.role author_role FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?").bind(id).first();
  if (!c) return err(404, "Not found.");
  const own = c.user_id === u.id;
  if (!own && !(staff(u, "mod") && RANK[u.role] > RANK[c.author_role])) return err(403, "You can't delete that.");
  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  if (!own) await log(env, u.id, "delete-comment", id);
  return json({ ok: true });
});

on("POST", "/api/comments/([\\w]+)/(report|hide|unhide)", async (req, env, u, [id, act]) => {
  if (!u) return err(401, "Sign in first.");
  if (act === "report") {
    if (!(await rate(env, "rep:" + u.id, 30, 86400))) return err(429, "Slow down.");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO reports (comment_id, user_id) VALUES (?, ?)").bind(id, u.id).run();
    if (r.meta.changes) await env.DB.prepare("UPDATE comments SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= 3 THEN 1 ELSE hidden END WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (!staff(u, "mod")) return err(403, "Moderators only.");
  const target = await env.DB.prepare("SELECT u.role FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?").bind(id).first();
  if (!target) return err(404, "Not found.");
  if (RANK[target.role] >= RANK[u.role]) return err(403, "You can only moderate people below your own role.");
  await env.DB.prepare("UPDATE comments SET hidden = ? WHERE id = ?").bind(act === "hide" ? 1 : 0, id).run();
  await log(env, u.id, act + "-comment", id);
  return json({ ok: true });
});

on("GET", "/api/u/([\\w]+)", async (req, env, _u, [id]) => {
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND banned = 0").bind(id).first();
  if (!u) return err(404, "No such learner.");
  const [c, l, refs] = await Promise.all([
    env.DB.prepare("SELECT id, item, body, ts FROM comments WHERE user_id = ? AND hidden = 0 ORDER BY ts DESC LIMIT 20").bind(id).all(),
    env.DB.prepare("SELECT COUNT(*) n FROM likes WHERE user_id = ?").bind(id).first(),
    env.DB.prepare("SELECT COUNT(*) n FROM users WHERE referred_by = ?").bind(id).first(),
  ]);
  return json({ user: pub(u), links: linksOf(u), comments: c.results, likes: l.n, referrals: refs.n });
});

// A verified member's latest X posts and YouTube uploads, for their profile. Verified only: the green check is
// given by an owner or admin, so the site never shows unvetted accounts' posts. Cached 30 minutes in KV.
export const feedPosts = (d, handle) => (d && d.results || [])
  .filter((r) => r.author && String(r.author.screen_name).toLowerCase() === handle.toLowerCase() && !r.replying_to && !r.reposted_by)
  .slice(0, 6)
  .map((r) => ({ id: String(r.id), text: String(r.text || "").slice(0, 600), ts: r.created_timestamp || 0, likes: r.likes || 0,
    photo: ((r.media && r.media.photos) || []).map((p) => p.url).find((u) => /^https:\/\/pbs\.twimg\.com\//.test(u)) || "" }));
export const feedVideos = (xml) => [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 6).map(([, e]) => ({
  id: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
  title: ((e.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").slice(0, 200),
  ts: Math.floor(Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1] || 0) / 1000) || 0,
})).filter((v) => v.id);
// Try a flaky source a few times before giving up (fxtwitter 404s real accounts about a third of the time).
async function tries(fn, n = 3) {
  for (let k = 0; k < n; k++) { try { return await fn(); } catch {} if (k < n - 1) await new Promise((res) => setTimeout(res, 250 * (k + 1))); }
  throw new Error("source failed");
}
on("GET", "/api/u/([\\w]+)/feed", async (req, env, _u, [id]) => {
  const u = await env.DB.prepare("SELECT id, verified, links FROM users WHERE id = ? AND banned = 0").bind(id).first();
  if (!u) return err(404, "No such learner.");
  const links = linksOf(u), empty = { posts: [], videos: [] };
  if (!u.verified || (!links.x && !links.youtube)) return json(empty, 200, { "cache-control": "public, max-age=300" });
  const key = `uf:${u.id}:${links.x || ""}:${links.youtube || ""}`, goodKey = "ok:" + key;
  let out = env.FRESH && (await env.FRESH.get(key, "json")), failed = false;
  if (!out) {
    // When a source fails every try, show the last copy that worked (kept a week) instead of an empty section.
    const last = (env.FRESH && (await env.FRESH.get(goodKey, "json"))) || empty;
    out = { ...empty };
    const jobs = [];
    if (links.x) jobs.push(tries(async () => {
      const d = await (await fetch(`https://api.fxtwitter.com/2/profile/${links.x}/statuses`, { headers: FX_UA })).json();
      if (!d || d.code !== 200) throw 0;
      out.posts = feedPosts(d, links.x);
    }).catch(() => { failed = true; out.posts = last.posts; }));
    if (links.youtube) jobs.push(tries(async () => {
      const ch = links.youtube.startsWith("channel/") ? links.youtube.slice(8) : await ytChannelId(links.youtube);
      if (!ch) throw 0;
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`);
      if (!r.ok) throw 0;
      out.videos = feedVideos(await r.text());
    }).catch(() => { failed = true; out.videos = last.videos; }));
    await Promise.all(jobs);
    if (env.FRESH) {
      // A miss is retried in 2 minutes instead of sticking for 30.
      await env.FRESH.put(key, JSON.stringify(out), { expirationTtl: failed ? 120 : 1800 });
      if (!failed) await env.FRESH.put(goodKey, JSON.stringify(out), { expirationTtl: 7 * 86400 });
    }
  }
  return json(out, 200, { "cache-control": `public, max-age=${failed ? 60 : 300}` });
});

on("POST", "/api/suggest", async (req, env, u) => {
  if (!u) return err(401, "Get a free code to suggest things.");
  if (u.banned) return err(403, "This account can't do that.");
  if (!(await rate(env, "sug:" + u.id, 10, 86400))) return err(429, "That's plenty for today. Thank you!");
  const b = await body(req);
  const kind = ["person", "video", "book", "paper", "term", "fix", "idea"].includes(b.kind) ? b.kind : "idea";
  const [text, e] = clean(b.body, 1500);
  if (e) return err(400, e);
  const url = /^https:\/\/[^\s]{3,300}$/.test(b.url || "") ? b.url : "";
  await env.DB.prepare("INSERT INTO suggestions (id, user_id, kind, body, url, ts) VALUES (?, ?, ?, ?, ?, ?)").bind(rid(12), u.id, kind, text, url, now()).run();
  return json({ ok: true });
});

// ---------- Staff ----------
on("GET", "/api/admin/users", async (req, env, u) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const q = (new URL(req.url).searchParams.get("q") || "").slice(0, 40);
  const rows = await env.DB.prepare(`SELECT u.*, (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) comments, (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.id) referrals
    FROM users u WHERE (? = '' OR u.name LIKE ? OR u.id = ?) ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'mod' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END, u.created DESC LIMIT 100`).bind(q, `%${q}%`, q).all();
  return json({ users: rows.results.map((r) => ({ ...pub(r), banned: !!r.banned, comments: r.comments, referrals: r.referrals })) });
});

on("POST", "/api/admin/users/([\\w]+)", async (req, env, u, [id]) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const t = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!t) return err(404, "No such user.");
  if (t.id === u.id) return err(400, "You can't change your own account here.");
  if (RANK[t.role] >= RANK[u.role]) return err(403, "You can only manage people below your own role.");
  const b = await body(req);
  if (b.role !== undefined) {
    if (!RANK[b.role] || b.role === "owner") return err(400, "Bad role.");
    // The owner names admins. Admins name mods and contributors. Mods can't change roles.
    if (!staff(u, "admin") || RANK[b.role] >= RANK[u.role]) return err(403, "You can't give that role.");
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, id).run();
    await log(env, u.id, "role:" + b.role, id);
  }
  if (b.verified !== undefined) {
    if (!staff(u, "admin")) return err(403, "Admins only.");
    await env.DB.prepare("UPDATE users SET verified = ? WHERE id = ?").bind(b.verified ? 1 : 0, id).run();
    await log(env, u.id, b.verified ? "verify" : "unverify", id);
  }
  if (b.banned !== undefined) {
    await env.DB.prepare("UPDATE users SET banned = ? WHERE id = ?").bind(b.banned ? 1 : 0, id).run();
    if (b.banned) {
      await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id), env.DB.prepare("UPDATE comments SET hidden = 1 WHERE user_id = ?").bind(id)]);
      const live = await env.DB.prepare("SELECT id FROM sessions_live WHERE starts + minutes * 60 > ?").bind(now() - 3600).all();
      const rooms = ROOMS.concat(live.results.map((r) => "s-" + r.id));
      await Promise.all(rooms.map((r) => env.CHAT.get(env.CHAT.idFromName(r)).fetch("https://chat/kick?uid=" + id, { method: "POST" }).catch(() => {})));
    }
    await log(env, u.id, b.banned ? "ban" : "unban", id);
  }
  if (b.removeAvatar) {
    if (t.avatar) await env.AVATARS.delete(t.avatar);
    // Also drop the X picture and the X link that feeds it, so the cron can't bring it back.
    const links = linksOf(t); delete links.x;
    await env.DB.prepare("UPDATE users SET avatar = '', avatar_x = '', links = ? WHERE id = ?").bind(JSON.stringify(links), id).run();
    await log(env, u.id, "remove-avatar", id);
  }
  return json({ ok: true });
});

on("GET", "/api/admin/feed", async (req, env, u) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const [c, s, l, inv] = await Promise.all([
    env.DB.prepare(`${COMMENT_SELECT} ORDER BY c.reports DESC, c.ts DESC LIMIT 60`).all(),
    env.DB.prepare("SELECT s.*, u.name FROM suggestions s JOIN users u ON u.id = s.user_id ORDER BY CASE s.status WHEN 'open' THEN 0 ELSE 1 END, s.ts DESC LIMIT 60").all(),
    env.DB.prepare("SELECT m.*, u.name FROM modlog m LEFT JOIN users u ON u.id = m.actor ORDER BY m.id DESC LIMIT 40").all(),
    env.DB.prepare("SELECT * FROM invites WHERE creator = ? OR ? = 'owner' ORDER BY created DESC LIMIT 50").bind(u.id, u.role).all(),
  ]);
  return json({ comments: c.results.map(pubComment), suggestions: s.results, log: l.results, invites: inv.results });
});

// ---------- Applications ----------
on("GET", "/api/admin/applications", async (req, env, u) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const rows = await env.DB.prepare("SELECT a.id, a.name, a.links, a.reason, a.status, a.created, a.decided, d.name decider FROM applications a LEFT JOIN users d ON d.id = a.decided_by ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created DESC LIMIT 100").all();
  return json({ applications: rows.results.map((r) => ({ ...r, links: JSON.parse(r.links || "{}") })) });
});
on("POST", "/api/admin/applications/([\\w]+)", async (req, env, u, [id]) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const b = await body(req);
  const a = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
  if (!a) return err(404, "No such application.");
  if (a.status !== "pending") return err(409, "Someone already decided this one.");
  if (b.decision === "deny") {
    await env.DB.prepare("UPDATE applications SET status = 'denied', decided_by = ?, decided = ? WHERE id = ? AND status = 'pending'").bind(u.id, now(), id).run();
    await log(env, u.id, "deny-application", id);
    return json({ ok: true });
  }
  if (b.decision !== "approve") return err(400, "Approve or deny.");
  // The account takes the applicant's own code, so their code works the moment this lands.
  const uid = rid(10), links = JSON.parse(a.links || "{}");
  const ax = links.x ? await xAvatar(links.x) : "";
  const r = await env.DB.batch([
    env.DB.prepare("UPDATE applications SET status = 'approved', decided_by = ?, decided = ?, user_id = ? WHERE id = ? AND status = 'pending'").bind(u.id, now(), uid, id),
    env.DB.prepare("INSERT INTO users (id, code_hash, ref_code, referred_by, verified, created, name, links, avatar_x, avatar_x_ts) SELECT ?, ?, ?, ?, 0, ?, ?, ?, ?, ? WHERE changes() = 1")
      .bind(uid, a.code_hash, rid(7), u.id, now(), a.name, a.links, ax, ax ? now() : 0),
  ]);
  if (!r[0].meta.changes) return err(409, "Someone already decided this one.");
  await log(env, u.id, "approve-application", uid);
  return json({ ok: true, user: uid });
});

on("POST", "/api/admin/suggestions/([\\w]+)", async (req, env, u, [id]) => {
  if (!staff(u, "admin")) return err(403, "Admins only.");
  const b = await body(req);
  if (!["approved", "declined", "open"].includes(b.status)) return err(400, "Bad status.");
  await env.DB.prepare("UPDATE suggestions SET status = ?, decided_by = ? WHERE id = ?").bind(b.status, u.id, id).run();
  await log(env, u.id, "suggestion:" + b.status, id);
  return json({ ok: true });
});

// Staff invite links, optionally with permissions. Mods and up make them; a link can grant a role below the
// maker's own, and admins can also grant a teaching role. Expiry is in days (0 means it never expires).
on("POST", "/api/admin/invites", async (req, env, u) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const b = await body(req);
  const role = b.role && RANK[b.role] ? b.role : "user";
  if (role === "owner" || RANK[role] >= RANK[u.role]) return err(403, "An invite can only grant a role below your own.");
  const teach = ["professor", "tutor"].includes(b.teach) ? b.teach : "";
  if (teach && !staff(u, "admin")) return err(403, "Only admins can grant teaching roles.");
  if (b.verified && !staff(u, "admin")) return err(403, "Only admins can give the green check.");
  const days = Math.max(0, Math.min(365, Math.floor(Number(b.days) || 0)));
  const code = rid(9);
  const note = String(b.note || "").slice(0, 80);
  await env.DB.prepare("INSERT INTO invites (code, creator, verified, max_uses, note, created, role, teach, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(code, u.id, b.verified ? 1 : 0, Math.max(0, Math.min(10000, Number(b.max_uses) || 0)), note, now(), role, teach, days ? now() + days * 86400 : 0).run();
  await log(env, u.id, ["invite", b.verified && "verified", role !== "user" && role, teach].filter(Boolean).join(":"), code);
  return json({ code });
});

// Turn an invite off or on, or change its total uses. The maker can; so can admins and the owner.
on("POST", "/api/admin/invites/([\\w-]{1,40})", async (req, env, u, [code]) => {
  if (!staff(u, "mod")) return err(403, "Staff only.");
  const inv = await env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first();
  if (!inv) return err(404, "No such invite.");
  if (inv.creator !== u.id && !staff(u, "admin")) return err(403, "Only its maker or an admin can change this invite.");
  const b = await body(req);
  const disabled = b.disabled === undefined ? inv.disabled : b.disabled ? 1 : 0;
  const max = b.max_uses === undefined ? inv.max_uses : Math.max(0, Math.min(10000, Math.floor(Number(b.max_uses) || 0)));
  await env.DB.prepare("UPDATE invites SET disabled = ?, max_uses = ? WHERE code = ?").bind(disabled, max, code).run();
  await log(env, u.id, `invite-edit:${disabled ? "off" : "on"}:${max}`, code);
  return json({ ok: true, disabled: !!disabled, max_uses: max });
});

on("GET", "/api/chat/([\\w-]+)", async (req, env, u, [room]) => {
  if (!ROOMS.includes(room)) {
    const sid = room.startsWith("s-") && room.slice(2);
    if (!sid || !(await env.DB.prepare("SELECT 1 FROM sessions_live WHERE id = ?").bind(sid).first())) return err(404, "No such room.");
  }
  if (req.headers.get("upgrade") !== "websocket") return err(426, "Use a WebSocket.");
  const stub = env.CHAT.get(env.CHAT.idFromName(room));
  const url = new URL(req.url);
  url.searchParams.delete("t");
  const h = new Headers(req.headers);
  h.delete("x-ff-user"); // only this Worker may say who the user is
  if (u && !u.banned) h.set("x-ff-user", JSON.stringify(pub(u)));
  return stub.fetch(new Request(url, { headers: h }));
});


// ---------- Teaching: professors (named by the owner or an admin) name tutors ----------
on("POST", "/api/teach/([\\w]+)", async (req, env, u, [id]) => {
  if (!u || u.banned) return err(401, "Sign in first.");
  const t = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!t || t.banned) return err(404, "No such user.");
  const b = await body(req);
  if (!["", "tutor", "professor"].includes(b.teach)) return err(400, "Bad teaching role.");
  const admin = staff(u, "admin") && (u.role === "owner" || RANK[t.role] < RANK[u.role]);
  const prof = u.teach === "professor" && RANK[t.role] < RANK.admin;
  // Admins can set any teaching role. Professors can only add or remove tutors.
  const ok = admin || (prof && t.id !== u.id && t.teach !== "professor" && b.teach !== "professor");
  if (!ok) return err(403, "Only admins name professors. Professors name tutors.");
  await env.DB.prepare("UPDATE users SET teach = ? WHERE id = ?").bind(b.teach, id).run();
  await log(env, u.id, "teach:" + (b.teach || "none"), id);
  return json({ ok: true });
});

// ---------- Live sessions ----------
const SESSION_SELECT = "SELECT s.*, u.name, u.avatar, u.role, u.teach, u.verified, (SELECT COUNT(*) FROM rsvps r WHERE r.session_id = s.id) going FROM sessions_live s JOIN users u ON u.id = s.host_id";
const pubSession = (r, mine) => ({ id: r.id, title: r.title, about: r.about, topic: r.topic, starts: r.starts, minutes: r.minutes, link: r.link, capacity: r.capacity, cancelled: !!r.cancelled, going: r.going, mine: !!mine,
  host: pub({ id: r.host_id, name: r.name, avatar: r.avatar, role: r.role, teach: r.teach, verified: r.verified }) });

on("GET", "/api/sessions", async (req, env, u) => {
  const rows = await env.DB.prepare(`${SESSION_SELECT} WHERE s.starts + s.minutes * 60 > ? ORDER BY s.starts LIMIT 100`).bind(now() - 3600).all();
  const mine = u ? new Set((await env.DB.prepare("SELECT session_id FROM rsvps WHERE user_id = ?").bind(u.id).all()).results.map((r) => r.session_id)) : new Set();
  return json({ sessions: rows.results.map((r) => pubSession(r, mine.has(r.id))) });
});

on("POST", "/api/sessions", async (req, env, u) => {
  if (!u || u.banned) return err(401, "Sign in first.");
  if (!u.teach && !staff(u, "admin")) return err(403, "Professors and tutors host sessions.");
  if (!(await rate(env, "sess:" + u.id, 10, 86400))) return err(429, "That's plenty of sessions for today.");
  const b = await body(req);
  const [title, e1] = clean(b.title, 90); if (e1) return err(400, e1);
  const about = b.about ? clean(b.about, 1500) : ["", null]; if (about[1]) return err(400, about[1]);
  const starts = Math.floor(Number(b.starts));
  if (!(starts > now() - 600 && starts < now() + 86400 * 120)) return err(400, "Pick a start time in the next four months.");
  const minutes = Math.max(15, Math.min(240, Math.floor(Number(b.minutes) || 60)));
  const id = rid(10);
  // Every session gets a free Jitsi room unless the host gives another https link.
  const link = /^https:\/\/[^\s"'<>]{4,300}$/.test(b.link || "") ? b.link : `https://meet.jit.si/feedforward-${id}`;
  await env.DB.prepare("INSERT INTO sessions_live (id, host_id, title, about, topic, starts, minutes, link, capacity, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, u.id, title, about[0], String(b.topic || "").slice(0, 20), starts, minutes, link, Math.max(0, Math.min(1000, Number(b.capacity) || 0)), now()).run();
  return json({ id });
});

on("POST", "/api/sessions/([\\w]+)/(rsvp|unrsvp|cancel)", async (req, env, u, [id, act]) => {
  if (!u || u.banned) return err(401, "Get a free code to join sessions.");
  const s = await env.DB.prepare(`${SESSION_SELECT} WHERE s.id = ?`).bind(id).first();
  if (!s) return err(404, "No such session.");
  if (act === "cancel") {
    if (s.host_id !== u.id && !(staff(u, "mod") && RANK[s.role] < RANK[u.role])) return err(403, "Only the host or a moderator above them can cancel.");
    await env.DB.prepare("UPDATE sessions_live SET cancelled = 1 WHERE id = ?").bind(id).run();
    if (s.host_id !== u.id) await log(env, u.id, "cancel-session", id);
    return json({ ok: true });
  }
  if (act === "rsvp") {
    if (s.capacity && s.going >= s.capacity) return err(409, "This session is full.");
    await env.DB.prepare("INSERT OR IGNORE INTO rsvps (session_id, user_id, ts) VALUES (?, ?, ?)").bind(id, u.id, now()).run();
  } else await env.DB.prepare("DELETE FROM rsvps WHERE session_id = ? AND user_id = ?").bind(id, u.id).run();
  return json({ ok: true });
});

// ---------- Shared skills ----------
on("GET", "/api/skills", async (req, env, u) => {
  const mod = staff(u, "mod");
  const rows = await env.DB.prepare(`SELECT s.id, s.name, s.summary, s.tags, s.status, s.created, s.updated, u.id uid, u.name uname, u.avatar, u.role, u.teach, u.verified,
    (SELECT COUNT(*) FROM likes l WHERE l.item = 'k:' || s.id) likes FROM skills s JOIN users u ON u.id = s.user_id
    WHERE s.status = 'approved' OR (? AND s.status = 'pending') OR s.user_id = ? ORDER BY likes DESC, s.updated DESC LIMIT 200`).bind(mod ? 1 : 0, u ? u.id : "").all();
  return json({ skills: rows.results.map((r) => ({ id: r.id, name: r.name, summary: r.summary, tags: r.tags, status: r.status, updated: r.updated, likes: r.likes,
    by: pub({ id: r.uid, name: r.uname, avatar: r.avatar, role: r.role, teach: r.teach, verified: r.verified }) })) });
});

on("GET", "/api/skills/([\\w]+)", async (req, env, u, [id]) => {
  const r = await env.DB.prepare("SELECT s.*, u.name uname FROM skills s JOIN users u ON u.id = s.user_id WHERE s.id = ?").bind(id).first();
  if (!r || (r.status !== "approved" && !staff(u, "mod") && (!u || u.id !== r.user_id))) return err(404, "No such skill.");
  return json({ skill: { id: r.id, name: r.name, summary: r.summary, body: r.body, tags: r.tags, status: r.status, updated: r.updated, by: r.uname || "Learner" } });
});

on("POST", "/api/skills", async (req, env, u) => {
  if (!u || u.banned) return err(401, "Get a free code to share a skill.");
  if (!(await rate(env, "skill:" + u.id, 5, 86400))) return err(429, "That's plenty for today.");
  const b = await body(req, 40000);
  const name = String(b.name || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(name)) return err(400, "Name it in lowercase with hyphens, like pdf-tables.");
  const [summary, e1] = clean(b.summary, 200); if (e1) return err(400, e1);
  const text = String(b.body || "").replace(/\r\n/g, "\n");
  // A skill is instructions for an agent: refuse anything a reviewer can't see.
  if (INVISIBLE.test(text))
    return err(400, "The skill contains hidden or invisible characters. Remove them so reviewers can read everything it says.");
  if (text.length < 40 || text.length > 30000) return err(400, "The SKILL.md must be 40 to 30,000 characters.");
  if (PROFANE.test(text) || OFFTOPIC.test(text)) return err(400, "Keep skills clean and on topic.");
  const tags = String(b.tags || "").toLowerCase().split(/[,\s]+/).filter((t) => /^[a-z0-9-]{2,20}$/.test(t)).slice(0, 5).join(",");
  // Contributors and staff skip the queue; everyone else waits for a moderator.
  const status = RANK[u.role] >= RANK.contributor ? "approved" : "pending";
  const id = rid(10);
  await env.DB.prepare("INSERT INTO skills (id, user_id, name, summary, body, tags, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, u.id, name, summary, text, tags, status, now(), now()).run();
  return json({ id, status });
});

on("POST", "/api/skills/([\\w]+)/(approve|decline|delete)", async (req, env, u, [id, act]) => {
  if (!u) return err(401, "Sign in first.");
  const r = await env.DB.prepare("SELECT * FROM skills WHERE id = ?").bind(id).first();
  if (!r) return err(404, "No such skill.");
  if (act === "delete" && r.user_id === u.id) { await env.DB.prepare("DELETE FROM skills WHERE id = ?").bind(id).run(); return json({ ok: true }); }
  if (!staff(u, "mod")) return err(403, "Moderators only.");
  const author = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(r.user_id).first();
  if (author && RANK[author.role] >= RANK[u.role]) return err(403, "You can only review skills from people below your own role.");
  if (act === "delete") await env.DB.prepare("DELETE FROM skills WHERE id = ?").bind(id).run();
  else await env.DB.prepare("UPDATE skills SET status = ?, reviewed_by = ? WHERE id = ?").bind(act === "approve" ? "approved" : "declined", u.id, id).run();
  await log(env, u.id, "skill:" + act, id);
  return json({ ok: true });
});

// ---------- Agent tokens ----------
on("GET", "/api/tokens", async (req, env, u) => {
  if (!u || u.banned) return err(401, "Sign in first.");
  const rows = await env.DB.prepare("SELECT id, name, scope, created, last_used FROM api_tokens WHERE user_id = ? ORDER BY created DESC").bind(u.id).all();
  return json({ tokens: rows.results });
});
on("POST", "/api/tokens", async (req, env, u) => {
  if (!u || u.banned) return err(401, "Sign in first.");
  if (!(await rate(env, "tok:" + u.id, 10, 86400))) return err(429, "That's plenty for today.");

  const b = await body(req);
  const [name, e] = clean(b.name || "My agent", 40); if (e) return err(400, e);
  const scope = b.scope === "write" ? "write" : "read";
  const token = "ffk_" + rid(40);
  // Insert only while the account holds fewer than 10 tokens, in one statement, so parallel requests can't overshoot.
  const ins = await env.DB.prepare("INSERT INTO api_tokens (id, user_id, token_hash, name, scope, created) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM api_tokens WHERE user_id = ?) < 10")
    .bind(rid(10), u.id, await sha(token), name, scope, now(), u.id).run();
  if (!ins.meta.changes) return err(400, "Revoke an old token first. The limit is 10.");
  return json({ token, scope, name });
});
on("DELETE", "/api/tokens/([\\w]+)", async (req, env, u, [id]) => {
  if (!u) return err(401, "Sign in first.");
  await env.DB.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").bind(id, u.id).run();
  return json({ ok: true });
});
export async function agentUser(env, tok) {
  if (!tok || !tok.startsWith("ffk_") || tok.length > 80) return null;
  const th = await sha(tok);
  const r = await env.DB.prepare("SELECT u.*, t.scope, t.id tid FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.banned = 0").bind(th).first();
  if (r) await env.DB.prepare("UPDATE api_tokens SET last_used = ? WHERE id = ?").bind(now(), r.tid).run();
  return r;
}
export { rate, sha };


// ---------- People added by admins ----------
async function ytChannelId(handle) {
  try {
    const r = await fetch(`https://www.youtube.com/${handle}`, { headers: { "user-agent": "Mozilla/5.0", "accept-language": "en-US" } });
    const t = await r.text();
    return (t.match(/"externalId":"(UC[\w-]{22})"/) || t.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || [])[1] || "";
  } catch { return ""; }
}
on("GET", "/api/people/extra", async (req, env) => {
  const rows = await env.DB.prepare("SELECT n, name, slug, topic, why, yt, yt_id, x, mode, av, created FROM people_extra WHERE active = 1 ORDER BY n").all();
  return json({ people: rows.results.map((r) => ({ i: 10000 + r.n, slug: r.slug, name: r.name, topic: r.topic, why: r.why, yt: r.yt || null, ytId: r.yt_id || null, x: r.x || null, av: r.av || null, mode: r.mode, added: r.created, nv: 0, np: 0 })) },
    200, { "cache-control": "public, max-age=120" });
});
on("POST", "/api/admin/people", async (req, env, u) => {
  if (!staff(u, "admin")) return err(403, "Admins only.");
  const b = await body(req);
  const [name, e1] = clean(b.name, 60); if (e1) return err(400, e1);
  const [why, e2] = clean(b.why, 160); if (e2) return err(400, "Add one line on why they're worth learning from.");
  const topics = ["foundations", "local", "agents", "research", "math", "cs", "systems", "making", "labs"];
  if (!topics.includes(b.topic)) return err(400, "Pick a topic.");
  const links = cleanLinks({ x: b.x, youtube: b.yt });
  if (!links.x && !links.youtube) return err(400, "Add an X handle or a YouTube channel.");
  const ytId = links.youtube ? (links.youtube.startsWith("channel/") ? links.youtube.slice(8) : await ytChannelId(links.youtube)) : "";
  if (links.youtube && !ytId) return err(400, "Couldn't find that YouTube channel.");
  const av = links.x ? await xAvatar(links.x) : "";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  try {
    await env.DB.prepare("INSERT INTO people_extra (name, slug, topic, why, yt, yt_id, x, mode, av, added_by, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(name, slug, b.topic, why, links.youtube || "", ytId, links.x || "", b.mode === "all" ? "all" : "ai", av, u.id, now()).run();
  } catch { return err(409, "Someone with that name is already listed."); }
  await log(env, u.id, "add-person", slug);
  return json({ ok: true, slug });
});
on("POST", "/api/admin/people/([\\w-]+)/remove", async (req, env, u, [slug]) => {
  if (!staff(u, "admin")) return err(403, "Admins only.");
  await env.DB.prepare("UPDATE people_extra SET active = 0 WHERE slug = ?").bind(slug).run();
  await log(env, u.id, "remove-person", slug);
  return json({ ok: true });
});

// ---------- Live counters ----------
on("GET", "/api/pulse", async (req, env) => {
  const cache = caches.default, key = new Request(new URL("/api/pulse", req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const [users, comments, extra, fresh] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n FROM users WHERE banned = 0").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM comments WHERE hidden = 0").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM people_extra WHERE active = 1").first(),
    env.FRESH.get("fresh", "json"),
  ]);
  // wall: recent upload ids for the front door's thumbnail wall (YouTube thumbnails are public anyway).
  const wall = ((fresh && fresh.videos) || []).map((v) => (Array.isArray(v) ? v[0] : v && v.id)).filter((id) => /^[\w-]{11}$/.test(id || "")).slice(0, 36);
  const res = json({ learners: users.n, comments: comments.n, extraPeople: extra.n, freshVideos: (fresh && fresh.videos || []).length, freshPosts: (fresh && fresh.posts || []).length, updated: (fresh && fresh.updated) || 0, people: LISTED_NAMES.size + extra.n, wall },
    200, { "cache-control": "public, max-age=30" });
  await cache.put(key, res.clone());
  return res;
});

export async function handle(req, env) {
  const url = new URL(req.url);
  for (const [m, re, fn] of routes) {
    if (m !== req.method) continue;
    const match = url.pathname.match(re);
    if (!match) continue;
    try {
      const u = await auth(req, env);
      return await fn(req, env, u, match.slice(1));
    } catch (e) {
      return err(e instanceof SyntaxError || e.message === "too big" ? 400 : 500, e instanceof SyntaxError ? "Bad request." : e.message === "too big" ? "Too big." : "Something went wrong.");
    }
  }
  return null;
}
