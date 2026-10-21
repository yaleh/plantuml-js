import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRenderer, parsePlantUml, transformFullGraph } from '../src/index.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('external (implicit) nodes', () => {
  it('flags undeclared endpoints as external and styles them distinctly', async () => {
    const puml = '@startuml\nclass A\nA --> B\nA --> C\n@enduml';
    const model = parsePlantUml(puml);
    expect(model.entities.find((e) => e.id === 'B')?.external).toBe(true);
    expect(model.entities.find((e) => e.id === 'A')?.external).toBeUndefined();
    const { svg } = await createRenderer().render(puml);
    expect(svg).toContain('uml-external');
    expect(svg).toContain('data-package-id="__external__"');
  });

  it('summarizes the incoming edges of Error into a count badge', () => {
    const raw = parsePlantUml(fixture('archguard-architecture.puml'));
    const original = raw.relations.filter((r) => r.target === 'Error').length;
    expect(original).toBeGreaterThan(2);
    const model = transformFullGraph(raw);
    const visible = model.relations.filter((r) => r.target === 'Error').length;
    expect(visible).toBeLessThanOrEqual(2);
    const error = model.entities.find((e) => e.id === 'Error')!;
    expect(error.external).toBe(true);
    expect(error.usageCount).toBe(original);
    expect(error.packageId).toBe('__external__');
  });
});
