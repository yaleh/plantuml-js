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
