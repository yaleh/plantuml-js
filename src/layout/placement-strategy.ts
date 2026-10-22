/**
 * Block placement strategy extension point for the compound layout.
 *
 * The compound layout lays each top-level package out as a block, then has to
 * decide where the blocks go: orbit stubs, stack semantic layers, rect-pack the
 * blocks, or let ELK's layered algorithm place them. Each of those is a
 * [[PlacementStrategy]]; the first one to return a placement wins and
 * `undefined` declines to the next. New placement behaviour is added by
 * injecting strategies through `CompoundOptions.placementStrategies` (tried
 * before the built-in chain) instead of editing `placeBlocks`' decision chain.
 * A strategy that throws is not swallowed: the error propagates out of the
 * layout.
 *
 * The same interface also covers the smaller "pack the boxes inside one block"
 * dimension ([[BoxPlacementContext]]), so the ordered shelf pack and the
 * equal-column grid are strategies too rather than branches in `layoutBlock`.
 */

import type { ELK as ElkInstance, ElkNode } from 'elkjs';
import type { PlantUmlModel } from '../foundation/model.js';
import type { NodeLayout, PackageLayout, Point } from '../foundation/layout.js';

/** Channel to the frame (`gap`) and spacing between neighbouring stubs (`spacing`), px. */
export interface StubOrbit {
  gap: number;
  spacing: number;
  /** Row/column a stub slides to: its targets' centroid (default) or the target nearest its side. */
  anchor?: 'centroid' | 'nearest';
}

/** One top-level block as laid out on its own, ready to be placed. */
export interface Block {
  /** Block key: package id, or entity id for a bare top-level entity. */
  key: string;
  width: number;
  height: number;
  nodes: NodeLayout[];
  packages: PackageLayout[];
  /** Intra-block edge polylines keyed by relation index, block-local coordinates. */
  edges: Map<number, Point[]>;
  /** Intra-block relations the block layout left for the grid router. */
  unrouted?: number[];
}

/** Where every placed block (or box) sits, and the canvas size that needs. */
export interface Placement {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

/** Knobs a strategy may consult; `CompoundOptions` satisfies this shape. */
export interface PlacementStrategyOptions {
  /** Pack every flat block tightly (very large graphs). */
  dense?: boolean;
  /** Dense blocks use rect packing instead of dependency-ordered rows. */
  rectPackDense?: boolean;
  /** Target canvas width/height (ELK `elk.aspectRatio`). */
  aspectRatio?: number;
  /** Raw ELK options injected into each block's root and package containers. */
  elk?: Record<string, string>;
  /** Block id → semantic-layer partition index. */
  partitions: ReadonlyMap<string, number>;
  /** Where stub nodes orbit the placed blocks; the caller resolves the default. */
  stubOrbit?: StubOrbit;
}

/** What the layout tells a block placement strategy about the run it is part of. */
export interface PlacementStrategyContext {
  readonly elk: ElkInstance;
  readonly model: PlantUmlModel;
  readonly blocks: ReadonlyMap<string, Block>;
  readonly crossRelations: readonly number[];
  readonly blockOfEntity: ReadonlyMap<string, string>;
  readonly options: PlacementStrategyOptions;
  /**
   * The chain this strategy runs in. A strategy may re-enter it for a
   * sub-placement (stub orbit places the main blocks first).
   */
  readonly strategies: readonly PlacementStrategy[];
}

/** What a box placement strategy is given: the boxes of one block, in dependency order. */
export interface BoxPlacementContext {
  /** The boxes to arrange; their order is preserved when they are materialised. */
  readonly boxes: readonly ElkNode[];
  /** Box ids in dependency order. */
  readonly order: readonly string[];
  /** Target canvas width/height. */
  readonly aspect: number;
  /** Gap between boxes, px. */
  readonly gap: number;
  /** Row gap, when it differs from `gap`. */
  readonly rowGap?: number;
  /** Size each column to its own widest box (grid pack only). */
  readonly tight?: boolean;
}

export interface PlacementStrategy<C = PlacementStrategyContext> {
  /** Short identifier, used in diagnostics. */
  readonly name: string;
  /** Place the blocks/boxes, or return `undefined` to decline. */
  place(ctx: C): Placement | undefined | Promise<Placement | undefined>;
}

/** First non-declining placement, or `undefined` when all decline. */
export async function runPlacementStrategies<C>(
  strategies: readonly PlacementStrategy<C>[] | undefined,
  ctx: C,
): Promise<Placement | undefined> {
  for (const strategy of strategies ?? []) {
    const result = await strategy.place(ctx);
    if (result !== undefined) return result;
  }
  return undefined;
}
