import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parsePlantUml,
  transformView,
  transformFullGraph,
  applyView,
  transformModel,
  ElkLayoutEngine,
  renderSvg,
} from '../src/index.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import { placeEdgeLabels, rectsIntersect } from '../src/render/labels.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packagePuml = readFileSync(join(testDir, 'fixtures', 'archguard-package.puml'), 'utf8');

describe('package-overview legibility', () => {
  it('uses at least 15% of the canvas and keeps weight labels apart', async () => {
    const model = transformView(parsePlantUml(packagePuml), { kind: 'overview', depth: 2 });
    const layout = await new ElkLayoutEngine().layout(model);
    const metrics = computeLayoutMetrics(model, layout);

    expect(metrics.areaUtilization).toBeGreaterThanOrEqual(0.15);
    expect(metrics.edgeLabelOverlap).toBe(0);

    const labels = placeEdgeLabels(model, layout);
    expect(labels.filter((l) => l.kind === 'weight').length).toBeGreaterThan(0);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(rectsIntersect(labels[i].rect, labels[j].rect)).toBe(false);
      }
    }
  });

  it('draws every weight label on a white backing box', async () => {
    const model = transformView(parsePlantUml(packagePuml), { kind: 'overview', depth: 2 });
    const layout = await new ElkLayoutEngine().layout(model);
    const svg = renderSvg(model, layout);
    const weighted = model.relations.filter((r) => (r.weight ?? 1) > 1).length;
    expect(weighted).toBeGreaterThan(0);
    expect(svg.match(/class="uml-edge-label-bg"[^>]*fill="#ffffff"/g)?.length).toBe(weighted);
  });
});

describe('full graph and views share one pipeline', () => {
  it('keeps the full package canvas within 2400px with a compact Tests Layer', async () => {
    const model = transformFullGraph(parsePlantUml(packagePuml));
    const layout = await new ElkLayoutEngine().layout(model);
    expect(layout.width).toBeLessThanOrEqual(2400);

    const tests = layout.packages!.find((p) => p.id === 'Tests_Layer')!;
    expect(tests.width / tests.height).toBeLessThanOrEqual(3);
  });

  it('applies default hub summarization to a large single-package view', () => {
    const view = transformView(parsePlantUml(packagePuml), { kind: 'package', id: 'Src_Layer' });
    expect(view.entities.some((e) => (e.usageCount ?? 0) > 0)).toBe(true);
  });

  it('lays the Src Layer view out no more tangled than the full graph', async () => {
    const parsed = parsePlantUml(packagePuml);
    const engine = new ElkLayoutEngine();

    const full = transformFullGraph(parsed);
    const fullLayout = await engine.layout(full);
    const srcIds = new Set(full.entities.filter((e) => e.packageId === 'Src_Layer').map((e) => e.id));
    // The view draws exactly the edges that touch the package, so compare it to
    // the same edge subset of the full drawing.
    const touches = (r: { source: string; target: string }): boolean =>
      srcIds.has(r.source) || srcIds.has(r.target);
    const kept = full.relations.map((r, i) => ({ r, i })).filter(({ r }) => touches(r));
    const fullSrc = computeLayoutMetrics(
      { ...full, relations: kept.map(({ r }) => r) },
      {
        ...fullLayout,
        edges: kept.map(({ i }, k) => ({ ...fullLayout.edges[i], id: `rel-${k}` })),
      },
    );

    const view = transformView(parsed, { kind: 'package', id: 'Src_Layer' });
    const viewMetrics = computeLayoutMetrics(view, await engine.layout(view));
    expect(viewMetrics.edgeNodeIntersections).toBe(0);
    // Both drawings repack the sparse Src block and grid-route its edges; allow
    // a 10% lane-assignment difference between the two runs.
    expect(viewMetrics.edgeCrossings).toBeLessThanOrEqual(Math.ceil(fullSrc.edgeCrossings * 1.1));
  });

  it('matches the manual aggregate+cycles view for small views', () => {
    const parsed = parsePlantUml(packagePuml);
    const manual = transformModel(applyView(parsed, { kind: 'package', id: 'Tests_Layer' }), {
      aggregate: true,
      cycles: true,
    });
    expect(transformView(parsed, { kind: 'package', id: 'Tests_Layer' })).toEqual(manual);
  });
});
