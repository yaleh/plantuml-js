import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createRenderer,
  checkSyntax,
  parsePlantUml,
  transformFullGraph,
  ElkLayoutEngine,
} from '../src/index.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('undeclared relation endpoints', () => {
  it('creates an implicit class for an undeclared endpoint and renders it', async () => {
    const puml = '@startuml\nclass A\nA --> B\n@enduml';
    const model = parsePlantUml(puml);
    const b = model.entities.find((e) => e.id === 'B');
    expect(b).toBeDefined();
    expect(b?.members).toEqual([]);
    const result = await createRenderer().render(puml);
    expect(result.svg).toContain('>B<');
    expect(result.svg).toContain('<svg');
    expect(result.warnings.some((w) => w.includes('"B"'))).toBe(true);
  });

  it('attaches package-alias endpoints to a node inside the package', async () => {
    const puml =
      '@startuml\npackage "X Layer" as X {\nclass A\n}\nX --> A\nA --> X\n@enduml';
    const result = await createRenderer().render(puml);
    expect(result.svg).toContain('<svg');
    expect(result.warnings.filter((w) => w.includes('is a package'))).toHaveLength(2);
    expect(parsePlantUml(puml).entities.map((e) => e.id)).toEqual(['A']);
  });

  it.each(['archguard-architecture-manual.puml', 'archguard-architecture.puml'])(
    'renders the real document diagram %s',
    async (name) => {
      const puml = fixture(name);
      expect(checkSyntax(puml).ok).toBe(true);
      const result = await createRenderer().render(puml);
      expect(result.svg.startsWith('<svg')).toBe(true);
      expect(result.svg.trimEnd().endsWith('</svg>')).toBe(true);
      const model = transformFullGraph(parsePlantUml(puml));
      const layout = await new ElkLayoutEngine().layout(model);
      expect(computeLayoutMetrics(model, layout).textOverflowCount).toBe(0);
    },
    60_000,
  );
});
