# Lab module contract

Each lab is one ES module at `public/labs/<slug>.js`. The app loads it with `import()` and mounts it into a container.

```js
export const meta = { slug: "tokenizer", title: "See how a model reads", blurb: "One plain sentence.", minutes: 5, topic: "foundations" };
export function mount(root, ctx) { /* build UI inside root */ return () => { /* stop timers, workers, rAF; free memory */ }; }
```

- `root` is an empty `<div>` about as wide as the main column (390px on a phone, at most 880px on a computer).
- `ctx.markDone()` records the lab as finished in the learner's progress. Call it when they get the check question right.
- No build step and no npm. A third-party library is allowed only as a pinned, exact-version `import()` from `https://cdn.jsdelivr.net/npm/<pkg>@<x.y.z>/...`, loaded inside `mount`, with a loading state and an error message if it fails.
- Style: inject one `<style>` scoped under `.lab-<slug>`, using only the tokens in `public/css/tokens.css` (`--bg`, `--bg-2`, `--bg-3`, `--line`, `--fg`, `--fg-2`, `--accent`, `--accent-ink`, `--accent-text`, `--ok`, `--bad`, spacing `--s1..--s8`, radii `--r-s`, `--r`, `--r-pill`, fonts `--font`, `--mono`). Reuse `.btn`, `.btn.primary`, `.field`, `.mono`, `.muted`. Read colors for canvas drawing from `getComputedStyle(root)` so both themes work. Re-read them on `matchMedia('(prefers-color-scheme: dark)')` change.
- Phone first: works at 390px wide with no sideways scroll. Tap targets at least 40px. Body text 16px, line-height 1.5.
- Accessible: every control has a visible label; canvases have `role="img"` and an `aria-label`, plus the key numbers as text. Keyboard works. Respect `prefers-reduced-motion`.
- Content shape, top to bottom: the interactive part first (it is the lesson), then **What's happening** (3 to 6 short plain sentences, technically exact), then **Try this** (2 or 3 concrete things to do), then one **Check** question with buttons and instant feedback that explains why.
- Copy: plain American English, short sentences. No em dashes or en dashes anywhere. No hype words ("revolutionary", "seamless", "unlock", "delve", "game-changer"). Facts must be right; check numbers against a primary source.
- Preview a lab alone at `/labs/dev.html?lab=<slug>`.
