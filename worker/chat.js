// One Durable Object per chat room. WebSockets hibernate between messages. The Worker passes the
// signed-in user (or nobody, for read-only visitors) in x-ff-user; clients can't set that header.
import { clean, rid, RANK } from "./api.js";

const KEEP = 200;

export class ChatRoom {
  constructor(state, env) { this.state = state; this.env = env; this.last = new Map(); }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/kick") {
      const uid = url.searchParams.get("uid");
      for (const ws of this.state.getWebSockets()) { const a = ws.deserializeAttachment() || {}; if (a.user && a.user.id === uid) ws.close(4003, "banned"); }
      // A ban also clears the person's messages from this room.
      const log = (await this.state.storage.get("log")) || [];
      const gone = log.filter((x) => x.user && x.user.id === uid);
      if (gone.length) { await this.state.storage.put("log", log.filter((x) => !(x.user && x.user.id === uid))); for (const g of gone) this.broadcast({ type: "del", id: g.id }); }
      return new Response("ok");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    let user = null;
    try { user = JSON.parse(req.headers.get("x-ff-user") || "null"); } catch {}
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ user });
    const log = (await this.state.storage.get("log")) || [];
    server.send(JSON.stringify({ type: "hello", you: user, messages: log.slice(-100) }));
    this.presence();
    // Echo the "ff" subprotocol when the client offered one (it carries the token that way).
    const offered = (req.headers.get("sec-websocket-protocol") || "").split(",").map((x) => x.trim());
    return new Response(null, { status: 101, webSocket: client, headers: offered.includes("ff") ? { "sec-websocket-protocol": "ff" } : {} });
  }

  presence() {
    const n = this.state.getWebSockets().length;
    this.broadcast({ type: "count", n });
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) { try { ws.send(s); } catch {} }
  }

  async webSocketMessage(ws, raw) {
    const { user } = ws.deserializeAttachment() || {};
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!user) return ws.send(JSON.stringify({ type: "error", error: "Get a free code to chat." }));
    // Re-check the account on every action, so a ban or a lost role takes effect in every room at once.
    const row = await this.env.DB.prepare("SELECT banned, role FROM users WHERE id = ?").bind(user.id).first();
    if (!row || row.banned) { ws.close(4003, "banned"); return; }
    user.role = row.role;
    if (m.type === "msg") {
      const t = Date.now(), prev = this.last.get(user.id) || 0;
      if (t - prev < 2500) return ws.send(JSON.stringify({ type: "error", error: "One message every few seconds, please." }));
      const [text, e] = clean(m.text, 500);
      if (e) return ws.send(JSON.stringify({ type: "error", error: e }));
      if (/https?:\/\//i.test(text) && Date.now() / 1000 - (user.created || 0) < 86400 && RANK[user.role] < RANK.contributor)
        return ws.send(JSON.stringify({ type: "error", error: "New accounts can post links after their first day." }));
      this.last.set(user.id, t);
      const msg = { id: rid(10), user, text, ts: Math.floor(t / 1000) };
      const log = (await this.state.storage.get("log")) || [];
      log.push(msg);
      await this.state.storage.put("log", log.slice(-KEEP));
      this.broadcast({ type: "msg", msg });
    } else if (m.type === "del" && typeof m.id === "string") {
      const log = (await this.state.storage.get("log")) || [];
      const target = log.find((x) => x.id === m.id);
      if (!target) return;
      const own = target.user.id === user.id;
      // Judge rank by the author's role now, not the role saved with the message.
      const author = own ? null : await this.env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(target.user.id).first();
      const can = own || (RANK[user.role] >= RANK.mod && RANK[user.role] > RANK[(author && author.role) || "user"]);
      if (!can) return ws.send(JSON.stringify({ type: "error", error: "You can't delete that." }));
      await this.state.storage.put("log", log.filter((x) => x.id !== m.id));
      if (!own) await this.env.DB.prepare("INSERT INTO modlog (actor, action, target, ts) VALUES (?, ?, ?, ?)").bind(user.id, "delete-chat", m.id, Math.floor(Date.now() / 1000)).run();
      this.broadcast({ type: "del", id: m.id });
    }
  }

  webSocketClose() { this.presence(); }
  webSocketError() { this.presence(); }
}
