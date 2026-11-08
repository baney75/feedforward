// Proof of work: fetch a challenge and solve it in a worker. onProgress gets an estimate from 0 to 1.
export async function proofOfWork(onProgress) {
  const r = await fetch("/api/pow");
  if (!r.ok) throw new Error(r.status === 429 ? "Too many tries. Wait a few minutes." : "Couldn't reach Feedforward. Check your connection.");
  const ch = await r.json(), expect = 2 ** ch.bits;
  return new Promise((res, rej) => {
    const w = new Worker("/js/pow-worker.js");
    w.onmessage = ({ data }) => {
      if (data.progress != null) { onProgress && onProgress(Math.min(0.95, 1 - Math.exp(-data.progress / expect))); return; }
      w.terminate(); onProgress && onProgress(1); res(data);
    };
    w.onerror = () => { w.terminate(); rej(new Error("Your browser couldn't finish the check. Try another browser.")); };
  });
}
