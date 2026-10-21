import { describe, it, expect } from 'vitest';
import { createRenderer } from '../src/index.js';
import { VizLayoutEngine } from '../src/layout/viz.js';
import { PlantUmlModel } from '../src/foundation/model.js';

describe('@viz-js/viz layout engine', () => {
  it('renders a class through the viz engine and emits SVG', async () => {
    const renderer = createRenderer({ layout: 'viz' });
    const { svg, diagramType } = await renderer.render(
      '@startuml\nclass A\n@enduml',
    );
    expect(diagramType).toBe('class');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect');
    expect(svg).toContain('>A</text>');
  });

  it('is byte-for-byte deterministic', async () => {
    const renderer = createRenderer({ layout: 'viz' });
    const a = await renderer.render('@startuml\nclass A\n@enduml');
    const b = await renderer.render('@startuml\nclass A\n@enduml');
    expect(a.svg).toBe(b.svg);
  });

  it('lays out a hand-built model with entities and an edge', async () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [
        { id: 'A', name: 'A', kind: 'class', members: [] },
        { id: 'B', name: 'B', kind: 'class', members: [] },
      ],
      relations: [{ source: 'A', target: 'B', type: 'inheritance' }],
      packages: [],
    };
    const layout = await new VizLayoutEngine().layout(model);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.edges.length).toBeGreaterThanOrEqual(1);
    for (const node of layout.nodes) {
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });
});

describe('both engines render the same fixture', () => {
  it('elk and viz both emit SVG for the same puml', async () => {
    const puml = '@startuml\nclass A\nclass B\n@enduml';
    for (const layout of ['elk', 'viz'] as const) {
      const renderer = createRenderer({ layout });
      const { svg } = await renderer.render(puml);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('>A</text>');
      expect(svg).toContain('>B</text>');
    }
  });
});
