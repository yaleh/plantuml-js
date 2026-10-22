import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlantUml } from '../src/parser.js';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { applyView, transformModel } from '../src/transform.js';
import { transformFullGraph } from '../src/core.js';
import { computeLayoutMetrics } from '../src/metrics/layout-metrics.js';
import { countNonOrthogonalSegments } from '../src/foundation/edge-router.js';
import type { PlantUmlModel } from '../src/foundation/model.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const allClasses = parsePlantUml(
  readFileSync(join(testDir, 'fixtures', 'all-classes.puml'), 'utf8'),
);

function packageView(id: string): PlantUmlModel {
  return transformModel(applyView(allClasses, { kind: 'package', id }), {
    aggregate: true,
    cycles: true,
  });
}

describe('gap-layout-cross-package-routing-large-graph: cross-package routing', () => {
  it('routes edges between two packages as orthogonal polylines that avoid other nodes', async () => {
    const model = parsePlantUml(
      [
        '@startuml',
        'package "Alpha" as Alpha {',
        '  class A1',
        '  class A2',
        '  class A3',
        '}',
        'package "Beta" as Beta {',
        '  class B1',
        '  class B2',
        '}',
        'A1 --> B1',
        'A2 --> B2',
        'A3 --> B1',
        'A1 --> A2',
        '@enduml',
      ].join('\n'),
    );
    const layout = await new ElkLayoutEngine().layout(model);
    expect(layout.edges).toHaveLength(4);
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(countNonOrthogonalSegments(edge.points)).toBe(0);
    }
    const m = computeLayoutMetrics(model, layout);
    expect(m.nonOrthogonalEdgeCount).toBe(0);
    expect(m.edgeNodeIntersections).toBe(0);
  });

  it('routes package↔stub edges orthogonally in a single-package view', async () => {
    const model = packageView('Src_Mermaid_Layer');
    const layout = await new ElkLayoutEngine().layout(model);
    const m = computeLayoutMetrics(model, layout);
    expect(m.nonOrthogonalEdgeCount).toBe(0);
    expect(m.edgeNodeIntersections).toBeLessThanOrEqual(5);
  });

  it('keeps every all-classes package view orthogonal, uncluttered and well proportioned', async () => {
    let intersections = 0;
    for (const pkg of allClasses.packages) {
      const model = packageView(pkg.id);
      const layout = await new ElkLayoutEngine().layout(model);
      const m = computeLayoutMetrics(model, layout);
      expect(m.nonOrthogonalEdgeCount, pkg.id).toBe(0);
      expect(m.aspectRatio, pkg.id).toBeGreaterThanOrEqual(0.25);
      expect(m.aspectRatio, pkg.id).toBeLessThanOrEqual(4);
      expect(m.textOverflowCount, pkg.id).toBe(0);
      intersections += m.edgeNodeIntersections;
    }
    expect(intersections).toBeLessThanOrEqual(60);
  }, 120_000);

  it('lays the full all-classes graph out as a compact, browsable canvas', async () => {
    const model = transformFullGraph(allClasses);
    const layout = await new ElkLayoutEngine().layout(model);
    const m = computeLayoutMetrics(model, layout);
    expect(m.aspectRatio).toBeGreaterThanOrEqual(0.5);
    expect(m.aspectRatio).toBeLessThanOrEqual(2.5);
    expect(layout.width * layout.height).toBeLessThanOrEqual(100e6);
    expect(m.edgeCrossings).toBeLessThan(9027);
    expect(m.textOverflowCount).toBe(0);
    expect(m.nonOrthogonalEdgeCount).toBe(0);
  }, 120_000);

  it('is deterministic', async () => {
    const model = packageView('Src_Mermaid_Layer');
    const a = await new ElkLayoutEngine().layout(model);
    const b = await new ElkLayoutEngine().layout(model);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
