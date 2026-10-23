# @yalehwang/plantuml-js

Pure-TypeScript PlantUML **class diagram** renderer (MIT). Renders `.puml`
class diagrams to SVG with a pluggable layout engine — `elkjs` (pure JS) by
default, `@viz-js/viz` (WASM Graphviz) as an option.

> **Engine status** — `'viz'` is **experimental**. It reaches only a fraction
> of `'elk'`'s area utilization and still routes a few edges through unrelated
> nodes on large package diagrams. See
> [`docs/viz-decision.md`](https://github.com/yaleh/plantuml-js/blob/author/docs/viz-decision.md)
> for the measured comparison. Use `'elk'` (the default) for production diagrams.

## What it renders

`@yalehwang/plantuml-js` turns a PlantUML class diagram into a styled SVG. Here
is a minimal diagram through the default `'elk'` engine — three-compartment
class/interface boxes, a package, and implementation / composition / dependency
edges:

![Minimal class diagram — package, class boxes, and three edge kinds](https://raw.githubusercontent.com/yaleh/plantuml-js/author/docs/img/quickstart.elk.png)

The same pipeline on a real medium-size architecture graph (package grouping,
orthogonal edge routing, bundled arrowheads):

![Medium architecture diagram](https://raw.githubusercontent.com/yaleh/plantuml-js/author/docs/img/m-architecture.elk.png)

See the [gallery](https://github.com/yaleh/plantuml-js/blob/author/docs/gallery.md)
for every figure's source `.puml`, its SVG output, and the `elk` vs `viz`
comparison.

## Install

```bash
npm install @yalehwang/plantuml-js
```

## Usage

```ts
import { createRenderer } from '@yalehwang/plantuml-js';

const renderer = createRenderer({ layout: 'elk' }); // or 'viz' (experimental)
const { svg, diagramType, warnings } = await renderer.render(`
@startuml
class A
@enduml
`);
```

A minimal runnable example (works in Node 18+ and browsers with a bundler):

```js
import { createRenderer } from '@yalehwang/plantuml-js';

const renderer = createRenderer({ layout: 'viz' });
const { svg } = await renderer.render('@startuml\nclass A\nclass B\n@enduml');
console.log(svg);
// <svg xmlns="http://www.w3.org/2000/svg" ...><rect .../></svg>
```

## Status

- **M1** — scaffolding, class-subset parser, PlantUmlModel IR, elkjs layout,
  SVG emission. `render("@startuml\nclass A\n@enduml")` produces a correct SVG.
- **M2** — members / relations / generics / package grouping / aliases,
  orthogonal edge routing, text metrics.
- **M3** — `@viz-js/viz` engine, API polish, npm publish.

## API

| Function | Description |
|---|---|
| `createRenderer({ layout })` | Build a renderer. `layout` is `'elk'` (default), `'viz'` (experimental), or a custom `LayoutEngine`. |
| `renderer.render(puml)` | Parse + layout + emit SVG. Returns `{ svg, diagramType, warnings }`. Throws `RenderError` on structurally invalid puml. |
| `renderDetailed(pumlOrModel, options?)` | Run the same pipeline as `renderer.render` and return every intermediate: `{ model, layout, svg, layoutMs, hiddenTransitive }`. Accepts a puml string (throws `RenderError` on invalid input) or an already-parsed `PlantUmlModel`. `DetailedRender.layout` carries the **stable** node/package/edge rectangles — see [Stable layout geometry](#stable-layout-geometry-renderdetailed) — so tooling never has to re-read bounding boxes from the SVG. Exported from both `.` and `./elk`. |
| `parsePlantUml(puml)` | Parse a puml string into a `PlantUmlModel`. |
| `checkSyntax(puml)` | Validate without throwing. Returns `{ ok, errors, warnings }` of line-accurate `SyntaxDiagnostic`s. |
| `explain(puml)` | Explain each line. Returns `LineExplanation[]` (line, kind, explanation). |
| `renderDot(dot, engine)` | Render a raw DOT string to SVG via `@viz-js/viz`. `engine` is `'dot'` (default), `'neato'`, `'fdp'`, `'sfdp'`, `'circo'`, `'twopi'`, `'osage'`, or `'patchwork'`. |
| `ElkLayoutEngine` / `VizLayoutEngine` | The two built-in `LayoutEngine` implementations, exported for direct use. |

### Stable layout geometry (`renderDetailed`)

`DetailedRender.layout` is a **stable public contract**: the rectangle fields
describe exactly what the renderer drew, so a thumbnail, a search jump or a
selection box can use them directly instead of parsing the SVG. Coordinates are
relative to the diagram origin (the SVG `viewBox` offset).

| `layout` field | Shape | Corresponding SVG hook |
|---|---|---|
| `nodes[]` | `{ id, x, y, width, height }` | `<g class="uml-node" data-entity-id="{id}">` |
| `packages[]` (engines with container support, e.g. `'elk'`) | `{ id, x, y, width, height }` | `<g class="uml-package" data-package-id="{id}">`; grouped nodes also carry `data-package-id` |
| `edges[]` | `{ id, source, target, points }` | `<g class="uml-edge" data-edge-source="{source}" data-edge-target="{target}" data-edge-type="…">`; aggregated package corridors add `data-weight`, bundled arrowheads carry `data-edge-target` on `uml-bundle-head` |
| `width`, `height` | `number` | The `viewBox` extent |

`points` is the same polyline the SVG draws, so an edge hit-test can reuse it
without re-routing. `model` is the diagram actually drawn (after view,
transforms and detail), and `hiddenTransitive` counts the edges dropped by
transitive reduction.

### Error semantics

`createRenderer` fails closed on an unknown layout name (`'elk'`, `'viz'`, or a
`LayoutEngine` instance only), and `render` throws a `RenderError` whose
`diagnostics` carry the offending line numbers. `checkSyntax` reports the same
problems as structured data instead of throwing.

## License

MIT
