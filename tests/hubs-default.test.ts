import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, transformFullGraph } from '../src/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packagePuml = readFileSync(
  join(testDir, 'fixtures', 'archguard-package.puml'),
  'utf8',
);

describe('gap-layout-module-grouping-hubs: default hub summarization', () => {
  it('summarizes the src/types hub on the default full-graph render', () => {
    const model = parsePlantUml(packagePuml);
    const originalInDegree = new Set(
      model.relations.filter((r) => r.target === 'src_types').map((r) => r.source),
    ).size;

    const out = transformFullGraph(model);
    const srcTypes = out.entities.find((e) => e.id === 'src_types')!;
    expect(srcTypes).toBeDefined();
    expect(srcTypes.usageCount).toBe(originalInDegree);
    expect(out.relations.some((r) => r.target === 'src_types')).toBe(false);
  });

  it("draws the hub's incoming edges one-by-one when summarization is disabled", () => {
    const model = parsePlantUml(packagePuml);

    const out = transformFullGraph(model, { hubThreshold: undefined });
    expect(out.relations.some((r) => r.target === 'src_types')).toBe(true);
    const srcTypes = out.entities.find((e) => e.id === 'src_types')!;
    expect(srcTypes.usageCount).toBeUndefined();
  });
});
