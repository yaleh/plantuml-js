import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, ElkLayoutEngine, renderDetailed } from '../src/index.js';
import { applyView, groupStubs, DEFAULT_STUB_GROUP_THRESHOLD } from '../src/transform.js';
import { PlantUmlModel, PlantUmlEntity } from '../src/foundation/model.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Single package `P` with one entity, plus 25 external packages with hierarchical names, each calling it. */
function manyStubModel(): PlantUmlModel {
  const names: string[] = [];
  for (const a of ['Src Cli', 'Src Core', 'Src Plugins']) {
    for (let i = 0; i < 9; i++) names.push(`${a} Part${i}`);
  }
  names.length = 25;
  const entities: PlantUmlEntity[] = [{ id: 'T', name: 'T', kind: 'class', members: [], packageId: 'P' }];
  const relations: PlantUmlModel['relations'] = [];
  names.forEach((name, i) => {
    entities.push({ id: `X${i}`, name: `X${i}`, kind: 'class', members: [], packageId: `pkg${i}` });
    relations.push({ source: `X${i}`, target: 'T', type: 'dependency' });
  });
  return {
    diagramType: 'class',
    entities,
    relations,
    packages: [{ id: 'P', name: 'P' }, ...names.map((name, i) => ({ id: `pkg${i}`, name }))],
  };
}

describe('single-package view stub grouping', () => {
  it('has a default threshold of 8', () => {
    expect(DEFAULT_STUB_GROUP_THRESHOLD).toBe(8);
  });

  it('merges 25 stubs into at most 8 group stubs, edges carry ×N and a <title> list', () => {
    const view = applyView(manyStubModel(), { kind: 'package', id: 'P' });
    const stubs = view.entities.filter((e) => e.stub);
    expect(stubs.length).toBeLessThanOrEqual(8);
    const groups = stubs.filter((s) => s.groupMembers);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      // readable label: member count and the "other packages" meaning, never `Src … (×N)`
      expect(g.name).toMatch(/^\d+ other .+ packages$/);
      expect(g.name).toContain(String(g.groupMembers!.length));
      expect(g.name).not.toMatch(/…|\(×/);
    }
    expect(stubs.some((s) => /…\s*\(×\d+\)/.test(s.name))).toBe(false);
    const grouped = view.relations.filter((r) => (r.weight ?? 1) > 1);
    expect(grouped.length).toBeGreaterThan(0);
    // every original edge is still accounted for, one description each
    expect(view.relations.reduce((n, r) => n + (r.weight ?? 1), 0)).toBe(25);
    for (const r of grouped) expect(r.descriptions).toHaveLength(r.weight!);
  });

  it('rendered edges of a group stub show ×N and a <title>', async () => {
    const { svg } = await renderDetailed(manyStubModel(), {
      layout: new ElkLayoutEngine(),
      view: { kind: 'package', id: 'P' },
    });
    expect(svg).toMatch(/×\d+/);
    expect(svg).toMatch(/<title>[^<]*dependency[^<]*<\/title>/);
  }, 60_000);

  it('lists every member of a group stub in its <title>', async () => {
    const { svg, model } = await renderDetailed(manyStubModel(), {
      layout: new ElkLayoutEngine(),
      view: { kind: 'package', id: 'P' },
    });
    for (const g of model.entities.filter((e) => e.groupMembers)) {
      const title = new RegExp(`<title>([^<]*${g.groupMembers![0]}[^<]*)</title>`).exec(svg)?.[1] ?? '';
      for (const member of g.groupMembers!) expect(title).toContain(member);
    }
  }, 60_000);

  it('leaves the view alone at or below the threshold, and honours stubGroupThreshold', () => {
    const model = manyStubModel();
    const off = applyView(model, { kind: 'package', id: 'P', stubGroupThreshold: 100 });
    expect(off.entities.filter((e) => e.stub)).toHaveLength(25);
    const tight = applyView(model, { kind: 'package', id: 'P', stubGroupThreshold: 3 });
    expect(tight.entities.filter((e) => e.stub).length).toBeLessThanOrEqual(3);
  });

  it('groupStubs keeps single-member groups intact', () => {
    const view = applyView(manyStubModel(), { kind: 'package', id: 'P', stubGroupThreshold: 100 });
    expect(groupStubs(view, 100)).toBe(view);
  });

  it('m-types-view: at most 8 stubs and a canvas at least 15% shorter than the 2068px baseline', async () => {
    const parsed = parsePlantUml(readFileSync(join(fixtures, 'all-classes.puml'), 'utf8'));
    const { model, layout } = await renderDetailed(parsed, {
      layout: new ElkLayoutEngine(),
      view: { kind: 'package', id: 'Src_Types_Layer' },
    });
    expect(model.entities.filter((e) => e.stub).length).toBeLessThanOrEqual(8);
    expect(layout.height).toBeLessThanOrEqual(2068 * 0.85);
  }, 120_000);

  it('m-types-view: group stubs carry readable names, no `… (×N)` literals', async () => {
    const parsed = parsePlantUml(readFileSync(join(fixtures, 'all-classes.puml'), 'utf8'));
    const { svg, model } = await renderDetailed(parsed, {
      layout: new ElkLayoutEngine(),
      view: { kind: 'package', id: 'Src_Types_Layer' },
    });
    expect(svg).not.toContain('… (×');
    expect(svg).not.toContain('…（×');
    const groups = model.entities.filter((e) => e.groupMembers);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.name).toMatch(/^\d+ other .+ packages$/);
  }, 120_000);
});
