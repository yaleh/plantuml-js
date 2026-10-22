/**
 * Model → ELK graph construction for the ELK engine: package containers,
 * entity leaves, packed boxes for unconnected entities, and the layout-direction
 * helpers for edges. Pure functions over the model.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import { PlantUmlModel, PlantUmlEntity, PlantUmlRelation } from '../foundation/model.js';
import { PACKAGE_LABEL, estimateEntitySize } from '../foundation/layout.js';
import { measureTextWidth } from '../foundation/text-measure.js';

export const PACKAGE_PREFIX = 'pkg::';
/** Id prefix of the invisible container that packs a package's unconnected entities. */
export const ISOLATED_PREFIX = 'iso::';
/** Unconnected entities in one container before they are packed into a grid... */
const ISOLATED_PACK_MIN = 3;
/** ...and only once laid side by side they would be wider than this (px). */
const ISOLATED_ROW_MAX_WIDTH = 2000;

/** Relation types whose layout direction is reversed so the arrow target sits above the source. */
export const REVERSED_RELATION_TYPES = new Set(['inheritance', 'implementation']);

/** Minimum frame width that keeps the package label tab readable. */
export function packageMinWidth(name: string): number {
  return measureTextWidth(name, PACKAGE_LABEL.fontSize) + PACKAGE_LABEL.tabPadding + 20;
}

/** Source endpoint of the edge *as laid out* (reversed for inheritance/implementation). */
export function layoutSource(relation: PlantUmlRelation): string {
  return REVERSED_RELATION_TYPES.has(relation.type) ? relation.target : relation.source;
}

/** Target endpoint of the edge *as laid out* (reversed for inheritance/implementation). */
export function layoutTarget(relation: PlantUmlRelation): string {
  return REVERSED_RELATION_TYPES.has(relation.type) ? relation.source : relation.target;
}

/** True when any relation connects entities that live in different containers. */
export function hasContainerCrossingEdge(model: PlantUmlModel): boolean {
  const packageOf = new Map(model.entities.map((e) => [e.id, e.packageId]));
  return model.relations.some((r) => packageOf.get(r.source) !== packageOf.get(r.target));
}

export function entityLeaf(entity: PlantUmlEntity): ElkNode {
  const size = estimateEntitySize(entity);
  return { id: entity.id, width: size.width, height: size.height };
}

/** Packages with at least this many direct members are laid out top-down. */
const FLOW_DOWN_MIN_MEMBERS = 12;

/**
 * One ELK node's `layoutOptions`, weakest first: built-in defaults, then the
 * caller's raw `elk` escape-hatch keys (they override our defaults), then the
 * named options the caller explicitly set (they win any key collision).
 */
export function mergeElkOptions(
  defaults: Record<string, string>,
  named: Record<string, string>,
  raw: Record<string, string> | undefined,
): Record<string, string> {
  return raw === undefined ? { ...defaults, ...named } : { ...defaults, ...raw, ...named };
}

export function buildChildren(
  model: PlantUmlModel,
  partitions: Map<string, number>,
  rawElk?: Record<string, string>,
): ElkNode[] {
  const pkgNodes = new Map<string, ElkNode>();
  const memberCount = new Map<string, number>(model.packages.map((p) => [p.id, 0]));
  for (const entity of model.entities) {
    if (entity.packageId !== undefined && memberCount.has(entity.packageId)) {
      memberCount.set(entity.packageId, memberCount.get(entity.packageId)! + 1);
    }
  }
  for (const pkg of model.packages) {
    // Padding at the top keeps the package label tab clear of the first
    // entity; the minimum width keeps the tab wide enough for the label when
    // a package holds only a single short-named entity.
    const minWidth = packageMinWidth(pkg.name);
    const minHeight = PACKAGE_LABEL.tabHeight + 26 + 10; // tab + top/bottom padding
    const defaults: Record<string, string> = {
      'elk.padding': '[top=26,left=10,bottom=10,right=10]',
      'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
      'elk.nodeSize.minimum': `[${minWidth.toFixed(1)}, ${minHeight.toFixed(1)}]`,
    };
    // A package's interior is laid out on its own (INHERIT hierarchy) and would
    // fall back to ELK's default RIGHT, turning the dependency flow sideways.
    // Big packages read top-down like the rest of the diagram; small ones stay compact.
    if (memberCount.get(pkg.id)! >= FLOW_DOWN_MIN_MEMBERS) defaults['elk.direction'] = 'DOWN';
    // The semantic-layer partition is named-option territory (layerOrder / "X Layer"
    // packages), so it beats a same-key raw `elk` value.
    const named: Record<string, string> = {};
    const partition = partitions.get(pkg.id);
    if (partition !== undefined) named['elk.partitioning.partition'] = String(partition);
    pkgNodes.set(pkg.id, {
      id: PACKAGE_PREFIX + pkg.id,
      children: [],
      layoutOptions: mergeElkOptions(defaults, named, rawElk),
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
      children: list.map((e) => entityLeaf(e)),
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
    const leaf = entityLeaf(entity);
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

export interface ElkGraphOptions {
  /** Edge routing mode; omitted means the built-in ORTHOGONAL default. */
  edgeRouting?: string;
  mergeEdges?: boolean;
  aspectRatio?: number;
  /** Raw ELK options injected into the root and every package container (escape hatch). */
  elk?: Record<string, string>;
}

/** The root ELK graph for one hierarchical run over the whole nested model. */
export function buildElkGraph(
  model: PlantUmlModel,
  layers: string[],
  partitions: Map<string, number>,
  options: ElkGraphOptions,
): ElkNode {
  const partitionsActive = layers.length > 0;
  // Memberless one-line boxes (overview / grouped / stub-only graphs) are tiny
  // next to the default gaps, which leaves the canvas mostly empty.
  const compact =
    model.packages.length === 0 && model.entities.every((e) => e.members.length === 0);
  const children = buildChildren(model, partitions, options.elk);
  const edges: ElkExtendedEdge[] = model.relations.map((relation, i) => ({
    id: `rel-${i}`,
    sources: [layoutSource(relation)],
    targets: [layoutTarget(relation)],
  }));

  const defaults: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': compact ? '12' : '20',
    'elk.layered.spacing.nodeNodeBetweenLayers': compact ? '24' : '24',
    // Ports keep a fixed side per edge, so same-direction edges fan out across
    // one node edge instead of scattering onto every side (or one point).
    'elk.layered.portConstraints': 'FIXED_SIDE',
    // Keep wires off node sides and off each other (see layout-metrics edgeFlushCount).
    'elk.spacing.edgeNode': '12',
    'elk.spacing.edgeEdge': '10',
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
  // Values that come from an explicitly-set named option: these beat a raw
  // `elk` key of the same name (documented precedence).
  const named: Record<string, string> = {};
  if (options.edgeRouting !== undefined) named['elk.edgeRouting'] = options.edgeRouting;
  if (options.aspectRatio !== undefined) named['elk.aspectRatio'] = String(options.aspectRatio);
  if (options.mergeEdges) named['elk.layered.mergeEdges'] = 'true';
  if (partitionsActive) named['elk.partitioning.activate'] = 'true';
  if (compact) {
    defaults['elk.layered.nodePlacement.strategy'] = 'NETWORK_SIMPLEX';
    defaults['elk.layered.spacing.edgeEdgeBetweenLayers'] = '5';
    defaults['elk.layered.spacing.edgeNodeBetweenLayers'] = '12';
  }
  // Every edge that crosses a container boundary (package↔package or
  // package↔top-level stub) needs INCLUDE_CHILDREN to get a routing section.
  if (hasContainerCrossingEdge(model)) {
    defaults['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
  }

  return {
    id: 'root',
    layoutOptions: mergeElkOptions(defaults, named, options.elk),
    children,
    edges,
  };
}
