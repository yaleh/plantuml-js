import { describe, it, expect } from 'vitest';
import {
  createRenderer,
  checkSyntax,
  explain,
  renderDot,
  RenderError,
} from '../src/index.js';

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
