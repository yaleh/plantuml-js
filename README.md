# @yalehwang/plantuml-js

Pure-TypeScript PlantUML **class diagram** renderer (MIT). Renders `.puml`
class diagrams to SVG with a pluggable layout engine — `elkjs` (pure JS) by
default, `@viz-js/viz` (WASM Graphviz) as an option.

## Install

```bash
npm install @yalehwang/plantuml-js
```

## Usage

```ts
import { createRenderer } from '@yalehwang/plantuml-js';

const renderer = createRenderer({ layout: 'elk' }); // or 'viz'
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
| `createRenderer({ layout })` | Build a renderer. `layout` is `'elk'` (default), `'viz'`, or a custom `LayoutEngine`. |
| `renderer.render(puml)` | Parse + layout + emit SVG. Returns `{ svg, diagramType, warnings }`. Throws `RenderError` on structurally invalid puml. |
| `parsePlantUml(puml)` | Parse a puml string into a `PlantUmlModel`. |
| `checkSyntax(puml)` | Validate without throwing. Returns `{ ok, errors, warnings }` of line-accurate `SyntaxDiagnostic`s. |
| `explain(puml)` | Explain each line. Returns `LineExplanation[]` (line, kind, explanation). |
| `renderDot(dot, engine)` | Render a raw DOT string to SVG via `@viz-js/viz`. `engine` is `'dot'` (default), `'neato'`, `'fdp'`, `'sfdp'`, `'circo'`, `'twopi'`, `'osage'`, or `'patchwork'`. |
| `ElkLayoutEngine` / `VizLayoutEngine` | The two built-in `LayoutEngine` implementations, exported for direct use. |

### Error semantics

`createRenderer` fails closed on an unknown layout name (`'elk'`, `'viz'`, or a
`LayoutEngine` instance only), and `render` throws a `RenderError` whose
`diagnostics` carry the offending line numbers. `checkSyntax` reports the same
problems as structured data instead of throwing.

## License

MIT
