import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlantUml, renderDetailed } from '../src/core.js';

function sixPackages(): string {
  const lines = ['@startuml'];
  for (let p = 0; p < 6; p++) {
    lines.push(`package "P${p}" as P${p} {`);
    for (let c = 0; c < 3; c++) lines.push(`  class P${p}C${c}`);
    lines.push(`  P${p}C0 --> P${p}C1`, '}');
  }
  lines.push('P0C0 --> P1C0', 'P2C0 --> P3C0', 'P4C0 --> P5C0', '@enduml');
  return lines.join('\n');
}

describe('package frame alignment', () => {
  it('aligns rows (same y) and columns (same x) of six packages within 1px', async () => {
    const { layout } = await renderDetailed(parsePlantUml(sixPackages()));
    const frames = layout.packages!;
    expect(frames).toHaveLength(6);
    for (const a of frames) {
      for (const b of frames) {
        if (a === b) continue;
        const sameRow = a.y < b.y + b.height && b.y < a.y + a.height;
        const sameCol = a.x < b.x + b.width && b.x < a.x + a.width;
        if (sameRow) expect(Math.abs(a.y - b.y), `${a.id}/${b.id} row`).toBeLessThanOrEqual(1);
        if (sameCol) expect(Math.abs(a.x - b.x), `${a.id}/${b.id} col`).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);

  it('left-aligns the architecture-manual frames and sets the isolated Utils frame level with its neighbour', async () => {
    const parsed = parsePlantUml(readFileSync(new URL('./fixtures/archguard-architecture-manual.puml', import.meta.url), 'utf8'));
    const { layout } = await renderDetailed(parsed);
    const f = (needle: string) => layout.packages!.find((p) => p.id.includes(needle))!;
    const utils = f('Utils');
    expect(Math.abs(f('Integration').x - utils.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(f('Parser').x - utils.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(f('CLI Layer').y - utils.y)).toBeLessThanOrEqual(1);
  }, 60_000);
});
