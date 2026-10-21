import { describe, it, expect } from 'vitest';
import { renderSvg } from '../src/render/svg.js';
import { LayoutResult } from '../src/foundation/layout.js';
import { PlantUmlModel } from '../src/foundation/model.js';
import { createRenderer } from '../src/index.js';

function grid(count: number): { model: PlantUmlModel; layout: LayoutResult } {
  const model: PlantUmlModel = {
    diagramType: 'class',
    entities: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      name: `n${i}`,
      kind: 'class' as const,
      members: [],
    })),
    relations: [],
    packages: [],
  };
  const layout: LayoutResult = {
    nodes: model.entities.map((e, i) => ({
      id: e.id,
      x: (i % 8) * 90,
      y: Math.floor(i / 8) * 50,
      width: 70,
      height: 34,
    })),
    edges: [],
    width: 720,
    height: Math.ceil(count / 8) * 50,
  };
  return { model, layout };
}

describe('legend', () => {
  it('lists feedback edge, hub badge, weight and frame styles when enabled', () => {
    const { model, layout } = grid(3);
    const svg = renderSvg(model, layout, { legend: true });
    expect(svg).toContain('class="uml-legend"');
    expect(svg).toContain('feedback edge');
    expect(svg).toContain('hub badge');
    expect(svg).toContain('×N');
    expect(svg).toContain('dashed frame');
    expect(svg).toContain('solid frame');
  });

  it('extends the canvas below the diagram so it covers no geometry', () => {
    const { model, layout } = grid(3);
    const plain = /height="([\d.]+)"/.exec(renderSvg(model, layout, { legend: false }))!;
    const withLegend = /height="([\d.]+)"/.exec(renderSvg(model, layout, { legend: true }))!;
    expect(Number(withLegend[1])).toBeGreaterThan(Number(plain[1]));
  });

  it('is on by default only for graphs with more than 30 nodes', () => {
    const small = grid(30);
    const large = grid(31);
    expect(renderSvg(small.model, small.layout)).not.toContain('uml-legend');
    expect(renderSvg(large.model, large.layout)).toContain('uml-legend');
    expect(renderSvg(large.model, large.layout, { legend: false })).not.toContain('uml-legend');
  });

  it('is controlled by the renderer `legend` option', async () => {
    const puml = '@startuml\nclass A\nclass B\nA --> B\n@enduml\n';
    const on = await createRenderer({ legend: true }).render(puml);
    const off = await createRenderer().render(puml);
    expect(on.svg).toContain('uml-legend');
    expect(off.svg).not.toContain('uml-legend');
  });
});
