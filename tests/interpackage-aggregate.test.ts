import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRenderer, parsePlantUml, renderDetailed } from '../src/core.js';

const twoPackages = `@startuml
package "A" as A {
  class A1
  class A2
  class A3
}
package "B" as B {
  class B1
  class B2
}
A1 --> B1
A1 --> B2
A2 --> B1
A3 ..> B2
A1 --> A2
@enduml`;

describe('inter-package aggregation', () => {
  it('folds N cross-package edges into one box-to-box edge with data-weight, ×N and per-edge titles', async () => {
    const { svg, model } = await renderDetailed(parsePlantUml(twoPackages), { interPackage: 'aggregate' });
    const cross = model.relations.filter((r) => r.sourcePackageId);
    expect(cross).toHaveLength(1);
    expect(cross[0]).toMatchObject({ sourcePackageId: 'A', targetPackageId: 'B', weight: 4 });
    expect(svg).toMatch(/data-weight="4"/);
    expect(svg).toContain('×4');
    const title = /<title>([^<]*A1 -- ?&gt;[^<]*)<\/title>/.exec(svg)?.[1] ?? /<title>([^<]*)<\/title>/.exec(svg)![1];
    for (const line of ['A1 --&gt; B1', 'A1 --&gt; B2', 'A2 --&gt; B1', 'A3 ..&gt; B2']) expect(title).toContain(line);
    // intra-package edge stays untouched
    expect(model.relations.some((r) => r.source === 'A1' && r.target === 'A2' && !r.sourcePackageId)).toBe(true);
  });

  it("keeps every edge with interPackage: 'raw'", async () => {
    const { model } = await renderDetailed(parsePlantUml(twoPackages), { interPackage: 'raw' });
    expect(model.relations.filter((r) => r.sourcePackageId)).toHaveLength(0);
    expect(model.relations).toHaveLength(5);
  });

  it('defaults to aggregate above 150 entities and raw below', async () => {
    const small = await renderDetailed(parsePlantUml(twoPackages));
    expect(small.model.relations).toHaveLength(5);
    const lines = ['@startuml', 'package "P" as P {'];
    for (let i = 0; i < 80; i++) lines.push(`  class P${i}`);
    lines.push('}', 'package "Q" as Q {');
    for (let i = 0; i < 80; i++) lines.push(`  class Q${i}`);
    lines.push('}', 'P0 --> Q0', 'P1 --> Q1', 'P2 --> Q2', '@enduml');
    const big = await renderDetailed(parsePlantUml(lines.join('\n')));
    expect(big.model.relations.filter((r) => r.sourcePackageId)).toHaveLength(1);
    expect(big.model.relations[0].weight).toBe(3);
  }, 60_000);

  it('renders deterministically', async () => {
    const r = createRenderer({ interPackage: 'aggregate' });
    expect((await r.render(twoPackages)).svg).toBe((await r.render(twoPackages)).svg);
  });

  it('shrinks the all-classes cross-package edge set to <= 40%', async () => {
    const parsed = parsePlantUml(readFileSync(new URL('./fixtures/all-classes.puml', import.meta.url), 'utf8'));
    const pkg = new Map(parsed.entities.map((e) => [e.id, e.packageId]));
    const original = parsed.relations.filter((r) => pkg.get(r.source) && pkg.get(r.target) && pkg.get(r.source) !== pkg.get(r.target)).length;
    const { model } = await renderDetailed(parsed);
    const aggregated = model.relations.filter((r) => r.descriptions).length;
    expect(aggregated).toBeGreaterThan(0);
    expect(aggregated).toBeLessThanOrEqual(original * 0.4);
  }, 120_000);
});
