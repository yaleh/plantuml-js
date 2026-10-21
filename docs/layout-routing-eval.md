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
