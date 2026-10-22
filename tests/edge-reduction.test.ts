import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parsePlantUml, renderDetailed, computeLayoutMetrics } from '../src/core.js';

/** A→B→C plus A→C, padded with parallel chains so edges > 3× nodes. */
function denseDependencyPuml(extraRelation = ''): string {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const lines = ['@startuml', ...names.map((n) => `class ${n}`), ...(extraRelation ? ['class I'] : [])];
  // Complete forward DAG over 8 nodes: 28 edges > 3 × 8 nodes.
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) lines.push(`${names[i]} ..> ${names[j]}`);
  }
  if (extraRelation) lines.push(extraRelation);
  lines.push('@enduml');
  return lines.join('\n');
}

const edgeKeys = (model: { relations: { source: string; target: string }[] }) =>
  model.relations.map((r) => `${r.source}->${r.target}`).sort();

describe('edgeReduction', () => {
  it('auto hides the transitive A→C of a dense pure-dependency graph and reports it', async () => {
    const out = await renderDetailed(parsePlantUml(denseDependencyPuml()), {});
    expect(edgeKeys(out.model)).toEqual(['A->B', 'B->C', 'C->D', 'D->E', 'E->F', 'F->G', 'G->H']);
    expect(out.hiddenTransitive).toBe(21);
    expect(out.svg).toContain('data-hidden-transitive="21"');
    expect(out.svg).toContain('21 transitive dependencies hidden');
    expect(out.svg).toContain('uml-legend');
  });

  it('auto does not reduce a graph containing inheritance/composition edges', async () => {
    for (const extra of ['I --|> A', 'I *-- A']) {
      const out = await renderDetailed(parsePlantUml(denseDependencyPuml(extra)), {});
      expect(out.model.relations).toHaveLength(29);
      expect(out.hiddenTransitive).toBe(0);
      expect(out.svg).not.toContain('data-hidden-transitive');
    }
  });

  it('auto does not reduce a sparse dependency graph (A→B, B→C, A→C)', async () => {
    const puml = '@startuml\nclass A\nclass B\nclass C\nA ..> B\nB ..> C\nA ..> C\n@enduml';
    const out = await renderDetailed(parsePlantUml(puml), {});
    expect(out.model.relations).toHaveLength(3);
  });

  it("'transitive' forces reduction on a sparse graph", async () => {
    const puml = '@startuml\nclass A\nclass B\nclass C\nA ..> B\nB ..> C\nA ..> C\n@enduml';
    const out = await renderDetailed(parsePlantUml(puml), { edgeReduction: 'transitive' });
    expect(edgeKeys(out.model)).toEqual(['A->B', 'B->C']);
    expect(out.svg).toContain('data-hidden-transitive="1"');
    expect(out.svg).toContain('1 transitive dependency hidden');
  });

  it("'none' restores every edge", async () => {
    const out = await renderDetailed(parsePlantUml(denseDependencyPuml()), { edgeReduction: 'none' });
    expect(out.model.relations).toHaveLength(28);
    expect(out.hiddenTransitive).toBe(0);
    expect(out.svg).not.toContain('data-hidden-transitive');
  });

  it('keeps cycle edges connected (reachability is preserved)', async () => {
    const puml = '@startuml\nclass A\nclass B\nclass C\nA ..> B\nB ..> C\nC ..> A\nA ..> C\n@enduml';
    const out = await renderDetailed(parsePlantUml(puml), { edgeReduction: 'transitive' });
    // A→C is redundant via A→B→C; the A→B→C→A cycle survives.
    expect(edgeKeys(out.model)).toEqual(['A->B', 'B->C', 'C->A']);
  });

  it('records layoutMs for the layout engine only', async () => {
    const out = await renderDetailed(parsePlantUml(denseDependencyPuml()), {});
    expect(out.layoutMs).toBeGreaterThan(0);
    expect(computeLayoutMetrics(out.model, out.layout, out.layoutMs).layoutMs).toBe(out.layoutMs);
  });
});

describe('m-package fixture', () => {
  const puml = readFileSync(new URL('./fixtures/archguard-package.puml', import.meta.url), 'utf8');

  it('auto shows ≤70% of the authored edges and fewer crossings than none', async () => {
    const parsed = parsePlantUml(puml);
    const reduced = await renderDetailed(parsed, {});
    const full = await renderDetailed(parsed, { edgeReduction: 'none' });
    expect(reduced.model.relations.length).toBeLessThanOrEqual(parsed.relations.length * 0.7);
    expect(reduced.hiddenTransitive).toBeGreaterThan(0);
    const crossings = (r: typeof full) => computeLayoutMetrics(r.model, r.layout).edgeCrossings;
    expect(crossings(reduced)).toBeLessThanOrEqual(crossings(full) * 0.75);
  }, 60000);

  it('leaves S-tier class diagrams untouched', async () => {
    const klass = parsePlantUml(readFileSync(new URL('./fixtures/archguard-class.puml', import.meta.url), 'utf8'));
    const a = await renderDetailed(klass, {});
    const b = await renderDetailed(klass, { edgeReduction: 'none' });
    expect(a.model.relations).toHaveLength(b.model.relations.length);
    expect(a.hiddenTransitive).toBe(0);
  });
});
