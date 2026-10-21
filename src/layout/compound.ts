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
/** Block count from which sparsely linked, layer-less roots are rect-packed too. */
const MID_PACK_BLOCK_THRESHOLD = 8;
/** Multipliers of the requested ratio tried when rect-packing blocks. */
const PACK_ASPECT_CANDIDATES = [0.6, 1, 1.5];
/** Above this many blocks the packing-candidate search is skipped. */
const MAX_CANDIDATE_BLOCKS = 30;
/** Canvas ratio band a packed candidate should stay inside to be preferred. */
const PACK_BAND_MIN = 0.7;
const PACK_BAND_MAX = 2.2;
/** Gap between blocks: wide enough for several routing lanes. */
const BLOCK_SPACING = 64;
/** Clearance ELK keeps between an edge and a node / another edge inside a block. */
const EDGE_NODE_SPACING = 12;
const EDGE_EDGE_SPACING = 10;

/** A layered block with at least this many nodes at lower density is repacked. */
const SPARSE_MIN_NODES = 30;
/** Vertical distance (px) between node centres beyond which they sit on different layers. */
const FLOW_LAYER_GAP = 24;
/** Dense graphs pack their blocks taller so the placed blocks do not stretch the canvas. */
const DENSE_SHELF_ASPECT_SCALE = 0.6;
/** Rows read better a little wider than the canvas target; the layers above add height. */
const SHELF_ASPECT_SCALE = 1.25;
/** Node gap of a repacked block: wide enough channels for several edge lanes. */
const SHELF_GAP = 72;
const SHELF_PADDING = { top: 26, side: 10, bottom: 10 };
const SPARSE_DENSITY = 0.16;

/** Hub rail: gap between hubs / columns, and the shortest column height before wrapping. */
const HUB_RAIL_GAP = 16;
const HUB_RAIL_MIN_HEIGHT = 400;

/** Border kept free around the whole canvas for outer routing lanes. */
const CANVAS_MARGIN = 40;

/** Node gap inside packed blocks of a dense (very large) graph; leaves one routing lane. */
const DENSE_NODE_SPACING = 36;

export interface CompoundOptions {
  /** Pack every flat block tightly (very large graphs); edges are grid-routed. */
  dense?: boolean;
  /**
   * Dense blocks use rect packing instead of dependency-ordered rows: tighter
   * but order-blind, so only used when the rows exceed the canvas budget.
   */
  rectPackDense?: boolean;
  edgeRouting: string;
  /** Target canvas width/height (ELK `elk.aspectRatio`); default 1.6. */
  aspectRatio?: number;
  /** Block id → semantic-layer partition index (layered mode only). */
  partitions: Map<string, number>;
  /** Rip-up passes of the cross-block router; its default when omitted. */
  ripupPasses?: number;
  /** Where stub nodes orbit the placed blocks; default [[DEFAULT_STUB_ORBIT]]. */
  stubOrbit?: StubOrbit;
}

/** Channel to the frame (`gap`) and spacing between neighbouring stubs (`spacing`), px. */
export interface StubOrbit {
  gap: number;
  spacing: number;
  /** Row/column a stub slides to: its targets' centroid (default) or the target nearest its side. */
  anchor?: 'centroid' | 'nearest';
}
/** Tightest gap between neighbouring stubs on the rail, px. */
const RAIL_MIN_GAP = 24;
/** Lattice cost of crossing a wire in a view with stub rails (their fans are crossing-prone), and elsewhere. */
const STUB_CROSSING_COST = 40;
const CROSSING_COST = 12;
/** Cost per px a rail runs past the frame side it follows (in px of target distance). */
const RAIL_OVERFLOW_WEIGHT = 0.5;
export const DEFAULT_STUB_ORBIT: StubOrbit = { gap: 48, spacing: 120, anchor: 'centroid' };

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
  const drawn = [...edgePoints].map(([index, points]) => ({
    source: model.relations[index].source,
    target: model.relations[index].target,
    points,
  }));
  const routed = routeOrthogonal(requests, nodes, {
    width: placed.width,
    height: placed.height,
    frames: packagesOut,
    existing: drawn,
    ripupPasses: options.ripupPasses,
    crossingCost: model.entities.some((e) => e.stub) ? STUB_CROSSING_COST : CROSSING_COST,
  });
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
  const touched = new Set<string>();
  for (const r of model.relations) {
    touched.add(r.source);
    touched.add(r.target);
  }
  // Summarised hubs without any drawn edge are not part of the layered graph:
  // they get a rail along the package side instead of a row on top of it.
  const hubs: PlantUmlEntity[] = [];
  for (const entity of entities) {
    const size = estimateEntitySize(entity);
    if (entity.packageId === topId && (entity.usageCount ?? 0) > 0 && !touched.has(entity.id)) {
      hubs.push(entity);
      continue;
    }
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
    'elk.aspectRatio': String(options.aspectRatio ?? 1.6),
    'elk.separateConnectedComponents': 'true',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.spacing.edgeNode': String(EDGE_NODE_SPACING),
    'elk.spacing.edgeEdge': String(EDGE_EDGE_SPACING),
    'elk.padding': '[top=26,left=10,bottom=10,right=10]',
  };
  if (hasNested) layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';

  const graph: ElkNode = { id: 'block', layoutOptions, children: rootChildren, edges };
  let result = await elk.layout(graph);
  // Dependency order of the plain layered run (layer by layer, left to right):
  // a repack keeps it so dependents stay above what they consume.
  const flowOrder = flowOrderOf(result.children ?? []);
  let repacked = false;
  let aspect = (result.width ?? 0) / Math.max(1, result.height ?? 1);
  const wide = (result.width ?? 0) > NESTED_SPLIT_WIDTH;
  if (hasNested && wide && (aspect > BLOCK_MAX_ASPECT || aspect < 1 / BLOCK_MAX_ASPECT)) {
    return splitNestedBlock(elk, model, key, entities, packages, relationIndexes, options);
  }
  let sparse = !hasNested && rootChildren.length >= SPARSE_MIN_NODES && blockDensity(rootChildren, result) < SPARSE_DENSITY;
  if (sparse) {
    // Fold the long layer chain into several rows before giving up on layering.
    const wrapped = await elk.layout({
      ...graph,
      layoutOptions: { ...layoutOptions, 'elk.layered.wrapping.strategy': 'MULTI_EDGE' },
    });
    if (blockDensity(rootChildren, wrapped) > blockDensity(rootChildren, result)) {
      result = wrapped;
      sparse = blockDensity(rootChildren, result) < SPARSE_DENSITY;
    }
  }
  if (!hasNested && (options.dense || sparse || aspect > BLOCK_MAX_ASPECT || aspect < 1 / BLOCK_MAX_ASPECT)) {
    // A single wide layer cannot be wrapped by the layered algorithm; pack the
    // boxes into a balanced rectangle, rows in dependency order, and let the
    // grid router draw the edges.
    result =
      options.dense && options.rectPackDense
        ? await elk.layout({
            id: 'block',
            layoutOptions: {
              'elk.algorithm': 'rectpacking',
              'elk.aspectRatio': String(options.aspectRatio ?? 1.6),
              'elk.spacing.nodeNode': String(DENSE_NODE_SPACING),
              'elk.padding': '[top=26,left=10,bottom=10,right=10]',
            },
            children: rootChildren,
          })
        : orderedShelfPack(
            rootChildren,
            flowOrder,
            (options.aspectRatio ?? 1.6) * (options.dense ? DENSE_SHELF_ASPECT_SCALE : SHELF_ASPECT_SCALE),
            options.dense ? DENSE_NODE_SPACING : SHELF_GAP,
          );
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

  let width = Math.max(result.width ?? 0, packageMinWidth(pkg.name));
  let height = Math.max(result.height ?? 0, PACKAGE_LABEL.tabHeight + 36);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map<number, Point[]>();
  if (!repacked) {
    for (const edge of result.edges ?? []) {
      const index = Number((edge.id ?? '').slice('rel-'.length));
      const relation: PlantUmlRelation = model.relations[index];
      const reversed = REVERSED_RELATION_TYPES.has(relation.type);
      const points = elkEdgePoints(edge, nodeById, offsets);
      edgeMap.set(index, reversed ? points.slice().reverse() : points);
    }
  }

  if (hubs.length > 0) {
    const rail = placeHubRail(hubs, height);
    for (const n of nodes) {
      n.x += rail.width;
    }
    for (const p of packagesOut) {
      p.x += rail.width;
    }
    for (const points of edgeMap.values()) for (const pt of points) pt.x += rail.width;
    nodes.push(...rail.nodes);
    width += rail.width;
    height = Math.max(height, rail.height);
  }
  packagesOut.push({ id: topId, x: 0, y: 0, width, height });

  return repacked
    ? { key, width, height, nodes, packages: packagesOut, edges: edgeMap, unrouted: relationIndexes }
    : { key, width, height, nodes, packages: packagesOut, edges: edgeMap };
}

/** Ids of `children` in layer order (top layer first), left to right within a layer. */
function flowOrderOf(children: ElkNode[]): string[] {
  const sorted = children
    .map((c) => ({ id: c.id, cx: (c.x ?? 0) + (c.width ?? 0) / 2, cy: (c.y ?? 0) + (c.height ?? 0) / 2 }))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const out: string[] = [];
  let layer: typeof sorted = [];
  let layerY = -Infinity;
  const flush = (): void => {
    layer.sort((a, b) => a.cx - b.cx);
    for (const n of layer) out.push(n.id);
    layer = [];
  };
  for (const n of sorted) {
    if (n.cy - layerY > FLOW_LAYER_GAP) {
      flush();
      layerY = n.cy;
    }
    layer.push(n);
  }
  flush();
  return out;
}

/**
 * Shelf-pack `children` row by row in `order`, choosing the row width whose
 * result is closest to `aspect`. Unlike rect packing the row order follows the
 * dependency order, so an upstream node never lands below its dependency.
 */
function orderedShelfPack(children: ElkNode[], order: string[], aspect: number, gap: number): ElkNode {
  const rank = new Map(order.map((id, i) => [id, i]));
  const items = children.slice().sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const { top, side, bottom } = SHELF_PADDING;
  const widest = Math.max(0, ...items.map((c) => c.width ?? 0));
  const total = items.reduce((sum, c) => sum + (c.width ?? 0) + gap, 0);
  let best: { rows: ElkNode[][]; rowH: number[]; width: number; height: number } | undefined;
  let bestMiss = Infinity;
  for (let inner = widest; inner <= total; inner += Math.max(8, (total - widest) / 40)) {
    const rows: ElkNode[][] = [[]];
    const rowH: number[] = [0];
    let used = 0;
    let width = 0;
    for (const c of items) {
      const w = c.width ?? 0;
      if (used > 0 && used + gap + w > inner) {
        rows.push([]);
        rowH.push(0);
        used = 0;
      }
      rows[rows.length - 1].push(c);
      rowH[rowH.length - 1] = Math.max(rowH[rowH.length - 1], c.height ?? 0);
      used += (used > 0 ? gap : 0) + w;
      width = Math.max(width, used);
    }
    const w = width + 2 * side;
    const h = top + bottom + rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
    const miss = Math.abs(Math.log(w / Math.max(1, h) / aspect)) + (w * h) / 1e9;
    if (miss < bestMiss) {
      bestMiss = miss;
      best = { rows, rowH, width: w, height: h };
    }
  }
  if (!best) return { id: 'block', width: 2 * side, height: top + bottom, children: [] };
  let y = top;
  best.rows.forEach((row, r) => {
    let x = side;
    for (const c of row) {
      c.x = x;
      c.y = y + (best!.rowH[r] - (c.height ?? 0)) / 2;
      x += (c.width ?? 0) + gap;
    }
    y += best!.rowH[r] + gap;
  });
  return { id: 'block', width: best.width, height: best.height, children: items };
}

/** Node area ÷ block area of a layered result; low means a sparse, mostly empty block. */
function blockDensity(children: ElkNode[], result: ElkNode): number {
  const area = (result.width ?? 0) * (result.height ?? 0);
  if (area <= 0) return 1;
  return children.reduce((sum, c) => sum + (c.width ?? 0) * (c.height ?? 0), 0) / area;
}

/**
 * Stack summarised hubs in column(s) on the package's left side, below the label
 * tab. Columns wrap at the block height (at least [[HUB_RAIL_MIN_HEIGHT]]).
 * `width` is the space the rail takes from the left edge, gap included.
 */
function placeHubRail(
  hubs: PlantUmlEntity[],
  blockHeight: number,
): { nodes: NodeLayout[]; width: number; height: number } {
  const top = 26;
  const limit = Math.max(blockHeight - 10, HUB_RAIL_MIN_HEIGHT);
  const nodes: NodeLayout[] = [];
  let x = 10;
  let y = top;
  let colWidth = 0;
  let bottom = top;
  for (const entity of hubs) {
    const size = estimateEntitySize(entity);
    if (y > top && y + size.height > limit) {
      x += colWidth + HUB_RAIL_GAP;
      y = top;
      colWidth = 0;
    }
    nodes.push({ id: entity.id, x, y, width: size.width, height: size.height });
    colWidth = Math.max(colWidth, size.width);
    y += size.height + HUB_RAIL_GAP;
    bottom = Math.max(bottom, y - HUB_RAIL_GAP);
  }
  return { nodes, width: x + colWidth + HUB_RAIL_GAP * 2 - 10, height: bottom + 10 };
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
      'elk.aspectRatio': String(options.aspectRatio ?? 1.6),
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
  const stubKeys = new Set(
    [...blocks.keys()].filter((k) => model.entities.find((e) => e.id === k)?.stub === true),
  );
  if (stubKeys.size > 0 && stubKeys.size < blocks.size) {
    const main = new Map([...blocks].filter(([k]) => !stubKeys.has(k)));
    const mainPlacement = await placeBlocks(elk, model, main, crossRelations, blockOfEntity, options);
    return placeStubsNearTargets(model, blocks, stubKeys, mainPlacement, crossRelations, blockOfEntity, options.stubOrbit ?? DEFAULT_STUB_ORBIT);
  }
  const blockEdgeCount = new Set(
    crossRelations.map((i) => `${blockOfEntity.get(model.relations[i].source)}\u0000${blockOfEntity.get(model.relations[i].target)}`),
  ).size;
  // Mid-scale root layers (a dozen-ish packages) with few block-level edges gain
  // nothing from layering: it strings them into a column. Pack them instead.
  const sparseMid =
    blocks.size >= MID_PACK_BLOCK_THRESHOLD &&
    options.partitions.size === 0 &&
    blockEdgeCount * 2 < blocks.size;
  const pack = blocks.size > PACK_BLOCK_THRESHOLD || sparseMid;
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
        'elk.aspectRatio': String(options.aspectRatio ?? 1.6),
        'elk.spacing.nodeNode': String(BLOCK_SPACING),
        'elk.padding': `[top=${CANVAS_MARGIN},left=${CANVAS_MARGIN},bottom=${CANVAS_MARGIN},right=${CANVAS_MARGIN}]`,
      }
    : {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.aspectRatio': String(options.aspectRatio ?? 1.6),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': String(BLOCK_SPACING),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(BLOCK_SPACING),
        'elk.layered.wrapping.strategy': 'MULTI_EDGE',
        'elk.separateConnectedComponents': 'true',
        'elk.padding': `[top=${CANVAS_MARGIN},left=${CANVAS_MARGIN},bottom=${CANVAS_MARGIN},right=${CANVAS_MARGIN}]`,
      };
  if (!pack && options.partitions.size > 0) layoutOptions['elk.partitioning.activate'] = 'true';

  let result: ElkNode;
  if (pack && blocks.size > MAX_CANDIDATE_BLOCKS) {
    // Very many blocks: a single rectpacking run (the candidates below only pay off at mid scale).
    result = await elk.layout({ id: 'blocks', layoutOptions, children, edges: [] });
  } else if (pack) {
    // rectpacking only honours a target ratio loosely and can leave a lone block
    // on the last row; also try height-sorted shelves and keep the tightest
    // canvas whose ratio stays near the target.
    const target = options.aspectRatio ?? 1.6;
    const candidates: ElkNode[] = [shelfPackBlocks(children, target)];
    for (const ratio of PACK_ASPECT_CANDIDATES.map((f) => target * f)) {
      candidates.push(
        await elk.layout({
          id: 'blocks',
          layoutOptions: { ...layoutOptions, 'elk.aspectRatio': String(ratio) },
          children: children.map((c) => ({ ...c })),
          edges: [],
        }),
      );
    }
    const area = (n: ElkNode): number => (n.width ?? 0) * (n.height ?? 0);
    const inBand = (n: ElkNode): boolean => {
      const a = (n.width ?? 0) / Math.max(1, n.height ?? 0);
      return a >= PACK_BAND_MIN && a <= PACK_BAND_MAX;
    };
    if (options.aspectRatio !== undefined) {
      // An explicit caller ratio wins over compactness: closest candidate.
      const miss = (n: ElkNode): number => Math.abs(Math.log((n.width ?? 1) / Math.max(1, n.height ?? 1) / target));
      result = candidates.reduce((best, c) => (miss(c) < miss(best) ? c : best));
    } else {
      const pool = candidates.some(inBand) ? candidates.filter(inBand) : candidates;
      result = pool.reduce((best, c) => (area(c) < area(best) ? c : best));
    }
  } else {
    result = await elk.layout({ id: 'blocks', layoutOptions, children, edges });
  }

  const positions = new Map<string, Point>();
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return { positions, width: result.width ?? 0, height: result.height ?? 0 };
}


/**
 * Orbit stub nodes (external packages of a single-package view) around the
 * placed blocks: each stub joins the side of the main bounding box nearest to
 * the nodes it connects to, and slides along that side to its targets' own
 * coordinate (sweeping apart where stubs would overlap). Edges then stay short
 * instead of running across the whole frame to a far-away stub column.
 */
function placeStubsNearTargets(
  model: PlantUmlModel,
  blocks: Map<string, Block>,
  stubKeys: Set<string>,
  main: Placement,
  crossRelations: number[],
  blockOfEntity: Map<string, string>,
  orbit: StubOrbit,
): Placement {
  const centre = new Map<string, Point>();
  for (const [key, at] of main.positions) {
    for (const n of blocks.get(key)?.nodes ?? []) {
      centre.set(n.id, { x: at.x + n.x + n.width / 2, y: at.y + n.y + n.height / 2 });
    }
  }
  type Side = 'left' | 'right' | 'top' | 'bottom';
  interface Stub {
    key: string;
    /** Centroid of the nodes it connects to, and those nodes' centres. */
    centroid: Point;
    targets: Point[];
  }
  const stubs: Stub[] = [];
  for (const key of [...stubKeys].sort()) {
    let sx = 0;
    let sy = 0;
    const targets: Point[] = [];
    for (const index of crossRelations) {
      const r = model.relations[index];
      const other = blockOfEntity.get(r.source) === key ? r.target : blockOfEntity.get(r.target) === key ? r.source : undefined;
      const c = other === undefined ? undefined : centre.get(other);
      if (c) {
        sx += c.x;
        sy += c.y;
        targets.push(c);
      }
    }
    const count = targets.length;
    stubs.push({
      key,
      centroid: { x: count > 0 ? sx / count : main.width / 2, y: count > 0 ? sy / count : main.height / 2 },
      targets,
    });
  }

  // All stubs form one rail along a single side of the frame. The side is the
  // one that is nearest to the stubs' targets overall; a side too short to hold
  // the whole rail only wins when the others are even shorter.
  const sides: Side[] = ['right', 'left', 'top', 'bottom'];
  const depthOf = (side: Side, c: Point): number =>
    side === 'left' ? c.x : side === 'right' ? main.width - c.x : side === 'top' ? c.y : main.height - c.y;
  const railLength = (side: Side): number => {
    const vertical = side === 'left' || side === 'right';
    return stubs.reduce((sum, { key }) => sum + (vertical ? blocks.get(key)!.height : blocks.get(key)!.width) + RAIL_MIN_GAP, 0);
  };
  const sideCost = (side: Side): number => {
    const extent = side === 'left' || side === 'right' ? main.height : main.width;
    const overflow = Math.max(0, railLength(side) - extent);
    return stubs.reduce((sum, s) => sum + depthOf(side, s.centroid), 0) / Math.max(1, stubs.length) + overflow * RAIL_OVERFLOW_WEIGHT;
  };
  // Left/right sides are preferred on ties: side stubs keep text horizontal.
  const side: Side = stubs.length === 0 ? 'right' : sides.reduce((a, b) => (sideCost(b) < sideCost(a) - 1e-6 ? b : a));

  const positions = new Map(main.positions);
  let minX = 0;
  let minY = 0;
  let maxX = main.width;
  let maxY = main.height;
  if (stubs.length > 0) {
    const vertical = side === 'left' || side === 'right';
    const extent = vertical ? main.height : main.width;
    const lenOf = (key: string): number => (vertical ? blocks.get(key)!.height : blocks.get(key)!.width);
    const thickOf = (key: string): number => (vertical ? blocks.get(key)!.width : blocks.get(key)!.height);
    const alongOf = (s: Stub): number => {
      const anchor =
        orbit.anchor === 'nearest'
          ? s.targets.reduce((a, c) => (depthOf(side, c) < depthOf(side, a) ? c : a), s.targets[0] ?? s.centroid)
          : s.centroid;
      return vertical ? anchor.y : anchor.x;
    };
    // Ordered by where their targets lie along the side, then spaced evenly.
    const ordered = stubs
      .map((s) => ({ s, along: alongOf(s) }))
      .sort((a, b) => a.along - b.along || a.s.key.localeCompare(b.s.key));
    const lengths = ordered.reduce((sum, { s }) => sum + lenOf(s.key), 0);
    const slack = ordered.length > 1 ? (extent - lengths) / (ordered.length - 1) : 0;
    const gap = Math.max(RAIL_MIN_GAP, Math.min(orbit.spacing, slack));
    const total = lengths + gap * (ordered.length - 1);
    const meanAlong = ordered.reduce((sum, o) => sum + o.along, 0) / ordered.length;
    const start = Math.max(0, Math.min(meanAlong - total / 2, extent - total));
    let cursor = start;
    const thick = Math.max(...ordered.map(({ s }) => thickOf(s.key)));
    const offset = orbit.gap - CANVAS_MARGIN;
    for (const { s } of ordered) {
      const b = blocks.get(s.key)!;
      let x: number;
      let y: number;
      if (vertical) {
        y = cursor;
        x = side === 'left' ? CANVAS_MARGIN - offset - thick + (thick - b.width) : main.width - CANVAS_MARGIN + offset;
      } else {
        x = cursor;
        y = side === 'top' ? CANVAS_MARGIN - offset - thick + (thick - b.height) : main.height - CANVAS_MARGIN + offset;
      }
      cursor += lenOf(s.key) + gap;
      positions.set(s.key, { x, y });
      minX = Math.min(minX, x - CANVAS_MARGIN);
      minY = Math.min(minY, y - CANVAS_MARGIN);
      maxX = Math.max(maxX, x + b.width + CANVAS_MARGIN);
      maxY = Math.max(maxY, y + b.height + CANVAS_MARGIN);
    }
  }
  for (const [key, at] of positions) positions.set(key, { x: at.x - minX, y: at.y - minY });
  return { positions, width: maxX - minX, height: maxY - minY };
}

/**
 * Height-sorted shelf packing of fixed-size blocks: rows hold blocks of similar
 * height, so a row leaves little dead space beside its shorter members. The row
 * width scanned for is the one with the smallest canvas near `aspect`.
 */
function shelfPackBlocks(children: ElkNode[], aspect: number): ElkNode {
  const items = children.map((c) => ({ ...c })).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || a.id.localeCompare(b.id));
  const gap = BLOCK_SPACING;
  const widest = Math.max(0, ...items.map((c) => c.width ?? 0));
  const total = items.reduce((sum, c) => sum + (c.width ?? 0) + gap, 0);
  let best: { items: ElkNode[]; width: number; height: number } | undefined;
  let bestScore = Infinity;
  const step = Math.max(8, (total - widest) / 200);
  for (let inner = widest; inner <= total + step; inner += step) {
    const placed: ElkNode[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    let width = 0;
    for (const c of items) {
      const w = c.width ?? 0;
      if (x > 0 && x + gap + w > inner) {
        y += rowH + gap;
        x = 0;
        rowH = 0;
      }
      if (x > 0) x += gap;
      placed.push({ ...c, x: CANVAS_MARGIN + x, y: CANVAS_MARGIN + y });
      x += w;
      rowH = Math.max(rowH, c.height ?? 0);
      width = Math.max(width, x);
    }
    const w = width + 2 * CANVAS_MARGIN;
    const h = y + rowH + 2 * CANVAS_MARGIN;
    const score = w * h * (1 + Math.abs(Math.log(w / h / aspect)) * 0.03);
    if (score < bestScore) {
      bestScore = score;
      best = { items: placed, width: w, height: h };
    }
  }
  return { id: 'blocks', width: best?.width ?? 0, height: best?.height ?? 0, children: best?.items ?? [] };
}

/** Row width beyond which a layer's blocks wrap onto a further row. */
const MAX_ROW_WIDTH = 2000;
/** Blocks up to this tall count as small and may share a row with other small blocks. */
const SMALL_BLOCK_HEIGHT = 600;

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
  // Neighbouring rows of small blocks share one row (in layer order, left to
  // right) instead of stacking into a narrow column above the big layer.
  const isSmall = (row: Block[]): boolean => row.every((b) => b.height <= SMALL_BLOCK_HEIGHT);
  for (let i = 0; i + 1 < rows.length; ) {
    const merged = [...rows[i], ...rows[i + 1]];
    if (isSmall(rows[i]) && isSmall(rows[i + 1]) && widthOf(merged) <= inner) {
      rows.splice(i, 2, merged);
    } else {
      i++;
    }
  }
  const positions = new Map<string, Point>();
  let y = CANVAS_MARGIN;
  for (const row of rows) {
    let x = CANVAS_MARGIN; // rows share one left edge
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
