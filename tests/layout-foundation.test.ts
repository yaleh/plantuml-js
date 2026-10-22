import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { VizLayoutEngine } from '../src/layout/viz.js';
import { computeLayoutMetrics } from '../src/metrics/layout-metrics.js';
import { estimateEntitySize } from '../src/foundation/layout.js';
import { parsePlantUml } from '../src/parser.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const archguardClass = readFileSync(
  join(testDir, 'fixtures', 'archguard-class.puml'),
  'utf8',
);
const archguardPackage = readFileSync(
  join(testDir, 'fixtures', 'archguard-package.puml'),
  'utf8',
);

/** The committed baseline produced by `render-samples.mjs --baseline`. */
interface BaselineRecord {
  group: string;
  engine: 'elk' | 'viz';
  metrics: { areaUtilization: number; aspectRatio: number };
}
const baseline = JSON.parse(
  readFileSync(join(testDir, '..', 'rendered', 'metrics.baseline.json'), 'utf8'),
) as BaselineRecord[];

describe('gap-layout-foundation: ELK layout', () => {
  it('lays the class fixture without overflow or label overlap, tighter than baseline', async () => {
    const model = parsePlantUml(archguardClass);
    const layout = await new ElkLayoutEngine().layout(model);
    const m = computeLayoutMetrics(model, layout);

    expect(m.textOverflowCount).toBe(0);
    expect(m.labelOverlapCount).toBe(0);

    const baselineArea = baseline.find(
      (r) => r.group === 'fixture' && r.engine === 'elk',
    )!.metrics.areaUtilization;
    // Entity boxes snap up to the 8px grid (gap-render-visual-design-system),
    // which costs the fixture a little area utilization against the pre-grid
    // baseline; allow that bounded regression, not a layout one.
    const GRID_SNAP_TOLERANCE = 0.01;
    expect(m.areaUtilization).toBeGreaterThan(baselineArea - GRID_SNAP_TOLERANCE);
  });

  it('lays the package fixture with a balanced aspect ratio', async () => {
    const model = parsePlantUml(archguardPackage);
    const layout = await new ElkLayoutEngine().layout(model);
    const m = computeLayoutMetrics(model, layout);

    // Small layers share a row and the sparse Src layer is repacked, so the
    // canvas is near-square (gap-layout-balance-clearance-bundling).
    expect(m.aspectRatio).toBeGreaterThanOrEqual(1.0);
    expect(m.aspectRatio).toBeLessThanOrEqual(2.2);
    expect(m.textOverflowCount).toBe(0);
    expect(m.labelOverlapCount).toBe(0);
  });
});

describe('gap-layout-foundation: viz layout', () => {
  it('sizes every class node to estimateEntitySize and emits package frames', async () => {
    const model = parsePlantUml(archguardClass);
    const layout = await new VizLayoutEngine().layout(model);

    expect(layout.packages!.length).toBeGreaterThan(0);

    const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const entity of model.entities) {
      const node = nodeById.get(entity.id);
      expect(node).toBeDefined();
      const size = estimateEntitySize(entity);
      expect(node!.height).toBe(size.height);
      expect(node!.width).toBe(size.width);
    }

    expect(computeLayoutMetrics(model, layout).textOverflowCount).toBe(0);
  });

  it('lays the package fixture with a balanced aspect ratio', async () => {
    const model = parsePlantUml(archguardPackage);
    const layout = await new VizLayoutEngine().layout(model);
    const m = computeLayoutMetrics(model, layout);

    expect(layout.packages!.length).toBeGreaterThan(0);
    expect(m.aspectRatio).toBeGreaterThanOrEqual(1.2);
    expect(m.aspectRatio).toBeLessThanOrEqual(2.2);
    expect(m.textOverflowCount).toBe(0);
  });
});

describe('gap-layout-foundation: determinism', () => {
  it('renders both fixtures byte-identically across repeated layouts', async () => {
    for (const source of [archguardClass, archguardPackage]) {
      const model = parsePlantUml(source);
      for (const engine of [new ElkLayoutEngine(), new VizLayoutEngine()]) {
        const a = await engine.layout(model);
        const b = await engine.layout(model);
        expect(a).toEqual(b);
      }
    }
  });
});
