import { describe, it, expect } from 'vitest';
import { createRenderer, parsePlantUml, ElkLayoutEngine } from '../src/index.js';
import {
  countEdgeBoxIntersections,
  countNonOrthogonalSegments,
} from '../src/foundation/edge-router.js';

describe('M2 relations', () => {
  it('maps all four relation kinds (plus aggregation/composition)', () => {
    const model = parsePlantUml(
      [
        '@startuml',
        'A --|> B',
        'C ..|> D',
        'E ..> F',
        'G --> H',
        'I o-- J',
        'K *-- L',
        '@enduml',
      ].join('\n'),
    );
    expect(model.relations.map((r) => r.type)).toEqual([
      'inheritance',
      'implementation',
      'dependency',
      'association',
      'aggregation',
      'composition',
    ]);
  });

  it('emits a hollow triangle on a solid line for inheritance', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA --|> B\n@enduml',
    );
    expect(svg).toContain('uml-arrow-inheritance');
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('emits a hollow triangle on a dashed line for implementation', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA ..|> B\n@enduml',
    );
    expect(svg).toContain('uml-arrow-implementation');
    expect(svg).toContain('stroke-dasharray');
  });

  it('emits an open chevron on a dashed line for dependency', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA ..> B\n@enduml',
    );
    expect(svg).toContain('uml-arrow-dependency');
    expect(svg).toContain('stroke-dasharray');
  });

  it('emits an open chevron on a solid line for association', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA --> B\n@enduml',
    );
    expect(svg).toContain('uml-arrow-association');
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('emits a hollow diamond for aggregation', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA o-- B\n@enduml',
    );
    expect(svg).toContain('uml-arrow-aggregation');
  });

  it('emits a filled diamond for composition', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA *-- B\n@enduml',
    );
    expect(svg).toContain('uml-arrow-composition');
  });

  it('places cardinality and label text on the edge', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA "1" --> "*" B : uses\n@enduml',
    );
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>*</text>');
    expect(svg).toContain('>uses</text>');
  });

  it('orthogonal routing avoids unrelated-box crossings on a synthetic grid', async () => {
    const puml = [
      '@startuml',
      'class A',
      'class B',
      'class C',
      'class D',
      'class E',
      'class F',
      'A --> B',
      'B --> C',
      'C --> D',
      'D --> E',
      'E --> F',
      'A --> C',
      'B --> D',
      'C --> E',
      'D --> F',
      'A --> D',
      '@enduml',
    ].join('\n');

    const model = parsePlantUml(puml);
    const layout = await new ElkLayoutEngine().layout(model);

    expect(countEdgeBoxIntersections(layout.edges, layout.nodes)).toBe(0);
    for (const edge of layout.edges) {
      expect(countNonOrthogonalSegments(edge.points)).toBe(0);
    }
  });
});
