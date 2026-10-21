/**
 * ElkLayoutEngine — the default engine, pure-JS layered layout via elkjs.
 *
 * Packages become nested container nodes (so members stay grouped and frames
 * nest) and edges use ORTHOGONAL routing to keep crossings down. On top of
 * that geometry the engine now carries *architecture semantics*:
 *
 * - **Semantic layering** — packages whose name follows the `"X Layer"`
 *   convention (or that carry an explicit `layer`) are stacked top-to-bottom in
 *   a fixed order via ELK partitioning (`elk.partitioning.activate` +
 *   `elk.partitioning.partition`). The order defaults to dependency topology
 *   (a dependent layer sits above the layer it consumes) and can be overridden
 *   with `ElkLayoutOptions.layerOrder`, so dependency direction stays readable
 *   (entry layers on top, base types at the bottom).
 * - **Directed inheritance/composition** — inheritance/implementation edges are
 *   laid out in reverse (parent above the subclass) and composition/aggregation
 *   with the whole above its parts, while the renderer still draws the original
 *   arrow direction (the reversed polyline is flipped back before returning).
 * - **Ports** — edges attach to a fixed side of each node
 *   (`elk.layered.portConstraints: FIXED_SIDE`), so same-direction parallel
 *   edges share an in/out side and spread across distinct ports instead of
 *   piling onto one point.
 *
 * Edges that cross a container boundary (package↔package, or package↔top-level
 * stub) would otherwise come back from ELK without any routing section (the
 * `INHERIT` hierarchy mode leaves them unresolved, and they degrade to straight
 * diagonals), so when the model contains such edges the engine switches that
 * layout to `INCLUDE_CHILDREN`, which routes them around unrelated boxes.
 *
 * `INCLUDE_CHILDREN` is one layered run over the whole nested graph, so it can
 * flatten a package into a strip or stack a big graph into a sliver. When the
 * result is badly proportioned (or the graph is very large) the engine falls
 * back to the compound layout in [[./compound]]: each top-level package is laid
 * out as its own block, blocks are packed, and cross-block edges are routed by
 * the grid router in [[./grid-router]].
 */

import ELKDefault from 'elkjs';
import type {
  ElkPoint,
  ELK as ElkInstance,
  ELKConstructorArguments,
} from 'elkjs';
import { PlantUmlModel } from '../model.js';
import { LayoutEngine, LayoutResult, alignRows } from '../layout.js';
import { compoundLayout } from './compound.js';
import { resolveLayerOrder, assignPartitions } from './layers.js';
import { buildElkGraph } from './elk-graph.js';
import { clipPackageEndpoints } from './package-endpoints.js';
import { mapElkResult } from './elk-result.js';

// elkjs ships a `typeof import(...)` default-export type under NodeNext; pin the
// real constructor shape so `new` type-checks and the layout result stays typed.
const ElkConstructor = ELKDefault as unknown as new (
  args?: ELKConstructorArguments,
) => ElkInstance;

/**
 * Entity count above which the single hierarchical ELK run is skipped in favour
 * of the compound layout (per-package blocks + packing + grid routing).
 */
const COMPOUND_ENTITY_THRESHOLD = 250;
/** Aspect ratio band and pixel budget a single hierarchical run must stay inside. */
const MAX_ASPECT = 3;
/** Stacked semantic layers are legitimately tall; only a sliver is rejected. */
const MIN_ASPECT = 0.2;
/** Narrowest aspect a width-driven switch to the compound layout may produce. */
const PREFERRED_MIN_ASPECT = 0.6;
const MAX_PIXELS = 40e6;
/** Canvas width beyond which a single hierarchical run is too wide to read. */
const MAX_WIDTH = 2400;

function isProportionate(layout: LayoutResult): boolean {
  if (layout.height <= 0 || layout.width <= 0) return true;
  const aspect = layout.width / layout.height;
  return aspect <= MAX_ASPECT && aspect >= MIN_ASPECT && layout.width * layout.height <= MAX_PIXELS;
}

/** Compound result that respects the width budget and is not a tall sliver. */
function isNarrowEnough(layout: LayoutResult): boolean {
  if (layout.height <= 0 || layout.width <= 0) return true;
  return layout.width <= MAX_WIDTH && layout.width / layout.height >= PREFERRED_MIN_ASPECT;
}

/** Edge routing strategies, evaluated in docs/layout-routing-eval.md. */
export type EdgeRoutingMode = 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';

/** Tuning knobs for the ELK engine. All are optional with sensible defaults. */
export interface ElkLayoutOptions {
  /**
   * Explicit layer order. Layers not listed (and packages without a layer) are
   * placed after the listed ones, in first-seen order. Defaults to the
   * declaration order of `"X Layer"` packages in the model.
   */
  layerOrder?: string[];
  /** Edge routing mode. Default `'ORTHOGONAL'` (see docs/layout-routing-eval.md). */
  edgeRouting?: EdgeRoutingMode;
  /**
   * Merge parallel edges between the same node pair (`elk.layered.mergeEdges`).
   * Only meaningful on models whose same-pair relations are already aggregated
   * into a weighted edge; default false.
   */
  mergeEdges?: boolean;
  /**
   * Target canvas width/height ratio (`elk.aspectRatio`), e.g. 16/9 for a
   * desktop panel or 9/16 for a portrait phone. Default 1.6.
   */
  aspectRatio?: number;
}


export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ElkConstructor();
  private readonly options: ElkLayoutOptions;

  constructor(options: ElkLayoutOptions = {}) {
    this.options = options;
  }

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    return clipPackageEndpoints(model, alignRows(model, await this.layoutRaw(model)));
  }

  private async layoutRaw(model: PlantUmlModel): Promise<LayoutResult> {
    const layers = resolveLayerOrder(model, this.options.layerOrder);
    const partitions = assignPartitions(model, layers);
    // Very large graphs skip the single hierarchical run: it cannot keep the
    // canvas proportioned, so it would only be thrown away.
    // A package-less graph has no blocks to pack: compound would degenerate into
    // one block per entity, so it always takes the layered run.
    let flat: LayoutResult | undefined;
    const target = this.options.aspectRatio;
    if (target !== undefined && target > 0) return this.layoutToward(model, layers, partitions, target);
    if (model.entities.length <= COMPOUND_ENTITY_THRESHOLD || model.packages.length === 0) {
      flat = await this.hierarchicalLayout(model, layers, partitions);
      if (isProportionate(flat) && flat.width <= MAX_WIDTH) return flat;
      if (model.packages.length === 0 && model.entities.length > COMPOUND_ENTITY_THRESHOLD) {
        return isProportionate(flat) ? flat : (await this.compound(model, layers, partitions));
      }
    }
    const compound = await this.compound(model, layers, partitions);
    // A flat run kept only for being too wide gives way to the compound layout
    // when that one fits the width budget without degenerating into a tall
    // sliver; otherwise the wide-but-balanced flat run is the better picture.
    if (flat !== undefined && isProportionate(flat) && !isNarrowEnough(compound)) return flat;
    return compound;
  }

  /**
   * Caller-requested canvas ratio: run both strategies and keep whichever lands
   * closer (in log distance) to the target. The default path never gets here.
   */
  private async layoutToward(
    model: PlantUmlModel,
    layers: string[],
    partitions: Map<string, number>,
    target: number,
  ): Promise<LayoutResult> {
    const candidates: LayoutResult[] = [await this.compound(model, layers, partitions)];
    if (model.entities.length <= COMPOUND_ENTITY_THRESHOLD || model.packages.length === 0) {
      candidates.push(await this.hierarchicalLayout(model, layers, partitions));
    }
    const miss = (l: LayoutResult): number =>
      l.width > 0 && l.height > 0 ? Math.abs(Math.log(l.width / l.height / target)) : 0;
    return candidates.reduce((best, c) => (miss(c) < miss(best) ? c : best));
  }

  private compound(
    model: PlantUmlModel,
    layers: string[],
    partitions: Map<string, number>,
  ): Promise<LayoutResult> {
    return compoundLayout(this.elk, model, {
      edgeRouting: this.options.edgeRouting ?? 'ORTHOGONAL',
      aspectRatio: this.options.aspectRatio,
      dense: model.entities.length > COMPOUND_ENTITY_THRESHOLD,
      partitions: layers.length > 0 ? partitions : new Map(),
    });
  }

  /** One ELK run over the whole nested graph (`INCLUDE_CHILDREN`). */
  private async hierarchicalLayout(
    model: PlantUmlModel,
    layers: string[],
    partitions: Map<string, number>,
  ): Promise<LayoutResult> {
    const graph = buildElkGraph(model, layers, partitions, {
      edgeRouting: this.options.edgeRouting ?? 'ORTHOGONAL',
      mergeEdges: this.options.mergeEdges,
      aspectRatio: this.options.aspectRatio,
    });
    return mapElkResult(model, await this.elk.layout(graph));
  }
}

export type { ElkPoint };
