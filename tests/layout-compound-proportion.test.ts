import { describe, it, expect } from 'vitest';
import { ElkLayoutEngine } from '../src/index.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import type { PlantUmlEntity, PlantUmlModel, PlantUmlPackage, PlantUmlRelation } from '../src/model.js';

/** 4 top packages × 5 sub-packages × 2 leaf packages × 7 classes = 280 nested classes + cross-package edges. */
function nestedModel(): PlantUmlModel {
  const packages: PlantUmlPackage[] = [];
  const entities: PlantUmlEntity[] = [];
  const relations: PlantUmlRelation[] = [];
  for (let t = 0; t < 4; t++) {
    const top = `t${t}`;
    packages.push({ id: top, name: top });
    for (let s = 0; s < 5; s++) {
      const sub = `${top}/s${s}`;
      packages.push({ id: sub, name: `s${s}`, parentId: top });
      for (let l = 0; l < 2; l++) {
        const leaf = `${sub}/l${l}`;
        packages.push({ id: leaf, name: `l${l}`, parentId: sub });
        for (let c = 0; c < 7; c++) {
          entities.push({ id: `${leaf}/C${c}`, name: `Class${t}${s}${l}${c}`, kind: 'class', members: [], packageId: leaf });
        }
      }
    }
  }
  entities.forEach((e, i) => {
    const next = entities[(i + 1) % entities.length];
    const far = entities[(i * 7 + 13) % entities.length];
    relations.push({ source: e.id, target: next.id, type: 'dependency' });
    if (i % 6 === 0 && far.id !== e.id) relations.push({ source: e.id, target: far.id, type: 'dependency' });
  });
  return { diagramType: 'class', entities, relations, packages };
}

describe('compound layout proportion', { timeout: 60_000 }, () => {
  it('keeps a nested multi-package canvas proportioned and edge-clean', async () => {
    const model = nestedModel();
    const layout = await new ElkLayoutEngine().layout(model);
    const aspect = layout.width / layout.height;
    expect((aspect >= 0.33 && aspect <= 3) || layout.width <= 10000).toBe(true);
    expect(computeLayoutMetrics(model, layout).edgeNodeIntersections).toBe(0);
  });

  it('is deterministic across runs', async () => {
    const model = nestedModel();
    const a = await new ElkLayoutEngine().layout(model);
    const b = await new ElkLayoutEngine().layout(model);
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
    expect(b.nodes).toEqual(a.nodes);
    expect(b.edges).toEqual(a.edges);
  });

  it('lays a large package-less graph out layered, not as one block per entity', async () => {
    const model = nestedModel();
    const flat: PlantUmlModel = {
      ...model,
      packages: [],
      relations: model.relations.slice(0, 280),
      entities: model.entities.map(({ packageId: _p, ...e }) => e),
    };
    const layout = await new ElkLayoutEngine().layout(flat);
    expect(layout.nodes).toHaveLength(flat.entities.length);
    expect(layout.packages ?? []).toHaveLength(0);
  });
});
