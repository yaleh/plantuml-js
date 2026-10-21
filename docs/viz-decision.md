# viz engine decision: experimental

`@viz-js/viz` (WASM Graphviz) is the second pluggable layout engine behind the
default `elkjs`. After the first pass of layout-quality work its measured
quality is far enough below elk's that we demote it to **experimental** rather
than claim parity — the honest status given the data.

## Decision

`'viz'` is marked **experimental** in `README.md` and on `RendererOptions.layout`
(`src/index.ts`). The default stays `'elk'`. The demotion is data-driven, not a
guess: the figures below are `node scripts/render-samples.mjs` output
(`rendered/metrics.json`).

## Measured comparison

| diagram | engine | areaUtilization | edgeNodeIntersections | edgeCrossings | aspectRatio | width × height |
|---|---|---|---|---|---|---|
| fixture (class) | elk | 0.338 | 0 | 0 | 1.60 | 1644 × 1030 |
| fixture (class) | viz | 0.062 | 0 | 0 | 1.67 | 3911 × 2347 |
| package | elk | 0.063 | 0 | 138 | 2.01 | 3560 × 1769 |
| package | viz | 0.017 | 1 | 130 | 1.67 | 6254 × 3752 |

## Why experimental rather than fixed now

- **Area utilization** — `fixture.viz` fits 20 nodes into 6.2% of a
  3911 × 2347 canvas (elk: 33.8% of 1644 × 1030). Graphviz places the two
  packages far apart and stretches the drawing with `ratio="0.6"`, so the SVG
  is mostly blank and the edges are long diagonals.
- **Edge-through-node** — `package.viz` still has 1 edge segment passing
  through an unrelated node box (elk: 0). ELK's orthogonal routing keeps elk at
  zero; the viz engine has no equivalent guarantee.
- **Orthogonal contract** — the renderer's arrowheads and the overlap metrics
  are built around the axis-aligned edge contract elk guarantees
  (`docs/layout-routing-eval.md`); viz emits bezier splines, so it only gets a
  coarse approximation of the same measurements.

## When viz is still useful

For small diagrams it produces a correct SVG, and it remains the reference
implementation for the `renderDot`/`modelToDot` Graphviz path and for comparing
against elk. It is **not** the production default.
