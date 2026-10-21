import { describe, it, expect } from 'vitest';
import { createRenderer, parsePlantUml, ElkLayoutEngine } from '../src/index.js';

describe('M2 package grouping', () => {
  it('assigns entities to their package and keeps alias ids', () => {
    const model = parsePlantUml(
      '@startuml\npackage "User Layer" as User_Layer {\n  class A\n}\nclass B\n@enduml',
    );
    expect(model.packages).toHaveLength(1);
    expect(model.packages[0]).toMatchObject({ id: 'User_Layer', name: 'User Layer' });
    const a = model.entities.find((e) => e.id === 'A')!;
    expect(a.packageId).toBe('User_Layer');
    expect(model.entities.find((e) => e.id === 'B')!.packageId).toBeUndefined();
  });

  it('supports nested package blocks', () => {
    const model = parsePlantUml(
      '@startuml\npackage Outer {\n  package Inner {\n    class A\n  }\n}\n@enduml',
    );
    const outer = model.packages.find((p) => p.id === 'Outer')!;
    const inner = model.packages.find((p) => p.id === 'Inner')!;
    expect(outer.parentId).toBeUndefined();
    expect(inner.parentId).toBe('Outer');
    expect(model.entities[0].packageId).toBe('Inner');
  });

  it('renders a package frame and keeps the class inside it', async () => {
    const { svg } = await createRenderer().render(
      '@startuml\npackage "X" {\n  class A\n}\n@enduml',
    );
    expect(svg).toContain('X');
    expect(svg).toContain('>A</text>');
  });

  it('lays the class inside its package frame', async () => {
    const puml = '@startuml\npackage "X" {\n  class A\n}\n@enduml';
    const model = parsePlantUml(puml);
    const layout = await new ElkLayoutEngine().layout(model);

    const pkg = layout.packages!.find((p) => p.id === 'X')!;
    const node = layout.nodes.find((n) => n.id === 'A')!;
    expect(pkg).toBeDefined();
    expect(node).toBeDefined();
    // The entity box must lie within the package frame.
    expect(node.x).toBeGreaterThanOrEqual(pkg.x);
    expect(node.y).toBeGreaterThanOrEqual(pkg.y);
    expect(node.x + node.width).toBeLessThanOrEqual(pkg.x + pkg.width + 0.01);
    expect(node.y + node.height).toBeLessThanOrEqual(pkg.y + pkg.height + 0.01);
  });
});
