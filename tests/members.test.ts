import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRenderer, parsePlantUml } from '../src/index.js';
import { estimateEntitySize, METRICS } from '../src/layout.js';
import { measureTextWidth } from '../src/text-measure.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const archguardClass = readFileSync(
  join(fixtureDir, 'archguard-class.puml'),
  'utf8',
);

describe('M2 members and generics', () => {
  it('parses visibility, field vs method, and modifiers', () => {
    const model = parsePlantUml(
      [
        '@startuml',
        'class A {',
        '  +publicField: number',
        '  -privateField: string',
        '  #protectedField?: boolean',
        '  ~packageField',
        '  +async analyze(input: string): number',
        '  +{static} build(config: object): A',
        '}',
        '@enduml',
      ].join('\n'),
    );
    const a = model.entities[0];
    expect(a.members.map((m) => m.visibility)).toEqual([
      'public',
      'private',
      'protected',
      'package-private',
      'public',
      'public',
    ]);
    expect(a.members.map((m) => m.kind)).toEqual([
      'field',
      'field',
      'field',
      'field',
      'method',
      'method',
    ]);
    expect(a.members[2].optional).toBe(true);
    expect(a.members[4].modifiers).toEqual(['async']);
    expect(a.members[5].modifiers).toEqual(['{static}']);
  });

  it('renders members with their visibility markers inside the class box', async () => {
    const renderer = createRenderer();
    const { svg } = await renderer.render(
      '@startuml\nclass A {\n  +name: string\n  -secret\n}\n@enduml',
    );
    expect(svg).toContain('+name: string');
    expect(svg).toContain('-secret');
  });

  it('expands tilde generics in the class name', () => {
    const model = parsePlantUml('@startuml\nclass List~Item~\n@enduml');
    expect(model.entities[0].name).toBe('List');
    expect(model.entities[0].generics).toEqual(['Item']);
  });

  it('expands angle generics in the class name', () => {
    const model = parsePlantUml('@startuml\nclass BaseEntity<T,U>\n@enduml');
    expect(model.entities[0].name).toBe('BaseEntity');
    expect(model.entities[0].generics).toEqual(['T', 'U']);
  });

  it('renders generics expanded (angle form) in the title', async () => {
    const renderer = createRenderer();
    const { svg } = await renderer.render('@startuml\nclass List~Item~\n@enduml');
    expect(svg).toContain('List&lt;Item&gt;');
  });

  it('resolves a generic endpoint to its declared entity', () => {
    const model = parsePlantUml(
      '@startuml\nclass List~Item~\nclass Item\nList~Item~ o-- Item\n@enduml',
    );
    expect(model.relations).toHaveLength(1);
    expect(model.relations[0].source).toBe('List');
    expect(model.relations[0].target).toBe('Item');
  });

  it('sizes a class box to fit its longest member without truncation', () => {
    const model = parsePlantUml(
      '@startuml\nclass A {\n  +aVeryLongMemberNameThatMustNotBeClipped: SomeVeryLongType\n}\n@enduml',
    );
    const entity = model.entities[0];
    const longest = Math.max(
      ...entity.members.map((m) => measureTextWidth(m.raw, METRICS.fontSize)),
    );
    const { width } = estimateEntitySize(entity);
    expect(width).toBeGreaterThanOrEqual(longest + METRICS.paddingX * 2);
  });

  it('renders a real archguard class diagram without parse errors', async () => {
    const model = parsePlantUml(archguardClass);
    expect(model.diagramType).toBe('class');
    expect(model.packages).toHaveLength(2);
    expect(model.entities.length).toBeGreaterThan(10);
    expect(model.relations.length).toBeGreaterThan(5);

    const renderer = createRenderer();
    const { svg } = await renderer.render(archguardClass);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('EnrichedPackageNode');
    expect(svg).toContain('+async analyze');
  });

  it('stays byte-for-byte deterministic for a member/relation/package input', async () => {
    const renderer = createRenderer();
    const a = await renderer.render(
      '@startuml\npackage "X" {\n  class A {\n    +name: string\n  }\n}\nclass B\nA --> B : uses\n@enduml',
    );
    const b = await renderer.render(
      '@startuml\npackage "X" {\n  class A {\n    +name: string\n  }\n}\nclass B\nA --> B : uses\n@enduml',
    );
    expect(a.svg).toBe(b.svg);
  });
});
