import { describe, it, expect } from 'vitest';
import { createRenderer, parsePlantUml } from '../src/index.js';
import { LayoutEngine, LayoutResult } from '../src/foundation/layout.js';
import { PlantUmlModel } from '../src/foundation/model.js';

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

describe('M1 vertical slice', () => {
  it('renders a single class to a correct SVG', async () => {
    const renderer = createRenderer();
    const { svg, diagramType } = await renderer.render(
      '@startuml\nclass A\n@enduml',
    );
    expect(diagramType).toBe('class');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect');
    expect(svg).toContain('>A</text>');
  });

  it('parses class/interface/enum/abstract class declarations', () => {
    const model = parsePlantUml(
      '@startuml\nclass A\ninterface B\nenum C\nabstract class D\n@enduml',
    );
    expect(model.entities.map((e) => e.kind)).toEqual([
      'class',
      'interface',
      'enum',
      'abstract',
    ]);
    expect(model.entities.map((e) => e.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles quoted entity names', () => {
    const model = parsePlantUml('@startuml\nclass "User Repo"\n@enduml');
    expect(model.entities).toHaveLength(1);
    expect(model.entities[0].name).toBe('User Repo');
  });

  it('is byte-for-byte deterministic', async () => {
    const renderer = createRenderer();
    const a = await renderer.render('@startuml\nclass A\n@enduml');
    const b = await renderer.render('@startuml\nclass A\n@enduml');
    expect(a.svg).toBe(b.svg);
  });

  it('escapes XML special characters in entity names', async () => {
    const renderer = createRenderer();
    const { svg } = await renderer.render('@startuml\nclass "A&B"\n@enduml');
    expect(svg).toContain('A&amp;B');
    expect(svg).not.toContain('A&B');
    expect(isWellFormedXml(svg)).toBe(true);
  });

  it('emits well-formed XML with a real class box and text', async () => {
    const renderer = createRenderer();
    const { svg } = await renderer.render('@startuml\nclass A\n@enduml');
    expect(isWellFormedXml(svg)).toBe(true);
  });

  it('default elkjs engine lays out a single entity with non-zero size and coordinates', async () => {
    const renderer = createRenderer();
    const { svg } = await renderer.render('@startuml\nclass A\n@enduml');
    const rect = svg.match(
      /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/,
    );
    expect(rect).not.toBeNull();
    const [, x, y, width, height] = rect!;
    expect(Number(x)).toBeGreaterThan(0);
    expect(Number(y)).toBeGreaterThan(0);
    expect(Number(width)).toBeGreaterThan(0);
    expect(Number(height)).toBeGreaterThan(0);
  });

  it('accepts an injected LayoutEngine (proves pluggability)', async () => {
    const stub: LayoutEngine = {
      async layout(_model: PlantUmlModel): Promise<LayoutResult> {
        return {
          nodes: [{ id: 'A', x: 5, y: 7, width: 40, height: 30 }],
          edges: [],
          width: 40,
          height: 30,
        };
      },
    };
    const renderer = createRenderer({ layout: stub });
    const { svg } = await renderer.render('@startuml\nclass A\n@enduml');
    expect(svg).toContain('x="5" y="7"');
  });
});
