import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { parsePlantUml } from '../src/parse/parser.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packagePuml = readFileSync(
  join(testDir, 'fixtures', 'archguard-package.puml'),
  'utf8',
);

describe('gap-layout-module-grouping-hubs: dependency-topology layer order', () => {
  it('stacks Tests and Examples above Src and keeps Templates out of the sandwich', async () => {
    const model = parsePlantUml(packagePuml);
    const layout = await new ElkLayoutEngine().layout(model);

    const frame = (id: string) => layout.packages!.find((p) => p.id === id)!;
    const tests = frame('Tests_Layer');
    const examples = frame('Examples_Layer');
    const src = frame('Src_Layer');
    const templates = frame('Templates_Layer');

    expect(tests).toBeDefined();
    expect(examples).toBeDefined();
    expect(src).toBeDefined();
    expect(templates).toBeDefined();

    // Dependents (Tests, Examples) sit above the layer they consume (Src).
    expect(tests.y).toBeLessThan(src.y);
    expect(examples.y).toBeLessThan(src.y);

    // Templates is independent — it must not sit between Src and Tests.
    const sandwiched =
      (templates.y > src.y && templates.y < tests.y) ||
      (templates.y > tests.y && templates.y < src.y);
    expect(sandwiched).toBe(false);
  });
});
