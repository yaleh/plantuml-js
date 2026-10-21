import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, transformFullGraph, ElkLayoutEngine } from '../src/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));

/** One package holding `layers` rows of `width` classes; every class depends on two classes one layer down. */
function layeredPackage(layers: number, width: number): string {
  const lines = ['@startuml', 'package "Core" as Core {'];
  for (let l = 0; l < layers; l++) for (let i = 0; i < width; i++) lines.push(`  class N${l}_${i}`);
  lines.push('}');
  for (let l = 0; l + 1 < layers; l++) {
    for (let i = 0; i < width; i++) {
      lines.push(`N${l}_${i} --> N${l + 1}_${i}`);
      lines.push(`N${l}_${i} --> N${l + 1}_${(i + 3) % width}`);
    }
  }
  lines.push('@enduml');
  return lines.join('\n');
}

describe('package dependency flow', () => {
  it('keeps upstream nodes above their dependencies inside a compacted package (5-layer chain)', async () => {
    const model = parsePlantUml(layeredPackage(5, 10));
    const layout = await new ElkLayoutEngine().layout(model);
    const top = new Map(layout.nodes.map((n) => [n.id, n.y]));
    let reversed = 0;
    for (const r of model.relations) {
      if (top.get(r.source)! > top.get(r.target)!) reversed++;
    }
    expect(model.relations.length).toBeGreaterThan(50);
    expect(reversed / model.relations.length).toBeLessThanOrEqual(0.1);
  });

  it('places src/cli/commands above src/types in the m-package Src Layer', async () => {
    const puml = readFileSync(join(testDir, 'fixtures', 'archguard-package.puml'), 'utf8');
    const model = transformFullGraph(parsePlantUml(puml));
    const layout = await new ElkLayoutEngine().layout(model);
    const y = (id: string): number => layout.nodes.find((n) => n.id === id)!.y;
    expect(y('src_cli_commands')).toBeLessThan(y('src_types'));
  });
});
