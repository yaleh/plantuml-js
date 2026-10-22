import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, ElkLayoutEngine, transformFullGraph } from '../src/index.js';
import { computeLayoutMetrics } from '../src/metrics/layout-metrics.js';
import { gridPack } from '../src/layout/compound.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

/** Every pair sharing a column (or a row) has the same left (or top) edge, and cells fill row by row. */
function expectGrid(nodes: Array<{ x: number; y: number; width: number; height: number }>): void {
  const lefts: number[] = [];
  const tops: number[] = [];
  for (const n of nodes) {
    if (!lefts.some((x) => near(x, n.x))) lefts.push(n.x);
    if (!tops.some((y) => near(y, n.y))) tops.push(n.y);
  }
  const cols = lefts.length;
  const rows = tops.length;
  expect(cols * rows).toBeGreaterThanOrEqual(nodes.length);
  // no hole before the last row: every row but the last holds `cols` nodes
  const perRow = tops.map((y) => nodes.filter((n) => near(n.y, y)).length);
  perRow.sort((a, b) => b - a);
  expect(perRow.slice(0, rows - 1).every((c) => c === cols)).toBe(true);
}

describe('gridPack: unconnected boxes in equal columns', () => {
  const boxes = Array.from({ length: 12 }, (_, i) => ({
    id: `n${i}`,
    width: 100 + (i % 5) * 60,
    height: 40 + (i % 3) * 20,
  }));
  const packed = gridPack(boxes, boxes.map((b) => b.id), 1.3, 40);
  const cells = (packed.children ?? []).map((c) => ({ x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 }));

  it('aligns left edges per column and top edges per row, with no hole before the last row', () => {
    expect(cells).toHaveLength(12);
    expectGrid(cells);
  });

  it('keeps every box inside the block and lands near the requested ratio', () => {
    for (const c of cells) {
      expect(c.x + c.width).toBeLessThanOrEqual((packed.width ?? 0) + 1e-6);
      expect(c.y + c.height).toBeLessThanOrEqual((packed.height ?? 0) + 1e-6);
    }
    const aspect = (packed.width ?? 1) / (packed.height ?? 1);
    expect(aspect).toBeGreaterThan(0.8);
    expect(aspect).toBeLessThan(2.0);
  });
});

describe('gridPack: tight columns', () => {
  const boxes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, width: 64 + i * 40, height: 40 }));
  const packed = gridPack(boxes, boxes.map((b) => b.id), 1.3, 24, 24);
  const cells = packed.children ?? [];

  it('spaces adjacent columns by the column widest box plus the gap, and wraps the frame round them', () => {
    const lefts = [...new Set(cells.map((c) => Math.round(c.x ?? 0)))].sort((a, b) => a - b);
    expect(lefts.length).toBeGreaterThan(1);
    const widths: number[] = [];
    lefts.forEach((left, k) => {
      const col = cells.filter((c) => Math.round(c.x ?? 0) === left);
      const widest = Math.max(...col.map((c) => c.width ?? 0));
      widths.push(widest);
      if (k > 0) expect(left - lefts[k - 1]).toBeLessThanOrEqual(widths[k - 1] + 32);
    });
    const inner = 20; // SHELF_PADDING side × 2
    expect(packed.width ?? 0).toBeLessThanOrEqual(widths.reduce((a, b) => a + b, 0) + 24 * (lefts.length - 1) + inner + 1e-6);
  });
});

describe('m-package Tests Layer', () => {
  it('is a tidy grid, top-aligned with the small boxes beside it', async () => {
    const parsed = parsePlantUml(readFileSync(join(fixtures, 'archguard-package.puml'), 'utf8'));
    const model = transformFullGraph(parsed);
    const layout = await new ElkLayoutEngine().layout(model);
    const frame = layout.packages!.find((p) => p.id === 'Tests_Layer')!;
    expect(frame).toBeDefined();
    const ids = new Set(model.entities.filter((e) => e.packageId === 'Tests_Layer').map((e) => e.id));
    const nodes = layout.nodes.filter((n) => ids.has(n.id));
    expect(nodes.length).toBe(12);
    expectGrid(nodes);
    const lefts = [...new Set(nodes.map((n) => Math.round(n.x)))].sort((a, b) => a - b);
    lefts.forEach((left, k) => {
      if (k === 0) return;
      const prev = nodes.filter((n) => Math.round(n.x) === lefts[k - 1]);
      expect(left - lefts[k - 1]).toBeLessThanOrEqual(Math.max(...prev.map((n) => n.width)) + 32);
    });
    const colSum = lefts.reduce((s, left) => s + Math.max(...nodes.filter((n) => Math.round(n.x) === left).map((n) => n.width)), 0);
    expect(frame.width).toBeLessThanOrEqual(colSum + 32 * (lefts.length - 1) + 40);
    expect(computeLayoutMetrics({ ...model, entities: model.entities.filter((e) => ids.has(e.id)) }, { ...layout, nodes, edges: [], packages: [frame], width: layout.width, height: layout.height }).frameFillRatio).toBeGreaterThanOrEqual(0.4);
    expect(layout.width).toBeLessThanOrEqual(1700);
    const aspect = frame.width / frame.height;
    expect(aspect).toBeGreaterThanOrEqual(0.8);
    expect(aspect).toBeLessThanOrEqual(2.0);
    const small = layout.packages!.filter((p) => p.id !== 'Src_Layer' && p.id !== frame.id && p.height <= 100);
    expect(small.length).toBeGreaterThanOrEqual(2);
    for (const p of small) expect(Math.abs(p.y - frame.y), p.id).toBeLessThanOrEqual(1);
  }, 60_000);
});
