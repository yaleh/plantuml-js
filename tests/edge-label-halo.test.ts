import { describe, it, expect } from 'vitest';
import { parsePlantUml, ElkLayoutEngine, renderSvg } from '../src/index.js';
import { defaultTheme } from '../src/render/theme.js';

const puml = `@startuml
class A
class B
class C
A --> B : validates
B --> C : analyzes
@enduml`;

async function render(theme?: Parameters<typeof renderSvg>[2]) {
  const model = parsePlantUml(puml);
  const layout = await new ElkLayoutEngine().layout(model);
  return { model, layout, svg: renderSvg(model, layout, theme) };
}

function labelTexts(svg: string): { text: string; x: number; y: number; tag: string }[] {
  return [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"([^>]*class="uml-edge-label"[^>]*)>([^<]*)<\/text>/g)].map((m) => ({
    x: Number(m[1]), y: Number(m[2]), tag: m[3], text: m[4],
  }));
}

function distToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

describe('edge label halo', () => {
  it('draws label text with a theme-token halo', async () => {
    const { svg } = await render();
    const labels = labelTexts(svg);
    expect(labels.map((l) => l.text).sort()).toEqual(['analyzes', 'validates']);
    for (const l of labels) {
      expect(l.tag).toContain(`stroke="${defaultTheme.color.labelHalo}"`);
      expect(l.tag).toContain('paint-order="stroke"');
    }
  });

  it('takes the halo colour from the theme, not a literal', async () => {
    const { svg } = await render({ theme: { color: { labelHalo: '#abcdef' } } });
    for (const l of labelTexts(svg)) expect(l.tag).toContain('stroke="#abcdef"');
  });

  it('keeps each label off its own edge by at least half the text height', async () => {
    const { model, layout, svg } = await render();
    for (const l of labelTexts(svg)) {
      const idx = model.relations.findIndex((r) => r.label === l.text);
      const pts = layout.edges!.find((e) => e.id === `rel-${idx}`)!.points;
      const cy = l.y - 12 + 7; // baseline → vertical centre of the 14px label box
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSegment(l.x, cy, pts[i], pts[i + 1]));
      // Horizontal-ish segments clear vertically; vertical ones clear horizontally.
      expect(d).toBeGreaterThanOrEqual(6);
    }
  });
});
