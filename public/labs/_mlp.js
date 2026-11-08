// A tiny multilayer perceptron for 2D binary classification, in plain JS.
// Hidden layers use tanh or ReLU; the output is one sigmoid unit trained with
// mean binary cross-entropy and full-batch gradient descent. Backprop by hand.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// sizes like [2, 8, 8, 1]. W[l] is out x in (row-major), b[l] has out entries.
export function createNet(sizes, act, seed = 1) {
  const r = rng(seed);
  const W = [], b = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const nin = sizes[l], nout = sizes[l + 1];
    const scale = act === "relu" && l < sizes.length - 2 ? Math.sqrt(2 / nin) : Math.sqrt(1 / nin);
    const w = new Float64Array(nout * nin);
    for (let i = 0; i < w.length; i++) w[i] = gauss(r) * scale;
    W.push(w);
    b.push(new Float64Array(nout).fill(act === "relu" && l < sizes.length - 2 ? 0.01 : 0));
  }
  return { sizes, act, W, b };
}

const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

// Forward one point. Returns activations per layer (a[0] is the input).
function forwardOne(net, x0, x1, keep) {
  const { sizes, W, b, act } = net;
  let a = keep ? [Float64Array.of(x0, x1)] : null;
  let prev = Float64Array.of(x0, x1);
  const L = sizes.length - 1;
  for (let l = 0; l < L; l++) {
    const nin = sizes[l], nout = sizes[l + 1], w = W[l], bl = b[l];
    const out = new Float64Array(nout);
    for (let j = 0; j < nout; j++) {
      let z = bl[j];
      const row = j * nin;
      for (let i = 0; i < nin; i++) z += w[row + i] * prev[i];
      out[j] = l === L - 1 ? sigmoid(z) : act === "tanh" ? Math.tanh(z) : z > 0 ? z : 0;
    }
    if (keep) a.push(out);
    prev = out;
  }
  return keep ? a : prev[0];
}

export const predict = (net, x, y) => forwardOne(net, x, y, false);

export function loss(net, X, Y) {
  let s = 0;
  for (let n = 0; n < Y.length; n++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, forwardOne(net, X[2 * n], X[2 * n + 1], false)));
    s -= Y[n] ? Math.log(p) : Math.log(1 - p);
  }
  return s / Y.length;
}

// Mean BCE loss and its exact gradient for the whole batch.
export function lossAndGrad(net, X, Y) {
  const { sizes, W, act } = net;
  const L = sizes.length - 1;
  const gW = W.map((w) => new Float64Array(w.length));
  const gb = net.b.map((v) => new Float64Array(v.length));
  const N = Y.length;
  let total = 0, correct = 0;
  for (let n = 0; n < N; n++) {
    const a = forwardOne(net, X[2 * n], X[2 * n + 1], true);
    const p = a[L][0];
    const pc = Math.min(1 - 1e-12, Math.max(1e-12, p));
    total -= Y[n] ? Math.log(pc) : Math.log(1 - pc);
    if ((p >= 0.5) === (Y[n] === 1)) correct++;
    // dLoss/dz at the sigmoid output is p - y.
    let delta = Float64Array.of((p - Y[n]) / N);
    for (let l = L - 1; l >= 0; l--) {
      const nin = sizes[l], nout = sizes[l + 1], ain = a[l], w = W[l];
      const gw = gW[l], gbl = gb[l];
      for (let j = 0; j < nout; j++) {
        const d = delta[j];
        gbl[j] += d;
        const row = j * nin;
        for (let i = 0; i < nin; i++) gw[row + i] += d * ain[i];
      }
      if (l > 0) {
        const nd = new Float64Array(nin);
        for (let i = 0; i < nin; i++) {
          let s = 0;
          for (let j = 0; j < nout; j++) s += w[j * nin + i] * delta[j];
          const ai = ain[i];
          nd[i] = act === "tanh" ? s * (1 - ai * ai) : ai > 0 ? s : 0;
        }
        delta = nd;
      }
    }
  }
  return { loss: total / N, acc: correct / N, gW, gb };
}

export function step(net, X, Y, lr) {
  const g = lossAndGrad(net, X, Y);
  for (let l = 0; l < net.W.length; l++) {
    const w = net.W[l], gw = g.gW[l], bl = net.b[l], gbl = g.gb[l];
    for (let i = 0; i < w.length; i++) w[i] -= lr * gw[i];
    for (let j = 0; j < bl.length; j++) bl[j] -= lr * gbl[j];
  }
  return g;
}

export const paramCount = (net) => net.W.reduce((s, w) => s + w.length, 0) + net.b.reduce((s, v) => s + v.length, 0);

// Datasets in [-1, 1]^2. Returns { X: Float64Array(2N), Y: Uint8Array(N) }.
export function makeData(kind, n = 200, seed = 7) {
  const r = rng(seed);
  const X = new Float64Array(2 * n), Y = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    let x, y, c;
    if (kind === "circle") {
      c = k % 2;
      const ang = r() * 2 * Math.PI;
      const rad = c ? r() * 0.45 : 0.65 + r() * 0.3;
      x = rad * Math.cos(ang); y = rad * Math.sin(ang);
    } else if (kind === "xor") {
      do { x = r() * 2 - 1; y = r() * 2 - 1; } while (Math.abs(x) < 0.06 || Math.abs(y) < 0.06);
      x *= 0.95; y *= 0.95;
      c = x * y > 0 ? 1 : 0;
    } else if (kind === "spiral") {
      c = k % 2;
      const t = (Math.floor(k / 2) / (n / 2)) * 1 + 0.05;
      const ang = t * 1.25 * 2 * Math.PI + c * Math.PI;
      const rad = t * 0.9;
      x = rad * Math.cos(ang) + gauss(r) * 0.025; y = rad * Math.sin(ang) + gauss(r) * 0.025;
    } else {
      c = k % 2;
      const cx = c ? 0.42 : -0.42, cy = c ? 0.38 : -0.38;
      x = cx + gauss(r) * 0.22; y = cy + gauss(r) * 0.22;
    }
    X[2 * k] = Math.max(-1, Math.min(1, x)); X[2 * k + 1] = Math.max(-1, Math.min(1, y)); Y[k] = c;
  }
  return { X, Y };
}
