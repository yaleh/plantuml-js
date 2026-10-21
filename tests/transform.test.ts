import { describe, it, expect } from 'vitest';
import {
  aggregateRelations,
  transitiveReduce,
  summarizeHubs,
  markCycles,
  transformModel,
} from '../src/transform.js';
import { PlantUmlModel } from '../src/foundation/model.js';

type Entity = PlantUmlModel['entities'][number];
type Relation = PlantUmlModel['relations'][number];

function entity(id: string, name = id): Entity {
  return { id, name, kind: 'class', members: [] };
}

function rel(source: string, target: string): Relation {
  return { source, target, type: 'dependency' };
}

function model(entities: Entity[], relations: Relation[]): PlantUmlModel {
  return { diagramType: 'class', entities, relations, packages: [] };
}

describe('aggregateRelations', () => {
  it('merges duplicate relations into one edge whose weight equals the original count', () => {
    const out = aggregateRelations(
      model(
        [entity('A'), entity('B')],
        [rel('A', 'B'), rel('A', 'B'), rel('A', 'B')],
      ),
    );

    expect(out.relations).toHaveLength(1);
    expect(out.relations[0].source).toBe('A');
    expect(out.relations[0].target).toBe('B');
    expect(out.relations[0].weight).toBe(3);
  });

  it('keeps opposite directions as distinct edges', () => {
    const out = aggregateRelations(
      model(
        [entity('A'), entity('B')],
        [rel('A', 'B'), rel('B', 'A')],
      ),
    );
    expect(out.relations).toHaveLength(2);
  });

  it('leaves a unique relation with weight undefined (single edge)', () => {
    const out = aggregateRelations(model([entity('A'), entity('B')], [rel('A', 'B')]));
    expect(out.relations[0].weight).toBeUndefined();
  });
});

describe('transitiveReduce', () => {
  it('removes an edge derivable by transitivity and keeps the witness path', () => {
    // A→B→C makes A→C redundant.
    const out = transitiveReduce(
      model(
        [entity('A'), entity('B'), entity('C')],
        [rel('A', 'B'), rel('B', 'C'), rel('A', 'C')],
      ),
    );

    expect(out.relations.map((r) => `${r.source}->${r.target}`).sort()).toEqual([
      'A->B',
      'B->C',
    ]);
  });

  it('keeps an edge with no alternate path', () => {
    const out = transitiveReduce(model([entity('A'), entity('B')], [rel('A', 'B')]));
    expect(out.relations).toHaveLength(1);
  });

  it('keeps a necessary direct edge when only a longer path exists through unrelated nodes', () => {
    // A→C is direct and also reachable via A→B→C, so it is still redundant;
    // but A→B has no alternate path and must survive.
    const out = transitiveReduce(
      model(
        [entity('A'), entity('B'), entity('C')],
        [rel('A', 'B'), rel('B', 'C'), rel('A', 'C')],
      ),
    );
    expect(out.relations.map((r) => `${r.source}->${r.target}`).sort()).toEqual([
      'A->B',
      'B->C',
    ]);
  });
});

describe('summarizeHubs', () => {
  it('summarizes a hub node\'s incoming edges and sets the badge count', () => {
    const out = summarizeHubs(
      model(
        [entity('H'), entity('A'), entity('B'), entity('C'), entity('D')],
        [rel('A', 'H'), rel('B', 'H'), rel('C', 'H'), rel('H', 'D')],
      ),
      1,
    );

    // H has in-degree 3 (> 1): its incoming edges disappear, its outgoing edge stays.
    expect(out.relations).toEqual([{ source: 'H', target: 'D', type: 'dependency' }]);
    expect(out.entities.find((e) => e.id === 'H')!.usageCount).toBe(3);
  });

  it('counts distinct sources, not duplicate edges', () => {
    const out = summarizeHubs(
      model(
        [entity('H'), entity('A'), entity('B')],
        [rel('A', 'H'), rel('A', 'H'), rel('B', 'H')],
      ),
      1,
    );
    expect(out.entities.find((e) => e.id === 'H')!.usageCount).toBe(2);
    expect(out.relations).toHaveLength(0);
  });

  it('leaves nodes at or below the threshold untouched', () => {
    const out = summarizeHubs(
      model([entity('H'), entity('A'), entity('B')], [rel('A', 'H'), rel('B', 'H')]),
      2,
    );
    expect(out.relations).toHaveLength(2);
    expect(out.entities.find((e) => e.id === 'H')!.usageCount).toBeUndefined();
  });
});

describe('markCycles', () => {
  it('marks exactly one feedback arc in a two-node cycle', () => {
    const out = markCycles(
      model([entity('A'), entity('B')], [rel('A', 'B'), rel('B', 'A')]),
    );
    expect(out.relations.filter((r) => r.feedback)).toHaveLength(1);
    expect(out.relations.filter((r) => !r.feedback)).toHaveLength(1);
  });

  it('marks no edges in an acyclic graph', () => {
    const out = markCycles(
      model([entity('A'), entity('B'), entity('C')], [rel('A', 'B'), rel('B', 'C')]),
    );
    expect(out.relations.filter((r) => r.feedback)).toHaveLength(0);
  });
});

describe('transformModel', () => {
  it('aggregates by default', () => {
    const out = transformModel(
      model([entity('A'), entity('B')], [rel('A', 'B'), rel('A', 'B')]),
    );
    expect(out.relations).toHaveLength(1);
    expect(out.relations[0].weight).toBe(2);
  });

  it('runs the full pipeline without mutating its input', () => {
    const input = model(
      [entity('A'), entity('B')],
      [rel('A', 'B'), rel('A', 'B'), rel('B', 'A')],
    );
    const snapshot = JSON.stringify(input);
    transformModel(input, { transitiveReduction: true, cycles: true });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
