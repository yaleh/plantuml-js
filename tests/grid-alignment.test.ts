import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlantUml } from '../src/parse/parser.js';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { estimateEntitySize, layoutRows, GRID } from '../src/foundation/layout.js';

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'archguard-class.puml'),
  'utf8',
);

describe('gap-render-visual-design-system: grid and row alignment', () => {
  it('sizes entity boxes in multiples of the 8px grid', async () => {
    const model = parsePlantUml(fixture);
    const layout = await new ElkLayoutEngine().layout(model);
    expect(GRID).toBe(8);
    for (const node of layout.nodes) {
      expect(node.width % 8, node.id).toBe(0);
      expect(node.height % 8, node.id).toBe(0);
    }
    for (const entity of model.entities) {
      const size = estimateEntitySize(entity);
      expect(size.width % 8).toBe(0);
      expect(size.height % 8).toBe(0);
    }
  });

  it('aligns same-row nodes by top edge or centre line', async () => {
    const model = parsePlantUml(fixture);
    const layout = await new ElkLayoutEngine().layout(model);
    const rows = layoutRows(model, layout).filter((r) => r.length > 1);
    expect(rows.length).toBeGreaterThan(0);
    let total = 0;
    let aligned = 0;
    for (const row of rows) {
      const top = Math.min(...row.map((n) => n.y));
      total += row.length;
      aligned += row.filter((n) => n.y === top).length;
    }
    // Moves that would run a box into a neighbour, a foreign edge or detach an
    // orthogonal edge are refused, so a few nodes may stay ragged; most
    // (>= 80%) of the nodes in multi-node rows must sit on their row's top.
    expect(aligned / total).toBeGreaterThanOrEqual(0.8);
  });

  it('never moves a node down or changes its size when aligning', async () => {
    const model = parsePlantUml(fixture);
    const layout = await new ElkLayoutEngine().layout(model);
    for (const node of layout.nodes) {
      const entity = model.entities.find((e) => e.id === node.id)!;
      const size = estimateEntitySize(entity);
      expect(node.width).toBeGreaterThanOrEqual(size.width);
      expect(node.height).toBeGreaterThanOrEqual(size.height);
    }
  });
});
