import { h, scopeStyle, slider, segmented, stat, learnSections, rgbOf, css, mix, onTheme, reducedMotion, nextId, code, p } from "./_kit.js";
import { createNet, makeData, step, predict, paramCount } from "./_mlp.js";

export const meta = {
  slug: "neural-net",
  title: "Train a tiny neural network",
  blurb: "Watch a small network learn to separate two kinds of points, one gradient step at a time.",
  minutes: 8,
  topic: "foundations",
};

const GRID = 48;            // boundary resolution (GRID x GRID predictions per frame)
const HIST = 600;           // loss points kept for the sparkline
const LRS = [0.003, 0.01, 0.03, 0.1, 0.3, 1, 3];
const FRAME_BUDGET_MS = 7;

const STYLE = `
& .wrap { display: grid; gap: var(--s5); grid-template-columns: 1fr; align-items: start; }
@media (min-width: 720px) { & .wrap { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); } }
& .plot { position: relative; width: 100%; max-width: 440px; aspect-ratio: 1 / 1; justify-self: center; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--bg); }
& .plot canvas { display: block; width: 100%; height: 100%; }
& .side { display: grid; gap: var(--s4); min-width: 0; }
& .play { display: flex; flex-wrap: wrap; gap: var(--s2); }
& .play .btn { min-width: 84px; }
& .spark { display: grid; gap: var(--s1); }
& .spark canvas { display: block; width: 100%; height: 56px; border: 1px solid var(--line); border-radius: var(--r-s); background: var(--bg); }
& .key { display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); font-size: var(--t-s); color: var(--fg-2); margin: 0; }
& .key i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; }
& .key .a i { background: var(--accent); border-radius: 50%; }
& .key .b i { background: var(--fg); border-radius: 2px; }
& .arch { font: 400 var(--t-s)/1.4 var(--mono); color: var(--fg-2); margin: 0; }
& .field select { font: 400 var(--t-m)/1.4 var(--font); }
`;

export function mount(root, ctx) {
  scopeStyle(root, meta.slug, STYLE);
  const state = { data: "circle", layers: 2, width: 6, act: "tanh", lrIdx: 4, running: false, epoch: 0, seed: 1 };
  let histStride = 1;
  let net, D, hist = [], lastLoss = NaN, lastAcc = NaN, raf = 0, colors;

  // Canvases
  const plot = h("canvas", { role: "img", "aria-label": "Decision boundary and data points" });
  const spark = h("canvas", { role: "img", "aria-label": "Loss over training" });
  const off = document.createElement("canvas");
  off.width = off.height = GRID;
  const offCtx = off.getContext("2d");
  const img = offCtx.createImageData(GRID, GRID);

  // Controls
  const dataSeg = segmented({ label: "Dataset", value: state.data, options: [["circle", "Circle"], ["xor", "XOR"], ["spiral", "Spiral"], ["blobs", "Two blobs"]], onchange: (v) => { state.data = v; newData(); } });
  const actSeg = segmented({ label: "Activation", value: state.act, options: [["tanh", "tanh"], ["relu", "ReLU"]], onchange: (v) => { state.act = v; reset(); } });
  const layerSeg = segmented({ label: "Hidden layers", value: String(state.layers), options: [["1", "1"], ["2", "2"], ["3", "3"]], onchange: (v) => { state.layers = +v; reset(); } });
  const widthSl = slider({ label: "Neurons per layer", min: 2, max: 16, step: 1, value: state.width, oninput: (v) => { state.width = v; reset(); } });
  const lrId = nextId("lr");
  const lrSel = h("select", { id: lrId }, LRS.map((v, i) => h("option", { value: i, selected: i === state.lrIdx }, String(v))));
  lrSel.addEventListener("change", () => { state.lrIdx = +lrSel.value; });
  const playBtn = h("button", { type: "button", class: "btn primary", "aria-pressed": "false", onclick: () => setRunning(!state.running) }, "Play");
  const stepBtn = h("button", { type: "button", class: "btn", onclick: () => { setRunning(false); train(1); draw(); } }, "Step");
  const resetBtn = h("button", { type: "button", class: "btn", onclick: () => { setRunning(false); reset(); } }, "Reset");

  const sEpoch = stat("Epoch", "0"), sLoss = stat("Loss", ""), sAcc = stat("Accuracy", "");
  const arch = h("p", { class: "arch" });
  const live = h("p", { class: "sr-only", "aria-live": "polite" });

  const stage = h("div", { class: "stage" },
    h("div", { class: "wrap" },
      h("div", { class: "stage" },
        h("div", { class: "plot" }, plot),
        h("p", { class: "key" }, h("span", { class: "a" }, h("i"), "Class A"), h("span", { class: "b" }, h("i"), "Class B"), h("span", null, "Shading shows what the network predicts")),
      ),
      h("div", { class: "side" },
        dataSeg.el,
        h("div", { class: "row", style: { gap: "var(--s4)", alignItems: "flex-end" } }, layerSeg.el, actSeg.el),
        widthSl.el,
        h("div", { class: "field" }, h("label", { for: lrId }, "Learning rate"), lrSel),
        h("div", { class: "play" }, playBtn, stepBtn, resetBtn),
        h("div", { class: "stats" }, sEpoch.el, sLoss.el, sAcc.el),
        h("div", { class: "spark" }, h("span", { class: "lbl" }, "Loss"), spark),
        arch,
        live,
      ),
    ),
  );

  const learn = learnSections({
    happening: [
      "The network takes a point's two coordinates and outputs one number between 0 and 1: its guess that the point is class A. Each hidden neuron computes a weighted sum of the layer before it, adds a bias, and passes the result through tanh or ReLU.",
      p("Loss is the average binary cross-entropy, ", code("-[y log p + (1 - y) log(1 - p)]"), ". It is 0.693 when every guess is 0.5 and falls toward 0 as guesses get confident and right."),
      "Each epoch runs every point through the network, then backpropagation applies the chain rule layer by layer to get the exact slope of the loss for every weight. Gradient descent moves each weight a small step downhill: the learning rate times its slope.",
      "Without the bending functions, any stack of layers would collapse into one straight line. tanh and ReLU let the boundary curve, and more neurons let it curve in more places.",
    ],
    tryThis: [
      "Pick Spiral with 1 hidden layer of 2 neurons and press Play. Then try 3 layers of 8 and compare the shapes.",
      "On XOR, set the learning rate to 3. Watch the loss line jump around, then drop it to 0.1 and press Reset.",
      "Switch between tanh and ReLU on Circle. ReLU boundaries are built from straight pieces; tanh boundaries are smooth.",
    ],
    check: {
      q: "You raise the learning rate a lot and the loss starts jumping up and down instead of falling. Why?",
      options: [
        { text: "The network ran out of neurons.", right: false, why: "The number of neurons did not change. The size of each update did." },
        { text: "Each step is so big it jumps past the low point and lands higher up the other side.", right: true, why: "The gradient only describes the slope right where the weights are. A huge step overshoots the valley, so the loss can rise, and the next step overshoots back." },
        { text: "A high learning rate adds random noise to the data.", right: false, why: "The data never changes during training. Full-batch gradient descent is deterministic: the same weights and data always give the same step." },
      ],
    },
  }, ctx);

  root.append(stage, learn);

  function readColors() {
    colors = { bg: rgbOf(root, "--bg"), fg: rgbOf(root, "--fg"), fg2: rgbOf(root, "--fg-2"), accent: rgbOf(root, "--accent"), line: rgbOf(root, "--line") };
  }

  function newData() {
    D = makeData(state.data, 200, { circle: 11, xor: 12, spiral: 13, blobs: 14 }[state.data]);
    reset();
  }

  function reset() {
    state.seed = (state.seed * 1103515245 + 12345) >>> 0 || 1;
    const sizes = [2, ...new Array(state.layers).fill(state.width), 1];
    net = createNet(sizes, state.act, state.seed);
    state.epoch = 0;
    hist = [];
    histStride = 1;
    lastLoss = NaN; lastAcc = NaN;
    arch.textContent = `Layers ${sizes.join(" → ")}, ${paramCount(net)} weights and biases`;
    draw();
  }

  function train(n) {
    const lr = LRS[state.lrIdx];
    let g;
    for (let k = 0; k < n; k++) {
      g = step(net, D.X, D.Y, lr);
      state.epoch++;
      // Keep the whole run: when full, average neighbors and record half as often.
      if (state.epoch % histStride === 0) hist.push(g.loss);
      if (hist.length >= HIST) {
        const half = [];
        for (let i = 0; i + 1 < hist.length; i += 2) half.push((hist[i] + hist[i + 1]) / 2);
        hist = half;
        histStride *= 2;
      }
    }
    if (g) { lastLoss = g.loss; lastAcc = g.acc; }
  }

  function sizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    return [w, hh, dpr];
  }

  function draw() {
    if (!colors) readColors();
    const { bg, fg, accent, line } = colors;
    // Boundary heatmap on a small grid, then scaled up with smoothing.
    const px = img.data;
    for (let gy = 0; gy < GRID; gy++) {
      const y = 1 - (2 * (gy + 0.5)) / GRID;
      for (let gx = 0; gx < GRID; gx++) {
        const x = (2 * (gx + 0.5)) / GRID - 1;
        const pr = predict(net, x, y);
        const conf = Math.abs(pr - 0.5) * 2;
        const c = mix(bg, pr >= 0.5 ? accent : fg, 0.04 + 0.2 * conf);
        const o = 4 * (gy * GRID + gx);
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    const [W, H, dpr] = sizeCanvas(plot);
    const g = plot.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, W, H);
    // Axes through the origin, faint.
    g.strokeStyle = css(line, 0.9);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    // Points: class A amber circles, class B squares in the text color.
    const r = Math.max(2.5, W / 110);
    for (let n = 0; n < D.Y.length; n++) {
      const cx = ((D.X[2 * n] + 1) / 2) * W, cy = ((1 - D.X[2 * n + 1]) / 2) * H;
      g.fillStyle = css(D.Y[n] ? accent : fg);
      g.strokeStyle = css(bg);
      g.lineWidth = 1.25 * dpr;
      g.beginPath();
      if (D.Y[n]) g.arc(cx, cy, r, 0, Math.PI * 2);
      else g.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8);
      g.fill(); g.stroke();
    }
    drawSpark();
    sEpoch.set(String(state.epoch));
    sLoss.set(Number.isFinite(lastLoss) ? lastLoss.toFixed(3) : "n/a");
    sAcc.set(Number.isFinite(lastAcc) ? `${(lastAcc * 100).toFixed(0)}%` : "n/a");
    const desc = `${state.data} dataset, epoch ${state.epoch}` + (Number.isFinite(lastLoss) ? `, loss ${lastLoss.toFixed(3)}, accuracy ${(lastAcc * 100).toFixed(0)} percent` : ", not trained yet");
    plot.setAttribute("aria-label", `Decision boundary and 200 data points. ${desc}.`);
    spark.setAttribute("aria-label", Number.isFinite(lastLoss) ? `Loss over ${state.epoch} epochs, now ${lastLoss.toFixed(3)}` : "Loss over training, no data yet");
  }

  function drawSpark() {
    const [W, H, dpr] = sizeCanvas(spark);
    const g = spark.getContext("2d");
    g.clearRect(0, 0, W, H);
    if (hist.length < 2) return;
    const top = Math.max(0.8, ...hist);
    const pad = 4 * dpr;
    // Reference line at 0.693, the loss of guessing 0.5 everywhere.
    const yRef = pad + (1 - Math.log(1 + 0.693) / Math.log(1 + top)) * (H - 2 * pad);
    g.strokeStyle = css(colors.line); g.lineWidth = 1; g.setLineDash([3 * dpr, 3 * dpr]);
    g.beginPath(); g.moveTo(0, yRef); g.lineTo(W, yRef); g.stroke(); g.setLineDash([]);
    g.strokeStyle = css(colors.accent); g.lineWidth = 1.5 * dpr; g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = (i / Math.max(1, hist.length - 1)) * W;
      const y = pad + (1 - Math.log(1 + hist[i]) / Math.log(1 + top)) * (H - 2 * pad);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  function frame() {
    if (!state.running) return;
    const t0 = performance.now();
    let n = 0;
    while (n < 40 && performance.now() - t0 < FRAME_BUDGET_MS) { train(1); n++; }
    draw();
    if (state.epoch % 250 < n) live.textContent = `Epoch ${state.epoch}, loss ${lastLoss.toFixed(3)}`;
    raf = requestAnimationFrame(frame);
  }

  function setRunning(on) {
    state.running = on;
    playBtn.textContent = on ? "Pause" : "Play";
    playBtn.setAttribute("aria-pressed", String(on));
    cancelAnimationFrame(raf);
    if (on) raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(plot);
  const stopTheme = onTheme(() => { readColors(); draw(); });
  readColors();
  newData();
  // Autoplay gives the lesson motion, unless the learner asked for less.
  if (!reducedMotion()) setRunning(true);

  return () => { state.running = false; cancelAnimationFrame(raf); ro.disconnect(); stopTheme(); };
}
