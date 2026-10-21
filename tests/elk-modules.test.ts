import { describe, it, expect } from 'vitest';
import type { ElkExtendedEdge } from 'elkjs';
import { emptyModel, PlantUmlEntity, PlantUmlModel } from '../src/foundation/model.js';
import type { NodeLayout, Point } from '../src/foundation/layout.js';
import { topologicalLayerOrder } from '../src/foundation/layers.js';
import { buildChildren } from '../src/layout/elk-graph.js';
import { edgePoints } from '../src/layout/elk-result.js';

function entity(id: string, packageId?: string): PlantUmlEntity {
  return { id, name: id, kind: 'class', members: [], packageId };
}

function layered(deps: Array<[string, string]>, layers: string[]): PlantUmlModel {
  const model = emptyModel();
  for (const layer of layers) {
    model.packages.push({ id: layer, name: `${layer} Layer` });
    model.entities.push(entity(`${layer}.E`, layer));
  }
  for (const [a, b] of deps) {
    model.relations.push({ source: `${a}.E`, target: `${b}.E`, type: 'dependency' });
  }
  return model;
}

describe('topologicalLayerOrder', () => {
  it('puts dependents above the layers they consume', () => {
    const model = layered(
      [
        ['Tests', 'Src'],
        ['Src', 'Base'],
      ],
      ['Base', 'Src', 'Tests'],
    );
    expect(topologicalLayerOrder(model)).toEqual(['Tests', 'Src', 'Base']);
  });

  it('keeps declaration order for a cyclic input', () => {
    const model = layered(
      [
        ['A', 'B'],
        ['B', 'A'],
      ],
      ['A', 'B'],
    );
    expect(topologicalLayerOrder(model)).toEqual(['A', 'B']);
  });
});

describe('buildChildren', () => {
  it('packs many unconnected wide entities into an iso:: container', () => {
    const model = emptyModel();
    for (let i = 0; i < 40; i++) model.entities.push(entity(`Entity${i}`));
    const top = buildChildren(model, new Map());
    const iso = top.find((n) => n.id.startsWith('iso::'));
    expect(iso).toBeDefined();
    expect(iso!.children).toHaveLength(40);
  });

  it('leaves a few unconnected entities as plain leaves', () => {
    const model = emptyModel();
    for (let i = 0; i < 3; i++) model.entities.push(entity(`E${i}`));
    const top = buildChildren(model, new Map());
    expect(top.some((n) => n.id.startsWith('iso::'))).toBe(false);
    expect(top).toHaveLength(3);
  });
});

describe('edgePoints', () => {
  const nodeById = new Map<string, NodeLayout>([
    ['a', { id: 'a', x: 0, y: 0, width: 20, height: 10 }],
    ['b', { id: 'b', x: 100, y: 50, width: 20, height: 10 }],
  ]);
  const offsets = new Map<string, Point>([['root', { x: 0, y: 0 }]]);

  it('falls back to a straight line when sections are missing', () => {
    const edge: ElkExtendedEdge = { id: 'e', sources: ['a'], targets: ['b'], sections: [] };
    expect(edgePoints(edge, nodeById, offsets)).toEqual([
      { x: 10, y: 5 },
      { x: 110, y: 55 },
    ]);
    const noSections: ElkExtendedEdge = { id: 'e', sources: ['a'], targets: ['b'] };
    expect(edgePoints(noSections, nodeById, offsets)).toHaveLength(2);
  });
});
