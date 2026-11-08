import { h, fmt, lessonCSS, renderLesson, readVars, watchTheme } from "./lab-kit.js";

export const meta = {
  slug: "slicer",
  title: "How a 3D printer builds a part",
  blurb: "Slice a part into layers, change the nozzle and layer height, and see time, detail, and overhangs change.",
  minutes: 8,
  topic: "3d-printing",
};

const INFILL = 0.15;  // sparse infill density
const WALLS = 2;      // perimeter loops on solid parts
const EPS = 1e-6;

// Monotone-friendly cubic Hermite through points (z, r) with finite-difference tangents.
function hermite(zs, rs) {
  const n = zs.length;
  const m = zs.map((_, i) => i === 0 ? (rs[1] - rs[0]) / (zs[1] - zs[0])
    : i === n - 1 ? (rs[n - 1] - rs[n - 2]) / (zs[n - 1] - zs[n - 2])
    : (rs[i + 1] - rs[i - 1]) / (zs[i + 1] - zs[i - 1]));
  return (z) => {
    let i = 0;
    while (i < n - 2 && z > zs[i + 1]) i++;
    const hgt = zs[i + 1] - zs[i];
    const t = Math.min(1, Math.max(0, (z - zs[i]) / hgt));
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * rs[i] + (t3 - 2 * t2 + t) * hgt * m[i] + (-2 * t3 + 3 * t2) * rs[i + 1] + (t3 - t2) * hgt * m[i + 1];
  };
}
const vaseR = hermite([0, 10, 24, 40, 50, 56, 60], [17, 25, 27, 17, 13.5, 16, 21]);

// Path length (mm) for one layer of a solid part: rectangles of width w (in the view) by depth D.
function solidPath(intervals, D, lw) {
  let walls = 0, infill = 0;
  for (const [a, b] of intervals) {
    const w = b - a;
    for (let k = 0; k < WALLS; k++) {
      const ins = (k + 0.5) * lw;
      if (w - 2 * ins > 0 && D - 2 * ins > 0) walls += 2 * ((w - 2 * ins) + (D - 2 * ins));
    }
    const wi = w - 2 * WALLS * lw, di = D - 2 * WALLS * lw;
    if (wi > 0 && di > 0) infill += (wi * di * INFILL) / lw;
  }
  return { walls, infill };
}

const PARTS = {
  vase: {
    name: "Vase",
    H: 60, base: 1.2,
    xRange: () => [-30, 30],
    section(z, s) {
      const r = vaseR(z);
      if (z < this.base) return [[-r, r]];
      return [[-r, -r + s.wall], [r - s.wall, r]];
    },
    path(z, s) {
      const r = vaseR(z);
      if (z < this.base) return { walls: 2 * Math.PI * (r - s.lw / 2), infill: (Math.PI * r * r) / s.lw };
      const n = Math.floor(s.wall / s.lw + EPS);
      return { walls: n * 2 * Math.PI * (r - s.wall / 2), infill: 0 };
    },
    focus: () => [vaseR(57), 57],
    desc: "a hollow vase, 60 mm tall, with a solid 1.2 mm floor",
  },
  overhang: {
    name: "Overhang test",
    H: 28,
    xRange: (s) => [0, Math.max(40, 14 + 20 * Math.tan(s.angle * Math.PI / 180))],
    section(z, s) {
      if (z < 8) return [[0, 14]];
      const sh = (z - 8) * Math.tan(s.angle * Math.PI / 180);
      return [[sh, sh + 14]];
    },
    path(z, s) { return solidPath(this.section(z, s), 10, s.lw); },
    focus: (s) => [14 + 10 * Math.tan(s.angle * Math.PI / 180), 18],
    desc: "a 14 by 10 mm pillar that leans after the first 8 mm",
  },
  bracket: {
    name: "Bracket",
    H: 40,
    xRange: () => [0, 50],
    section(z) {
      if (z < 6) return [[0, 50]];
      const dz = z - 26;
      if (Math.abs(dz) < 4) {
        const c = Math.sqrt(16 - dz * dz);
        return [[0, 7 - c], [7 + c, 14]];
      }
      return [[0, 14]];
    },
    path(z, s) { return solidPath(this.section(z, s), 20, s.lw); },
    focus: () => [7, 29.2],
    desc: "an L bracket, 20 mm deep, with an 8 mm hole through the upright",
  },
};

// Slice: one entry per layer with its intervals, path, and how far it sticks out past the layer below.
function slice(part, s) {
  const n = Math.ceil(part.H / s.lh - EPS);
  const layers = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const z = Math.min(part.H - EPS, (i + 0.5) * s.lh);
    const iv = part.section(z, s);
    let out = 0;
    if (prev) {
      for (const [a, b] of iv) {
        const cands = [a, b];
        for (let j = 0; j + 1 < prev.length; j++) {
          const m = (prev[j][1] + prev[j + 1][0]) / 2;
          if (m > a && m < b) cands.push(m);
        }
        for (const x of cands) {
          let d = Infinity;
          for (const [pa, pb] of prev) d = Math.min(d, Math.max(0, pa - x, x - pb));
          out = Math.max(out, d);
        }
      }
    }
    const p = part.path(z, s);
    layers.push({ i, z0: i * s.lh, iv, out, angle: Math.atan2(out, s.lh) * 180 / Math.PI, flagged: out > s.lh + EPS, ...p });
    prev = iv;
  }
  return layers;
}

function fmtTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const CSS = `
.lab-slicer { font: 400 var(--t-m)/1.5 var(--font); color: var(--fg); }
.lab-slicer * { box-sizing: border-box; }
.lab-slicer fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.lab-slicer legend, .lab-slicer .sl-lab { font-size: var(--t-s); color: var(--fg-2); padding: 0; margin-bottom: var(--s2); display: flex; justify-content: space-between; gap: var(--s2); width: 100%; }
.lab-slicer .sl-lab output { font: 500 var(--t-s)/1.4 var(--mono); color: var(--fg); }
.lab-slicer .sl-seg { display: flex; border: 1px solid var(--line); border-radius: var(--r-pill); padding: 3px; gap: 2px; background: var(--bg-2); }
.lab-slicer .sl-seg label { position: relative; flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 var(--s2);
  border-radius: var(--r-pill); font: 500 var(--t-s)/1.1 var(--font); color: var(--fg-2); cursor: pointer; text-align: center; }
.lab-slicer .sl-seg input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.lab-slicer .sl-seg label:has(input:checked) { background: var(--bg-3); color: var(--fg); }
.lab-slicer .sl-seg label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.lab-slicer .sl-seg.mono label { font-family: var(--mono); }
.lab-slicer .sl-part { margin-bottom: var(--s4); }
.lab-slicer .sl-views { display: grid; gap: var(--s3); align-items: start; }
@media (min-width: 720px) { .lab-slicer .sl-views { grid-template-columns: minmax(0, 1fr) 240px; } }
.lab-slicer .sl-view { position: relative; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-2); overflow: hidden; }
.lab-slicer .sl-view canvas { display: block; width: 100%; }
.lab-slicer .sl-cap { display: flex; justify-content: space-between; gap: var(--s2); padding: var(--s2) var(--s3); border-top: 1px solid var(--line); font-size: var(--t-xs); color: var(--fg-2); }
.lab-slicer .sl-key { display: inline-flex; align-items: center; gap: 6px; }
.lab-slicer .sl-key i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.lab-slicer .sl-controls { display: grid; gap: var(--s4); margin-top: var(--s4); }
@media (min-width: 720px) { .lab-slicer .sl-controls { grid-template-columns: 1fr 1fr; column-gap: var(--s6); } }
.lab-slicer input[type="range"] { height: 32px; margin: 0; }
.lab-slicer .sl-range-ends { display: flex; justify-content: space-between; font: 400 var(--t-xs)/1 var(--mono); color: var(--fg-2); }
.lab-slicer .sl-readout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s3) var(--s4); margin-top: var(--s5); }
@media (min-width: 720px) { .lab-slicer .sl-readout { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.lab-slicer .sl-stat { border-top: 1px solid var(--line); padding-top: var(--s2); min-width: 0; }
.lab-slicer .sl-stat span { display: block; font-size: var(--t-xs); color: var(--fg-2); }
.lab-slicer .sl-stat b { display: block; font: 500 var(--t-l)/1.3 var(--mono); }
.lab-slicer .sl-stat small { display: block; font-size: var(--t-xs); color: var(--fg-2); }
.lab-slicer .sl-stat.warn b { color: var(--bad); }
.lab-slicer .sl-notes { margin: var(--s4) 0 0; padding: 0; list-style: none; display: grid; gap: var(--s2); }
.lab-slicer .sl-notes li { padding: var(--s2) var(--s3); border-left: 3px solid var(--line); background: var(--bg-2); border-radius: 0 var(--r-s) var(--r-s) 0; font-size: var(--t-s); }
.lab-slicer .sl-notes li.warn { border-left-color: var(--bad); }
.lab-slicer .sl-notes li.info { border-left-color: var(--accent); }
.lab-slicer .sl-fine { margin: var(--s3) 0 0; font-size: var(--t-xs); color: var(--fg-2); max-width: 70ch; }
.lab-slicer [hidden] { display: none !important; }
${lessonCSS("lab-slicer")}
`;

export function mount(root, ctx) {
  root.classList.add("lab-slicer");
  root.append(h("style", { text: CSS }));

  const s = { part: "vase", lh: 0.2, nozzle: 0.4, lw: 0.4, speed: 100, angle: 40, wall: 0.8 };

  // Controls
  const seg = (name, opts, cur, onPick, extra = "") => h("div", { class: `sl-seg ${extra}` }, opts.map(([v, t]) => {
    const input = h("input", { type: "radio", name, value: String(v), checked: String(v) === String(cur) });
    input.addEventListener("change", () => onPick(v));
    return h("label", {}, input, t);
  }));
  const partSeg = h("fieldset", { class: "sl-part" }, h("legend", { text: "Part" }),
    seg("sl-part", Object.entries(PARTS).map(([k, p]) => [k, p.name]), s.part, (v) => { s.part = v; update(); }));

  const slider = (id, label, min, max, step, val, unit, digits, onInput) => {
    const out = h("output", { for: id });
    const input = h("input", { type: "range", id, min, max, step, value: val });
    const set = () => { out.textContent = `${fmt(Number(input.value), digits)}${unit === "\u00b0" ? "" : " "}${unit}`; };
    input.addEventListener("input", () => { set(); onInput(Number(input.value)); });
    set();
    const wrap = h("div", {}, h("label", { class: "sl-lab", for: id }, h("span", { text: label }), out), input,
      h("div", { class: "sl-range-ends", "aria-hidden": "true" }, h("span", { text: `${fmt(min, digits)}` }), h("span", { text: `${fmt(max, digits)}` })));
    return wrap;
  };
  const lhCtl = slider("sl-lh", "Layer height", 0.08, 0.32, 0.04, s.lh, "mm", 2, (v) => { s.lh = v; update(); });
  const spCtl = slider("sl-speed", "Print speed", 20, 300, 10, s.speed, "mm/s", 0, (v) => { s.speed = v; update(); });
  const angCtl = slider("sl-angle", "Overhang angle from vertical", 0, 75, 1, s.angle, "°", 0, (v) => { s.angle = v; update(); });
  const wallCtl = slider("sl-wall", "Vase wall thickness", 0.3, 2.0, 0.1, s.wall, "mm", 1, (v) => { s.wall = v; update(); });
  const nozCtl = h("fieldset", {}, h("legend", { text: "Nozzle diameter (mm)" }),
    seg("sl-noz", [[0.2, "0.2"], [0.4, "0.4"], [0.6, "0.6"], [0.8, "0.8"]], s.nozzle, (v) => { s.nozzle = v; s.lw = v; update(); }, "mono"));

  // Views
  const main = h("canvas", { role: "img" });
  const zoom = h("canvas", { role: "img" });
  const mainCap = h("div", { class: "sl-cap" },
    h("span", { class: "sl-key" }, h("i", { class: "k-ok" }), "Layer"),
    h("span", { class: "sl-key" }, h("i", { class: "k-bad" }), "Over 45°, needs support"),
    h("span", { class: "sl-key" }, h("i", { class: "k-zoom" }), "Zoom area"));
  const zoomCap = h("div", { class: "sl-cap" }, h("span", { text: "Zoom: 6 mm wide" }), h("span", { class: "sl-key" }, h("i", { class: "k-line" }), "designed surface"));

  const readout = h("div", { class: "sl-readout", "aria-live": "polite" });
  const notes = h("ul", { class: "sl-notes", "aria-live": "polite" });

  root.append(
    partSeg,
    h("div", { class: "sl-views" },
      h("figure", { class: "sl-view", style: { margin: 0 } }, main, mainCap),
      h("figure", { class: "sl-view", style: { margin: 0 } }, zoom, zoomCap)),
    readout,
    h("div", { class: "sl-controls" }, lhCtl, nozCtl, spCtl, angCtl, wallCtl),
    notes,
    h("p", { class: "sl-fine", text: `Simplified estimate: total path length divided by print speed. Walls are ${WALLS} loops; infill is ${INFILL * 100}% of the inside area divided by the line width. It ignores acceleration, travel moves, cooling pauses, and the solid floors and roofs a slicer adds, so real prints take longer.` }),
  );

  let C = {};
  const readColors = () => {
    C = readVars(root, ["bg", "bg-2", "bg-3", "line", "fg", "fg-2", "accent", "accent-text", "bad", "ok"]);
    C.mono = getComputedStyle(root).getPropertyValue("--mono").trim() || "monospace";
    const sw = (sel, css) => mainCap.querySelector(sel)?.setAttribute("style", css);
    sw(".k-ok", `background:${C["fg-2"]}`);
    sw(".k-bad", `background:${C.bad}`);
    sw(".k-zoom", `border:1.5px solid ${C.accent}`);
    zoomCap.querySelector(".k-line").setAttribute("style", `background:${C.accent};height:2px`);
  };

  let layers = [];
  let raf = 0;

  function sizeCanvas(cv, cssH) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = cv.parentElement.clientWidth;
    cv.style.height = cssH + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, hgt: cssH };
  }

  function drawMain() {
    const part = PARTS[s.part];
    const cw = main.parentElement.clientWidth;
    const { g, w, hgt } = sizeCanvas(main, Math.round(Math.min(380, Math.max(260, cw * 0.62))));
    g.clearRect(0, 0, w, hgt);
    const [x0, x1] = part.xRange(s);
    const pad = { l: 16, r: 16, t: 24, b: 30 };
    const sc = Math.min((w - pad.l - pad.r) / (x1 - x0), (hgt - pad.t - pad.b) / part.H);
    const ox = pad.l + ((w - pad.l - pad.r) - (x1 - x0) * sc) / 2 - x0 * sc;
    const by = hgt - pad.b;
    const X = (x) => ox + x * sc, Y = (z) => by - z * sc;
    // bed
    g.fillStyle = C.line; g.fillRect(8, by, w - 16, 2);
    g.fillStyle = C["fg-2"]; g.font = `11px ${C.mono}`; g.textBaseline = "top";
    g.fillText("print bed", 10, by + 8);
    // layers
    const lpx = s.lh * sc;
    const gap = lpx >= 3.5 ? 1 : 0;
    for (const L of layers) {
      const y = Y(L.z0 + s.lh);
      const thin = s.part === "vase" && L.z0 >= part.base && Math.floor(s.wall / s.lw + EPS) === 0;
      g.fillStyle = L.flagged ? C.bad : C["fg-2"];
      g.globalAlpha = thin ? 0.25 : L.flagged ? 0.95 : 0.6;
      for (const [a, b] of L.iv) g.fillRect(X(a), y, Math.max(1, (b - a) * sc), Math.max(0.6, lpx - gap));
    }
    g.globalAlpha = 1;
    // zoom box
    const [fx, fz] = part.focus(s);
    const zw = 6, zh = 6 * (zoomH() / Math.max(1, zoom.parentElement.clientWidth));
    g.strokeStyle = C.accent; g.lineWidth = 1.5;
    g.strokeRect(X(fx - zw / 2), Y(fz + zh / 2), zw * sc, zh * sc);
    // height label
    g.fillStyle = C["fg-2"]; g.textBaseline = "alphabetic"; g.textAlign = "right";
    g.fillText(`${part.H} mm tall`, w - 10, 16);
    g.textAlign = "left";
  }

  const zoomH = () => (zoom.parentElement.clientWidth < 400 ? 200 : 240);

  function drawZoom() {
    const part = PARTS[s.part];
    const { g, w, hgt } = sizeCanvas(zoom, zoomH());
    g.clearRect(0, 0, w, hgt);
    const [fx, fz] = part.focus(s);
    const sc = w / 6;
    const zr = hgt / sc;
    const xa = fx - 3, za = fz - zr / 2;
    const X = (x) => (x - xa) * sc, Y = (z) => hgt - (z - za) * sc;
    // designed shape, sampled finely
    g.fillStyle = C["bg-3"];
    const dz = 0.02;
    for (let z = Math.max(0, za); z < Math.min(part.H, za + zr); z += dz) {
      for (const [a, b] of part.section(z, s)) g.fillRect(X(a), Y(z + dz), (b - a) * sc, dz * sc + 0.6);
    }
    // beads
    const lw = s.lw, lh = s.lh, rad = Math.min(lw, lh) * sc * 0.45;
    const bead = (cx, z0, flagged) => {
      g.fillStyle = flagged ? C.bad : C["fg-2"];
      g.globalAlpha = flagged ? 0.9 : 0.75;
      g.beginPath();
      g.roundRect(X(cx - lw / 2) + 0.5, Y(z0 + lh) + 0.5, lw * sc - 1, lh * sc - 1, rad);
      g.fill();
    };
    for (const L of layers) {
      if (L.z0 + lh < za || L.z0 > za + zr) continue;
      for (const [a, b] of L.iv) {
        const width = b - a;
        if (s.part === "vase" && L.z0 >= part.base) {
          const n = Math.floor(s.wall / lw + EPS);
          // lines centered in the designed wall
          const start = a + (width - n * lw) / 2;
          for (let k = 0; k < n; k++) bead(start + (k + 0.5) * lw, L.z0, L.flagged);
        } else {
          for (let k = 0; k < WALLS; k++) {
            if (width < (2 * k + 1) * lw) break;
            bead(a + (k + 0.5) * lw, L.z0, L.flagged);
            if (width >= (2 * k + 2) * lw) bead(b - (k + 0.5) * lw, L.z0, L.flagged);
          }
        }
      }
    }
    g.globalAlpha = 1;
    // designed surface outline
    g.strokeStyle = C.accent; g.lineWidth = 1.5;
    const edges = new Map();
    for (let z = Math.max(0, za); z <= Math.min(part.H, za + zr); z += 0.02) {
      part.section(z, s).forEach(([a, b], j) => {
        for (const [k, x] of [[`${j}a`, a], [`${j}b`, b]]) {
          if (!edges.has(k)) edges.set(k, []);
          edges.get(k).push([X(x), Y(z)]);
        }
      });
    }
    for (const pts of edges.values()) {
      g.beginPath();
      pts.forEach(([x, y], i) => {
        if (i && Math.abs(y - pts[i - 1][1]) > 3) g.moveTo(x, y); else if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
    }
    // 1 mm scale bar
    g.font = `11px ${C.mono}`;
    const lblW = g.measureText("1 mm").width;
    g.fillStyle = C["bg-2"]; g.globalAlpha = 0.9;
    g.beginPath(); g.roundRect(4, hgt - 26, sc + lblW + 20, 22, 4); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = C.fg; g.fillRect(10, hgt - 16, sc, 2);
    g.fillStyle = C["fg-2"]; g.textBaseline = "middle"; g.fillText("1 mm", 16 + sc, hgt - 15);
  }

  function update() {
    const part = PARTS[s.part];
    angCtl.hidden = s.part !== "overhang";
    wallCtl.hidden = s.part !== "vase";
    layers = slice(part, s);
    const flagged = layers.filter((L) => L.flagged);
    const steep = layers.reduce((m, L) => Math.max(m, L.angle), 0);
    const walls = layers.reduce((a, L) => a + L.walls, 0);
    const infill = layers.reduce((a, L) => a + L.infill, 0);
    const secs = (walls + infill) / s.speed;

    readout.replaceChildren(
      stat("Layers", fmt(layers.length), `${fmt(s.lh, 2)} mm each`),
      stat("Estimated time", fmtTime(secs), "simplified, see note"),
      stat("Nozzle path", `${fmt((walls + infill) / 1000, 1)} m`, `walls ${fmt(walls / 1000, 1)} m, infill ${fmt(infill / 1000, 1)} m`),
      stat("Layers over 45°", flagged.length ? fmt(flagged.length) : "none",
        flagged.length ? `steepest about ${fmt(Math.min(89, steep))}°` : `steepest ${fmt(steep)}°`, flagged.length > 0),
    );

    const list = [];
    if (s.part === "overhang") {
      const step = s.lh * Math.tan(s.angle * Math.PI / 180);
      const rest = Math.max(0, 1 - step / s.lw);
      list.push([s.angle > 45 ? "warn" : "info",
        `Each layer steps out ${fmt(step, 2)} mm past the one below. With ${fmt(s.lw, 1)} mm lines, ${fmt(rest * 100)}% of the edge line rests on the layer below.${s.angle > 45 ? " The rest hangs in air and droops without support." : ""}`]);
    }
    if (s.part === "vase") {
      const n = Math.floor(s.wall / s.lw + EPS);
      list.push(n === 0
        ? ["warn", `The ${fmt(s.wall, 1)} mm wall is thinner than one ${fmt(s.lw, 1)} mm line. The slicer will skip it or print it thicker than designed.`]
        : ["info", `The ${fmt(s.wall, 1)} mm wall fits ${n} line${n > 1 ? "s" : ""} of ${fmt(s.lw, 1)} mm.${s.wall - n * s.lw > 0.05 ? ` The slicer stretches the lines to cover the extra ${fmt(s.wall - n * s.lw, 1)} mm.` : ""}`]);
    }
    if (s.part === "bracket" && flagged.length) {
      list.push(["info", "The top of the round hole passes 45°. Short spans like this often bridge, but the top edge sags. Designers use a teardrop-shaped hole or print with the hole pointing up."]);
    }
    if (s.lh > 0.75 * s.nozzle + EPS) {
      list.push(["warn", `A ${fmt(s.lh, 2)} mm layer is more than 75% of the ${fmt(s.nozzle, 1)} mm nozzle. Layers that thick bond poorly. That 75% is a common rule of thumb.`]);
    }
    notes.replaceChildren(...list.map(([c, t]) => h("li", { class: c, text: t })));

    main.setAttribute("aria-label", `Side view of ${part.desc}, sliced into ${layers.length} layers of ${fmt(s.lh, 2)} mm. ${flagged.length ? `${flagged.length} layers overhang more than 45 degrees and are shown in red.` : "No layer overhangs more than 45 degrees."}`);
    zoom.setAttribute("aria-label", `Close-up, 6 mm wide, showing each printed line as a ${fmt(s.lw, 1)} by ${fmt(s.lh, 2)} mm bead against the designed surface.`);
    schedule();
  }

  function stat(label, value, sub, warn) {
    return h("div", { class: `sl-stat${warn ? " warn" : ""}` }, h("span", { text: label }), h("b", { text: value }), h("small", { text: sub }));
  }

  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { drawMain(); drawZoom(); });
  }

  readColors();
  update();
  const ro = new ResizeObserver(() => schedule());
  ro.observe(root);
  const unwatch = watchTheme(() => { readColors(); schedule(); });

  renderLesson(root, {
    happening: [
      "A slicer cuts the model into flat layers and plans the nozzle's path for each one: outer walls first, then sparse infill inside.",
      "Thinner layers mean more layers over the same path. Half the layer height gives about twice the layers and twice the time, in exchange for smaller steps on curves and slopes. The zoom shows those steps.",
      "Each layer can stick out past the one below only so far. At 45 degrees from vertical it steps out by one layer height, so with 0.2 mm layers and a 0.4 mm line, half of each edge line still rests on plastic. Past that, more of the line hangs in air and droops, so slicers add supports.",
      "The nozzle lays a line about as wide as its opening. A wall thinner than one line cannot be traced, so the slicer drops it or prints it thicker than designed. Wider nozzles print faster but lose fine detail.",
      "Every number here is a simplified estimate: total path length divided by speed.",
    ],
    tryThis: [
      "Pick Overhang test and drag the angle past 45°. Watch the layers turn red and the share of each edge line resting on the layer below fall under half.",
      "Pick Vase, set the wall to 0.5 mm, then switch the nozzle from 0.4 to 0.6 mm. The wall no longer fits even one line.",
      "Halve the layer height from 0.24 to 0.12 mm and compare the time. Then look at the zoom to see what the extra time buys.",
    ],
    check: {
      q: "You switch the same part from 0.2 mm layers to 0.1 mm layers. What happens to the estimated time?",
      options: [
        { t: "It roughly doubles.", right: true,
          why: "Twice as many layers, and each one still traces about the same walls and infill." },
        { t: "It stays about the same.", right: false,
          why: "Each layer is thinner, but the nozzle still has to trace the whole layer. Twice as many layers means about twice the path." },
        { t: "It roughly halves.", right: false,
          why: "Thinner layers do not move faster. The nozzle traces a full layer each time, and now there are twice as many." },
      ],
    },
  }, ctx);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    unwatch();
  };
}
