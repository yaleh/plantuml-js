import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, expectTypeOf } from 'vitest';
import * as fullEntry from '../src/index.js';
import * as elkEntry from '../src/elk.js';
import {
  createRenderer,
  checkSyntax,
  explain,
  parsePlantUml,
  renderDetailed,
  renderDot,
  RenderError,
} from '../src/index.js';
import type { DetailedRender as FullDetailedRender } from '../src/index.js';
import type { DetailedRender as ElkDetailedRender } from '../src/elk.js';

describe('checkSyntax', () => {
  it('warns (not errors) on implicitly declared relation endpoints', () => {
    const result = checkSyntax('@startuml\nclass A\nA --> B\n@enduml');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ line: 3, severity: 'warning' });
    expect(result.warnings[0].message).toContain('"B"');
  });

  it('returns ok for a valid diagram', () => {
    const result = checkSyntax('@startuml\nclass A\n@enduml');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns structured diagnostics instead of throwing on invalid input', () => {
    const result = checkSyntax('class A'); // content outside a diagram
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty('line');
    expect(result.errors[0]).toHaveProperty('message');
    expect(result.errors[0]).toHaveProperty('severity');
  });

  it('flags an unterminated diagram', () => {
    const result = checkSyntax('@startuml\nclass A');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /enduml/i.test(e.message))).toBe(true);
  });

  it('flags an unterminated quoted name', () => {
    const result = checkSyntax('@startuml\nclass "Unterminated\n@enduml');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /entity declaration/i.test(e.message))).toBe(
      true,
    );
  });
});

describe('explain', () => {
  it('explains a diagram line by line', () => {
    const lines = explain('@startuml\nclass A\n@enduml');
    expect(lines).toHaveLength(3);
    expect(lines[0].kind).toBe('directive');
    expect(lines[1].kind).toBe('entity');
    expect(lines[1].explanation).toMatch(/class "A"/);
    expect(lines[2].kind).toBe('directive');
  });

  it('classifies members, relations and packages', () => {
    const source = [
      '@startuml',
      'package "p" {',
      'class A {',
      '  - field: String',
      '}',
      'A --> B',
      '}',
      '@enduml',
    ].join('\n');
    const kinds = explain(source).map((l) => l.kind);
    expect(kinds).toContain('package');
    expect(kinds).toContain('member');
    expect(kinds).toContain('relation');
  });
});

describe('renderDot', () => {
  it('renders DOT to SVG with the default engine', async () => {
    const svg = await renderDot('digraph { a -> b }');
    expect(svg).toContain('<svg');
  });

  it('renders with an explicit engine', async () => {
    const svg = await renderDot('digraph { a -> b }', 'neato');
    expect(svg).toContain('<svg');
  });

  it('fails closed on invalid DOT', async () => {
    await expect(renderDot('this is not dot')).rejects.toThrow(/renderDot/);
  });
});

describe('renderDetailed public contract', () => {
  const puml = [
    '@startuml',
    'package "core" {',
    'class A {',
    '  +field: string',
    '}',
    'class B',
    '}',
    'A --> B',
    '@enduml',
  ].join('\n');

  it('is exported from both package entries (`.` and `./elk`)', () => {
    // The package `exports` map is the published contract; both entries must
    // resolve to modules that re-export the same core API.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(pkg.exports['.']).toMatchObject({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
    expect(pkg.exports['./elk']).toMatchObject({
      types: './dist/elk.d.ts',
      import: './dist/elk.js',
    });
    expect(typeof fullEntry.renderDetailed).toBe('function');
    expect(typeof elkEntry.renderDetailed).toBe('function');
  });

  it('DetailedRender is the same public type from both entries', () => {
    expectTypeOf<FullDetailedRender>().toEqualTypeOf<ElkDetailedRender>();
  });

  it('returns model, layout, svg, layoutMs and hiddenTransitive', async () => {
    const out = await renderDetailed(puml);

    // model: the post-view/transform/detail model that was actually drawn.
    expect(Array.isArray(out.model.entities)).toBe(true);
    expect(out.model.entities.map((e) => e.id)).toEqual(
      expect.arrayContaining(['A', 'B']),
    );
    expect(out.model.diagramType).toBeTypeOf('string');

    // layout: stable geometry.
    expect(Array.isArray(out.layout.nodes)).toBe(true);
    expect(Array.isArray(out.layout.edges)).toBe(true);
    expect(out.layout.nodes.length).toBeGreaterThan(0);
    expect(out.layout.width).toBeTypeOf('number');
    expect(out.layout.height).toBeTypeOf('number');

    // svg / timings / reduction bookkeeping.
    expect(out.svg).toContain('<svg');
    expect(out.layoutMs).toBeTypeOf('number');
    expect(out.layoutMs).toBeGreaterThanOrEqual(0);
    expect(out.hiddenTransitive).toBeTypeOf('number');
    expect(out.hiddenTransitive).toBe(0);

    expectTypeOf(out).toEqualTypeOf<FullDetailedRender>();
    expectTypeOf(out.model).toEqualTypeOf<FullDetailedRender['model']>();
    expectTypeOf(out.layout).toEqualTypeOf<FullDetailedRender['layout']>();
    expectTypeOf(out.svg).toBeString();
    expectTypeOf(out.layoutMs).toBeNumber();
    expectTypeOf(out.hiddenTransitive).toBeNumber();
  });

  it('exposes node/package/edge rectangles that match the SVG data attributes', async () => {
    const out = await renderDetailed(puml);

    const node = out.layout.nodes.find((n) => n.id === 'A');
    expect(node).toBeDefined();
    for (const n of out.layout.nodes) {
      expectTypeOf(n.x).toBeNumber();
      expectTypeOf(n.y).toBeNumber();
      expectTypeOf(n.width).toBeNumber();
      expectTypeOf(n.height).toBeNumber();
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
      expect(out.svg).toContain(`data-entity-id="${n.id}"`);
    }

    // ELK reports package frames; each id is the SVG package/grouping id.
    expect(out.layout.packages).toBeDefined();
    for (const p of out.layout.packages ?? []) {
      expectTypeOf(p.x).toBeNumber();
      expectTypeOf(p.y).toBeNumber();
      expectTypeOf(p.width).toBeNumber();
      expectTypeOf(p.height).toBeNumber();
      expect(out.svg).toContain(`data-package-id="${p.id}"`);
    }

    for (const e of out.layout.edges) {
      expect(Array.isArray(e.points)).toBe(true);
      expectTypeOf(e.points[0]?.x).toBeNumber();
      expectTypeOf(e.points[0]?.y).toBeNumber();
      expect(out.svg).toContain(`data-edge-source="${e.source}"`);
      expect(out.svg).toContain(`data-edge-target="${e.target}"`);
    }
  });

  it('still accepts an already-parsed model (harness path)', async () => {
    const out = await renderDetailed(parsePlantUml(puml));
    expect(out.model.entities.map((e) => e.id)).toEqual(
      expect.arrayContaining(['A', 'B']),
    );
    expect(out.svg).toContain('<svg');
  });

  it('fails closed on invalid puml with RenderError', async () => {
    await expect(renderDetailed('class A')).rejects.toBeInstanceOf(RenderError);
  });
});

describe('createRenderer error semantics', () => {
  it('throws a clear error for an unknown layout name', () => {
    expect(() => createRenderer({ layout: 'bogus' as never })).toThrow(
      /layout/,
    );
  });

  it('render throws RenderError on invalid puml', async () => {
    const renderer = createRenderer();
    await expect(renderer.render('class A')).rejects.toBeInstanceOf(RenderError);
  });
});
