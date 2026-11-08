// Likes, star ratings and comments for any item key (v:, s:, b:, r:, k:). Event delegation keeps it to one listener per mount.
import { api, signedIn, user, can, like, rate, mine, stats, loadStats } from "./account.js";
import { esc, ago, num, toast, badges, userAvatar } from "./ui.js";
import { icon } from "./icons.js";
import { haptic } from "./haptics.js";

// Like and dislike, one pill. The like count shows; the dislike count never does. stacked: the Shorts action
// column, where they're round buttons with a label under each, like Save and Share.
export function likeButton(item, { label = true, stacked = false } = {}) {
  const on = mine.likes.has(item), off = mine.dislikes.has(item), n = stats.likes[item] || 0;
  if (stacked) return `<span class="vote stacked" data-vote="${esc(item)}" data-stacked="1"><button type="button" data-like="${esc(item)}" aria-pressed="${on}" aria-label="Like${n ? `, ${num(n)} likes` : ""}">${icon(on ? "thumbupfill" : "thumbup")}<span>${n ? num(n) : "Like"}</span></button><button type="button" data-dislike="${esc(item)}" aria-pressed="${off}" aria-label="Dislike. Only you see this.">${icon(off ? "thumbdownfill" : "thumbdown")}<span>Dislike</span></button></span>`;
  return `<span class="vote" data-vote="${esc(item)}"><button class="btn like" data-like="${esc(item)}" aria-pressed="${on}" aria-label="Like${n ? `, ${num(n)} likes` : ""}">${icon(on ? "thumbupfill" : "thumbup")}${label ? `<span>${n ? num(n) : "Like"}</span>` : n ? `<span>${num(n)}</span>` : ""}</button><button class="btn dislike" data-dislike="${esc(item)}" aria-pressed="${off}" aria-label="Dislike. Only you see this.">${icon(off ? "thumbdownfill" : "thumbdown")}</button></span>`;
}

export function stars(item) {
  const r = stats.ratings[item], my = mine.ratings[item] || 0;
  return `<div class="stars" role="radiogroup" aria-label="Rate it">${[1, 2, 3, 4, 5].map((k) => `<button role="radio" aria-checked="${my === k}" aria-label="${k} star${k > 1 ? "s" : ""}" data-rate="${esc(item)}" data-stars="${k}" class="${k <= my ? "on" : ""}">${icon("star")}</button>`).join("")}<span class="muted rate-n">${r ? `${r[0].toFixed(1)} · ${r[1]} rating${r[1] === 1 ? "" : "s"}` : my ? "" : "Rate it"}</span></div>`;
}

const needCode = () => toast("Sign in first.");

// One handler for likes and stars anywhere inside root.
export function bindSocial(root) {
  const onClick = async (e) => {
    const lb = e.target.closest("[data-like], [data-dislike]");
    if (lb) {
      if (!signedIn()) return needCode();
      const kind = lb.dataset.dislike ? "dislike" : "like", item = lb.dataset.like || lb.dataset.dislike;
      const on = lb.getAttribute("aria-pressed") !== "true", pill = lb.closest(".vote");
      lb.setAttribute("aria-pressed", on);
      haptic.tick();
      try { await like(item, on, kind); pill.outerHTML = likeButton(item, { stacked: !!pill.dataset.stacked }); if (kind === "dislike" && on) toast("Got it. You'll see less like this."); }
      catch (err) { lb.setAttribute("aria-pressed", !on); toast(err.message); }
      return;
    }
    const sb = e.target.closest("[data-rate]");
    if (sb) {
      if (!signedIn()) return needCode();
      const item = sb.dataset.rate, k = +sb.dataset.stars, next = mine.ratings[item] === k ? 0 : k;
      try { await rate(item, next); sb.closest(".stars").outerHTML = stars(item); toast(next ? `Rated ${next} of 5` : "Rating removed"); } catch (err) { toast(err.message); }
    }
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}

// Replies need the green check (or a staff role): bots that slip in can't post.
const canReply = () => signedIn() && !!user() && (user().verified || can("contributor"));

// Comments: list plus composer. Mods and above can hide; authors can delete their own.
export async function comments(el, item) {
  el.innerHTML = `<section class="comments" aria-label="Comments"><div class="sec-h"><h2>Comments</h2><span class="muted mono" id="cn"></span></div>
    ${canReply() ? `<form class="compose"><label class="sr-only" for="cbody">Add a comment</label><textarea id="cbody" rows="2" maxlength="1500" placeholder="Add a thoughtful comment" required></textarea><button class="btn primary" type="submit">Post</button></form>`
      : `<p class="muted signin-line">Replies are for verified members, so every voice here is a real person. Talk it through in your communities any time.</p>`}
    <div class="clist"><div class="skel" role="status" aria-label="Loading comments"><i></i><i></i><i></i></div></div></section>`;
  const list = el.querySelector(".clist");
  const me = user();
  const row = (c) => `<article class="cmt${c.hidden ? " hidden-c" : ""}" data-cid="${esc(c.id)}">
      <a href="/u/${esc(c.user.id)}">${userAvatar(c.user, "s")}</a>
      <div style="min-width:0"><div class="cmt-h"><a href="/u/${esc(c.user.id)}"><b>${esc(c.user.name)}</b></a>${badges(c.user)}<span class="muted">${ago(c.ts, true)}</span>${c.hidden ? '<span class="muted">hidden</span>' : ""}</div>
      <p>${esc(c.body)}</p>
      <div class="cmt-a">${me && me.id === c.user.id ? `<button data-cdel>Delete</button>` : ""}${me && me.id !== c.user.id ? `<button data-crep>Report</button>` : ""}${can("mod") && me.id !== c.user.id ? `<button data-chide="${c.hidden ? "unhide" : "hide"}">${c.hidden ? "Unhide" : "Hide"}</button>` : ""}</div></div></article>`;
  const load = async () => {
    try {
      const d = await api("/api/comments?item=" + encodeURIComponent(item));
      el.querySelector("#cn").textContent = d.comments.length ? String(d.comments.length) : "";
      list.innerHTML = d.comments.map(row).join("") || `<p class="muted empty-c">No comments yet. Start the conversation.</p>`;
    } catch (e) { list.innerHTML = `<p class="muted">Comments didn't load.</p>`; }
  };
  await load();
  const form = el.querySelector(".compose");
  if (form) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ta = form.querySelector("textarea"), btn = form.querySelector("button");
    btn.disabled = true;
    try { await api("/api/comments", { method: "POST", body: { item, body: ta.value } }); ta.value = ""; await load(); }
    catch (err) { toast(err.message); }
    btn.disabled = false;
  });
  list.addEventListener("click", async (e) => {
    const art = e.target.closest("[data-cid]"); if (!art) return;
    const id = art.dataset.cid;
    try {
      if (e.target.closest("[data-cdel]")) { if (!confirm("Delete your comment?")) return; await api("/api/comments/" + id, { method: "DELETE" }); }
      else if (e.target.closest("[data-crep]")) { await api(`/api/comments/${id}/report`, { method: "POST" }); toast("Thanks. A moderator will look."); return; }
      else if (e.target.closest("[data-chide]")) { await api(`/api/comments/${id}/${e.target.closest("[data-chide]").dataset.chide}`, { method: "POST" }); }
      else return;
      await load();
    } catch (err) { toast(err.message); }
  });
}

export { loadStats, stats };
