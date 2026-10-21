# Edge routing evaluation

The ELK engine (`src/layout/elk.ts`) exposes three `elk.edgeRouting` modes —
`ORTHOGONAL`, `POLYLINE` and `SPLINES` — through
`new ElkLayoutEngine({ edgeRouting: … })`. This document records the measured
comparison behind the default choice.

## Method

Each mode was run against the two committed fixtures
(`tests/fixtures/archguard-class.puml` and
`tests/fixtures/archguard-package.puml`) with the engine's default options
(semantic layering on, `INCLUDE_CHILDREN` for cross-package edges, fixed-side
ports), and measured with `computeLayoutMetrics` (the same numbers
`scripts/render-samples.mjs` writes to `rendered/metrics.json`).

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

### `tests/fixtures/archguard-package.puml`

| mode       | edgeCrossings | edgeNodeIntersections | totalEdgeLength | aspectRatio | areaUtilization | labelOverlap |
|------------|---------------|-----------------------|-----------------|-------------|-----------------|--------------|
| ORTHOGONAL | 1446          | 0                     | 394979          | 2.068       | 0.0263          | 0            |
| POLYLINE   | 1446          | 0                     | 393539          | 1.713       | 0.0218          | 0            |
| SPLINES    | 1450          | 0                     | 393735          | 1.996       | 0.0254          | 0            |

All three reach `edgeNodeIntersections === 0` and stay below the previous
stage's `edgeCrossings` (1868 baseline). `POLYLINE` wins narrowly on
`totalEdgeLength` and `aspectRatio`; `SPLINES` is a negligible 4 crossings
worse.

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
prefer marginally shorter edges over the orthogonal guarantee.
