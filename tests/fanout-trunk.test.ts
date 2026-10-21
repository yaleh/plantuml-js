import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ElkLayoutEngine } from '../src/elk.js';
import { parsePlantUml, renderDetailed } from '../src/core.js';
import { findParallelBundles, computeLayoutMetrics } from '../src/layout-metrics.js';
import type { Point } from '../src/layout.js';
// @ts-expect-error — plain .mjs helper without type declarations
import { filterPackagesMatching } from '../scripts/samples-lib.mjs';

type Seg = [Point, Point];

function segmentsOf(points: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]]);
  return out;
}

const length = ([a, b]: Seg): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Length of `seg` lying on top of `other` (axis-aligned segments only). */
function sharedLength(seg: Seg, other: Seg): number {
  const [a, b] = seg;
  const [c, d] = other;
  const horizontal = Math.abs(a.y - b.y) < 1e-6 && Math.abs(c.y - d.y) < 1e-6 && Math.abs(a.y - c.y) < 0.5;
  const vertical = Math.abs(a.x - b.x) < 1e-6 && Math.abs(c.x - d.x) < 1e-6 && Math.abs(a.x - c.x) < 0.5;
  if (!horizontal && !vertical) return 0;
  const [s0, s1, t0, t1] = horizontal
    ? [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(c.x, d.x), Math.max(c.x, d.x)]
    : [Math.min(a.y, b.y), Math.max(a.y, b.y), Math.min(c.y, d.y), Math.max(c.y, d.y)];
  return Math.max(0, Math.min(s1, t1) - Math.max(s0, t0));
}

function fanOut(kind: string, leaves: number): string {
  const lines = ['@startuml', 'class Hub'];
  for (let i = 1; i <= leaves; i++) lines.push(`class Leaf${i}`);
  for (let i = 1; i <= leaves; i++) lines.push(`Hub ${kind} Leaf${i}`);
  lines.push('@enduml');
  return lines.join('\n');
}

describe('fan-out trunks', () => {
  for (const [label, kind] of [
    ['dependency', '..>'],
    ['association', '-->'],
  ] as const) {
    it(`draw seven ${label} edges from one node as a shared trunk that then branches`, async () => {
      const { layout, svg } = await renderDetailed(parsePlantUml(fanOut(kind, 7)), { layout: new ElkLayoutEngine() });
      const edges = layout.edges;
      expect(edges).toHaveLength(7);

      // Every edge leaves the hub the same way, so they can share one trunk.
      const firstLeg = edges.map((e) => `${e.points[0].x},${e.points[0].y}->${e.points[1].x},${e.points[1].y}`);
      expect(new Set(firstLeg).size).toBe(1);

      // At least 70% of the edges' path length is drawn on top of another edge of the group,
      // and every edge at least shares the trunk.
      let totalLength = 0;
      let sharedTotal = 0;
      for (const edge of edges) {
        const others = edges.filter((o) => o !== edge).flatMap((o) => segmentsOf(o.points));
        const shared = segmentsOf(edge.points).map((s) =>
          Math.min(length(s), others.reduce((best, o) => Math.max(best, sharedLength(s, o)), 0)),
        );
        totalLength += segmentsOf(edge.points).reduce((sum, s) => sum + length(s), 0);
        sharedTotal += shared.reduce((sum, v) => sum + v, 0);
        expect(shared[0] / length(segmentsOf(edge.points)[0]), `${edge.id} trunk`).toBeGreaterThanOrEqual(0.99);
      }
      expect(sharedTotal / totalLength).toBeGreaterThanOrEqual(0.7);

      // The shared stretch is drawn once: the bundle path holds fewer segments than the edges together have.
      const bundle = /<g [^>]*uml-edge-bundle[^>]*>\s*<path d="([^"]+)"/.exec(svg);
      expect(bundle).not.toBeNull();
      const drawn = (bundle![1].match(/M/g) ?? []).length;
      const unique = new Set(edges.flatMap((e) => segmentsOf(e.points).map(([a, b]) => `${a.x},${a.y}-${b.x},${b.y}`)));
      expect(drawn).toBeLessThanOrEqual(unique.size);
      expect(drawn).toBeLessThan(edges.reduce((sum, e) => sum + segmentsOf(e.points).length, 0));
    }, 60_000);
  }

  it('leaves a fan-out of four alone', async () => {
    const { layout } = await renderDetailed(parsePlantUml(fanOut('..>', 4)), { layout: new ElkLayoutEngine() });
    const firstLegs = layout.edges.map((e) => `${e.points[0].x},${e.points[0].y}`);
    expect(new Set(firstLegs).size).toBeGreaterThan(1);
  }, 60_000);

  it('leaves no comb in the l-plugins Java and Python package frames', async () => {
    const fixture = readFileSync(new URL('./fixtures/all-classes.puml', import.meta.url), 'utf8');
    const parsed = filterPackagesMatching(parsePlantUml(fixture), '^Src_Plugins_');
    const { model, layout } = await renderDetailed(parsed, { layout: new ElkLayoutEngine() });
    const packageOf = new Map(model.entities.map((e) => [e.id, e.packageId ?? '']));
    const inJavaOrPython = (node: string): boolean => /Plugins_(Java|Python)/.test(packageOf.get(node) ?? '');
    const combs = findParallelBundles(layout.edges).filter((b) => inJavaOrPython(b.node));
    expect(combs).toEqual([]);
    expect(computeLayoutMetrics(model, layout).parallelBundleCount).toBeLessThanOrEqual(1);
  }, 120_000);
});
