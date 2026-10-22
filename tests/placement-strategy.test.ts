import { describe, expect, it } from 'vitest';
import type { ELK as ElkInstance, ElkNode } from 'elkjs';
import { compoundLayout } from '../src/layout/compound.js';
import {
  DEFAULT_PLACEMENT_STRATEGIES,
  gridPackPlacementStrategy,
  layerRowsPlacementStrategy,
  orderedShelfPackPlacementStrategy,
  shelfPackBlocksPlacementStrategy,
  stubOrbitPlacementStrategy,
} from '../src/layout/compound.js';
import type { Placement, PlacementStrategy } from '../src/layout/placement-strategy.js';
import type { PlantUmlModel } from '../src/foundation/model.js';

/** Bare entities make blocks with no ELK call, so a synthetic placement is all that runs. */
function modelOf(ids: string[]): PlantUmlModel {
  return {
    diagramType: 'class',
    entities: ids.map((id) => ({ id, name: id, kind: 'class' as const, members: [] })),
    relations: [],
    packages: [],
  };
}

const unreachableElk = {
  layout: async (): Promise<ElkNode> => {
    throw new Error('ELK layout must not run when an injected placement strategy accepts');
  },
} as unknown as ElkInstance;

const fixedPlacement: Placement = {
  positions: new Map([
    ['A', { x: 10, y: 20 }],
    ['B', { x: 30, y: 40 }],
  ]),
  width: 1234,
  height: 567,
};

describe('PlacementStrategy extension point', () => {
  it('uses an injected synthetic strategy without touching compound.ts', async () => {
    const strategy: PlacementStrategy = { name: 'synthetic', place: () => fixedPlacement };
    const result = await compoundLayout(unreachableElk, modelOf(['A', 'B']), {
      partitions: new Map(),
      placementStrategies: [strategy],
    });
    expect(result.width).toBe(1234);
    expect(result.height).toBe(567);
    expect(result.nodes.find((n) => n.id === 'A')?.x).toBe(10);
    expect(result.nodes.find((n) => n.id === 'B')?.y).toBe(40);
  });

  it('a declining strategy falls through to the next one', async () => {
    const decline: PlacementStrategy = { name: 'decline', place: () => undefined };
    const accept: PlacementStrategy = { name: 'accept', place: () => fixedPlacement };
    const result = await compoundLayout(unreachableElk, modelOf(['A', 'B']), {
      partitions: new Map(),
      placementStrategies: [decline, accept],
    });
    expect(result.width).toBe(1234);
  });

  it('a throwing strategy is not silently ignored', async () => {
    const boom: PlacementStrategy = {
      name: 'boom',
      place() {
        throw new Error('placement boom failed');
      },
    };
    await expect(
      compoundLayout(unreachableElk, modelOf(['A', 'B']), {
        partitions: new Map(),
        placementStrategies: [boom],
      }),
    ).rejects.toThrow('placement boom failed');
  });

  it('encapsulates all five placement algorithms as strategies', () => {
    const strategies = [
      stubOrbitPlacementStrategy,
      layerRowsPlacementStrategy,
      shelfPackBlocksPlacementStrategy,
      orderedShelfPackPlacementStrategy,
      gridPackPlacementStrategy,
    ];
    expect(strategies.map((s) => s.name)).toEqual([
      'stub-orbit',
      'layer-rows',
      'shelf-pack-blocks',
      'ordered-shelf-pack',
      'grid-pack',
    ]);
    for (const strategy of strategies) expect(typeof strategy.place).toBe('function');
    expect(DEFAULT_PLACEMENT_STRATEGIES.map((s) => s.name)).toEqual([
      'stub-orbit',
      'layer-rows',
      'packed-blocks',
      'elk-layered-blocks',
    ]);
  });

  it('places the boxes inside a block through the box strategy chain', async () => {
    const boxes: ElkNode[] = [
      { id: 'one', width: 100, height: 40 },
      { id: 'two', width: 120, height: 60 },
      { id: 'three', width: 80, height: 30 },
    ];
    const order = ['one', 'two', 'three'];
    const grid = await gridPackPlacementStrategy.place({ boxes, order, aspect: 1.3, gap: 24 });
    expect(grid?.positions.get('one')).toBeDefined();
    expect(grid?.positions.get('three')).toBeDefined();
    const shelf = await orderedShelfPackPlacementStrategy.place({ boxes, order, aspect: 1.3, gap: 24 });
    expect(shelf?.positions.get('two')).toBeDefined();
    expect(shelf!.width).toBeGreaterThan(0);
  });
});
