import { describe, it, expect } from 'vitest';
import { createRenderer } from '../src/index.js';
import { defaultTheme, resolveTheme } from '../src/render/theme.js';

const puml = `@startuml
package "Src Layer" {
  class A { +x: number }
  class B
}
A --> B
@enduml`;

describe('theme overrides', () => {
  it('applies a partial override and falls back to defaults for the rest', async () => {
    const { svg } = await createRenderer({
      theme: { color: { stroke: '#112233' }, shape: { nodeRadius: 2 } },
    }).render(puml);
    expect(svg).toContain('stroke="#112233"');
    expect(svg).toContain('rx="2"');
    // untouched tokens keep their default values
    expect(svg).toContain(`fill="${defaultTheme.color.textTitle}"`);
    expect(svg).toContain(`stroke="${defaultTheme.color.edge}"`);
  });

  it('resolveTheme merges nested objects and leaves defaults unmutated', () => {
    const t = resolveTheme({ font: { size: { title: 20 } } });
    expect(t.font.size.title).toBe(20);
    expect(t.font.size.member).toBe(defaultTheme.font.size.member);
    expect(defaultTheme.font.size.title).toBe(13);
  });

  it('is byte-identical across repeated renders with the same theme', async () => {
    const opts = { theme: { color: { accent: '#224466' } } };
    const a = await createRenderer(opts).render(puml);
    const b = await createRenderer(opts).render(puml);
    expect(b.svg).toBe(a.svg);
    const c = await createRenderer().render(puml);
    const d = await createRenderer().render(puml);
    expect(d.svg).toBe(c.svg);
  });
});
