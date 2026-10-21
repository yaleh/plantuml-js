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
  ElkNode,
  ElkExtendedEdge,
  ElkPoint,
  ELK as ElkInstance,
  ELKConstructorArguments,
} from 'elkjs';
import { PlantUmlModel } from '../model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  PackageLayout,
  Point,
} from '../layout.js';
import { compoundLayout } from './compound.js';
import { resolveLayerOrder, assignPartitions } from './layers.js';
import {
  buildChildren,
  layoutSource,
  layoutTarget,
  hasContainerCrossingEdge,
  REVERSED_RELATION_TYPES,
} from './elk-graph.js';
import { flatten, edgePoints, enforcePackageMinWidth } from './elk-result.js';

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
}


export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ElkConstructor();
  private readonly options: ElkLayoutOptions;

  constructor(options: ElkLayoutOptions = {}) {
    this.options = options;
  }

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const layers = resolveLayerOrder(model, this.options.layerOrder);
    const partitions = assignPartitions(model, layers);
    // Very large graphs skip the single hierarchical run: it cannot keep the
    // canvas proportioned, so it would only be thrown away.
    let flat: LayoutResult | undefined;
    if (model.entities.length <= COMPOUND_ENTITY_THRESHOLD) {
      flat = await this.hierarchicalLayout(model, layers, partitions);
      if (isProportionate(flat) && flat.width <= MAX_WIDTH) return flat;
    }
    const compound = await compoundLayout(this.elk, model, {
      edgeRouting: this.options.edgeRouting ?? 'ORTHOGONAL',
      dense: model.entities.length > COMPOUND_ENTITY_THRESHOLD,
      partitions: layers.length > 0 ? partitions : new Map(),
    });
    // A flat run kept only for being too wide gives way to the compound layout
    // when that one fits the width budget without degenerating into a tall
    // sliver; otherwise the wide-but-balanced flat run is the better picture.
    if (flat !== undefined && isProportionate(flat) && !isNarrowEnough(compound)) return flat;
    return compound;
  }

  /** One ELK run over the whole nested graph (`INCLUDE_CHILDREN`). */
  private async hierarchicalLayout(
    model: PlantUmlModel,
    layers: string[],
    partitions: Map<string, number>,
  ): Promise<LayoutResult> {
    const partitionsActive = layers.length > 0;
    // Memberless one-line boxes (overview / grouped / stub-only graphs) are tiny
    // next to the default gaps, which leaves the canvas mostly empty.
    const compact =
      model.packages.length === 0 && model.entities.every((e) => e.members.length === 0);
    const children = buildChildren(model, partitions);
    const edges: ElkExtendedEdge[] = model.relations.map((relation, i) => ({
      id: `rel-${i}`,
      sources: [layoutSource(relation)],
      targets: [layoutTarget(relation)],
    }));

    const layoutOptions: Record<string, string> = {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': this.options.edgeRouting ?? 'ORTHOGONAL',
      'elk.spacing.nodeNode': compact ? '12' : '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': compact ? '24' : '60',
      // Ports keep a fixed side per edge, so same-direction edges fan out across
      // one node edge instead of scattering onto every side (or one point).
      'elk.layered.portConstraints': 'FIXED_SIDE',
      // Soft targets: pack disconnected components into a balanced rectangle
      // instead of a long horizontal strip. (hierarchyHandling stays INHERIT
      // unless cross-package edges exist — see the header comment.)
      'elk.aspectRatio': '1.6',
      'elk.separateConnectedComponents': 'true',
      // INTERACTIVE placement keeps each layer's boxes centred on the widest
      // partition instead of fanning them out sideways, which is what lets a
      // topologically-stacked package diagram stay compact (see
      // docs/layout-routing-eval.md).
      'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    };
    if (partitionsActive) layoutOptions['elk.partitioning.activate'] = 'true';
    if (compact) {
      layoutOptions['elk.layered.nodePlacement.strategy'] = 'NETWORK_SIMPLEX';
      layoutOptions['elk.layered.spacing.edgeEdgeBetweenLayers'] = '5';
      layoutOptions['elk.layered.spacing.edgeNodeBetweenLayers'] = '12';
    }
    // Every edge that crosses a container boundary (package↔package or
    // package↔top-level stub) needs INCLUDE_CHILDREN to get a routing section.
    if (hasContainerCrossingEdge(model)) {
      layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
    }
    if (this.options.mergeEdges) layoutOptions['elk.layered.mergeEdges'] = 'true';

    const graph: ElkNode = {
      id: 'root',
      layoutOptions,
      children,
      edges,
    };

    const result = await this.elk.layout(graph);

    const nodes: NodeLayout[] = [];
    const packages: PackageLayout[] = [];
    const offsets = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
    for (const child of result.children ?? []) {
      flatten(child, 0, 0, nodes, packages, offsets);
    }
    enforcePackageMinWidth(model, packages);

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const laidEdges: EdgeLayout[] = (result.edges ?? []).map((edge, i) => {
      const relation = model.relations[i];
      const reversed = relation !== undefined && REVERSED_RELATION_TYPES.has(relation.type);
      const points = edgePoints(edge, nodeById, offsets);
      return {
        id: edge.id ?? `rel-${i}`,
        // Keep the model's direction (not the possibly-reversed layout
        // direction) so the renderer's arrowheads and the overlap counter both
        // see the endpoints the author wrote.
        source: relation?.source ?? (edge.sources?.[0] ?? ''),
        target: relation?.target ?? (edge.targets?.[0] ?? ''),
        points: reversed ? points.slice().reverse() : points,
      };
    });

    return {
      nodes,
      edges: laidEdges,
      packages,
      width: result.width ?? 0,
      height: result.height ?? 0,
    };
  }
}

export type { ElkPoint };
