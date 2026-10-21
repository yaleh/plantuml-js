import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ElkLayoutEngine } from '../src/elk.js';
import { parsePlantUml, renderDetailed } from '../src/core.js';

const fixture = readFileSync(new URL('./fixtures/archguard-package.puml', import.meta.url), 'utf8');

describe('small root layers on the package overview', () => {
  it('packs the Tests Layer into a grid and top-aligns it with the other small layers', async () => {
    const { layout } = await renderDetailed(parsePlantUml(fixture), { layout: new ElkLayoutEngine() });
    const frames = layout.packages!;
    const tests = frames.find((p) => p.id === 'Tests_Layer')!;
    expect(tests).toBeDefined();

    // A grid, not a tall column (or a flat strip): within 2.5:1 either way.
    const aspect = tests.width / tests.height;
    expect(aspect).toBeLessThanOrEqual(2.5);
    expect(aspect).toBeGreaterThanOrEqual(1 / 2.5);
    const columns = new Set(layout.nodes.filter((n) => n.x >= tests.x && n.x < tests.x + tests.width && n.y >= tests.y && n.y < tests.y + tests.height).map((n) => Math.round(n.x)));
    expect(columns.size).toBeGreaterThanOrEqual(2);

    // The other small root layers (single-row frames) sit in the same row, tops level.
    const small = frames.filter((p) => !p.id.includes('/') && p.id !== 'Src_Layer' && p.id !== 'Tests_Layer' && p.height <= 100);
    expect(small.length).toBeGreaterThanOrEqual(2);
    for (const f of small) expect(Math.abs(f.y - tests.y), f.id).toBeLessThanOrEqual(1);
  }, 60_000);
});
