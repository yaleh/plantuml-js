import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRenderer, parsePlantUml } from '../src/index.js';
import { applyView, aggregateRelations } from '../src/transform/transform.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packagePuml = readFileSync(
  join(testDir, 'fixtures', 'archguard-package.puml'),
  'utf8',
);

/** Minimal well-formedness check: balanced, correctly nested XML tags. */
function isWellFormedXml(xml: string): boolean {
  const tagRe = /<(\/?)([a-zA-Z][\w.-]*)([^>]*)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    const [, closing, name, rest] = match;
    const selfClosing = /\/$/.test(rest.trim());
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

describe('gap-layout-abstraction-views: package view', () => {
  it('renders stubs for external packages and hides other packages\' entities', async () => {
    const renderer = createRenderer({ view: { kind: 'package', id: 'Src_Layer' } });
    const { svg } = await renderer.render(packagePuml);

    expect(isWellFormedXml(svg)).toBe(true);
    // Stub nodes for the two external packages that reference Src Layer.
    expect(svg).toContain('uml-stub');
    expect(svg).toContain('Examples Layer');
    expect(svg).toContain('Tests Layer');
    // The selected package frame and one of its entities are present…
    expect(svg).toContain('Src Layer');
    expect(svg).toContain('>src/parser</text>');
    // …but entities of other packages are not drawn as nodes.
    expect(svg).not.toContain('>examples</text>');
    expect(svg).not.toContain('mock-plugin');
  });

  it('renders the package view byte-identically across repeated renders', async () => {
    const renderer = createRenderer({ view: { kind: 'package', id: 'Src_Layer' } });
    const a = await renderer.render(packagePuml);
    const b = await renderer.render(packagePuml);
    expect(a.svg).toBe(b.svg);
  });
});

describe('gap-layout-abstraction-views: overview view', () => {
  it('collapses packages into nodes and aggregates inter-package edges', () => {
    const model = parsePlantUml(packagePuml);
    const viewed = applyView(model, { kind: 'overview' });

    expect(viewed.packages).toHaveLength(0);
    expect(viewed.entities).toHaveLength(5); // five top-level packages
    expect(viewed.entities.every((e) => e.stub)).toBe(true);

    for (const r of viewed.relations) {
      expect(r.source.startsWith('ov::')).toBe(true);
      expect(r.target.startsWith('ov::')).toBe(true);
    }

    const aggregated = aggregateRelations(viewed);
    const keys = new Set(aggregated.relations.map((r) => `${r.source}\u0000${r.target}`));
    expect(keys.size).toBe(aggregated.relations.length); // duplicates merged
    expect(aggregated.relations.some((r) => (r.weight ?? 1) > 1)).toBe(true);
  });
});

describe('gap-layout-abstraction-views: neighborhood view', () => {
  it('keeps only the seed and its neighbours within hops', () => {
    const model = parsePlantUml(packagePuml);
    const viewed = applyView(model, { kind: 'neighborhood', entity: 'src_parser', hops: 1 });

    const ids = new Set(viewed.entities.map((e) => e.id));
    expect(ids.has('src_parser')).toBe(true);
    expect(ids.has('examples')).toBe(true);
    expect(ids.has('src')).toBe(true);
    expect(ids.has('tests_fixtures_mock_plugin')).toBe(false);
  });
});
