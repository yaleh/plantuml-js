import { describe, expect, it } from 'vitest';
import { routeOrthogonal } from '../src/layout/grid-router.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import type { LayoutResult, NodeLayout } from '../src/foundation/layout.js';
import type { PlantUmlModel } from '../src/foundation/model.js';

/** Three tall package columns side by side with 64px gutters, canvas margin above and below. */
function threeColumns(): { model: PlantUmlModel; nodes: NodeLayout[]; frames: LayoutResult['packages'] } {
  const columns = [
    { id: 'Left', x: 40 },
    { id: 'Middle', x: 304 },
    { id: 'Right', x: 568 },
  ];
  const nodes: NodeLayout[] = [];
  const entities: PlantUmlModel['entities'] = [];
  const frames: NonNullable<LayoutResult['packages']> = [];
  for (const col of columns) {
    frames.push({ id: col.id, x: col.x, y: 120, width: 200, height: 360 });
    for (let row = 0; row < 4; row++) {
      const id = `${col.id}${row}`;
      nodes.push({ id, x: col.x + 40, y: 160 + row * 80, width: 120, height: 40 });
      entities.push({ id, name: id, kind: 'class', members: [], packageId: col.id });
    }
  }
  const model: PlantUmlModel = {
    diagramType: 'class',
    entities,
    relations: [],
    packages: columns.map((c) => ({ id: c.id, name: c.id })),
  };
  return { model, nodes, frames };
}

describe('corridors between package frames', () => {
  it('route column-to-column edges through the gutters, not across the middle column', () => {
    const { model, nodes, frames } = threeColumns();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pairs: [string, string][] = [
      ['Left0', 'Right0'],
      ['Left1', 'Right2'],
      ['Left2', 'Right1'],
      ['Left3', 'Right3'],
      ['Left0', 'Right3'],
    ];
    const routed = routeOrthogonal(
      pairs.map(([s, t], i) => ({ id: String(i), source: byId.get(s)!, target: byId.get(t)! })),
      nodes,
      { width: 840, height: 600, frames },
    );
    const layout: LayoutResult = {
      nodes,
      packages: frames,
      width: 840,
      height: 600,
      edges: pairs.map(([source, target], i) => ({ id: `rel-${i}`, source, target, points: routed.get(String(i))! })),
    };
    model.relations = pairs.map(([source, target]) => ({ source, target, type: 'dependency' as const }));

    for (const edge of layout.edges) expect(edge.points.length, edge.id).toBeGreaterThanOrEqual(2);
    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeFrameCrossings).toBe(0);
    expect(m.edgeNodeIntersections).toBe(0);

    // Between the two outer columns every edge is outside the middle frame (x 304..504).
    for (const edge of layout.edges) {
      for (let i = 0; i + 1 < edge.points.length; i++) {
        const a = edge.points[i];
        const b = edge.points[i + 1];
        const insideX = Math.min(a.x, b.x) < 504 && Math.max(a.x, b.x) > 304;
        const insideY = Math.max(a.y, b.y) > 120 && Math.min(a.y, b.y) < 480;
        expect(insideX && insideY && Math.abs(a.y - b.y) < 1e-6, `${edge.id} runs through the middle frame`).toBe(false);
      }
    }
  });

  it('cut through an unrelated frame only when no gutter exists', () => {
    const { model, nodes, frames } = threeColumns();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // The canvas is exactly as tall as the frames: nothing above or below to detour through.
    const routed = routeOrthogonal([{ id: '0', source: byId.get('Left1')!, target: byId.get('Right1')! }], nodes, {
      width: 840,
      height: 480,
      frames,
    });
    const points = routed.get('0')!;
    const layout: LayoutResult = {
      nodes,
      packages: frames,
      width: 840,
      height: 480,
      edges: [{ id: 'rel-0', source: 'Left1', target: 'Right1', points }],
    };
    model.relations = [{ source: 'Left1', target: 'Right1', type: 'dependency' }];
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(computeLayoutMetrics(model, layout).edgeNodeIntersections).toBe(0);
  });
});
