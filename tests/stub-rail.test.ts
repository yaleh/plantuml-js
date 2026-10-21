import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ElkLayoutEngine } from '../src/elk.js';
import { parsePlantUml, renderDetailed } from '../src/core.js';
import { computeLayoutMetrics } from '../src/layout/layout-metrics.js';

const fixture = readFileSync(new URL('./fixtures/all-classes.puml', import.meta.url), 'utf8');

async function stubView(packageId: string) {
  const { model, layout } = await renderDetailed(parsePlantUml(fixture), {
    layout: new ElkLayoutEngine(),
    view: { kind: 'package', id: packageId },
  });
  const frame = layout.packages!.find((p) => p.id === packageId)!;
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  const stubs = model.entities.filter((e) => e.stub).map((e) => nodes.get(e.id)!);
  return { model, layout, frame, nodes, stubs };
}

describe('single-package view stub rail', () => {
  for (const packageId of ['Src_Types_Layer', 'Src_Mermaid_Layer']) {
    it(`${packageId}: stubs line up on one side of the frame, spaced evenly`, async () => {
      const { frame, stubs } = await stubView(packageId);
      expect(stubs.length).toBeGreaterThan(5);

      // One side: every stub lies wholly beyond the same frame edge, flush with the same line.
      const right = stubs.every((s) => s.x >= frame.x + frame.width);
      const left = stubs.every((s) => s.x + s.width <= frame.x);
      const below = stubs.every((s) => s.y >= frame.y + frame.height);
      const above = stubs.every((s) => s.y + s.height <= frame.y);
      expect([right, left, below, above].filter(Boolean).length).toBe(1);

      const vertical = right || left;
      const near = (s: (typeof stubs)[number]): number =>
        right ? s.x : left ? s.x + s.width : below ? s.y : s.y + s.height;
      const reference = near(stubs[0]);
      for (const s of stubs) expect(Math.abs(near(s) - reference)).toBeLessThanOrEqual(1);

      // Adjacent stubs are the same distance apart along the rail.
      const along = [...stubs].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
      const gaps = along.slice(1).map((s, i) => (vertical ? s.y - (along[i].y + along[i].height) : s.x - (along[i].x + along[i].width)));
      for (const gap of gaps) expect(Math.abs(gap - gaps[0])).toBeLessThanOrEqual(1);
      expect(gaps[0]).toBeGreaterThan(0);
    }, 60_000);

    it(`${packageId}: stubs follow the order of the nodes they connect to`, async () => {
      const { model, layout, nodes, stubs } = await stubView(packageId);
      const stubIds = new Set(model.entities.filter((e) => e.stub).map((e) => e.id));
      const vertical = stubs.every((s) => s.x === stubs[0].x) || new Set(stubs.map((s) => Math.round(s.x))).size < 3;
      const centre = (id: string): number => {
        const n = nodes.get(id)!;
        return vertical ? n.y + n.height / 2 : n.x + n.width / 2;
      };
      const targetsOf = (stub: string): number[] =>
        model.relations
          .map((r) => (r.source === stub ? r.target : r.target === stub ? r.source : undefined))
          .filter((id): id is string => id !== undefined && !stubIds.has(id) && nodes.has(id))
          .map(centre);
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

      // Rail position (stub centre) against the mean target position: strongly rank-correlated.
      const pairs = [...stubIds]
        .filter((id) => targetsOf(id).length > 0)
        .map((id) => ({ rail: centre(id), target: mean(targetsOf(id)) }));
      let agree = 0;
      let total = 0;
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          if (pairs[i].target === pairs[j].target) continue;
          total++;
          if ((pairs[i].rail - pairs[j].rail) * (pairs[i].target - pairs[j].target) > 0) agree++;
        }
      }
      expect(agree / total).toBeGreaterThanOrEqual(0.75);
      expect(layout.edges.every((e) => e.points.length >= 2)).toBe(true);
    }, 60_000);
  }

  it('Src_Types_Layer: crosses no more than 40 edges', async () => {
    const { model, layout } = await stubView('Src_Types_Layer');
    expect(computeLayoutMetrics(model, layout).edgeCrossings).toBeLessThanOrEqual(40);
  }, 60_000);
});
