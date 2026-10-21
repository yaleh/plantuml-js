import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../src/index.js';
import { defaultTheme, themeColors, type Theme } from '../src/render/theme.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(dir, 'fixtures', 'archguard-class.puml'), 'utf8');

const withEdges = `@startuml
package "Src Layer" {
  class A { +x: number }
  interface B
  class C
}
package "Tests Layer" { class T }
T ..> A
C --|> A
A --> B
@enduml`;

function colorsIn(svg: string): { fills: string[]; strokes: string[] } {
  const grab = (attr: string): string[] =>
    [...svg.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))].map((m) => m[1]);
  return { fills: grab('fill'), strokes: grab('stroke') };
}

describe('theme tokens drive the SVG', () => {
  it('exports a Theme and defaultTheme', () => {
    const t: Theme = defaultTheme;
    expect(t.grid).toBe(8);
    expect(t.font.family).toBe('monospace');
  });

  it('draws no pure-black or #333333 strokes', async () => {
    const { svg } = await createRenderer().render(fixture);
    expect(svg).not.toContain('#000000');
    expect(svg).not.toContain('#333333');
    for (const s of colorsIn(svg).strokes) {
      expect(s).not.toBe('#000000');
      expect(s).not.toBe('#333333');
    }
  });

  it('uses only theme colours for every fill and stroke', async () => {
    const tokens = themeColors(defaultTheme);
    for (const puml of [fixture, withEdges]) {
      const { svg } = await createRenderer().render(puml);
      const { fills, strokes } = colorsIn(svg);
      expect(fills.length).toBeGreaterThan(0);
      for (const v of [...fills, ...strokes]) {
        if (v === 'none') continue;
        expect(tokens.has(v), v).toBe(true);
      }
    }
  });

  it('renders weak relations dashed and strong ones solid', async () => {
    const { svg } = await createRenderer().render(withEdges);
    const edge = (type: string): string =>
      new RegExp(`data-edge-type="${type}" class="uml-edge">(.*?)</g>`).exec(svg)![1];
    expect(edge('dependency')).toContain('stroke-dasharray');
    expect(edge('association')).not.toContain('stroke-dasharray');
    expect(edge('inheritance')).not.toContain('stroke-dasharray');
  });
});
