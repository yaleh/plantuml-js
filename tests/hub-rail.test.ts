import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, transformFullGraph, ElkLayoutEngine } from '../src/index.js';
import { GRID } from '../src/layout.js';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('hub rail', () => {
  it('places m-package hubs in a side rail inside their package, clear of its content', async () => {
    const puml = readFileSync(join(testDir, 'fixtures', 'archguard-package.puml'), 'utf8');
    const model = transformFullGraph(parsePlantUml(puml));
    const layout = await new ElkLayoutEngine().layout(model);

    const touched = new Set(model.relations.flatMap((r) => [r.source, r.target]));
    const hubs = model.entities.filter((e) => (e.usageCount ?? 0) > 0 && !touched.has(e.id) && e.packageId === 'Src_Layer');
    expect(hubs.length).toBeGreaterThanOrEqual(3);

    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const frame = layout.packages!.find((p) => p.id === 'Src_Layer')!;
    const hubNodes = hubs.map((h) => byId.get(h.id)!);
    const hubIds = new Set(hubs.map((h) => h.id));
    const others = layout.nodes.filter(
      (n) => !hubIds.has(n.id) && model.entities.find((e) => e.id === n.id)?.packageId === 'Src_Layer',
    );

    // Same side: one column (same x), left of every other node of the package.
    const railRight = Math.max(...hubNodes.map((n) => n.x + n.width));
    expect(new Set(hubNodes.map((n) => n.x)).size).toBeLessThanOrEqual(2);
    for (const o of others) expect(o.x).toBeGreaterThanOrEqual(railRight + GRID);

    // Not a top row: the hubs are stacked vertically, not spread horizontally.
    const ys = hubNodes.map((n) => n.y);
    expect(new Set(ys).size).toBeGreaterThan(1);

    // Inside the frame, and ≥ one grid unit from any other node of the package.
    for (const h of hubNodes) {
      expect(h.x).toBeGreaterThanOrEqual(frame.x);
      expect(h.x + h.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(h.y).toBeGreaterThanOrEqual(frame.y);
      expect(h.y + h.height).toBeLessThanOrEqual(frame.y + frame.height);
      for (const o of others) {
        const gapX = Math.max(o.x - (h.x + h.width), h.x - (o.x + o.width));
        const gapY = Math.max(o.y - (h.y + h.height), h.y - (o.y + o.height));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(GRID);
      }
    }
    // Hubs do not overlap each other either.
    for (let i = 0; i < hubNodes.length; i++) {
      for (let j = i + 1; j < hubNodes.length; j++) {
        const a = hubNodes[i];
        const b = hubNodes[j];
        const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
        const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(GRID);
      }
    }
  });
});
