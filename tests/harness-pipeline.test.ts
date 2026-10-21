import { describe, expect, it } from 'vitest';
import { createRenderer, parsePlantUml, renderDetailed } from '../src/core.js';

function classes(n: number): string {
  const lines = ['@startuml'];
  for (let i = 0; i < n; i++) {
    lines.push(`class C${i} {`, `  +memberRowText${i}: string`, '}');
  }
  lines.push('@enduml');
  return lines.join('\n');
}

describe('renderDetailed (harness pipeline)', () => {
  it('uses names detail for a 660-entity input (no member rows)', async () => {
    const { svg, model, layout } = await renderDetailed(parsePlantUml(classes(660)));
    expect(model.entities).toHaveLength(660);
    expect(layout.width).toBeGreaterThan(0);
    expect(svg).not.toContain('memberRowText');
  }, 120_000);

  it('keeps member rows for a 22-entity input', async () => {
    const { svg } = await renderDetailed(parsePlantUml(classes(22)));
    expect(svg).toContain('memberRowText0');
  });

  it('matches createRenderer output', async () => {
    const puml = classes(22);
    const direct = await renderDetailed(parsePlantUml(puml));
    const viaApi = await createRenderer().render(puml);
    expect(direct.svg).toBe(viaApi.svg);
  });
});
