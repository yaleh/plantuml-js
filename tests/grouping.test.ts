import { describe, it, expect } from 'vitest';
import { groupByPathPrefix } from '../src/transform.js';
import { PlantUmlModel } from '../src/model.js';

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

describe('gap-layout-module-grouping-hubs: groupByPathPrefix', () => {
  it('collapses path-form names to their depth-2 prefix and weights inter-group edges', () => {
    const out = groupByPathPrefix(
      model(
        [entity('a', 'src/cli/a'), entity('b', 'src/cli/b'), entity('x', 'src/core/x')],
        [rel('a', 'x'), rel('b', 'x')],
      ),
      2,
    );

    expect(out.packages).toHaveLength(0);
    const groupIds = out.entities
      .filter((e) => e.stub)
      .map((e) => e.id)
      .sort();
    expect(groupIds).toEqual(['grp::src/cli', 'grp::src/core']);

    const groupEdge = out.relations.find(
      (r) => r.source === 'grp::src/cli' && r.target === 'grp::src/core',
    );
    expect(groupEdge).toBeDefined();
    expect(groupEdge!.weight).toBe(2);
  });

  it('keeps non-path-form names ungrouped and drops intra-group edges', () => {
    const out = groupByPathPrefix(
      model(
        [entity('a', 'src/cli/a'), entity('b', 'src/cli/b'), entity('plain', 'PlainThing')],
        [rel('a', 'b'), rel('plain', 'a')],
      ),
      2,
    );

    const plain = out.entities.find((e) => e.id === 'plain');
    expect(plain).toBeDefined();
    expect(plain!.stub).toBeUndefined();

    // a→b is inside src/cli and disappears; plain→src/cli is remapped.
    expect(out.relations.map((r) => `${r.source}->${r.target}`)).toEqual([
      'plain->grp::src/cli',
    ]);
  });
});
