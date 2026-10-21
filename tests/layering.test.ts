import { describe, it, expect } from 'vitest';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { parsePlantUml } from '../src/parser.js';

/**
 * Semantic layering — the ELK engine stacks packages that follow the
 * `"X Layer"` name convention into a fixed vertical order (declaration order by
 * default), and reverses inheritance/implementation edges so the parent sits
 * above the subclass while composition keeps the whole above its parts.
 */
describe('gap-layout-semantic-layering: layer order', () => {
  it('orders layers by declaration order, even against an upward edge', async () => {
    const model = parsePlantUml(
      [
        '@startuml',
        'package "Alpha Layer" as Alpha_Layer {',
        '  class A1',
        '  class A2',
        '}',
        'package "Beta Layer" as Beta_Layer {',
        '  class B1',
        '  class B2',
        '}',
        // Upward dependency: Beta depends on Alpha. Partitioning, not edge
        // direction, must keep Alpha Layer (declared first) on top.
        'B1 ..> A1',
        '@enduml',
      ].join('\n'),
    );

    const layout = await new ElkLayoutEngine().layout(model);

    const aNodes = layout.nodes.filter((n) => ['A1', 'A2'].includes(n.id));
    const bNodes = layout.nodes.filter((n) => ['B1', 'B2'].includes(n.id));
    expect(aNodes).toHaveLength(2);
    expect(bNodes).toHaveLength(2);

    const maxA = Math.max(...aNodes.map((n) => n.y));
    const minB = Math.min(...bNodes.map((n) => n.y));
    expect(maxA).toBeLessThan(minB);
  });

  it('honours an explicit layerOrder option over the declaration order', async () => {
    const model = parsePlantUml(
      [
        '@startuml',
        'package "First Layer" as First_Layer {',
        '  class A',
        '}',
        'package "Second Layer" as Second_Layer {',
        '  class B',
        '}',
        'B ..> A',
        '@enduml',
      ].join('\n'),
    );

    // Without the option the declaration order would put First on top; the
    // explicit order reverses it so Second sits above First.
    const layout = await new ElkLayoutEngine({ layerOrder: ['Second', 'First'] }).layout(model);

    const b = layout.nodes.find((n) => n.id === 'B')!;
    const a = layout.nodes.find((n) => n.id === 'A')!;
    expect(b.y).toBeLessThan(a.y);
  });
});

describe('gap-layout-semantic-layering: relation direction', () => {
  it('places an inheritance subclass below its parent', async () => {
    const model = parsePlantUml(
      ['@startuml', 'class Base', 'class Derived', 'Derived --|> Base', '@enduml'].join('\n'),
    );
    const layout = await new ElkLayoutEngine().layout(model);

    const base = layout.nodes.find((n) => n.id === 'Base')!;
    const derived = layout.nodes.find((n) => n.id === 'Derived')!;
    expect(derived.y).toBeGreaterThan(base.y);

    // The rendered edge still points at the parent: source stays the subclass.
    const edge = layout.edges.find((e) => e.source === 'Derived' && e.target === 'Base');
    expect(edge).toBeDefined();
  });

  it('places an implementation class below its interface', async () => {
    const model = parsePlantUml(
      ['@startuml', 'interface Contract', 'class Impl', 'Impl ..|> Contract', '@enduml'].join(
        '\n',
      ),
    );
    const layout = await new ElkLayoutEngine().layout(model);

    const contract = layout.nodes.find((n) => n.id === 'Contract')!;
    const impl = layout.nodes.find((n) => n.id === 'Impl')!;
    expect(impl.y).toBeGreaterThan(contract.y);
  });

  it('places a composition whole above its part', async () => {
    const model = parsePlantUml(
      ['@startuml', 'class Whole', 'class Part', 'Whole *-- Part', '@enduml'].join('\n'),
    );
    const layout = await new ElkLayoutEngine().layout(model);

    const whole = layout.nodes.find((n) => n.id === 'Whole')!;
    const part = layout.nodes.find((n) => n.id === 'Part')!;
    expect(whole.y).toBeLessThan(part.y);
  });
});
