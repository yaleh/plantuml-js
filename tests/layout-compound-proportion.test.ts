import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ElkLayoutEngine, transformFullGraph } from '../src/index.js';
import { computeLayoutMetrics } from '../src/metrics/layout-metrics.js';
import type { PlantUmlEntity, PlantUmlModel, PlantUmlPackage, PlantUmlRelation } from '../src/foundation/model.js';

const testDir = dirname(fileURLToPath(import.meta.url));

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

/** A nested model of `tops × 2 × 2 × classes` entities with local, deterministic edges. */
function largeNestedModel(tops: number, classes: number): PlantUmlModel {
  const packages: PlantUmlPackage[] = [];
  const entities: PlantUmlEntity[] = [];
  const byTop: PlantUmlEntity[][] = [];
  for (let t = 0; t < tops; t++) {
    const top = `t${t}`;
    packages.push({ id: top, name: top });
    const own: PlantUmlEntity[] = [];
    for (let s = 0; s < 2; s++) {
      const sub = `${top}/s${s}`;
      packages.push({ id: sub, name: `s${s}`, parentId: top });
      for (let l = 0; l < 2; l++) {
        const leaf = `${sub}/l${l}`;
        packages.push({ id: leaf, name: `l${l}`, parentId: sub });
        for (let c = 0; c < classes; c++) {
          const e: PlantUmlEntity = { id: `${leaf}/C${c}`, name: `K${t}_${s}_${l}_${c}`, kind: 'class', members: [], packageId: leaf };
          entities.push(e);
          own.push(e);
        }
      }
    }
    byTop.push(own);
  }
  const relations: PlantUmlRelation[] = [];
  entities.forEach((e, i) => {
    // Local (same top package) chain plus a cross-top edge every tenth entity:
    // the cross-block router still has work, but the graph keeps the locality
    // of a real package tree.
    relations.push({ source: e.id, target: byTop[i % tops][(i + 1) % byTop[i % tops].length].id, type: 'dependency' });
    if (i % 10 === 0 && i > 0) relations.push({ source: e.id, target: entities[(i * 7 + 13) % entities.length].id, type: 'dependency' });
  });
  return transformFullGraph({ diagramType: 'class', entities, relations, packages });
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

  it('keeps a large package-less graph on one layered ELK run when an aspectRatio is requested', async () => {
    // The 789-node archguard neighbourhood flattened: no packages to pack, so
    // the compound layout would be one block per entity (40s / 13k crossings).
    // A requested aspectRatio must not drag it onto that path either.
    const fixture = JSON.parse(
      readFileSync(join(testDir, 'fixtures', 'archguard-neighborhood.json'), 'utf8'),
    ) as {
      nodes: { id: string; label: string }[];
      edges: { from: string; to: string; relationType: PlantUmlRelation['type'] }[];
    };
    const idOf = new Map(fixture.nodes.map((n, i) => [n.id, `n${i}`]));
    const flat = transformFullGraph({
      diagramType: 'class',
      entities: fixture.nodes.map((n, i) => ({ id: `n${i}`, name: n.label, kind: 'class', members: [] })),
      relations: fixture.edges
        .filter((e) => idOf.has(e.from) && idOf.has(e.to))
        .map((e) => ({ source: idOf.get(e.from)!, target: idOf.get(e.to)!, type: e.relationType })),
      packages: [],
    });

    const engine = new ElkLayoutEngine({ aspectRatio: 1.6 });
    const elk = (engine as unknown as { elk: { layout: (graph: unknown) => Promise<unknown> } }).elk;
    const realLayout = elk.layout.bind(elk);
    let elkRuns = 0;
    elk.layout = (graph) => {
      elkRuns++;
      return realLayout(graph);
    };

    const layout = await engine.layout(flat);
    expect(layout.nodes).toHaveLength(flat.entities.length);
    expect(layout.packages ?? []).toHaveLength(0);
    expect(elkRuns).toBe(1);
  });

  it('degrades a large nested graph without collapsing its canvas or routing through nodes', async () => {
    // 1000 entities is above the default 800 threshold, so this exercises the
    // cheap large-graph pipeline (coarse routing lattice, no cosmetic passes).
    const model = largeNestedModel(10, 25);
    expect(model.entities.length).toBe(1000);
    const layout = await new ElkLayoutEngine().layout(model);
    const aspect = layout.width / layout.height;
    expect(aspect).toBeLessThanOrEqual(3);
    expect(aspect).toBeGreaterThanOrEqual(1 / 3);
    expect(computeLayoutMetrics(model, layout).edgeNodeIntersections).toBe(0);
    expect(layout.nodes).toHaveLength(model.entities.length);
    expect(layout.edges.filter((e) => e.points.length >= 2)).toHaveLength(model.relations.length);
  });

  it('honours a configured large-graph threshold', async () => {
    // 288 entities: above threshold 1 (degraded path) and below Infinity (full
    // pipeline), so both branches of the switch are exercised.
    const model = largeNestedModel(6, 12);
    expect(model.entities.length).toBe(288);
    for (const threshold of [1, Infinity]) {
      const layout = await new ElkLayoutEngine({ largeGraphThreshold: threshold }).layout(model);
      expect(layout.width / layout.height).toBeLessThanOrEqual(3);
      expect(computeLayoutMetrics(model, layout).edgeNodeIntersections).toBe(0);
      expect(layout.nodes).toHaveLength(model.entities.length);
    }
  });
});
