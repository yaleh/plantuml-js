import { afterEach, describe, expect, it } from 'vitest';
import {
  computeLayoutMetrics,
  listMetrics,
  registerMetric,
  unregisterMetric,
  type LayoutMetrics,
} from '../src/metrics/layout-metrics.js';
import { PlantUmlModel } from '../src/foundation/model.js';
import { LayoutResult } from '../src/foundation/layout.js';

const model: PlantUmlModel = {
  diagramType: 'class',
  entities: [
    { id: 'A', name: 'A', kind: 'class', members: [] },
    { id: 'B', name: 'B', kind: 'class', members: [] },
  ],
  relations: [{ source: 'A', target: 'B', type: 'association' }],
  packages: [],
};

const layout: LayoutResult = {
  nodes: [
    { id: 'A', x: 0, y: 0, width: 100, height: 50 },
    { id: 'B', x: 200, y: 0, width: 100, height: 50 },
  ],
  edges: [{ id: 'rel-0', source: 'A', target: 'B', points: [{ x: 100, y: 25 }, { x: 200, y: 25 }] }],
  width: 300,
  height: 50,
};

/** Every measurement `computeLayoutMetrics` must report (layoutMs is wall time, not a metric). */
const BUILT_IN_METRICS = [
  'edgeCrossings',
  'edgeNodeIntersections',
  'nonOrthogonalEdgeCount',
  'totalEdgeLength',
  'areaUtilization',
  'aspectRatio',
  'textOverflowCount',
  'labelOverlapCount',
  'overlappingEdgeLength',
  'badgeLabelOverlap',
  'edgeLabelOverlap',
  'labelNodeOverlap',
  'labelEdgeOverlap',
  'labelLabelOverlap',
  'hubArrowStack',
  'maxEmptyBlockRatio',
  'edgeFlushCount',
  'parallelBundleCount',
  'edgeFrameCrossings',
  'trunkDetourCount',
  'nestedLoopCount',
  'edgeNodeFlush',
  'frameFillRatio',
  'edgeCanvasMargin',
];

afterEach(() => {
  unregisterMetric('syntheticProbe');
  unregisterMetric('syntheticZero');
});

describe('metrics registry', () => {
  it('registers every built-in measurement and reports it', () => {
    expect(listMetrics()).toEqual(BUILT_IN_METRICS);

    const metrics = computeLayoutMetrics(model, layout) as unknown as Record<string, number>;
    for (const name of BUILT_IN_METRICS) {
      expect(typeof metrics[name], `${name} should be a number`).toBe('number');
    }
  });

  it('includes a newly registered metric in computeLayoutMetrics without editing its return body', () => {
    registerMetric({
      name: 'syntheticProbe',
      compute: (m, l) => m.entities.length * 100 + l.nodes.length,
    });

    // Same call as before registration — no extra argument, no code change.
    const metrics = computeLayoutMetrics(model, layout) as unknown as Record<string, number>;
    expect(metrics.syntheticProbe).toBe(202);
  });

  it('drops a metric after unregistering it', () => {
    registerMetric({ name: 'syntheticZero', compute: () => 0 });
    expect(listMetrics()).toContain('syntheticZero');
    expect(computeLayoutMetrics(model, layout)).toHaveProperty('syntheticZero');

    expect(unregisterMetric('syntheticZero')).toBe(true);
    expect(listMetrics()).not.toContain('syntheticZero');
    expect(computeLayoutMetrics(model, layout)).not.toHaveProperty('syntheticZero');
  });

  it('refuses a duplicate metric name', () => {
    registerMetric({ name: 'syntheticZero', compute: () => 0 });
    expect(() => registerMetric({ name: 'syntheticZero', compute: () => 1 })).toThrow(
      /already registered/,
    );
  });

  it('keeps layoutMs as the caller-supplied wall time, outside the registry', () => {
    const metrics = computeLayoutMetrics(model, layout, 12.5);
    expect(metrics.layoutMs).toBe(12.5);
    expect(listMetrics()).not.toContain('layoutMs');
  });

  it('keeps the result a strong LayoutMetrics value', () => {
    const metrics: LayoutMetrics = computeLayoutMetrics(model, layout);
    // If LayoutMetrics were weakened to Record<string, number>, this annotation
    // would still compile — the type-level check below is the real guard.
    type NotIndexSignature = string extends keyof LayoutMetrics ? never : true;
    const strong: NotIndexSignature = true;
    expect(strong).toBe(true);
    expect(metrics.edgeCrossings).toBe(0);
  });
});
