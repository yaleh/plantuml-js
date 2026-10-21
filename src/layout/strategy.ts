/**
 * Layout strategy extension point for the ELK engine.
 *
 * A strategy is tried before the engine's built-in decision chain; the first
 * one that returns a result wins, `undefined` declines and falls through. New
 * layout strategies are added by injecting them through
 * `ElkLayoutOptions.strategies` (or `createRenderer({ layoutOptions })`)
 * instead of editing `ElkLayoutEngine`. A strategy that throws is not
 * swallowed: the error propagates out of the render.
 */

import type { PlantUmlModel } from '../model.js';
import type { LayoutResult } from '../layout.js';

/** What the engine tells a strategy about the run it is part of. */
export interface LayoutStrategyContext {
  /** Semantic layer order resolved for the model. */
  layers: string[];
  /** Layer partition index per entity id. */
  partitions: Map<string, number>;
}

export interface LayoutStrategy {
  /** Short identifier, used in diagnostics. */
  readonly name: string;
  /** Lay the model out, or return `undefined` to decline. */
  layout(model: PlantUmlModel, ctx: LayoutStrategyContext): Promise<LayoutResult | undefined>;
}

/** First non-declining strategy result, or `undefined` when all decline. */
export async function runStrategies(
  strategies: readonly LayoutStrategy[] | undefined,
  model: PlantUmlModel,
  ctx: LayoutStrategyContext,
): Promise<LayoutResult | undefined> {
  for (const strategy of strategies ?? []) {
    const result = await strategy.layout(model, ctx);
    if (result !== undefined) return result;
  }
  return undefined;
}
