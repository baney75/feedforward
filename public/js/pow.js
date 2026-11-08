// Proof of work. The challenge is fetched when a form appears (prepare), so the server's "a person takes a
// moment" check counts from when the form was shown. On submit it's solved in a worker, and if the person was
// faster than the minimum, the button waits out the rest instead of failing.
export function prepare() {
  const at = Date.now();
  const ch = fetch("/api/pow").then(async (r) => {
    if (!r.ok) throw new Error(r.status === 429 ? "Too many tries. Wait a few minutes." : "Couldn't reach Feedforward. Check your connection.");
    return r.json();
  });
  ch.catch(() => {});
  return { at, ch };
}

export async function proofOfWork(onProgress, { ready = null, minAge = 0 } = {}) {
  // A challenge older than 9 minutes is close to expiring; fetch a fresh one.
  let p = ready && Date.now() - ready.at < 540000 ? ready : prepare();
  let ch;
  try { ch = await p.ch; } catch (e) { p = prepare(); ch = await p.ch; }
  const expect = 2 ** ch.bits;
  const work = await new Promise((res, rej) => {
    const w = new Worker("/js/pow-worker.js");
    w.onmessage = ({ data }) => {
      if (data.progress != null) { onProgress && onProgress(Math.min(0.95, 1 - Math.exp(-data.progress / expect))); return; }
      w.terminate(); res(data);
    };
    w.onerror = () => { w.terminate(); rej(new Error("Your browser couldn't finish the check. Try another browser.")); };
    w.postMessage(ch);
  });
  // The server counts whole seconds from when it issued the challenge; leave a margin.
  const wait = minAge * 1000 + 1100 - (Date.now() - p.at);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  onProgress && onProgress(1);
  return work;
}
