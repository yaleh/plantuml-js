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
  ElkEdgeSection,
  ElkPoint,
  ELK as ElkInstance,
  ELKConstructorArguments,
} from 'elkjs';
import {
  PlantUmlModel,
  PlantUmlEntity,
  PlantUmlPackage,
  PlantUmlRelation,
} from '../model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  PackageLayout,
  Point,
  PACKAGE_LABEL,
  estimateEntitySize,
} from '../layout.js';
import { measureTextWidth } from '../text-measure.js';
import { compoundLayout } from './compound.js';

// elkjs ships a `typeof import(...)` default-export type under NodeNext; pin the
// real constructor shape so `new` type-checks and the layout result stays typed.
const ElkConstructor = ELKDefault as unknown as new (
  args?: ELKConstructorArguments,
) => ElkInstance;

const PACKAGE_PREFIX = 'pkg::';
/** Id prefix of the invisible container that packs a package's unconnected entities. */
const ISOLATED_PREFIX = 'iso::';
/** Unconnected entities in one container before they are packed into a grid... */
const ISOLATED_PACK_MIN = 3;
/** ...and only once laid side by side they would be wider than this (px). */
const ISOLATED_ROW_MAX_WIDTH = 2000;

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

/** Relation types whose layout direction is reversed so the arrow target sits above the source. */
const REVERSED_RELATION_TYPES = new Set(['inheritance', 'implementation']);

/** Name convention: `"X Layer"` declares a semantic layer `X`. */
const LAYER_SUFFIX = /^(.*)\s+Layer$/i;

/** Resolve a package's semantic layer from its explicit field or its name. */
function packageLayer(pkg: PlantUmlPackage): string | undefined {
  if (pkg.layer !== undefined) return pkg.layer;
  const m = LAYER_SUFFIX.exec(pkg.name);
  if (!m) return undefined;
  const core = m[1].trim();
  return core === '' ? undefined : core;
}

/**
 * Order semantic layers by dependency topology instead of puml declaration
 * order: a layer that depends on another (`A ..> B` across layers) sits *above*
 * its dependency, so entry layers (Tests, Examples) stack over the base they
 * consume (Src) and independent layers (Templates) fall out of the sandwich.
 *
 * A Kahn topological sort places in-degree-zero layers (nothing depends on
 * them) first, breaking ties in declaration order for determinism. Layers left
 * over because of a dependency cycle are appended in declaration order, so a
 * cyclic graph still yields a stable (if not strictly topological) order; the
 * renderer marks the offending back-edges as feedback arcs.
 */
function topologicalLayerOrder(model: PlantUmlModel): string[] {
  const declared: string[] = [];
  for (const pkg of model.packages) {
    const layer = packageLayer(pkg);
    if (layer !== undefined && !declared.includes(layer)) declared.push(layer);
  }
  if (declared.length <= 1) return declared;

  const pkgById = new Map(model.packages.map((p) => [p.id, p]));
  const layerOf = new Map<string, string | undefined>();
  for (const entity of model.entities) {
    const pkg = entity.packageId ? pkgById.get(entity.packageId) : undefined;
    layerOf.set(entity.id, pkg ? packageLayer(pkg) : undefined);
  }

  const dependsOn = new Map<string, Set<string>>();
  const dependents = new Map<string, number>();
  for (const layer of declared) {
    dependsOn.set(layer, new Set());
    dependents.set(layer, 0);
  }

  for (const relation of model.relations) {
    const source = layerOf.get(relation.source);
    const target = layerOf.get(relation.target);
    if (source === undefined || target === undefined || source === target) continue;
    const set = dependsOn.get(source)!;
    if (!set.has(target)) {
      set.add(target);
      dependents.set(target, (dependents.get(target) ?? 0) + 1);
    }
  }

  const order: string[] = [];
  const done = new Set<string>();
  const queue = declared.filter((layer) => (dependents.get(layer) ?? 0) === 0);
  for (let i = 0; i < queue.length; i++) {
    const layer = queue[i];
    order.push(layer);
    done.add(layer);
    for (const dep of dependsOn.get(layer) ?? []) {
      const remaining = (dependents.get(dep) ?? 0) - 1;
      dependents.set(dep, remaining);
      if (remaining === 0 && !done.has(dep)) queue.push(dep);
    }
  }

  // Cyclic remainder: keep declaration order so the output is stable.
  for (const layer of declared) {
    if (!done.has(layer)) order.push(layer);
  }
  return order;
}

/** Minimum frame width that keeps the package label tab readable. */
function packageMinWidth(name: string): number {
  return measureTextWidth(name, PACKAGE_LABEL.fontSize) + PACKAGE_LABEL.tabPadding + 20;
}

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ElkConstructor();
  private readonly options: ElkLayoutOptions;

  constructor(options: ElkLayoutOptions = {}) {
    this.options = options;
  }

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const layers = this.resolveLayerOrder(model);
    const partitions = this.assignPartitions(model, layers);
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
    const children = this.buildChildren(model, partitions);
    const edges: ElkExtendedEdge[] = model.relations.map((relation, i) => ({
      id: `rel-${i}`,
      sources: [this.layoutSource(relation)],
      targets: [this.layoutTarget(relation)],
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
    if (this.hasContainerCrossingEdge(model)) {
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
      this.flatten(child, 0, 0, nodes, packages, offsets);
    }
    this.enforcePackageMinWidth(model, packages);

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const laidEdges: EdgeLayout[] = (result.edges ?? []).map((edge, i) => {
      const relation = model.relations[i];
      const reversed = relation !== undefined && REVERSED_RELATION_TYPES.has(relation.type);
      const points = this.edgePoints(edge, nodeById, offsets);
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

  /** Source endpoint of the edge *as laid out* (reversed for inheritance/implementation). */
  private layoutSource(relation: PlantUmlRelation): string {
    return REVERSED_RELATION_TYPES.has(relation.type) ? relation.target : relation.source;
  }

  /** Target endpoint of the edge *as laid out* (reversed for inheritance/implementation). */
  private layoutTarget(relation: PlantUmlRelation): string {
    return REVERSED_RELATION_TYPES.has(relation.type) ? relation.source : relation.target;
  }

  /** Ordered, de-duplicated list of semantic layers (dependency topology by default). */
  private resolveLayerOrder(model: PlantUmlModel): string[] {
    if (this.options.layerOrder) {
      return this.options.layerOrder.filter((layer, i, all) => all.indexOf(layer) === i);
    }
    return topologicalLayerOrder(model);
  }

  /** Map each package to its partition index (layers first, unlayered last). */
  private assignPartitions(model: PlantUmlModel, layers: string[]): Map<string, number> {
    const partitions = new Map<string, number>();
    if (layers.length === 0) return partitions;
    for (const pkg of model.packages) {
      const layer = packageLayer(pkg);
      const index = layer !== undefined ? layers.indexOf(layer) : -1;
      partitions.set(pkg.id, index >= 0 ? index : layers.length);
    }
    return partitions;
  }

  /** True when any relation connects entities that live in different containers. */
  private hasContainerCrossingEdge(model: PlantUmlModel): boolean {
    const packageOf = new Map(model.entities.map((e) => [e.id, e.packageId]));
    return model.relations.some((r) => packageOf.get(r.source) !== packageOf.get(r.target));
  }

  private buildChildren(model: PlantUmlModel, partitions: Map<string, number>): ElkNode[] {
    const pkgNodes = new Map<string, ElkNode>();
    for (const pkg of model.packages) {
      // Padding at the top keeps the package label tab clear of the first
      // entity; the minimum width keeps the tab wide enough for the label when
      // a package holds only a single short-named entity.
      const minWidth = packageMinWidth(pkg.name);
      const minHeight = PACKAGE_LABEL.tabHeight + 26 + 10; // tab + top/bottom padding
      const layoutOptions: Record<string, string> = {
        'elk.padding': '[top=26,left=10,bottom=10,right=10]',
        'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
        'elk.nodeSize.minimum': `[${minWidth.toFixed(1)}, ${minHeight.toFixed(1)}]`,
      };
      const partition = partitions.get(pkg.id);
      if (partition !== undefined) layoutOptions['elk.partitioning.partition'] = String(partition);
      pkgNodes.set(pkg.id, {
        id: PACKAGE_PREFIX + pkg.id,
        children: [],
        layoutOptions,
      });
    }

    const connected = new Set<string>();
    for (const relation of model.relations) {
      connected.add(relation.source);
      connected.add(relation.target);
    }

    // Unconnected entities of one container are packed into a balanced grid by
    // an invisible sub-container; left alone, the layered algorithm lines them
    // all up in a single row and stretches the whole canvas.
    const isolatedByOwner = new Map<string, PlantUmlEntity[]>();
    const ownerKey = (entity: PlantUmlEntity): string =>
      entity.packageId && pkgNodes.has(entity.packageId) ? entity.packageId : '';
    for (const entity of model.entities) {
      if (connected.has(entity.id)) continue;
      const key = ownerKey(entity);
      const list = isolatedByOwner.get(key);
      if (list) list.push(entity);
      else isolatedByOwner.set(key, [entity]);
    }
    const packed = new Set<string>();
    const groups = new Map<string, ElkNode>();
    for (const [key, list] of isolatedByOwner) {
      if (list.length < ISOLATED_PACK_MIN) continue;
      const rowWidth = list.reduce((sum, e) => sum + estimateEntitySize(e).width + 40, 0);
      if (rowWidth <= ISOLATED_ROW_MAX_WIDTH) continue;
      const layoutOptions: Record<string, string> = {
        'elk.algorithm': 'rectpacking',
        'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
        'elk.aspectRatio': '1.6',
        'elk.spacing.nodeNode': '20',
        'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      };
      const partition = key === '' ? undefined : partitions.get(key);
      if (partition !== undefined) layoutOptions['elk.partitioning.partition'] = String(partition);
      groups.set(key, {
        id: ISOLATED_PREFIX + key,
        children: list.map((e) => this.entityLeaf(e)),
        layoutOptions,
      });
      for (const e of list) packed.add(e.id);
    }

    const top: ElkNode[] = [];
    for (const [key, group] of groups) {
      if (key === '') top.push(group);
      else pkgNodes.get(key)!.children!.push(group);
    }
    for (const entity of model.entities) {
      if (packed.has(entity.id)) continue;
      const leaf = this.entityLeaf(entity);
      const owner = entity.packageId ? pkgNodes.get(entity.packageId) : undefined;
      if (owner) owner.children!.push(leaf);
      else top.push(leaf);
    }

    // Link nested packages into their parents; packages without a parent (or
    // whose parent is unknown) sit at the top level.
    for (const pkg of model.packages) {
      const node = pkgNodes.get(pkg.id)!;
      const parent = pkg.parentId ? pkgNodes.get(pkg.parentId) : undefined;
      if (parent) parent.children!.push(node);
      else top.push(node);
    }

    return top;
  }

  private entityLeaf(entity: PlantUmlEntity): ElkNode {
    const size = estimateEntitySize(entity);
    return { id: entity.id, width: size.width, height: size.height };
  }

  /**
   * INCLUDE_CHILDREN sizes a container from its content and does not honour the
   * `elk.nodeSize.minimum` we give package frames, so a single short-named
   * entity can leave the frame narrower than its label tab. Widen those frames
   * in place (never shrink) so the tab stays readable.
   */
  private enforcePackageMinWidth(model: PlantUmlModel, packages: PackageLayout[]): void {
    const byId = new Map(packages.map((p) => [p.id, p]));
    for (const pkg of model.packages) {
      const box = byId.get(pkg.id);
      if (!box) continue;
      const min = packageMinWidth(pkg.name);
      if (box.width < min) box.width = min;
    }
  }

  private flatten(
    node: ElkNode,
    offsetX: number,
    offsetY: number,
    nodes: NodeLayout[],
    packages: PackageLayout[],
    offsets: Map<string, Point>,
  ): void {
    const x = (node.x ?? 0) + offsetX;
    const y = (node.y ?? 0) + offsetY;
    offsets.set(node.id, { x, y });

    if (node.id.startsWith(PACKAGE_PREFIX)) {
      packages.push({
        id: node.id.slice(PACKAGE_PREFIX.length),
        x,
        y,
        width: node.width ?? 0,
        height: node.height ?? 0,
      });
      for (const child of node.children ?? []) {
        this.flatten(child, x, y, nodes, packages, offsets);
      }
    } else if (node.id.startsWith(ISOLATED_PREFIX)) {
      for (const child of node.children ?? []) {
        this.flatten(child, x, y, nodes, packages, offsets);
      }
    } else {
      nodes.push({
        id: node.id,
        x,
        y,
        width: node.width ?? 0,
        height: node.height ?? 0,
      });
    }
  }

  private edgePoints(
    edge: ElkExtendedEdge,
    nodeById: Map<string, NodeLayout>,
    offsets: Map<string, Point>,
  ): Point[] {
    const sections = edge.sections ?? [];
    if (sections.length === 0) {
      return this.straightEdge(edge, nodeById);
    }

    const containerOffset = offsets.get(edge.container ?? 'root') ?? {
      x: 0,
      y: 0,
    };
    const points: Point[] = [];
    for (const section of sections) {
      for (const p of this.sectionPoints(section)) {
        const shifted = { x: p.x + containerOffset.x, y: p.y + containerOffset.y };
        const last = points[points.length - 1];
        if (!last || Math.abs(last.x - shifted.x) > 0.01 || Math.abs(last.y - shifted.y) > 0.01) {
          points.push(shifted);
        }
      }
    }
    return points.length >= 2 ? points : this.straightEdge(edge, nodeById);
  }

  private sectionPoints(section: ElkEdgeSection): Point[] {
    const pts: Point[] = [];
    if (section.startPoint) pts.push(section.startPoint);
    for (const b of section.bendPoints ?? []) pts.push(b);
    if (section.endPoint) pts.push(section.endPoint);
    return pts;
  }

  private straightEdge(
    edge: ElkExtendedEdge,
    nodeById: Map<string, NodeLayout>,
  ): Point[] {
    const source = nodeById.get(edge.sources?.[0] ?? '');
    const target = nodeById.get(edge.targets?.[0] ?? '');
    if (!source || !target) return [];
    return [
      { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    ];
  }
}

export type { ElkPoint };
