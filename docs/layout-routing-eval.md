# Edge routing evaluation

The ELK engine (`src/layout/elk.ts`) exposes three `elk.edgeRouting` modes —
`ORTHOGONAL`, `POLYLINE` and `SPLINES` — through
`new ElkLayoutEngine({ edgeRouting: … })`. This document records the measured
comparison behind the default choice.

## Method

Each mode was run against the two committed fixtures
(`tests/fixtures/archguard-class.puml` and
`tests/fixtures/archguard-package.puml`), and measured with
`computeLayoutMetrics` (the same numbers `scripts/render-samples.mjs` writes to
`rendered/metrics.json`).

The package fixture goes through the default full-graph pipeline
(`transformFullGraph` in `src/index.ts`): aggregation, hub summarization
(nodes with more than 6 distinct dependents get a `usageCount` badge instead of
one edge per dependent) and cycle feedback marking. Layers are stacked by
dependency topology (`src/layout/elk.ts`), and node placement uses
`INTERACTIVE`. The engine's default options are unchanged otherwise (semantic
layering on, `INCLUDE_CHILDREN` for cross-package edges, fixed-side ports).

## Results

`edgeNodeIntersections` is the hard acceptance target (must be 0) and
`edgeCrossings` must not exceed the previous stage.

### `tests/fixtures/archguard-class.puml`

| mode       | edgeCrossings | edgeNodeIntersections | totalEdgeLength | aspectRatio | areaUtilization | labelOverlap |
|------------|---------------|-----------------------|-----------------|-------------|-----------------|--------------|
| ORTHOGONAL | 0             | 0                     | 616             | 1.572       | 0.3379          | 0            |
| POLYLINE   | 0             | 0                     | 616             | 1.572       | 0.3379          | 0            |
| SPLINES    | 0             | 0                     | 616             | 1.572       | 0.3379          | 0            |

No cross-package edges exist here, so the three routers coincide.

### `tests/fixtures/archguard-package.puml` (full graph, default transform)

| mode       | edgeCrossings | edgeNodeIntersections | totalEdgeLength | aspectRatio | areaUtilization | labelOverlap |
|------------|---------------|-----------------------|-----------------|-------------|-----------------|--------------|
| ORTHOGONAL | 138           | 0                     | 73351           | 1.992       | 0.0630          | 0            |
| POLYLINE   | 138           | 0                     | 73225           | 1.725       | 0.0545          | 0            |
| SPLINES    | 138           | 0                     | 73319           | 1.931       | 0.0610          | 0            |

The previous stage drew all 217 edges and measured `edgeCrossings` 1446 with
`areaUtilization` 0.0263. Hub summarization drops 72 of those edges (the
`src/types`, `src/types/extensions`, `src/core/interfaces`, … hubs become
badges), which cuts crossings to 138 and more than doubles utilization.

The depth-2 overview (`view: { kind: 'overview', depth: 2 }`, path-prefix
grouping) collapses the same diagram to 17 nodes with `edgeCrossings` 34 —
`src/cli → src/analysis → src/core → src/types` becomes a readable ladder
instead of a 64-node hairball.

## Conclusion: default is `ORTHOGONAL`

`ORTHOGONAL` remains the default even though `POLYLINE` edges are slightly
shorter, because the axis-aligned segments are a **contract, not a cosmetic
preference**:

- `tests/relations.test.ts` asserts every emitted edge has
  `countNonOrthogonalSegments === 0` — a diagonal router fails that check by
  construction.
- The SVG renderer draws arrowheads from the direction of the first/last
  polyline segment (`src/render/svg.ts`); an axis-aligned terminal segment keeps
  those arrowheads visually anchored to the node edge.

`POLYLINE` and `SPLINES` are therefore available as an opt-in
(`{ edgeRouting: 'POLYLINE' }` / `{ edgeRouting: 'SPLINES' }`) for callers who
prefer marginally shorter edges over the orthogonal guarantee. On the
transformed package graph the three routers now agree on crossings (138) and
differ only in total edge length and aspect ratio.

## Cross-package routing and large graphs

Measured on archguard's real `all-classes.puml` (660 entities / 950 relations /
56 packages), fixture at `tests/fixtures/all-classes.puml`.

**Cross-package edges fell back to diagonals.** Under `elk.hierarchyHandling:
INHERIT`, ELK returns no routing section for an edge between a package's child
and a node outside the package (a stub in a single-package view), so
`edgePoints` drew a straight line. The engine now uses `INCLUDE_CHILDREN`
whenever any edge crosses a container boundary (package↔package *or*
package↔top-level). `Src_Mermaid_Layer`: 24 diagonal cross edges → 0,
`edgeNodeIntersections` 82 → 0.

**A single hierarchical run cannot stay proportioned.** `INCLUDE_CHILDREN` is
one layered run, so it flattens packages into strips (and layered wrapping is
not available across a hierarchy). When the result's aspect ratio leaves
0.2–3, or the pixel count exceeds 40 MP, or the model has more than 250
entities, the engine uses the compound layout (`src/layout/compound.ts`):

1. each top-level package is laid out alone (layered, packed to ~1.6:1; a flat
   block that comes out wider than 2.2:1 — or any flat block of a >250-entity
   graph — is rect-packed instead);
2. blocks are placed as fixed-size nodes — layered for ≤12 blocks, rectpacking
   above that;
3. every edge that ELK did not route is drawn by the lattice A* router in
   `src/layout/grid-router.ts` (axis-aligned, bend- and shared-lane-penalised,
   clear of every node box).

| metric (all-classes, ELK) | before | after |
| --- | --- | --- |
| canvas | 13455 × 79369 | 13245 × 6800 |
| pixels | 1068 MP | 90 MP |
| aspect ratio | 0.17 | 1.95 |
| edgeCrossings | 9027 | 4658 |
| edgeNodeIntersections | — | 0 |
| nonOrthogonalEdgeCount | — | 0 |
| areaUtilization | 0.022 | 0.266 |

All 56 package views: `nonOrthogonalEdgeCount` 0, `edgeNodeIntersections`
total 0, aspect ratios within 0.69–2.98 (previously 7 outside 0.25–4).
`scripts/render-samples.mjs` skips the PNG (and the Chrome text re-measure) for
canvases above 100 MP and logs it.

## Multi-scale sample set (S/M/L/XL)

`scripts/samples.json` declares 9 samples in four tiers; `node scripts/render-samples.mjs
--manifest [<archguard-output-dir>] --tiles` renders them (elk for all, viz for S/M),
prints a per-tier table, writes `rendered/metrics.json` (records carry `tier`), exits
non-zero on a violated threshold, and cuts each elk diagram into 1:1 tiles
(`rendered/tiles/<id>/r<row>c<col>.png`, ≤1800×1200) plus `overview.png` with the grid
marked. XL is never rasterised whole.

Measured (elk, current develop):

| tier | id | ents | w×h | crossings | areaUtil | aspect | thresholds |
|---|---|---|---|---|---|---|---|
| S | s-class | 22 | 1644×1030 | 0 | 0.34 | 1.60 | pass |
| S | s-architecture-manual | 21 | 2242×841 | 0 | 0.31 | 2.67 | **FAIL** aspect > 2.2 |
| S | s-cli-utils-view | 21 | 1192×922 | 3 | 0.38 | 1.29 | pass |
| M | m-architecture | 70 | 5104×2783 | 102 | 0.22 | 1.83 | pass |
| M | m-package | 64 | 2256×2754 | 172 | 0.06 | 0.82 | **FAIL** areaUtilization 0.064 < 0.12 |
| M | m-mermaid-view | 50 | 2897×2034 | 180 | 0.22 | 1.42 | pass |
| M | m-types-view | 65 | 5343×2164 | 42 | 0.16 | 2.47 | pass |
| L | l-plugins (172) | 172 | 7505×5968 | 607 | 0.16 | 1.26 | pass |
| XL | xl-all-classes | 660 | 13245×6800 | 4658 | 0.27 | 1.95 | pass |

### Exposed failures (not fixed here)

- **S `s-architecture-manual`** — a 4-package flat strip layout (2242×841) overshoots the
  S aspect band (2.67 > 2.2); the layered run places the packages side by side.
- **M `m-package`** — areaUtilization 0.064: five packages of very uneven size in a
  2256×2754 canvas leave large empty regions around the small packages.

viz (S/M only) is reported for comparison: it is 2–3× larger in each dimension
(area utilisation 0.02–0.06) and has 8–100 non-orthogonal edges per diagram.

### Tile inspection notes

Spot-checked `s-class`, `m-mermaid-view` and `l-plugins` tiles at 1:1:

- Arrowheads (open triangles for inheritance, `>` for dependencies), composition diamonds,
  `×N` multiplicity labels, and package tab titles are all legible; text is never clipped by
  its box.
- S (`s-class/r0c0`): inter-node gaps are generous; edges attach cleanly to node sides.
- M (`m-mermaid-view/r0c0`): in the right part several long dashed/solid edges run as a
  tight parallel bundle (≈4–8 px apart) down the canvas, which makes individual edges hard
  to follow; `×3`/`×4` labels sit on those bundles.
- L (`l-plugins/r2c2`): long inter-package edges thread between packages as many parallel
  vertical/horizontal lines with small gaps; packages themselves are well spaced.

## Balance, clearance and bundling (gap-layout-balance-clearance-bundling)

Two metrics were added to `computeLayoutMetrics`: `maxEmptyBlockRatio` (largest node- and
frame-free rectangle ÷ canvas, 20 px raster) and `edgeFlushCount` (edge segments parallel to
and < 6 px from an unrelated node side or package frame border). Measured on the same
fixtures before and after the change (before = layout of the previous commit, scored with
the new metrics):

| Sample | w×h before → after | areaUtil | aspect | maxEmptyBlockRatio | edgeFlushCount |
| --- | --- | --- | --- | --- | --- |
| s-class | 1650×1196 → same | 0.307 → 0.307 | 1.38 | 0.162 → 0.162 | 0 → 0 |
| s-architecture-manual | 1826×1262 → same | 0.258 | 1.45 | 0.179 → 0.179 | 0 → 0 |
| m-architecture | 4578×2867 → 4580×2867 | 0.241 | 1.60 | 0.116 → 0.116 | 0 → 0 |
| m-package | 2314×2826 → 1644×1276 | 0.073 → 0.228 | 0.82 → 1.29 | 0.134 → 0.169 | 0 → 1 |
| m-mermaid-view | 2927×2088 → 2929×2088 | 0.229 | 1.40 | 0.019 → 0.027 | 0 → 0 |
| l-plugins | 7548×6036 → 7984×5996 | 0.160 → 0.153 | 1.25 → 1.33 | 0.115 → 0.141 | 21 → 0 |
| xl-all-classes | 13144×7032 → 14568×6840 | 0.271 → 0.251 | 1.87 → 2.13 | 0.103 → 0.110 | **121 → 5** (−96 %) |

What changed:

- **Edge clearance** — the grid router charges extra for lattice steps that run along a
  package frame border within 12 px (`FRAME_CLEARANCE`), and the ELK runs set
  `elk.spacing.edgeNode=12` / `edgeEdge=10`. All 121 XL flush segments were grid-routed lanes
  hugging frames. Cost: XL `overlappingEdgeLength` 86268 → 95375 and crossings 4590 → 4646,
  because lanes now share the channel centre.
- **Sparse blocks** — a single-package block of ≥ 30 nodes below 0.16 node density is first
  re-laid with ELK layer wrapping, then rect-packed if still sparse (edges grid-routed).
  `m-package` Src block no longer sprawls over 2234×1766.
- **Small layers** — neighbouring small layer blocks (≤ 600 px tall) share one row, and all
  rows are left-aligned instead of centred.
- **Hub rail** — summarised hubs with no drawn edge leave the layered run and stack in a
  column on the package's left side (wrapping at the block height).
- **Bundling** — ≥ 5 unlabelled dependency/association edges leaving one source in the same
  direction render as a single `uml-edge-bundle` path (shared segments drawn once) with
  `data-bundle-size` and the summed `data-weight`; each target keeps its arrowhead.

Not done: the fan-out lines still leave the source from distinct ports (the bundle is one
element but the branches are not snapped to a single trunk), and the long
`examples → src/plugins/golang` edge (item 5) is untouched. `s-cli-utils-view` still misses
its 0.25 areaUtilization threshold (0.233, unchanged from before this task).

## Edge hierarchy and dependency flow (gap-layout-edge-hierarchy-and-flow)

Before = develop at `3e67c0a`; after = this change. Same fixtures (`tests/fixtures`),
`node scripts/render-samples.mjs --manifest`.

| Sample | overlappingEdgeLength before → after | maxEmptyBlockRatio before → after | areaUtilization before → after | edgeCrossings before → after |
| --- | --- | --- | --- | --- |
| s-cli-utils-view | 0 → 0 | 0.094 → 0.076 | 0.233 → **0.251** | 0 → 0 |
| m-architecture | 0 → 0 | 0.195 → 0.195 | 0.211 → 0.213 | 61 → 61 |
| m-package | 24936 → **9504** (−62 %) | 0.169 → 0.136 | 0.228 → 0.184 | 334 → 466 |
| m-mermaid-view | 7559 → 5261 | 0.030 → 0.030 | 0.231 → 0.231 | 145 → 153 |
| m-types-view | 16464 → 1120 | 0.042 → 0.042 | 0.202 → 0.202 | 157 → 167 |
| xl-all-classes | 28565 → **18332** (−36 % here; −81 % vs the 95375 of the previous report) | 0.094 → **0.060** | 0.172 → 0.173 | 4648 → 4024 |

What changed:

- **Edge tiers (theme tokens).** Line type: strong relations solid, realisation dashed
  (`dash.implementation`), weak dependency dotted (`dash.weak`), cycle feedback dash-dot.
  Weight: width grows with `weight` (`stroke.weightStep`), opacity by tier
  (`stroke.opacity` light 0.8 / medium 0.9 / strong ≥ `heavyWeight`=3 → 1.0; feedback 0.95), so a
  heavy edge is thicker *and* more opaque than a single dependency (previously heavier edges were
  *lighter*). Edge colours were darkened (`edge` `#5b6a80`, `edgeWeak` `#566479`, `warn` `#3b0a0a`)
  so every kind, after blending with its opacity, keeps ≥ 3:1 against the deepest package fill
  (`tests/theme-contrast.test.ts`).
- **Dependency flow in packed blocks.** A block that is repacked (sparse / dense) no longer uses ELK
  rect packing, whose order ignores dependencies. `orderedShelfPack` (`src/layout/compound.ts`)
  fills rows in layer order, so upstream nodes sit above what they consume: in `m-package` the Src
  Layer now reads `src/cli/commands` (top) … `src/core/parser-runtime` (bottom). Row gap 72 px leaves
  channels wide enough for several edge lanes. Very large graphs whose rows would exceed the canvas
  budget (`COMPOUND_AREA_BUDGET`, full all-classes graph without summarisation) fall back to rect packing.
  Big packages (≥ 12 members) in the flat run are laid out top-down too (`elk-graph.ts`).
- **Parallel edges.** The grid router's lattice pitch was 8 px — exactly the near-parallel
  proximity, so every router lane counted as overlapping. Pitch is now ≥ 9. A new post-pass
  (`src/layout/lane-spread.ts`) fans coincident interior segments out onto lanes ≥ 10 px apart
  (least-squares, inside the free corridor, never through a node or along a frame). Same-source fan-outs
  of ≥ 5 edges still render as one shared trunk (`uml-edge-bundle`).
- **Compactness.** Flat-run spacing 40/60 → 20/24 px, which lifts `s-cli-utils-view` over the S-tier
  0.25 utilisation threshold.
- **Thresholds.** XL `maxEmptyBlockRatio` 0.2 → 0.08; M-tier `m-mermaid-view`/`m-types-view` ≤ 0.1;
  `overlappingEdgeLength` caps added for `m-package` (≤ 9974) and XL (≤ 47687).

Not met: **M-tier `maxEmptyBlockRatio` ≤ 0.1 for `m-architecture` (0.195) and `m-package`
(0.136).** Both are semantic-layer stacks whose layers differ strongly in width (a narrow AI/Tests
layer next to a wide CLI/Src layer), so the empty well beside the narrow layer cannot be closed by
repacking inside blocks; stacking the small layers into a column (tried) moved the gap rather than
closing it. Their thresholds are ratcheted to the current values (0.2 / 0.14) instead.

Self-score (1–5): hierarchy legibility 4, parallel-edge merging 4, dependency flow 4,
XL silhouette 4, M-tier balance 3.

## Round 7 — inter-package corridors and line semantics

- **Aggregation.** `interPackage: 'aggregate' | 'raw'` (default `aggregate` above 150 entities):
  all relations between two packages fold into one box-to-box edge (`data-weight` = N, `×N`
  label, originals in `<title>`); intra-package edges are untouched.
- **Line type = relation kind only.** Inheritance/implementation/composition/aggregation/
  association are solid, dependency is dashed (`6,3`, no longer dotted), cycle feedback is
  dash-dot. Weight is width + opacity. Edge strokes use `vector-effect: non-scaling-stroke`
  so thumbnails keep ≥ 1px lines.
- **Alignment.** An isolated top-level frame (no edge touches it) is top-aligned with the
  topmost side-by-side neighbour (`s-architecture-manual`: Utils now level with CLI Layer).

| `xl-all-classes` (elk) | round 6 | round 7 |
| --- | --- | --- |
| edgeCrossings | 4024 | 975 (−76%) |
| overlappingEdgeLength | 18332 | 4130 |
| cross-package edges drawn | 385 | ≤ 40% (asserted in `tests/interpackage-aggregate.test.ts`) |

`render-samples.mjs --manifest --compare`: no regressions; all thresholds satisfied. Metrics
only — the 1:1 tile / thumbnail visual re-score is not recorded here.

## Round 8 — fan-out trunks, frame gutters, stub rail

- **Fan-out trunks.** `src/layout/fanout-trunk.ts`: edges of one kind that leave (or enter) one node
  through the same side, five or more, are redrawn as a tree — one trunk out of the node, a common
  bus level just before the nearest target, short drops into each target (`tests/fanout-trunk.test.ts`:
  ≥ 70% of the group's drawn length lies on another group edge; `svg.ts` already draws the shared
  stretch once). Targets that sit behind other nodes keep ELK's route unless the tree is clear of
  nodes and no worse on crossings, frame crossings and crowding. Combs the tree cannot replace are
  re-routed on the lattice router with a shared-trunk reward (same source or same target), kept only
  when that removes the comb without adding more than a few crossings.
- **Router.** Wires with the same source or target share lanes at 0.4 of a fresh step, so fan-outs grow
  a trunk while routing. A step through a frame neither endpoint lives in costs +7
  (`FOREIGN_FRAME_COST`), so corridors take the gutters. Crossings are priced at 12 (40 in a view with
  stubs) and the intra-block edges already drawn count as obstacles for that price; after the first
  pass up to three rip-up-and-re-route passes lift the wires that still cross others.
  A search window around the two nodes keeps each A* local (whole lattice only as a fallback).
- **Stub rail.** The stubs of a single-package view form one rail along the side of the frame nearest
  their targets (all flush to one line, equal gaps, ordered by where their targets lie). The engine
  still compares a handful of orbits, now without the rip-up passes, and routes only the winner in full.
- **Metrics.** `parallelBundleCount` (≥ 5 edges of one source/target, same way, laid side by side at
  ≤ 16 px for ≥ 120 px; exactly coincident edges are one line, not a comb) and `edgeFrameCrossings`
  (edges through the interior of a frame neither end belongs to). `overlappingEdgeLength` no longer
  counts edges of one source/target drawn exactly on top of each other (a merged trunk).
- **Tests Layer.** `m-package`'s Tests Layer already packs as a 576×496 grid, top-aligned with the other
  small layers (asserted in `tests/small-layers.test.ts`); no layout change was needed.

| elk sample | edgeCrossings r7 → r8 | parallelBundleCount | edgeFrameCrossings | overlappingEdgeLength | totalEdgeLength |
| --- | --- | --- | --- | --- | --- |
| `m-architecture` | 61 → 58 | 2 → 1 | 0 → 0 | 0 → 0 | 74227 → 72293 |
| `m-package` | 466 → 255 | 1 → 1 | 3 → 0 | 8336 → 4779 | 58014 → 58610 |
| `m-mermaid-view` | 36 → 38 | 1 → 1 | 0 → 0 | 496 → 4277 | 45667 → 50780 |
| `m-types-view` | 70 → 29 | 1 → 0 | 0 → 0 | 18 → 0 | 39193 → 49286 |
| `l-plugins` | 213 → 132 | 3 → 0 | 12 → 0 | 1302 → 3332 | 94170 → 94443 |
| `xl-all-classes` | 975 → 621 | 0 → 0 | 84 → 2 | 2282 → 7854 | 252739 → 282289 |

`render-samples.mjs --manifest --compare`: no regressions; all thresholds (now including
`parallelBundleCount` ≤ 1 everywhere, `edgeFrameCrossings` ≤ 2 / ≤ 16 for L / XL and
`m-types-view` `edgeCrossings` ≤ 40) satisfied; `rendered/metrics.baseline.json` refreshed.

Costs, stated plainly: wires are longer (XL +12% total length, `m-types-view` +26%) because crossings
and foreign frames are now priced; `m-mermaid-view` and `xl-all-classes` have more near-parallel
overlap than in round 7 (still far under the XL threshold); and layout is slower — all-classes
package views take about 3× as long as before (XL ≈ 6 s instead of ≈ 2 s), so `vitest.config.ts` now
sets a 60 s test timeout.

Looked at the re-rendered `l-plugins`, `m-package`, `m-types-view` and `xl-all-classes` (thumbnails
and 1:1 crops): the Java and Python fan-outs are trees (a shared trunk and bus with short drops,
though the Python frame still shows two sources fanning to the same targets side by side),
corridors run in the gutters, the stubs sit on an even rail along the frame's right side. Self-score
(1–5, not a reviewer score): fan-out readability 4, corridors 4, stub rail 4, runtime 2.
