// /chat: six topic rooms. mountChat() is the one chat component, reused by each live session's room (s-<id>).
// Visitors read; signed-in learners post. Staff delete messages from people below them; anyone deletes their own.
import { signedIn, user, account, RANK } from "../account.js";
import { load, D } from "../data.js";
import { esc, toast, badges, userAvatar } from "../ui.js";
import { icon } from "../icons.js";
import { $, setTitle, cssReady, loader, on } from "./_shared.js";

export const ROOMS = [
  ["general", "General", "Anything about learning AI and computer science", ["What are you learning this week?", "Which video finally made attention click for you?", "Share one thing you built recently."]],
  ["local-ai", "Local AI", "Running models on your own hardware", ["What's the best model you can run on 16 GB?", "llama.cpp, Ollama or MLX: what do you use and why?", "Post your tokens per second and your setup."]],
  ["agents", "Agents", "Coding agents, harnesses and MCP", ["Which coding agent do you trust with a real repo?", "What's in your AGENTS.md that made the biggest difference?", "Favorite MCP server so far?"]],
  ["research", "Research", "Papers, ideas and how to read them", ["Which paper should everyone read first?", "How do you read a paper you only half understand?", "What result surprised you most this year?"]],
  ["making", "Making", "CAD, 3D printing and building things", ["What are you printing right now?", "OpenSCAD, build123d or FreeCAD for parametric parts?", "Best tip for first-layer adhesion?"]],
  ["help", "Help", "Stuck on something? Ask here", ["My model won't load on the GPU. Where do I start?", "How do I set up Python for AI without a mess?", "Which track should a beginner start with?"]],
];
const SESSION_STARTERS = ["What are you hoping to learn in this session?", "Any questions before we start?", "Share what you're working on."];
const roomOf = (k) => ROOMS.find((r) => r[0] === k) || ROOMS[0];

export async function render(el, qs) {
  await cssReady;
  let room = roomOf(qs.get("room"))[0];
  el.innerHTML = `<div class="pg pg-chat">
    <aside class="rooms-col" aria-label="Rooms">
      <p class="kind">Rooms</p>
      <ul>${ROOMS.map(([k, l, about]) => `<li><button type="button" class="room" data-room="${k}" aria-current="${k === room}"><span class="room-l"><span class="hash" aria-hidden="true">#</span>${l}</span><span class="room-d">${about}</span><span class="room-n" data-count="${k}"></span></button></li>`).join("")}</ul>
    </aside>
    <section class="conv" aria-labelledby="roomName">
      <header class="conv-h">
        <div class="conv-t">
          <div class="room-pick">
            <h1 id="roomName"><span class="hash" aria-hidden="true">#</span><span id="roomLabel"></span></h1>${icon("down")}
            <label class="sr-only" for="roomSel">Choose a room</label>
            <select id="roomSel">${ROOMS.map(([k, l, about]) => `<option value="${k}"${k === room ? " selected" : ""}>${l}: ${about}</option>`).join("")}</select>
          </div>
          <p class="room-about" id="roomAbout"></p>
        </div>
        <p class="online" id="online" aria-live="polite" hidden><i class="live" aria-hidden="true"></i><span></span></p>
      </header>
      <div class="conv-body" id="slot"></div>
    </section>
  </div>`;
  const online = $("#online", el), slot = $("#slot", el);
  const setCount = (n) => {
    online.hidden = !n; online.lastChild.textContent = `${n} online`;
    el.querySelectorAll("[data-count]").forEach((c) => { c.textContent = c.dataset.count === room && n ? `${n} online` : ""; });
  };
  let stop = () => {};
  const open = (k) => {
    room = k;
    const [, label, about] = roomOf(k);
    setTitle(label + " chat");
    $("#roomLabel", el).textContent = label;
    $("#roomAbout", el).textContent = about;
    $("#roomSel", el).value = k;
    el.querySelectorAll("[data-room]").forEach((x) => x.setAttribute("aria-current", x.dataset.room === k));
    stop(); setCount(0);
    stop = mountChat(slot, k, { onCount: setCount, label });
  };
  open(room);
  const pick = (k) => { if (k === room) return; history.replaceState(null, "", k === "general" ? "/chat" : "/chat?room=" + k); open(k); };
  const off = on(el, "[data-room]", (b) => pick(b.dataset.room));
  const sel = $("#roomSel", el), onSel = () => pick(sel.value);
  sel.addEventListener("change", onSel);
  return () => { off(); sel.removeEventListener("change", onSel); stop(); };
}

// ---------- Message helpers ----------
const dayKey = (ts) => new Date(ts * 1000).toDateString();
function dayLabel(ts) {
  const d = new Date(ts * 1000), t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
}
const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fullTime = (ts) => new Date(ts * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

// Escape everything, then turn https links into anchors. Only https, never javascript: or data:.
const URL_RE = /https:\/\/[^\s<>"'`]+/g;
const hasUrl = (t) => /https:\/\//.test(t);
function linkify(text) {
  let out = "", last = 0;
  const vids = [];
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,!?:;)\]]+$/, "");
    let ok = false;
    try { ok = new URL(u).protocol === "https:"; } catch {}
    out += esc(text.slice(last, m.index));
    if (ok) {
      const label = u.replace(/^https:\/\/(www\.)?/, "");
      out += `<a href="${esc(u)}" target="_blank" rel="nofollow ugc noopener">${esc(label.length > 48 ? label.slice(0, 46) + "..." : label)}</a>`;
      const v = videoId(u); if (v && !vids.includes(v)) vids.push(v);
    } else out += esc(u);
    last = m.index + u.length;
  }
  return [out + esc(text.slice(last)), vids];
}
function videoId(u) {
  const m = u.match(/^https:\/\/(?:www\.)?feedforward\.dbaney\.com\/watch\/([\w-]{11})/) || u.match(/^https:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})/) || u.match(/^https:\/\/youtu\.be\/([\w-]{11})/);
  return m && m[1];
}
// A compact card for a catalog video linked in a message.
function preview(id) {
  const v = D.byId && D.byId.get(id);
  if (!v) return "";
  const p = D.people[v.person] || {};
  return `<a class="vprev" href="/watch/${esc(v.id)}"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" width="112" height="63" loading="lazy"><span class="vprev-t"><b>${esc(v.title)}</b><span>${esc(p.name || "")}</span></span></a>`;
}
const SEND = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/></svg>';

// Mounts a room into el. Returns a cleanup function that closes the socket and stops reconnecting.
export function mountChat(el, room, { onCount = () => {}, compact = false, label = "this room" } = {}) {
  const me = user();
  const starters = (ROOMS.find((r) => r[0] === room) || [0, 0, 0, SESSION_STARTERS])[3];
  el.classList.add("pg-chat");
  el.innerHTML = `<div class="chat${compact ? " compact" : ""}">
    ${compact ? `<p class="chat-mini"><span class="kind">Session chat</span><span class="online" hidden><i class="live" aria-hidden="true"></i><span></span></span></p>` : ""}
    <div class="chat-scroll">
      <div class="chat-list" role="log" aria-live="polite" aria-label="Messages" tabindex="0">${loader("joining the room")}</div>
      <button class="new-pill" type="button" hidden>${icon("down")}New messages</button>
    </div>
    <p class="chat-status" hidden></p>
    ${signedIn() ? `<form class="composer">
        <div class="comp-box"><label class="sr-only" for="msg-${esc(room)}">Message ${esc(label)}</label><textarea id="msg-${esc(room)}" rows="1" maxlength="500" placeholder="Message ${esc(compact ? "the session" : "#" + label)}" enterkeyhint="send"></textarea><span class="count" aria-live="polite" hidden></span></div>
        <button class="btn primary send" type="submit" disabled aria-label="Send">${SEND}<span>Send</span></button>
      </form>`
      : `<div class="join-bar"><p>Read along, or get a free code to join the conversation.</p><a class="btn primary" href="/me">Get a code</a></div>`}
  </div>`;
  const list = $(".chat-list", el), pill = $(".new-pill", el), status = $(".chat-status", el), form = $(".composer", el);
  const ta = form && $("textarea", form), send = form && $(".send", form), count = form && $(".count", form);
  const mini = compact && $(".chat-mini .online", el);
  let ws = null, tries = 0, timer = 0, closed = false, msgs = [], pending = "", lastSent = "", waitUntil = 0, waitT = 0;

  const canDel = (m) => me && m.user && (m.user.id === me.id || (RANK[me.role] >= RANK.mod && RANK[me.role] > RANK[m.user.role]));
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 64;
  const toBottom = (smooth) => list.scrollTo({ top: list.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });

  // One row. prev decides grouping (same person, under 5 minutes, same day) and day separators.
  function row(m, prev, fresh) {
    const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
    const cont = !newDay && prev.user.id === m.user.id && m.ts - prev.ts < 300;
    const mine = me && m.user.id === me.id;
    const [html, vids] = linkify(m.text);
    const iso = new Date(m.ts * 1000).toISOString();
    return `${newDay ? `<div class="day" role="separator"><span>${dayLabel(m.ts)}</span></div>` : ""}<article class="msg${cont ? " cont" : ""}${mine ? " mine" : ""}${fresh ? " fresh" : ""}" data-id="${esc(m.id)}">
        ${cont ? `<time class="msg-tm" datetime="${iso}" title="${esc(fullTime(m.ts))}">${clock(m.ts)}</time>`
          : `<a class="msg-av" href="/u/${esc(m.user.id)}" tabindex="-1" aria-hidden="true">${userAvatar(m.user)}</a>`}
        <div class="msg-b">
          ${cont ? "" : `<p class="msg-h"><a href="/u/${esc(m.user.id)}"><b>${esc(m.user.name)}</b></a>${badges(m.user)}<time datetime="${iso}" title="${esc(fullTime(m.ts))}">${clock(m.ts)}</time></p>`}
          <p class="msg-t">${html}</p>${vids.map(preview).join("")}
        </div>
        ${canDel(m) ? `<button class="msg-del" type="button" data-del="${esc(m.id)}" aria-label="Delete message from ${esc(m.user.name)}" title="Delete">${icon("close")}</button>` : ""}
      </article>`;
  }
  function empty() {
    return `<div class="chat-empty"><span class="ce-i">${icon("chat")}</span><p><b>No messages yet</b><span>${signedIn() ? "Start the conversation, or pick an opener." : "Get a free code to start the conversation."}</span></p>
      ${signedIn() ? `<div class="starters">${starters.map((s) => `<button type="button" class="starter" data-start="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}</div>`;
  }
  function paintAll(keep = false) {
    const y = list.scrollTop, bottom = atBottom();
    list.innerHTML = msgs.length ? msgs.map((m, i) => row(m, msgs[i - 1], false)).join("") : empty();
    if (keep && !bottom) list.scrollTop = y; else toBottom();
  }
  function add(m) {
    const stick = atBottom() || (me && m.user.id === me.id);
    const prev = msgs[msgs.length - 1];
    msgs.push(m); if (msgs.length > 300) msgs.shift();
    if (msgs.length === 1) list.innerHTML = "";
    list.insertAdjacentHTML("beforeend", row(m, prev, true));
    if (stick) toBottom(true); else pill.hidden = false;
  }
  const setStatus = (t) => { status.hidden = !t; status.textContent = t || ""; refresh(); };
  // The send button: disabled while empty, offline, or waiting out the rate limit.
  function refresh() {
    if (!form) return;
    const n = ta.value.length, wait = Math.ceil((waitUntil - Date.now()) / 1000);
    count.hidden = n <= 400; count.textContent = `${n}/500`; count.classList.toggle("full", n >= 500);
    send.disabled = !ta.value.trim() || !!status.textContent || wait > 0;
    send.lastChild.textContent = wait > 0 ? `Wait ${wait}s` : "Send";
    send.setAttribute("aria-label", wait > 0 ? `Wait ${wait} seconds` : "Send");
    send.classList.toggle("waiting", wait > 0);
  }
  function rateWait(sec) {
    waitUntil = Date.now() + sec * 1000; refresh();
    clearInterval(waitT); waitT = setInterval(() => { refresh(); if (Date.now() >= waitUntil) clearInterval(waitT); }, 250);
  }

  function connect() {
    if (closed) return;
    const tok = signedIn() ? (account() || {}).token : "";
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/chat/${encodeURIComponent(room)}`;
    // The token rides in the subprotocol, never the URL, so it can't end up in logs.
    try { ws = tok ? new WebSocket(url, ["ff", "t." + tok]) : new WebSocket(url); } catch { return retry(); }
    ws.onopen = () => { tries = 0; setStatus(""); if (pending) { ws.send(JSON.stringify({ type: "msg", text: pending })); lastSent = pending; pending = ""; } };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "hello") { msgs = m.messages || []; paintAll(); }
      else if (m.type === "msg" && m.msg) { add(m.msg); if (me && m.msg.user.id === me.id) lastSent = ""; }
      else if (m.type === "del") { const n = msgs.length; msgs = msgs.filter((x) => x.id !== m.id); if (msgs.length !== n) paintAll(true); }
      else if (m.type === "count") { onCount(m.n); if (mini) { mini.hidden = !m.n; mini.lastChild.textContent = `${m.n} online`; } }
      else if (m.type === "error") {
        // Give the text back so nothing typed is lost, and pause the button after a rate limit.
        if (lastSent && ta && !ta.value) { ta.value = lastSent; grow(); }
        lastSent = "";
        if (/few seconds/i.test(m.error)) rateWait(2); else toast(m.error);
        refresh();
      }
    };
    ws.onclose = (e) => {
      ws = null;
      if (closed) return;
      if (e.code === 4003) { setStatus("This account can't chat right now."); return; }
      retry();
    };
  }
  function retry() {
    // Back off 1, 2, 4, 8 up to 30 seconds, with jitter so a room doesn't reconnect all at once.
    const wait = Math.min(30000, 1000 * 2 ** tries++) + Math.random() * 400;
    setStatus("Reconnecting");
    clearTimeout(timer); timer = setTimeout(connect, wait);
  }

  const offs = [
    on(list, "[data-del]", (b) => {
      if (!confirm("Delete this message for everyone?")) return;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "del", id: b.dataset.del })); else toast("Not connected. Try again in a moment.");
    }),
    on(list, "[data-start]", (b) => { if (!ta) return; ta.value = b.dataset.start; grow(); refresh(); ta.focus(); }),
    // Touch screens have no hover: a tap on a message shows its time and delete button.
    on(list, ".msg", (a, e) => { if (!e.target.closest("a,button")) a.classList.toggle("open"); }),
  ];
  const onScroll = () => { if (atBottom()) pill.hidden = true; };
  list.addEventListener("scroll", onScroll, { passive: true });
  pill.onclick = () => { toBottom(true); pill.hidden = true; };

  function grow() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 128) + "px"; }
  if (form) {
    ta.addEventListener("input", () => { grow(); refresh(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!send.disabled) form.requestSubmit(); } });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text || Date.now() < waitUntil) return;
      // Typed before the room connected: send it as soon as the socket opens.
      if (!ws || ws.readyState !== 1) { if (pending) return toast("Still connecting. One moment."); pending = text; }
      else { ws.send(JSON.stringify({ type: "msg", text })); lastSent = text; }
      ta.value = ""; grow(); refresh();
    });
  }
  // Video previews need the catalog. When it arrives, redraw so links to known videos get their card.
  load().then(() => D.full).then(() => { if (!closed && msgs.some((m) => hasUrl(m.text))) paintAll(true); }).catch(() => {});
  const onVis = () => { if (!document.hidden && !ws && !closed) { clearTimeout(timer); tries = 0; connect(); } };
  document.addEventListener("visibilitychange", onVis);
  connect();
  return () => {
    closed = true; clearTimeout(timer); clearInterval(waitT); offs.forEach((f) => f());
    list.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVis);
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch {} ws = null; }
  };
}
