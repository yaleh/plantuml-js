import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { createRenderer } from '../src/core.js';
import { parsePlantUml } from '../src/parse/parser.js';

const testDir = dirname(fileURLToPath(import.meta.url));

function syntheticModel(): string {
  const lines = ['@startuml'];
  for (let p = 0; p < 30; p++) {
    lines.push(`package "pkg${p}" {`);
    for (let c = 0; c < 4; c++) lines.push(`  class P${p}C${c}`);
    lines.push('}');
  }
  for (let p = 0; p < 27; p += 3) lines.push(`P${p}C0 --> P${p + 1}C1`);
  lines.push('@enduml');
  return lines.join('\n');
}

async function ratio(aspectRatio: number): Promise<number> {
  const model = parsePlantUml(syntheticModel());
  const layout = await new ElkLayoutEngine({ aspectRatio }).layout(model);
  return layout.width / layout.height;
}

describe('layoutOptions.aspectRatio', () => {
  it('canvas ratio follows the requested aspectRatio monotonically within ±30%', async () => {
    const targets = [0.5, 1, 2];
    const got: number[] = [];
    for (const t of targets) got.push(await ratio(t));
    expect(got[0]).toBeLessThan(got[1]);
    expect(got[1]).toBeLessThan(got[2]);
    targets.forEach((t, i) => {
      expect(got[i]).toBeGreaterThanOrEqual(t * 0.7);
      expect(got[i]).toBeLessThanOrEqual(t * 1.3);
    });
  });

  it('is deterministic for identical options', async () => {
    const model = parsePlantUml(syntheticModel());
    const a = await new ElkLayoutEngine({ aspectRatio: 2 }).layout(model);
    const b = await new ElkLayoutEngine({ aspectRatio: 2 }).layout(model);
    expect(b).toEqual(a);
  });

  it('omitting layoutOptions renders byte-identically to empty layoutOptions', async () => {
    const puml = readFileSync(join(testDir, 'fixtures', 'archguard-package.puml'), 'utf8');
    const base = await createRenderer().render(puml);
    const again = await createRenderer({ layout: 'elk', layoutOptions: {} }).render(puml);
    expect(again.svg).toBe(base.svg);
  });
});
