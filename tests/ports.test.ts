import { describe, it, expect } from 'vitest';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { parsePlantUml } from '../src/parser.js';
import { NodeLayout, Point } from '../src/foundation/layout.js';

/** Which boundary side an edge endpoint sits on (within a small epsilon). */
function endpointSide(p: Point, node: NodeLayout): string {
  const on = (value: number, target: number) => Math.abs(value - target) < 0.01;
  if (on(p.y, node.y + node.height)) return 'south';
  if (on(p.y, node.y)) return 'north';
  if (on(p.x, node.x + node.width)) return 'east';
  if (on(p.x, node.x)) return 'west';
  return 'interior';
}

/**
 * Port assignment — same-direction edges leaving a node must attach to one
 * fixed side of the box and spread across distinct ports instead of piling
 * onto a single point.
 */
describe('gap-layout-semantic-layering: ports', () => {
  it('fans same-direction parallel edges out of one side without overlap', async () => {
    const model = parsePlantUml(
      [
        '@startuml',
        'class Hub',
        'class A',
        'class B',
        'class C',
        'Hub --> A',
        'Hub --> A',
        'Hub --> B',
        'Hub --> C',
        '@enduml',
      ].join('\n'),
    );

    const layout = await new ElkLayoutEngine().layout(model);
    const hub = layout.nodes.find((n) => n.id === 'Hub')!;
    expect(hub).toBeDefined();

    const outgoing = layout.edges.filter((e) => e.source === 'Hub');
    expect(outgoing.length).toBeGreaterThanOrEqual(4);

    // Every outgoing edge starts on the same side of the Hub box.
    const starts = outgoing.map((e) => e.points[0]);
    const sides = new Set(starts.map((p) => endpointSide(p, hub)));
    expect(sides.size).toBe(1);
    expect([...sides][0]).not.toBe('interior');

    // …and no two endpoints overlap.
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const distance = Math.hypot(starts[i].x - starts[j].x, starts[i].y - starts[j].y);
        expect(distance).toBeGreaterThan(0.5);
      }
    }
  });

  it('keeps incoming edges on the target side distinct as well', async () => {
    const model = parsePlantUml(
      ['@startuml', 'class Sink', 'class A', 'class B', 'A --> Sink', 'B --> Sink', '@enduml'].join(
        '\n',
      ),
    );

    const layout = await new ElkLayoutEngine().layout(model);
    const sink = layout.nodes.find((n) => n.id === 'Sink')!;

    const incoming = layout.edges.filter((e) => e.target === 'Sink');
    expect(incoming.length).toBeGreaterThanOrEqual(2);

    const ends = incoming.map((e) => e.points[e.points.length - 1]);
    const sides = new Set(ends.map((p) => endpointSide(p, sink)));
    expect(sides.size).toBe(1);
    expect([...sides][0]).not.toBe('interior');

    const distance = Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y);
    expect(distance).toBeGreaterThan(0.5);
  });
});
