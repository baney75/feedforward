// Suggest a person, video, book, paper, term or fix. Staff review every suggestion in the admin queue.
import { api, signedIn } from "/js/account.js";
import { esc, toast } from "/js/ui.js";

const KINDS = [["person", "A person or channel"], ["video", "A video"], ["book", "A free book"], ["paper", "A paper"], ["term", "A dictionary term"], ["fix", "Something to fix"], ["idea", "An idea"]];

export function render(el) {
  document.title = "Suggest · Feedforward";
  el.innerHTML = `<div class="prose"><h1 style="font-size:32px;margin:16px 0 8px">Suggest something</h1>
    <p class="muted">The list favors people who teach clearly and show their work, on AI, computer science and making. Every suggestion is read by a person.</p>
    ${signedIn() ? `<form class="suggest">
      <label class="field">What is it<select name="kind">${KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
      <label class="field">Link (optional)<input name="url" type="url" inputmode="url" placeholder="https://" maxlength="300"></label>
      <label class="field">Why it belongs here<textarea name="body" rows="4" maxlength="1500" required placeholder="One or two sentences"></textarea></label>
      <button class="btn primary" type="submit">Send suggestion</button></form>`
      : `<p><a class="btn primary" href="/me">Get a free code to suggest</a></p><p class="muted">Or open an issue on <a href="https://github.com/baney75/feedforward/issues/new/choose">GitHub</a>.</p>`}</div>`;
  const f = el.querySelector(".suggest");
  if (f) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const b = f.querySelector("button"); b.disabled = true;
    try { await api("/api/suggest", { method: "POST", body: d }); f.reset(); toast("Thank you. It's in the queue."); }
    catch (err) { toast(err.message); }
    b.disabled = false;
  });
}
