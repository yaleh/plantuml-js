---
id: gap-render-viewbox-includes-edge-routes
title: gap-render-viewbox-includes-edge-routes
status: done
labels:
  - gap
  - defect
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Finding

SVG viewBox / layout width and height exclude edge detour routes and edge labels. Repro: `node scripts/render-docs.mjs`, figure `m-focus` (docs/img/m-focus.elk.png, neighborhood view of TypeScriptParser, hops 1, memberMaxRows 4). Dependency edges routed to the left of the outer package are clipped at x<0, and the labels "uses" / "returns" are cut (rendered as "ns"). The downstream consumer claudecodeui reported the same clipping; their item: the viewBox must contain edge detour routes plus a ~40px margin, and the SVG contract must state this guarantee. Dedup: searched existing tasks for viewBox and clip; the only related one is gap-layout-foundation (done), which fixed viewBox for negative node/cluster coordinates in viz.ts only, not edge routes or labels. Not a duplicate; different mechanism (edge polyline and label extents omitted from the bounds computation).

## AC

- [x] viewBox and layout.width/height cover all edge polyline points and edge label boxes plus a margin >= 16px; checked by `npx vitest run` exit 0 on the new test below
- [x] A new test asserts every edge path point and every edge label rect lies inside the viewBox for a fixture with outer-loop edges (tests/fixtures/archguard-architecture.puml, neighborhood TypeScriptParser hops 1); `npx vitest run tests/viewbox-edge-bounds.test.ts` exits 0
- [x] `npm run docs` exits 0 and regenerated docs/img/m-focus.elk.png / docs/gallery.md show m-focus unclipped (no x<0 edge points, labels "uses"/"returns" fully visible), verified by the same bounds assertion run on the generated SVG
- [x] The SVG contract doc states the guarantee (viewBox contains all edge routes and labels with margin >= 16px); `grep -n "viewBox" <contract doc>` shows the new statement
- [x] `npm run typecheck` and `npx vitest run` pass and two renders of the same input are byte-identical

## DoD

The real m-focus figure from the archguard-architecture fixture is re-rendered through `npm run docs` and visually inspected as a PNG: no edge or label is clipped at any border. The bounds test runs against actual layout output (not a synthetic toy), and the contract doc carries the guarantee so downstream consumers (claudecodeui) can rely on it.

## Touches

- tasks/gap-render-viewbox-includes-edge-routes.md
- src/foundation/layout.ts
- src/core.ts (the pipeline applies the fit so the returned layout and the viewBox agree)
- src/render/svg.ts (confirmed as the viewBox writer; it draws the fitted layout unchanged)
- tests/viewbox-edge-bounds.test.ts (new)
- tests/fixtures/archguard-architecture.puml (existing fixture, used by the new test)
- scripts/docs-gallery.json (m-focus figure in the gallery manifest)
- scripts/render-docs.mjs (forward view/memberMaxRows/memberMaxChars to renderDetailed)
- README.md (SVG/layout contract doc carries the guarantee)
- docs/gallery.md (regenerated)
- docs/img/m-focus.elk.png (regenerated)
- docs/img/m-focus.elk.svg (regenerated)
