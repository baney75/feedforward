// OAuth 2.1 for the personal Feedforward connector in claude.ai, ChatGPT and other MCP clients.
// Public clients only: dynamic registration, authorization code with PKCE (S256), exact redirect match,
// single-use codes that expire in 10 minutes. The access token is a normal personal token (ffk_...)
// that the learner can see and revoke on their profile.
import { json, sha, rid, rate, tokenUser, clean } from "./api.js";

const now = () => Math.floor(Date.now() / 1000);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const oauthErr = (error, description, status = 400) => json({ error, error_description: description }, status);

export function metadata(req) {
  const o = new URL(req.url).origin;
  return {
    resource: { resource: `${o}/mcp/me`, authorization_servers: [o], scopes_supported: ["read", "write"], bearer_methods_supported: ["header"], resource_name: "Feedforward (your library)" },
    server: {
      issuer: o, authorization_endpoint: `${o}/oauth/authorize`, token_endpoint: `${o}/oauth/token`, registration_endpoint: `${o}/oauth/register`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["read", "write"],
    },
  };
}

// A redirect may go to an https site, or to localhost for desktop clients. Nothing else.
const okRedirect = (u) => {
  try { const x = new URL(u); return !x.hash && !x.username && !x.password && (x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname))); }
  catch { return false; }
};

export async function oauth(req, env) {
  const url = new URL(req.url);
  const ip = req.headers.get("cf-connecting-ip") || "local";

  if (url.pathname === "/oauth/register" && req.method === "POST") {
    if (!(await rate(env, "oreg:" + ip, 20, 3600))) return oauthErr("slow_down", "Too many registrations.", 429);
    let b; try { b = await req.json(); } catch { return oauthErr("invalid_client_metadata", "Send JSON."); }
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u) => typeof u === "string" && u.length < 500) : [];
    if (!uris.length || uris.length > 5 || !uris.every(okRedirect)) return oauthErr("invalid_redirect_uri", "Redirect URIs must be https, or http on localhost.");
    const name = String(b.client_name || "An app").replace(/[^\w .()-]/g, "").slice(0, 60) || "An app";
    const id = "ffc_" + rid(24);
    await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created) VALUES (?, ?, ?, ?)").bind(id, name, JSON.stringify(uris), now()).run();
    return json({ client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, 201);
  }

  // The consent page calls this to show who is asking.
  if (url.pathname === "/api/oauth/client" && req.method === "GET") {
    const c = await env.DB.prepare("SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?").bind(url.searchParams.get("id") || "").first();
    if (!c) return json({ error: "Unknown app." }, 404);
    const r = url.searchParams.get("redirect_uri") || "";
    if (!JSON.parse(c.redirect_uris).includes(r)) return json({ error: "That redirect address isn't registered for this app." }, 400);
    return json({ name: c.name, redirect_host: new URL(r).host });
  }

  // The signed-in learner approves. Bearer session token in the header, so no cookie and no CSRF.
  if (url.pathname === "/api/oauth/approve" && req.method === "POST") {
    const h = req.headers.get("authorization") || "";
    const u = await tokenUser(env, h.startsWith("Bearer ") ? h.slice(7) : "");
    if (!u || u.banned) return json({ error: "Sign in first." }, 401);
    if (!(await rate(env, "oapp:" + u.id, 30, 3600))) return json({ error: "Slow down." }, 429);
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const c = await env.DB.prepare("SELECT * FROM oauth_clients WHERE id = ?").bind(String(b.client_id || "")).first();
    if (!c || !JSON.parse(c.redirect_uris).includes(b.redirect_uri)) return json({ error: "Unknown app or redirect." }, 400);
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(b.code_challenge || "") || b.code_challenge_method !== "S256") return json({ error: "PKCE with S256 is required." }, 400);
    const scope = b.scope === "write" ? "write" : "read";
    const code = rid(40);
    await env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, scope, expires) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha(code), c.id, u.id, b.redirect_uri, b.code_challenge, scope, now() + 600).run();
    const back = new URL(b.redirect_uri);
    back.searchParams.set("code", code);
    if (b.state) back.searchParams.set("state", String(b.state).slice(0, 500));
    back.searchParams.set("iss", url.origin);
    return json({ redirect: back.toString() });
  }

  if (url.pathname === "/oauth/token" && req.method === "POST") {
    if (!(await rate(env, "otok:" + ip, 60, 3600))) return oauthErr("slow_down", "Too many requests.", 429);
    const ct = req.headers.get("content-type") || "";
    let p;
    try { p = ct.includes("application/json") ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text())); } catch { return oauthErr("invalid_request", "Bad body."); }
    if (p.grant_type !== "authorization_code") return oauthErr("unsupported_grant_type", "Only authorization_code is supported.");
    const row = await env.DB.prepare("SELECT o.*, c.name client_name FROM oauth_codes o JOIN oauth_clients c ON c.id = o.client_id WHERE o.code_hash = ?").bind(await sha(String(p.code || ""))).first();
    if (!row || row.used || row.expires < now()) return oauthErr("invalid_grant", "The code is invalid, used or expired.");
    // Mark used first, so a replayed code can never mint a second token.
    const mark = await env.DB.prepare("UPDATE oauth_codes SET used = 1 WHERE code_hash = ? AND used = 0").bind(row.code_hash).run();
    if (!mark.meta.changes) return oauthErr("invalid_grant", "The code was already used.");
    if (row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) return oauthErr("invalid_grant", "Client or redirect doesn't match.");
    const verifier = String(p.code_verifier || "");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthErr("invalid_grant", "Bad code_verifier.");
    const digest = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    if (digest !== row.challenge) return oauthErr("invalid_grant", "PKCE check failed.");
    const [name] = clean(`${row.client_name} connector`, 40);
    // Reconnecting the same app (same client_id) replaces its old token. Matching on client_id, never the display
    // name, keeps two machines or two apps with the same name from revoking each other. One batch is one
    // transaction, so the replace and the 10-token cap can't interleave with a parallel exchange.
    const token = "ffk_" + rid(40);
    const [, ins] = await env.DB.batch([
      env.DB.prepare("DELETE FROM api_tokens WHERE user_id = ? AND client_id = ?").bind(row.user_id, row.client_id),
      env.DB.prepare("INSERT INTO api_tokens (id, user_id, token_hash, name, scope, created, client_id) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM api_tokens WHERE user_id = ?) < 10")
        .bind(rid(10), row.user_id, await sha(token), name || "Connector", row.scope, now(), row.client_id, row.user_id),
    ]);
    if (!ins.meta.changes) return oauthErr("access_denied", "This account already has 10 agent tokens. Revoke one on your Feedforward profile.");
    return json({ access_token: token, token_type: "Bearer", scope: row.scope }, 200, { "cache-control": "no-store", pragma: "no-cache" });
  }
  return null;
}
