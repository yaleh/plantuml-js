import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parsePlantUml,
  applyView,
  transformModel,
  ElkLayoutEngine,
} from '../src/index.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import { PlantUmlModel } from '../src/model.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packagePuml = readFileSync(
  join(testDir, 'fixtures', 'archguard-package.puml'),
  'utf8',
);

describe('gap-layout-packing-viz-metrics-truth: packing', () => {
  it('wraps 12 disconnected nodes into a grid with aspect ratio ≤ 3', async () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: Array.from({ length: 12 }, (_, i) => ({
        id: `n${i}`,
        name: `node_${i}`,
        kind: 'class' as const,
        members: [],
      })),
      relations: [],
      packages: [],
    };

    const layout = await new ElkLayoutEngine().layout(model);
    const m = computeLayoutMetrics(model, layout);
    expect(m.aspectRatio).toBeLessThanOrEqual(3);
  });

  it('renders the Tests Layer single-package view with aspect ratio ≤ 3', async () => {
    const model = parsePlantUml(packagePuml);
    const viewed = transformModel(
      applyView(model, { kind: 'package', id: 'Tests_Layer' }),
      { aggregate: true, cycles: true },
    );

    const layout = await new ElkLayoutEngine().layout(viewed);
    const m = computeLayoutMetrics(viewed, layout);
    expect(m.aspectRatio).toBeLessThanOrEqual(3);
  });
});
