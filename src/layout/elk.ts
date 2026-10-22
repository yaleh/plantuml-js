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
import { PlantUmlModel } from '../foundation/model.js';
import { LayoutEngine, LayoutResult, alignRows, alignIsolatedFrames } from '../foundation/layout.js';
import { compoundLayout, type StubOrbit } from './compound.js';
import { computeLayoutMetrics, computeMaxEmptyBlockRatio } from './layout-metrics.js';
import { resolveLayerOrder, assignPartitions } from '../foundation/layers.js';
import { buildElkGraph } from './elk-graph.js';
import { clipPackageEndpoints } from './package-endpoints.js';
import { mapElkResult } from './elk-result.js';
import { spreadParallelLanes } from './lane-spread.js';
import { straightenTrunkDetours, liftFlushSegments, uncoilWraps } from './trunk-lanes.js';
import { mergeFanoutTrunks } from './fanout-trunk.js';
import { runStrategies, type LayoutStrategy } from './strategy.js';

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
/** Top-level package count from which a gappy flat run yields to packed blocks. */
const MID_ROOT_PACKAGES = 8;
/** Empty-block ratio above which a mid-scale flat run is considered gappy. */
const MID_MAX_EMPTY_BLOCK = 0.15;
const MAX_PIXELS = 40e6;
/** Canvas area (px²) a dense compound layout with dependency-ordered rows may use. */
const COMPOUND_AREA_BUDGET = 90e6;
/** Canvas width beyond which a single hierarchical run is too wide to read. */
const MAX_WIDTH = 2400;

/** Alternative stub orbits tried after the default one (tuned on the archguard package views). */
const STUB_ORBITS: StubOrbit[] = [
  { gap: 72, spacing: 112, anchor: 'nearest' },
  { gap: 88, spacing: 120, anchor: 'nearest' },
  { gap: 72, spacing: 136, anchor: 'nearest' },
  { gap: 48, spacing: 112, anchor: 'centroid' },
];
/** Clutter cost under which no further stub orbit is tried. */
const STUB_GOOD_ENOUGH = 400;

/** Clutter of a stub view: border-hugging edges and parallel walls weigh most. */
function stubViewCost(model: PlantUmlModel, layout: LayoutResult): number {
  const m = computeLayoutMetrics(model, layout);
  return (
    m.edgeFlushCount * 500 +
    m.edgeNodeIntersections * 1000 +
    m.overlappingEdgeLength +
    m.edgeCrossings * 4 +
    m.maxEmptyBlockRatio * 2000
  );
}

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

/** A tall single-column run: narrower than the preferred minimum aspect. */
function isColumn(layout: LayoutResult): boolean {
  return layout.height > 0 && layout.width / layout.height < PREFERRED_MIN_ASPECT;
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
  /**
   * Extra layout strategies tried, in order, before the built-in decision
   * chain; the first to return a result wins (see [[./strategy]]).
   */
  strategies?: LayoutStrategy[];
  /**
   * Raw ELK options (`elk.*` keys), the escape hatch for knobs that have no
   * named option here — e.g.
   * `{ 'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
   *    'elk.layered.layering.coffmanGraham.layerBound': '2' }` to cap how many
   * nodes sit side by side per layer, which a plain `aspectRatio` cannot do.
   *
   * Every key is injected into the root graph *and* every package container
   * node, recursively, so nested packages honour it too. Values override the
   * engine's built-in defaults, but an explicitly-set named option wins a
   * same-key collision (`aspectRatio` over `elk.aspectRatio`, `edgeRouting`
   * over `elk.edgeRouting`, `mergeEdges` over `elk.layered.mergeEdges`).
   *
   * Known elkjs crash: `INCLUDE_CHILDREN` + `COFFMAN_GRAHAM` +
   * `coffmanGraham.layerBound=2` + `elk.aspectRatio=1.6` throws
   * `TypeError: Cannot read properties of undefined (reading 'c')`; steer clear
   * of that exact combination (bound=2 with a different ratio is fine).
   */
  elk?: Record<string, string>;
}

/** One raw layout plus whether the compound layout placed orbiting stubs in it. */
interface RawLayout {
  layout: LayoutResult;
  orbited: boolean;
}

/** Per-run knobs threaded through the layout calls (not engine state). */
interface RunOptions {
  /** Stub orbit variant to use. */
  orbit?: StubOrbit;
  /** Skip the router's rip-up passes (while stub orbits are only being compared). */
  quick?: boolean;
}


/** Clear space kept between any edge point and the canvas side. */
export const CANVAS_EDGE_MARGIN = 16;

/**
 * Translate and grow the canvas so no edge point (or node/frame) sits closer
 * than [[CANVAS_EDGE_MARGIN]] to a canvas side — a line hugging the border is
 * easily cropped.
 */
export function fitCanvas(layout: LayoutResult): LayoutResult {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const e of layout.edges ?? []) for (const p of e.points) take(p.x, p.y);
  if (minX === Infinity) return layout;
  const dx = Math.max(0, CANVAS_EDGE_MARGIN - minX);
  const dy = Math.max(0, CANVAS_EDGE_MARGIN - minY);
  const width = Math.max(layout.width + dx, maxX + dx + CANVAS_EDGE_MARGIN);
  const height = Math.max(layout.height + dy, maxY + dy + CANVAS_EDGE_MARGIN);
  if (dx === 0 && dy === 0 && width === layout.width && height === layout.height) return layout;
  return {
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: layout.edges.map((e) => ({ ...e, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) })),
    packages: layout.packages?.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    width,
    height,
  };
}

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ElkConstructor();
  private readonly options: ElkLayoutOptions;

  constructor(options: ElkLayoutOptions = {}) {
    this.options = options;
  }

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const finish = (raw: LayoutResult): LayoutResult =>
      fitCanvas(
        liftFlushSegments(
          // stub views price crossings high on purpose: their rail edges are not un-coiled
          (model.entities.some((e) => e.stub) ? (l: LayoutResult) => l : uncoilWraps)(
            straightenTrunkDetours(
              mergeFanoutTrunks(model, spreadParallelLanes(clipPackageEndpoints(model, alignIsolatedFrames(model, alignRows(model, raw))))),
            ),
          ),
        ),
      );
    if (!model.entities.some((e) => e.stub)) return finish((await this.layoutRaw(model)).layout);
    // Where the orbiting stubs sit decides how the router weaves their edges
    // through the frame; the outcome is chaotic enough that a handful of
    // orbits is tried and the least cluttered picture kept. The trials skip the
    // router's rip-up passes (the slow part); only the winner is routed in full.
    const first = await this.layoutRaw(model, { quick: true });
    if (!first.orbited) return finish(first.layout);
    let bestCost = stubViewCost(model, finish(first.layout));
    let bestOrbit: StubOrbit | undefined;
    for (const orbit of STUB_ORBITS) {
      if (bestCost <= STUB_GOOD_ENOUGH) break;
      const trial = await this.layoutRaw(model, { orbit, quick: true });
      const cost = stubViewCost(model, finish(trial.layout));
      if (cost < bestCost) {
        bestCost = cost;
        bestOrbit = orbit;
      }
    }
    return finish((await this.layoutRaw(model, { orbit: bestOrbit })).layout);
  }

  private async layoutRaw(model: PlantUmlModel, run: RunOptions = {}): Promise<RawLayout> {
    const layers = resolveLayerOrder(model, this.options.layerOrder);
    const partitions = assignPartitions(model, layers);
    const injected = await runStrategies(this.options.strategies, model, { layers, partitions });
    if (injected !== undefined) return { layout: injected, orbited: false };
    let flat: LayoutResult | undefined;
    const raw = (layout: LayoutResult): RawLayout => ({ layout, orbited: false });
    // A large package-less graph has no blocks to pack: the compound layout
    // degenerates into one block per entity, which is an order of magnitude
    // slower and no better proportioned than the single layered run (measured:
    // 789 flat nodes — 1.7s/608 crossings layered vs 40s/13625 compound). It
    // also has no folded layer sequence, so a requested aspectRatio cannot
    // reshape it either; take the layered run unconditionally instead.
    if (model.packages.length === 0 && model.entities.length > COMPOUND_ENTITY_THRESHOLD) {
      return raw(await this.hierarchicalLayout(model, layers, partitions));
    }
    // Very large graphs skip the single hierarchical run: it cannot keep the
    // canvas proportioned, so it would only be thrown away.
    const target = this.options.aspectRatio;
    if (target !== undefined && target > 0) return this.layoutToward(model, layers, partitions, target, run);
    if (model.entities.length <= COMPOUND_ENTITY_THRESHOLD || model.packages.length === 0) {
      flat = await this.hierarchicalLayout(model, layers, partitions);
      if (isProportionate(flat) && flat.width <= MAX_WIDTH && !this.isGappyMidScale(model, flat)) return raw(flat);
    }
    const compound = await this.compound(model, layers, partitions, run);
    const packed = compound.layout;
    if (flat !== undefined && this.isGappyMidScale(model, flat) && isProportionate(flat) && !isColumn(packed)
      && computeMaxEmptyBlockRatio(packed) >= computeMaxEmptyBlockRatio(flat)) return raw(flat);
    // A flat run kept only for being too wide gives way to the compound layout
    // when that one fits the width budget without degenerating into a tall
    // sliver; otherwise the wide-but-balanced flat run is the better picture.
    // A flat run that degenerated into a single column (aspect under the
    // preferred minimum) is never worth keeping over the packed blocks.
    if (flat !== undefined && isProportionate(flat) && !isNarrowEnough(packed) && !isColumn(flat)) return raw(flat);
    return compound;
  }

  /**
   * A mid-scale root layer (many top-level packages) whose single hierarchical
   * run left a large hole: the packed compound blocks are tried instead.
   */
  private isGappyMidScale(model: PlantUmlModel, flat: LayoutResult): boolean {
    const roots = model.packages.filter((p) => p.parentId === undefined).length;
    return roots >= MID_ROOT_PACKAGES && computeMaxEmptyBlockRatio(flat) > MID_MAX_EMPTY_BLOCK;
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
    run: RunOptions,
  ): Promise<RawLayout> {
    const compound = await this.compound(model, layers, partitions, run);
    const candidates: LayoutResult[] = [compound.layout];
    if (model.entities.length <= COMPOUND_ENTITY_THRESHOLD || model.packages.length === 0) {
      candidates.push(await this.hierarchicalLayout(model, layers, partitions));
    }
    const miss = (l: LayoutResult): number =>
      l.width > 0 && l.height > 0 ? Math.abs(Math.log(l.width / l.height / target)) : 0;
    const winner = candidates.reduce((best, c) => (miss(c) < miss(best) ? c : best));
    return { layout: winner, orbited: true };
  }

  private async compound(
    model: PlantUmlModel,
    layers: string[],
    partitions: Map<string, number>,
    { orbit, quick }: RunOptions,
  ): Promise<RawLayout> {
    const dense = model.entities.length > COMPOUND_ENTITY_THRESHOLD;
    const run = (rectPackDense: boolean): Promise<LayoutResult> =>
      compoundLayout(this.elk, model, {
        edgeRouting: this.options.edgeRouting,
        aspectRatio: this.options.aspectRatio,
        elk: this.options.elk,
        dense,
        rectPackDense,
        partitions: layers.length > 0 ? partitions : new Map(),
        stubOrbit: orbit,
        ripupPasses: quick ? 0 : undefined,
      });
    const ordered = await run(false);
    // Dependency-ordered rows cost canvas on very large graphs; past the budget
    // fall back to the tighter (order-blind) rect packing.
    if (dense && ordered.width * ordered.height > COMPOUND_AREA_BUDGET) {
      return { layout: await run(true), orbited: true };
    }
    return { layout: ordered, orbited: true };
  }

  /** One ELK run over the whole nested graph (`INCLUDE_CHILDREN`). */
  private async hierarchicalLayout(
    model: PlantUmlModel,
    layers: string[],
    partitions: Map<string, number>,
  ): Promise<LayoutResult> {
    const graph = buildElkGraph(model, layers, partitions, {
      edgeRouting: this.options.edgeRouting,
      mergeEdges: this.options.mergeEdges,
      aspectRatio: this.options.aspectRatio,
      elk: this.options.elk,
    });
    return mapElkResult(model, await this.elk.layout(graph));
  }
}

export type { ElkPoint };
