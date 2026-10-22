import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, ElkLayoutEngine, transformFullGraph } from '../src/index.js';
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
    const aspect = frame.width / frame.height;
    expect(aspect).toBeGreaterThanOrEqual(0.8);
    expect(aspect).toBeLessThanOrEqual(2.0);
    const small = layout.packages!.filter((p) => ['Examples_Layer', 'Templates_Layer', '(root)_Layer'].includes(p.id) || /^(Root|Examples|Templates)/.test(p.id));
    for (const p of small) expect(near(p.y, frame.y) || p.y <= frame.y).toBe(true);
  }, 60_000);
});
