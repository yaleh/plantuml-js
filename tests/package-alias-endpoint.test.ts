import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRenderer, parsePlantUml, transformFullGraph, ElkLayoutEngine } from '../src/index.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const onBoundary = (p: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }): number => {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y);
};

describe('package alias endpoints', () => {
  const puml =
    '@startuml\npackage "X Layer" as X {\nclass A\nclass A2\nA --> A2\n}\nclass B\nX --> B\nB --> X\n@enduml';

  it('draws no class box for the alias and ends edges on the package frame', async () => {
    const result = await createRenderer().render(puml);
    expect(result.svg).not.toContain('data-entity-id="X"');
    const model = transformFullGraph(parsePlantUml(puml));
    const layout = await new ElkLayoutEngine().layout(model);
    const box = layout.packages!.find((p) => p.id === 'X')!;
    const xb = model.relations
      .map((r, i) => ({ r, e: layout.edges.find((e) => e.id === `rel-${i}`)! }))
      .filter(({ r }) => r.sourcePackageId === 'X' || r.targetPackageId === 'X');
    expect(xb).toHaveLength(2);
    for (const { r, e } of xb) {
      const end = r.sourcePackageId === 'X' ? e.points[0] : e.points[e.points.length - 1];
      expect(onBoundary(end, box)).toBeLessThanOrEqual(1);
    }
  });

  it('does not invent *_Layer classes for the manual diagram', () => {
    const model = parsePlantUml(fixture('archguard-architecture-manual.puml'));
    const ids = model.entities.map((e) => e.id);
    for (const id of ['CLI_Layer', 'CLI_Integration_Layer', 'Parser_Layer']) {
      expect(ids).not.toContain(id);
    }
  });
});
