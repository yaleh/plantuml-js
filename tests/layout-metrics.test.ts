import { describe, it, expect } from 'vitest';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import { PlantUmlModel } from '../src/model.js';
import { LayoutResult } from '../src/layout.js';
import { measureTextWidth } from '../src/text-measure.js';

const entity = (id: string, raw: string[] = [], packageId?: string) => ({
  id,
  name: id,
  kind: 'class' as const,
  packageId,
  members: raw.map((r) => ({
    visibility: 'public' as const,
    name: r,
    kind: 'field' as const,
    modifiers: [],
    raw: r,
  })),
});

const rel = (source: string, target: string) => ({
  source,
  target,
  type: 'association' as const,
});

describe('computeLayoutMetrics', () => {
  it('counts crossings, node intersections, length, utilization and aspect', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: ['A', 'B', 'C', 'D', 'X'].map((id) => entity(id)),
      relations: [rel('A', 'B'), rel('C', 'D'), rel('A', 'D')],
      packages: [],
    };
    const box = (id: string, x: number, y: number) => ({ id, x, y, width: 20, height: 20 });
    const layout: LayoutResult = {
      nodes: [box('A', 0, 0), box('B', 100, 100), box('C', 100, 0), box('D', 0, 100), box('X', 40, 40)],
      edges: [
        // A→B and C→D are the two diagonals of a square: exactly one crossing.
        { id: 'rel-0', source: 'A', target: 'B', points: [{ x: 10, y: 10 }, { x: 110, y: 110 }] },
        { id: 'rel-1', source: 'C', target: 'D', points: [{ x: 110, y: 10 }, { x: 10, y: 110 }] },
        // A→D runs down the left edge and touches no unrelated node.
        { id: 'rel-2', source: 'A', target: 'D', points: [{ x: 10, y: 10 }, { x: 10, y: 110 }] },
      ],
      width: 200,
      height: 100,
    };
    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeCrossings).toBe(1);
    // The A→B diagonal passes through X's box (40..60).
    expect(m.edgeNodeIntersections).toBeGreaterThanOrEqual(1);
    expect(m.totalEdgeLength).toBeCloseTo(2 * Math.hypot(100, 100) + 100, 5);
    expect(m.areaUtilization).toBeCloseTo((5 * 400) / (200 * 100), 5);
    expect(m.aspectRatio).toBe(2);
  });

  it('does not count edges that merely share an endpoint as crossing', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C')],
      relations: [rel('A', 'B'), rel('A', 'C')],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [],
      edges: [
        { id: 'rel-0', source: 'A', target: 'B', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] },
        { id: 'rel-1', source: 'A', target: 'C', points: [{ x: 0, y: 0 }, { x: 50, y: -50 }] },
      ],
      width: 100,
      height: 100,
    };
    expect(computeLayoutMetrics(model, layout).edgeCrossings).toBe(0);
  });

  it('flags text lines wider than their box', () => {
    const longLine = '+kind: FunctionFingerprintKind';
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A', [longLine, '+x: y']), entity('B', ['+x: y'])],
      relations: [],
      packages: [],
    };
    const needed = measureTextWidth(longLine) + 20;
    const layout: LayoutResult = {
      nodes: [
        { id: 'A', x: 0, y: 0, width: needed - 30, height: 60 },
        { id: 'B', x: 0, y: 100, width: 200, height: 40 },
      ],
      edges: [],
      width: 300,
      height: 200,
    };
    expect(computeLayoutMetrics(model, layout).textOverflowCount).toBe(1);
  });

  it('flags a package tab that overlaps content or is narrower than its label', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A', [], 'P'), entity('B', [], 'Q')],
      relations: [],
      packages: [
        { id: 'P', name: 'Src Analysis Layer' },
        { id: 'Q', name: 'Q' },
      ],
    };
    const layout: LayoutResult = {
      nodes: [
        { id: 'A', x: 10, y: 5, width: 80, height: 30 }, // under P's tab
        { id: 'B', x: 210, y: 40, width: 80, height: 30 }, // clear of Q's tab
      ],
      edges: [],
      packages: [
        { id: 'P', x: 0, y: 0, width: 100, height: 60 },
        { id: 'Q', x: 200, y: 0, width: 100, height: 80 },
      ],
      width: 320,
      height: 100,
    };
    expect(computeLayoutMetrics(model, layout).labelOverlapCount).toBe(1);
  });
});
