/**
 * Model → ELK graph construction for the ELK engine: package containers,
 * entity leaves, packed boxes for unconnected entities, and the layout-direction
 * helpers for edges. Pure functions over the model.
 */

import type { ElkNode } from 'elkjs';
import { PlantUmlModel, PlantUmlEntity, PlantUmlRelation } from '../model.js';
import { PACKAGE_LABEL, estimateEntitySize } from '../layout.js';
import { measureTextWidth } from '../text-measure.js';

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

export function buildChildren(model: PlantUmlModel, partitions: Map<string, number>): ElkNode[] {
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
