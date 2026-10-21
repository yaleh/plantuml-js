/**
 * Compound layout — lay packages out as independent blocks, place the blocks,
 * then route the edges that cross block boundaries.
 *
 * A single hierarchical layered run (`INCLUDE_CHILDREN`) routes every edge but
 * stacks all layers of every package into one tall strip: the 660-entity
 * archguard `all-classes` graph came out 13455×79369. Here each top-level
 * package is laid out on its own (packed to a balanced rectangle), the blocks
 * are arranged as plain nodes — layered for small block counts, rectpacking for
 * large ones — and [[routeOrthogonal]] draws the cross-block edges around the
 * leaf boxes along the channels between blocks.
 */

import type { ELK as ElkInstance, ElkNode, ElkExtendedEdge, ElkEdgeSection } from 'elkjs';
import type { PlantUmlModel, PlantUmlEntity, PlantUmlPackage, PlantUmlRelation } from '../model.js';
import {
  estimateEntitySize,
  PACKAGE_LABEL,
  type EdgeLayout,
  type LayoutResult,
  type NodeLayout,
  type PackageLayout,
  type Point,
} from '../layout.js';
import { measureTextWidth } from '../text-measure.js';
import { routeOrthogonal, type RouteRequest } from './grid-router.js';

const PACKAGE_PREFIX = 'pkg::';
/** Block aspect ratio beyond which a flat block is repacked instead of layered. */
const BLOCK_MAX_ASPECT = 2.2;
const REVERSED_RELATION_TYPES = new Set(['inheritance', 'implementation']);

/**
 * Width beyond which a lopsided nested block is split into child blocks and
 * rect-packed; narrower strips keep their (low-crossing) layered routing.
 */
const NESTED_SPLIT_WIDTH = 3500;

/** Block count above which blocks are packed instead of layered. */
const PACK_BLOCK_THRESHOLD = 12;
/** Gap between blocks: wide enough for several routing lanes. */
const BLOCK_SPACING = 64;
/** Border kept free around the whole canvas for outer routing lanes. */
const CANVAS_MARGIN = 40;

/** Node gap inside packed blocks of a dense (very large) graph; leaves one routing lane. */
const DENSE_NODE_SPACING = 36;

export interface CompoundOptions {
  /** Pack every flat block tightly (very large graphs); edges are grid-routed. */
  dense?: boolean;
  edgeRouting: string;
  /** Block id → semantic-layer partition index (layered mode only). */
  partitions: Map<string, number>;
}

interface Block {
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

function packageMinWidth(name: string): number {
  return measureTextWidth(name, PACKAGE_LABEL.fontSize) + PACKAGE_LABEL.tabPadding + 20;
}

export async function compoundLayout(
  elk: ElkInstance,
  model: PlantUmlModel,
  options: CompoundOptions,
): Promise<LayoutResult> {
  const pkgById = new Map(model.packages.map((p) => [p.id, p]));
  const topOfPackage = new Map<string, string>();
  const topPackageOf = (id: string): string => {
    const cached = topOfPackage.get(id);
    if (cached !== undefined) return cached;
    let cur = pkgById.get(id)!;
    const seen = new Set<string>([cur.id]);
    while (cur.parentId !== undefined && pkgById.has(cur.parentId) && !seen.has(cur.parentId)) {
      cur = pkgById.get(cur.parentId)!;
      seen.add(cur.id);
    }
    topOfPackage.set(id, cur.id);
    return cur.id;
  };

  /** Block key of an entity: its top-level package, or itself when it has none. */
  const blockOfEntity = new Map<string, string>();
  for (const entity of model.entities) {
    const pkgId = entity.packageId !== undefined && pkgById.has(entity.packageId) ? entity.packageId : undefined;
    blockOfEntity.set(entity.id, pkgId !== undefined ? PACKAGE_PREFIX + topPackageOf(pkgId) : entity.id);
  }

  // Group model parts by block.
  const entitiesByBlock = new Map<string, PlantUmlEntity[]>();
  for (const entity of model.entities) {
    const key = blockOfEntity.get(entity.id)!;
    const list = entitiesByBlock.get(key);
    if (list) list.push(entity);
    else entitiesByBlock.set(key, [entity]);
  }
  const packagesByBlock = new Map<string, PlantUmlPackage[]>();
  for (const pkg of model.packages) {
    const key = PACKAGE_PREFIX + topPackageOf(pkg.id);
    const list = packagesByBlock.get(key);
    if (list) list.push(pkg);
    else packagesByBlock.set(key, [pkg]);
  }
  const blockKeys: string[] = [];
  for (const pkg of model.packages) {
    if (topPackageOf(pkg.id) === pkg.id) blockKeys.push(PACKAGE_PREFIX + pkg.id);
  }
  for (const entity of model.entities) {
    const key = blockOfEntity.get(entity.id)!;
    if (!key.startsWith(PACKAGE_PREFIX) || !packagesByBlock.has(key)) {
      if (!blockKeys.includes(key)) blockKeys.push(key);
    }
  }

  const relationsByBlock = new Map<string, number[]>();
  const crossRelations: number[] = [];
  model.relations.forEach((relation, index) => {
    const sb = blockOfEntity.get(relation.source);
    const tb = blockOfEntity.get(relation.target);
    if (sb === undefined || tb === undefined) return;
    if (sb === tb) {
      const list = relationsByBlock.get(sb);
      if (list) list.push(index);
      else relationsByBlock.set(sb, [index]);
    } else {
      crossRelations.push(index);
    }
  });

  // 1. Lay each block out on its own.
  const blocks = new Map<string, Block>();
  for (const key of blockKeys) {
    const entities = entitiesByBlock.get(key) ?? [];
    const packages = packagesByBlock.get(key) ?? [];
    blocks.set(
      key,
      await layoutBlock(elk, model, key, entities, packages, relationsByBlock.get(key) ?? [], options),
    );
  }

  // 2. Place the blocks.
  const placed = await placeBlocks(elk, model, blocks, crossRelations, blockOfEntity, options);

  // 3. Absolute geometry.
  const nodes: NodeLayout[] = [];
  const packagesOut: PackageLayout[] = [];
  const edgePoints = new Map<number, Point[]>();
  for (const key of blockKeys) {
    const block = blocks.get(key)!;
    const at = placed.positions.get(key) ?? { x: CANVAS_MARGIN, y: CANVAS_MARGIN };
    for (const n of block.nodes) nodes.push({ ...n, x: n.x + at.x, y: n.y + at.y });
    for (const p of block.packages) packagesOut.push({ ...p, x: p.x + at.x, y: p.y + at.y });
    for (const index of block.unrouted ?? []) crossRelations.push(index);
    for (const [index, points] of block.edges) {
      edgePoints.set(index, points.map((p) => ({ x: p.x + at.x, y: p.y + at.y })));
    }
  }

  // 4. Route the edges that cross blocks.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const requests: RouteRequest[] = [];
  for (const index of crossRelations) {
    const relation = model.relations[index];
    const source = nodeById.get(relation.source);
    const target = nodeById.get(relation.target);
    if (source && target) requests.push({ id: String(index), source, target });
  }
  const routed = routeOrthogonal(requests, nodes, { width: placed.width, height: placed.height });
  for (const [id, points] of routed) edgePoints.set(Number(id), points);

  const edges: EdgeLayout[] = model.relations.map((relation, index) => ({
    id: `rel-${index}`,
    source: relation.source,
    target: relation.target,
    points: edgePoints.get(index) ?? [],
  }));

  return { nodes, edges, packages: packagesOut, width: placed.width, height: placed.height };
}

/** ELK-layout one block (a top-level package subtree, or a single bare entity). */
async function layoutBlock(
  elk: ElkInstance,
  model: PlantUmlModel,
  key: string,
  entities: PlantUmlEntity[],
  packages: PlantUmlPackage[],
  relationIndexes: number[],
  options: CompoundOptions,
): Promise<Block> {
  if (!key.startsWith(PACKAGE_PREFIX) || packages.length === 0) {
    const entity = entities[0];
    const size = estimateEntitySize(entity);
    return {
      key,
      width: size.width,
      height: size.height,
      nodes: [{ id: entity.id, x: 0, y: 0, width: size.width, height: size.height }],
      packages: [],
      edges: new Map(),
    };
  }

  const topId = key.slice(PACKAGE_PREFIX.length);
  const pkgNodes = new Map<string, ElkNode>();
  for (const pkg of packages) {
    if (pkg.id === topId) continue;
    pkgNodes.set(pkg.id, {
      id: PACKAGE_PREFIX + pkg.id,
      children: [],
      layoutOptions: {
        'elk.padding': '[top=26,left=10,bottom=10,right=10]',
        'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
        'elk.nodeSize.minimum': `[${packageMinWidth(pkg.name).toFixed(1)}, ${PACKAGE_LABEL.tabHeight + 36}]`,
      },
    });
  }
  const rootChildren: ElkNode[] = [];
  for (const entity of entities) {
    const size = estimateEntitySize(entity);
    const leaf: ElkNode = { id: entity.id, width: size.width, height: size.height };
    const owner = entity.packageId !== undefined && entity.packageId !== topId ? pkgNodes.get(entity.packageId) : undefined;
    if (owner) owner.children!.push(leaf);
    else rootChildren.push(leaf);
  }
  for (const pkg of packages) {
    if (pkg.id === topId) continue;
    const node = pkgNodes.get(pkg.id)!;
    const parent = pkg.parentId !== undefined && pkg.parentId !== topId ? pkgNodes.get(pkg.parentId) : undefined;
    if (parent) parent.children!.push(node);
    else rootChildren.push(node);
  }

  const edges: ElkExtendedEdge[] = relationIndexes.map((index) => {
    const relation = model.relations[index];
    const reversed = REVERSED_RELATION_TYPES.has(relation.type);
    return {
      id: `rel-${index}`,
      sources: [reversed ? relation.target : relation.source],
      targets: [reversed ? relation.source : relation.target],
    };
  });

  const pkg = packages.find((p) => p.id === topId)!;
  const hasNested = packages.length > 1;
  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.edgeRouting': options.edgeRouting,
    'elk.spacing.nodeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.layered.portConstraints': 'FIXED_SIDE',
    'elk.aspectRatio': '1.6',
    'elk.separateConnectedComponents': 'true',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.padding': '[top=26,left=10,bottom=10,right=10]',
  };
  if (hasNested) layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';

  const graph: ElkNode = { id: 'block', layoutOptions, children: rootChildren, edges };
  let result = await elk.layout(graph);
  let repacked = false;
  const aspect = (result.width ?? 0) / Math.max(1, result.height ?? 1);
  const wide = (result.width ?? 0) > NESTED_SPLIT_WIDTH;
  if (hasNested && wide && (aspect > BLOCK_MAX_ASPECT || aspect < 1 / BLOCK_MAX_ASPECT)) {
    return splitNestedBlock(elk, model, key, entities, packages, relationIndexes, options);
  }
  if (!hasNested && (options.dense || aspect > BLOCK_MAX_ASPECT || aspect < 1 / BLOCK_MAX_ASPECT)) {
    // A single wide layer cannot be wrapped by the layered algorithm; pack the
    // boxes into a balanced rectangle and let the grid router draw the edges.
    result = await elk.layout({
      id: 'block',
      layoutOptions: {
        'elk.algorithm': 'rectpacking',
        'elk.aspectRatio': '1.6',
        'elk.spacing.nodeNode': String(options.dense ? DENSE_NODE_SPACING : 40),
        'elk.padding': '[top=26,left=10,bottom=10,right=10]',
      },
      children: rootChildren,
    });
    repacked = true;
  }

  const nodes: NodeLayout[] = [];
  const packagesOut: PackageLayout[] = [];
  const offsets = new Map<string, Point>([['block', { x: 0, y: 0 }]]);
  const flatten = (node: ElkNode, ox: number, oy: number): void => {
    const x = (node.x ?? 0) + ox;
    const y = (node.y ?? 0) + oy;
    offsets.set(node.id, { x, y });
    if (node.id.startsWith(PACKAGE_PREFIX)) {
      packagesOut.push({ id: node.id.slice(PACKAGE_PREFIX.length), x, y, width: node.width ?? 0, height: node.height ?? 0 });
      for (const child of node.children ?? []) flatten(child, x, y);
    } else {
      nodes.push({ id: node.id, x, y, width: node.width ?? 0, height: node.height ?? 0 });
    }
  };
  for (const child of result.children ?? []) flatten(child, 0, 0);

  const width = Math.max(result.width ?? 0, packageMinWidth(pkg.name));
  const height = Math.max(result.height ?? 0, PACKAGE_LABEL.tabHeight + 36);
  packagesOut.push({ id: topId, x: 0, y: 0, width, height });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map<number, Point[]>();
  if (repacked) {
    return { key, width, height, nodes, packages: packagesOut, edges: edgeMap, unrouted: relationIndexes };
  }
  for (const edge of result.edges ?? []) {
    const index = Number((edge.id ?? '').slice('rel-'.length));
    const relation: PlantUmlRelation = model.relations[index];
    const reversed = REVERSED_RELATION_TYPES.has(relation.type);
    const points = elkEdgePoints(edge, nodeById, offsets);
    edgeMap.set(index, reversed ? points.slice().reverse() : points);
  }

  return { key, width, height, nodes, packages: packagesOut, edges: edgeMap };
}

/**
 * Pack a lopsided nested block proportionally: every child package becomes a
 * block of its own (recursively split when it is lopsided too), and the child
 * blocks plus the package's own entities are rect-packed into a balanced
 * rectangle. Edges inside a child keep their ELK routes; edges between
 * children are left for the grid router.
 */
async function splitNestedBlock(
  elk: ElkInstance,
  model: PlantUmlModel,
  key: string,
  entities: PlantUmlEntity[],
  packages: PlantUmlPackage[],
  relationIndexes: number[],
  options: CompoundOptions,
): Promise<Block> {
  const topId = key.slice(PACKAGE_PREFIX.length);
  const top = packages.find((p) => p.id === topId)!;
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  const childOf = new Map<string, string>(); // package id → direct child of top
  for (const pkg of packages) {
    if (pkg.id === topId) continue;
    let cur = pkg;
    while (cur.parentId !== undefined && cur.parentId !== topId && pkgById.has(cur.parentId)) {
      cur = pkgById.get(cur.parentId)!;
    }
    childOf.set(pkg.id, cur.id);
  }
  const children = packages.filter((p) => p.parentId === topId);
  const entityChild = (e: PlantUmlEntity): string | undefined =>
    e.packageId !== undefined ? childOf.get(e.packageId) : undefined;
  const entityIds = new Map(entities.map((e) => [e.id, e]));
  const subBlocks: Block[] = [];
  const claimed = new Set<number>();
  for (const child of children) {
    const subKey = PACKAGE_PREFIX + child.id;
    const subPackages = packages.filter((p) => p.id === child.id || childOf.get(p.id) === child.id);
    const subEntities = entities.filter((e) => entityChild(e) === child.id);
    const subRelations = relationIndexes.filter((i) => {
      const r = model.relations[i];
      const a = entityIds.get(r.source);
      const b = entityIds.get(r.target);
      return a !== undefined && b !== undefined && entityChild(a) === child.id && entityChild(b) === child.id;
    });
    for (const i of subRelations) claimed.add(i);
    subBlocks.push(await layoutBlock(elk, model, subKey, subEntities, subPackages, subRelations, { ...options, dense: false }));
  }

  const unrouted: number[] = relationIndexes.filter((i) => !claimed.has(i));
  const own = entities.filter((e) => entityChild(e) === undefined);
  const elkChildren: ElkNode[] = [
    ...subBlocks.map((b) => ({ id: b.key, width: b.width, height: b.height })),
    ...own.map((e) => {
      const size = estimateEntitySize(e);
      return { id: e.id, width: size.width, height: size.height };
    }),
  ];
  // Layered placement over the child boxes keeps linked packages adjacent (few
  // crossings between them); wrapping bounds the aspect ratio.
  const itemOf = (id: string): string => {
    const e = entityIds.get(id);
    const c = e === undefined ? undefined : entityChild(e);
    return c === undefined ? id : PACKAGE_PREFIX + c;
  };
  const seen = new Set<string>();
  const linkEdges: ElkExtendedEdge[] = [];
  for (const i of unrouted) {
    const a = itemOf(model.relations[i].source);
    const b = itemOf(model.relations[i].target);
    if (a === b || seen.has(`${a}\u0000${b}`)) continue;
    seen.add(`${a}\u0000${b}`);
    linkEdges.push({ id: `lnk-${linkEdges.length}`, sources: [a], targets: [b] });
  }
  const packed: ElkNode = await elk.layout({
    id: 'block',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.aspectRatio': '1.6',
      'elk.spacing.nodeNode': String(DENSE_NODE_SPACING),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(BLOCK_SPACING),
      'elk.layered.wrapping.strategy': 'MULTI_EDGE',
      'elk.separateConnectedComponents': 'true',
      'elk.padding': '[top=26,left=10,bottom=10,right=10]',
    },
    children: elkChildren,
    edges: linkEdges,
  });

  const nodes: NodeLayout[] = [];
  const packagesOut: PackageLayout[] = [];
  const edges = new Map<number, Point[]>();
  for (const c of packed.children ?? []) {
    const at = { x: c.x ?? 0, y: c.y ?? 0 };
    const sub = subBlocks.find((b) => b.key === c.id);
    if (!sub) {
      nodes.push({ id: c.id, x: at.x, y: at.y, width: c.width ?? 0, height: c.height ?? 0 });
      continue;
    }
    for (const n of sub.nodes) nodes.push({ ...n, x: n.x + at.x, y: n.y + at.y });
    for (const p of sub.packages) packagesOut.push({ ...p, x: p.x + at.x, y: p.y + at.y });
    for (const i of sub.unrouted ?? []) unrouted.push(i);
    for (const [i, pts] of sub.edges) edges.set(i, pts.map((q) => ({ x: q.x + at.x, y: q.y + at.y })));
  }
  const width = Math.max(packed.width ?? 0, packageMinWidth(top.name));
  const height = Math.max(packed.height ?? 0, PACKAGE_LABEL.tabHeight + 36);
  packagesOut.push({ id: topId, x: 0, y: 0, width, height });
  return { key, width, height, nodes, packages: packagesOut, edges, unrouted };
}

function elkEdgePoints(
  edge: ElkExtendedEdge,
  nodeById: Map<string, NodeLayout>,
  offsets: Map<string, Point>,
): Point[] {
  const base = offsets.get(edge.container ?? 'block') ?? { x: 0, y: 0 };
  const points: Point[] = [];
  for (const section of edge.sections ?? []) {
    for (const p of sectionPoints(section)) {
      const shifted = { x: p.x + base.x, y: p.y + base.y };
      const last = points[points.length - 1];
      if (!last || Math.abs(last.x - shifted.x) > 0.01 || Math.abs(last.y - shifted.y) > 0.01) {
        points.push(shifted);
      }
    }
  }
  if (points.length >= 2) return points;
  const source = nodeById.get(edge.sources?.[0] ?? '');
  const target = nodeById.get(edge.targets?.[0] ?? '');
  if (!source || !target) return [];
  return [
    { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  ];
}

function sectionPoints(section: ElkEdgeSection): Point[] {
  const pts: Point[] = [];
  if (section.startPoint) pts.push(section.startPoint);
  for (const b of section.bendPoints ?? []) pts.push(b);
  if (section.endPoint) pts.push(section.endPoint);
  return pts;
}

interface Placement {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

/** Arrange blocks as fixed-size nodes; block-level edges bias the order. */
async function placeBlocks(
  elk: ElkInstance,
  model: PlantUmlModel,
  blocks: Map<string, Block>,
  crossRelations: number[],
  blockOfEntity: Map<string, string>,
  options: CompoundOptions,
): Promise<Placement> {
  const pack = blocks.size > PACK_BLOCK_THRESHOLD;
  if (!pack && options.partitions.size > 0) return stackLayerRows(blocks, options);
  const children: ElkNode[] = [...blocks.values()].map((b) => {
    const node: ElkNode = { id: b.key, width: b.width, height: b.height };
    const partition = options.partitions.get(b.key.slice(PACKAGE_PREFIX.length));
    if (!pack && partition !== undefined && options.partitions.size > 0) {
      node.layoutOptions = { 'elk.partitioning.partition': String(partition) };
    }
    return node;
  });

  const seen = new Set<string>();
  const edges: ElkExtendedEdge[] = [];
  for (const index of crossRelations) {
    const relation = model.relations[index];
    const a = blockOfEntity.get(relation.source)!;
    const b = blockOfEntity.get(relation.target)!;
    const pair = `${a}\u0000${b}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    edges.push({ id: `blk-${edges.length}`, sources: [a], targets: [b] });
  }

  const layoutOptions: Record<string, string> = pack
    ? {
        'elk.algorithm': 'rectpacking',
        'elk.aspectRatio': '1.6',
        'elk.spacing.nodeNode': String(BLOCK_SPACING),
        'elk.padding': `[top=${CANVAS_MARGIN},left=${CANVAS_MARGIN},bottom=${CANVAS_MARGIN},right=${CANVAS_MARGIN}]`,
      }
    : {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.aspectRatio': '1.6',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': String(BLOCK_SPACING),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(BLOCK_SPACING),
        'elk.layered.wrapping.strategy': 'MULTI_EDGE',
        'elk.separateConnectedComponents': 'true',
        'elk.padding': `[top=${CANVAS_MARGIN},left=${CANVAS_MARGIN},bottom=${CANVAS_MARGIN},right=${CANVAS_MARGIN}]`,
      };
  if (!pack && options.partitions.size > 0) layoutOptions['elk.partitioning.activate'] = 'true';

  const graph: ElkNode = { id: 'blocks', layoutOptions, children, edges: pack ? [] : edges };
  const result = await elk.layout(graph);

  const positions = new Map<string, Point>();
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return { positions, width: result.width ?? 0, height: result.height ?? 0 };
}

/** Row width beyond which a layer's blocks wrap onto a further row. */
const MAX_ROW_WIDTH = 2000;

/**
 * Semantic-layer placement: every layer is a horizontal band, bands stack in
 * partition order, and the blocks of one band sit side by side (wrapping when
 * the band would grow wider than [[MAX_ROW_WIDTH]]). Each row is centred on the
 * widest one. Unlike a layered run over the blocks this cannot drag a wide
 * block sideways to sit under its parents, so the canvas stays as narrow as
 * its widest block.
 */
function stackLayerRows(blocks: Map<string, Block>, options: CompoundOptions): Placement {
  const bands = new Map<number, Block[]>();
  for (const block of blocks.values()) {
    const partition = options.partitions.get(block.key.slice(PACKAGE_PREFIX.length));
    const band = partition ?? Number.MAX_SAFE_INTEGER;
    const list = bands.get(band);
    if (list) list.push(block);
    else bands.set(band, [block]);
  }

  const rows: Block[][] = [];
  for (const band of [...bands.keys()].sort((a, b) => a - b)) {
    let row: Block[] = [];
    let rowWidth = 0;
    for (const block of bands.get(band)!) {
      if (row.length > 0 && rowWidth + BLOCK_SPACING + block.width > MAX_ROW_WIDTH) {
        rows.push(row);
        row = [];
        rowWidth = 0;
      }
      rowWidth += (row.length > 0 ? BLOCK_SPACING : 0) + block.width;
      row.push(block);
    }
    if (row.length > 0) rows.push(row);
  }

  const widthOf = (row: Block[]): number =>
    row.reduce((sum, b) => sum + b.width, 0) + BLOCK_SPACING * (row.length - 1);
  const inner = Math.max(0, ...rows.map(widthOf));
  const positions = new Map<string, Point>();
  let y = CANVAS_MARGIN;
  for (const row of rows) {
    let x = CANVAS_MARGIN + (inner - widthOf(row)) / 2;
    for (const block of row) {
      positions.set(block.key, { x, y });
      x += block.width + BLOCK_SPACING;
    }
    y += Math.max(...row.map((b) => b.height)) + BLOCK_SPACING;
  }
  return {
    positions,
    width: inner + CANVAS_MARGIN * 2,
    height: Math.max(0, y - BLOCK_SPACING) + CANVAS_MARGIN,
  };
}
