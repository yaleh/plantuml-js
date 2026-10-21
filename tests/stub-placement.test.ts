import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ElkLayoutEngine } from '../src/elk.js';
import { parsePlantUml, renderDetailed } from '../src/core.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';

const fixture = readFileSync(new URL('./fixtures/all-classes.puml', import.meta.url), 'utf8');

describe('single-package view stubs', () => {
  it('sit close to the package nodes they connect to', async () => {
    const { model, layout } = await renderDetailed(parsePlantUml(fixture), {
      layout: new ElkLayoutEngine(),
      view: { kind: 'package', id: 'Src_Types_Layer' },
    });
    const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
    const stubs = model.entities.filter((e) => e.stub);
    expect(stubs.length).toBeGreaterThan(5);
    const centre = (id: string) => {
      const n = nodes.get(id)!;
      return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
    };
    const linkedInner = (stubId: string): string[] =>
      model.relations
        .map((r) => (r.source === stubId ? r.target : r.target === stubId ? r.source : undefined))
        .filter((id): id is string => id !== undefined && !model.entities.find((e) => e.id === id)?.stub);
    const meanDistance = (at: (stubId: string) => { x: number; y: number }): number => {
      let sum = 0;
      let count = 0;
      for (const stub of stubs) {
        const p = at(stub.id);
        for (const id of linkedInner(stub.id)) {
          const c = centre(id);
          sum += Math.hypot(p.x - c.x, p.y - c.y);
          count++;
        }
      }
      return sum / count;
    };
    const actual = meanDistance(centre);
    // Same stubs, all stacked in the canvas's right-most column: the stubs form one
    // rail along the nearest side of the frame (see stub-rail.test.ts), so they are
    // never farther from their targets than that column.
    const rightColumn = meanDistance((id) => ({ x: layout.width - 40, y: centre(id).y }));
    expect(actual).toBeLessThanOrEqual(rightColumn);

    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeCrossings).toBeLessThanOrEqual(40);
    expect(m.overlappingEdgeLength).toBeLessThanOrEqual(300);
  }, 60_000);
});
