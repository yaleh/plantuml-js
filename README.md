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

const renderer = createRenderer({ layout: 'elk' });
const { svg, diagramType, warnings } = await renderer.render(`
@startuml
class A
@enduml
`);
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
| `renderer.render(puml)` | Parse + layout + emit SVG. Returns `{ svg, diagramType, warnings }`. |
| `parsePlantUml(puml)` | Parse a puml string into a `PlantUmlModel`. |

## License

MIT
