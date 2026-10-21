/**
 * Layout quality metrics. Pure functions from (model, layout) to numbers, so a
 * layout strategy change can be judged by a diff in figures rather than by eye.
 *
 * Edge polylines are taken at face value: for the viz engine they are bezier
 * control points, which is a coarse but consistent approximation. Every metric
 * is deterministic — the same (model, layout) always yields the same numbers —
 * so a run can be committed as `rendered/metrics.baseline.json` and diffed
 * against a later run to prove an improvement or a regression.
 */

import { PlantUmlModel } from './foundation/model.js';
import { LayoutResult, EdgeLayout, METRICS, PACKAGE_LABEL, Point, displayName } from './foundation/layout.js';
import { countEdgeBoxIntersections, countNonOrthogonalSegments, nodeRect, Rect } from './foundation/edge-router.js';
import { measureTextWidth } from './foundation/text-measure.js';
import {
  entityTextRects,
  hubBadgeRect,
  placeEdgeLabels,
  rectHitsOtherEdge,
  rectsIntersect,
} from './render/labels.js';

export interface LayoutMetrics {
  /** Proper crossings between segments of two different edges. */
  edgeCrossings: number;
  /** Edge segments passing through the interior of an unrelated node. */
  edgeNodeIntersections: number;
  /**
   * Edges drawn with at least one diagonal segment (or no usable polyline at
   * all) — the straight-line fallback an engine takes when its router returns
   * no route. Zero means every edge is an orthogonal polyline.
   */
  nonOrthogonalEdgeCount: number;
  /** Summed polyline length of every edge, in canvas pixels. */
  totalEdgeLength: number;
  /** Sum of node areas divided by canvas area (0..1). */
  areaUtilization: number;
  /** Canvas width / height. */
  aspectRatio: number;
  /** Entity text lines wider than the box they are drawn in. */
  textOverflowCount: number;
  /** Package label tabs that overlap content or are narrower than their text. */
  labelOverlapCount: number;
  /**
   * Summed overlap length of *nearly* parallel segments from different edges —
   * segments within [[PARALLEL_PROXIMITY]] px of each other. The orthogonal
   * router's "parallel-line wall" is invisible to [[edgeCrossings]] (segments
   * that merely run alongside never *cross*), so this counts that hidden
   * clutter in canvas pixels.
   */
  overlappingEdgeLength: number;
  /** Hub badges whose circle covers any of the owning node's text. */
  badgeLabelOverlap: number;
  /**
   * Edge labels (`×N` weights and plain labels) that overlap another edge label
   * or sit on top of a node box.
   */
  edgeLabelOverlap: number;
  /** Edge labels whose rectangle intersects any node rectangle (should be 0). */
  labelNodeOverlap: number;
  /** Edge labels whose rectangle is crossed by a segment of an edge other than their own. */
  labelEdgeOverlap: number;
  /** Pairs of edge-label rectangles that intersect each other. */
  labelLabelOverlap: number;
  /**
   * Incoming arrowheads stacked beyond a threshold on the same side of the
   * same node — the "everything points at this hub" pile-up that
   * [[edgeCrossings]] cannot see either.
   */
  hubArrowStack: number;
  /**
   * Area of the largest axis-aligned rectangle on the canvas that holds neither
   * a node nor a package frame, divided by the canvas area (0..1). A big value
   * is the "empty quadrant" a row-packed root layer leaves behind.
   */
  maxEmptyBlockRatio: number;
  /**
   * Edge segments running parallel to, and within [[EDGE_FLUSH_DISTANCE]] px
   * of, a side of a node they do not end at or of a package frame border they
   * do not end at — the edge then reads as part of the box outline.
   */
  edgeFlushCount: number;
  /**
   * "Combs": groups of at least [[BUNDLE_MIN_EDGES]] edges that share a source
   * (or a target), run the same way, and have segments laid side by side
   * within [[BUNDLE_LATERAL_DISTANCE]] px for at least [[BUNDLE_MIN_RUN]] px.
   * Edges drawn exactly on top of each other (a merged trunk) are one line and
   * do not form a comb. [[overlappingEdgeLength]] cannot see these: the lines
   * sit just outside its proximity.
   */
  parallelBundleCount: number;
  /**
   * Edges that pass through the interior of a package frame neither endpoint
   * belongs to (counted once per edge and frame) — a corridor should run in the
   * gutters between frames, not across unrelated packages.
   */
  edgeFrameCrossings: number;
}

export function computeLayoutMetrics(
  model: PlantUmlModel,
  layout: LayoutResult,
): LayoutMetrics {
  const edges = layout.edges ?? [];
  const nodeArea = layout.nodes.reduce((sum, n) => sum + n.width * n.height, 0);
  const canvasArea = layout.width * layout.height;

  return {
    edgeCrossings: countEdgeCrossings(edges.map((e) => e.points)),
    edgeNodeIntersections: countEdgeBoxIntersections(edges, layout.nodes),
    nonOrthogonalEdgeCount: edges.filter(
      (e) => e.points.length >= 2 && countNonOrthogonalSegments(e.points) > 0,
    ).length,
    totalEdgeLength: edges.reduce((sum, e) => sum + polylineLength(e.points), 0),
    areaUtilization: canvasArea > 0 ? nodeArea / canvasArea : 0,
    aspectRatio: layout.height > 0 ? layout.width / layout.height : 0,
    textOverflowCount: countTextOverflow(model, layout),
    labelOverlapCount: countLabelOverlap(model, layout),
    overlappingEdgeLength: countOverlappingEdgeLength(
      edges.map((e) => e.points),
      edges.map((e): [string, string] => [e.source, e.target]),
    ),
    badgeLabelOverlap: countBadgeLabelOverlap(model, layout),
    edgeLabelOverlap: countEdgeLabelOverlap(model, layout),
    labelNodeOverlap: countLabelNodeOverlap(model, layout),
    labelEdgeOverlap: countLabelEdgeOverlap(model, layout),
    labelLabelOverlap: countLabelLabelOverlap(model, layout),
    hubArrowStack: countHubArrowStack(edges),
    maxEmptyBlockRatio: computeMaxEmptyBlockRatio(layout),
    edgeFlushCount: countEdgeFlush(edges, layout),
    parallelBundleCount: countParallelBundles(edges),
    edgeFrameCrossings: countEdgeFrameCrossings(model, edges, layout),
  };
}

function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return len;
}

function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1;
}

/** True when segments ab and cd cross at a point interior to both. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function countEdgeCrossings(polylines: Point[][]): number {
  return perEdgeCrossings(polylines).reduce((sum, n) => sum + n, 0) / 2;
}

/** For each polyline, the number of crossings it takes part in (each crossing counts for both edges). */
export function perEdgeCrossings(polylines: Point[][]): number[] {
  interface Seg {
    a: Point;
    b: Point;
    edge: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }
  const segs: Seg[] = [];
  polylines.forEach((pts, edge) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      segs.push({
        a,
        b,
        edge,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      });
    }
  });
  segs.sort((p, q) => p.minX - q.minX);

  const counts = polylines.map(() => 0);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j];
      if (t.minX > s.maxX) break;
      if (t.edge === s.edge) continue;
      if (t.maxY < s.minY || t.minY > s.maxY) continue;
      if (segmentsCross(s.a, s.b, t.a, t.b)) {
        counts[s.edge]++;
        counts[t.edge]++;
      }
    }
  }
  return counts;
}

function countTextOverflow(model: PlantUmlModel, layout: LayoutResult): number {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  let count = 0;
  for (const entity of model.entities) {
    const node = nodes.get(entity.id);
    if (!node) continue;
    const lines = [displayName(entity), ...entity.members.map((m) => m.raw)];
    for (const line of lines) {
      const needed = measureTextWidth(line, METRICS.fontSize) + METRICS.paddingX * 2;
      if (needed > node.width + 0.01) count++;
    }
  }
  return count;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * A package's label tab is drawn at its top-left corner. It is counted when it
 * overlaps an entity or sub-package frame inside the package, or when the tab
 * is narrower than the label text it has to hold.
 */
function countLabelOverlap(model: PlantUmlModel, layout: LayoutResult): number {
  const frames = new Map((layout.packages ?? []).map((p) => [p.id, p]));
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  let count = 0;

  for (const pkg of model.packages) {
    const frame = frames.get(pkg.id);
    if (!frame) continue;

    const textWidth = measureTextWidth(pkg.name, PACKAGE_LABEL.fontSize);
    const wanted = textWidth + PACKAGE_LABEL.tabPadding;
    const tab: Rect = {
      x: frame.x,
      y: frame.y,
      width: Math.min(frame.width, Math.max(24, wanted)),
      height: PACKAGE_LABEL.tabHeight,
    };

    let bad = textWidth + 6 > tab.width + 0.01;
    for (const entity of model.entities) {
      if (bad) break;
      if (entity.packageId !== pkg.id) continue;
      const node = nodes.get(entity.id);
      if (node && rectsOverlap(tab, nodeRect(node))) bad = true;
    }
    for (const child of model.packages) {
      if (bad) break;
      if (child.parentId !== pkg.id) continue;
      const childFrame = frames.get(child.id);
      if (childFrame && rectsOverlap(tab, childFrame)) bad = true;
    }
    if (bad) count++;
  }
  return count;
}

/** Lateral distance (px) within which two parallel segments count as overlapping. */
export const PARALLEL_PROXIMITY = 8;

/**
 * Summed length of near-parallel, overlapping segments from different edges.
 * Two segments that run in the same direction within [[PARALLEL_PROXIMITY]] px
 * of each other and share a stretch of their projection read as one "wall" of
 * lines. Each (segment, segment) pair is counted once, in canvas pixels.
 */
function countOverlappingEdgeLength(polylines: Point[][], ends: [string, string][]): number {
  interface Seg {
    a: Point;
    b: Point;
    edge: number;
  }
  const segs: Seg[] = [];
  polylines.forEach((pts, edge) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      segs.push({ a: pts[i], b: pts[i + 1], edge });
    }
  });

  let total = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].edge === segs[j].edge) continue;
      const length = nearParallelOverlapLength(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (length > 0 && sharesEnd(ends[segs[i].edge], ends[segs[j].edge]) && isCoincident(segs[i], segs[j])) continue;
      total += length;
    }
  }
  return total;
}

/** Two edges leave the same source or arrive at the same target. */
function sharesEnd(a: [string, string], b: [string, string]): boolean {
  return a[0] === b[0] || a[1] === b[1];
}

/** Segments lying on one line: a merged fan-out trunk draws them once, so they are not clutter. */
function isCoincident(s: { a: Point; b: Point }, t: { a: Point; b: Point }): boolean {
  const onLine = (p: Point, a: Point, b: Point): boolean => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len > 1e-9 && Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len < COINCIDENT_DISTANCE;
  };
  return onLine(t.a, s.a, s.b) && onLine(t.b, s.a, s.b);
}

/** Shared projected length of two near-parallel segments, else 0 (canvas pixels). */
function nearParallelOverlapLength(a: Point, b: Point, c: Point, d: Point): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = d.x - c.x;
  const vy = d.y - c.y;
  const lenU = Math.hypot(ux, uy);
  const lenV = Math.hypot(vx, vy);
  if (lenU < 1e-9 || lenV < 1e-9) return 0;

  // Parallel: the two direction vectors must be colinear.
  if (Math.abs(ux * vy - uy * vx) > 1e-9 * lenU * lenV) return 0;

  // Near: the lateral distance between the two lines is within the proximity.
  const dist = Math.abs(ux * (c.y - a.y) - uy * (c.x - a.x)) / lenU;
  if (dist > PARALLEL_PROXIMITY) return 0;

  const uxN = ux / lenU;
  const uyN = uy / lenU;
  const proj = (p: Point) => (p.x - a.x) * uxN + (p.y - a.y) * uyN;
  const t0 = Math.min(proj(a), proj(b));
  const t1 = Math.max(proj(a), proj(b));
  const s0 = Math.min(proj(c), proj(d));
  const s1 = Math.max(proj(c), proj(d));
  const overlap = Math.min(t1, s1) - Math.max(t0, s0);
  return overlap > 0 ? overlap : 0;
}

/** Hub badges (drawn on the node's corner) that touch the node's own text. */
function countBadgeLabelOverlap(model: PlantUmlModel, layout: LayoutResult): number {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  let count = 0;
  for (const entity of model.entities) {
    if (!entity.usageCount || entity.usageCount <= 0) continue;
    const node = nodes.get(entity.id);
    if (!node) continue;
    const badge = hubBadgeRect(node);
    if (entityTextRects(entity, node).some((r) => rectsIntersect(badge, r))) count++;
  }
  return count;
}

/** Edge labels overlapping each other, or covering a node box. */
function countEdgeLabelOverlap(model: PlantUmlModel, layout: LayoutResult): number {
  const labels = placeEdgeLabels(model, layout);
  const nodeRects = layout.nodes.map(nodeRect);
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    let bad = nodeRects.some((n) => rectsIntersect(labels[i].rect, n));
    for (let j = 0; j < i && !bad; j++) {
      if (rectsIntersect(labels[i].rect, labels[j].rect)) bad = true;
    }
    if (bad) count++;
  }
  return count;
}

function countLabelNodeOverlap(model: PlantUmlModel, layout: LayoutResult): number {
  const nodeRects = layout.nodes.map(nodeRect);
  return placeEdgeLabels(model, layout).filter((l) =>
    nodeRects.some((n) => rectsIntersect(l.rect, n)),
  ).length;
}

function countLabelEdgeOverlap(model: PlantUmlModel, layout: LayoutResult): number {
  const edges = layout.edges ?? [];
  return placeEdgeLabels(model, layout).filter((l) => rectHitsOtherEdge(l.rect, edges, `rel-${l.edge}`)).length;
}

function countLabelLabelOverlap(model: PlantUmlModel, layout: LayoutResult): number {
  const labels = placeEdgeLabels(model, layout);
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (rectsIntersect(labels[i].rect, labels[j].rect)) count++;
    }
  }
  return count;
}

/**
 * Incoming arrowheads are grouped by (target node, entry side). A side that
 * receives more than [[HUB_ARROW_STACK_THRESHOLD]] arrowheads contributes its
 * excess to the total — the "everyone points at this hub from the same side"
 * pile-up, invisible to [[countEdgeCrossings]].
 */
const HUB_ARROW_STACK_THRESHOLD = 3;

type ArrowSide = 'top' | 'bottom' | 'left' | 'right';

function countHubArrowStack(edges: EdgeLayout[]): number {
  const groups = new Map<string, number>();
  for (const edge of edges) {
    const pts = edge.points;
    if (pts.length < 2) continue;
    const side = approachSide(pts[pts.length - 2], pts[pts.length - 1]);
    if (side === undefined) continue;
    const key = `${edge.target}\u0000${side}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  let total = 0;
  for (const count of groups.values()) {
    if (count > HUB_ARROW_STACK_THRESHOLD) total += count - HUB_ARROW_STACK_THRESHOLD;
  }
  return total;
}

/** Side of the target the arrowhead enters from, derived from the last segment. */
function approachSide(from: Point, to: Point): ArrowSide | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'left' : 'right';
  return dy > 0 ? 'top' : 'bottom';
}

/** Edge-to-box distance (px) below which a parallel segment counts as flush. */
export const EDGE_FLUSH_DISTANCE = 6;

/** Raster cell (px) used to find the largest empty block; coarsened for huge canvases. */
const EMPTY_BLOCK_CELL = 20;
const EMPTY_BLOCK_MAX_CELLS = 400;

/**
 * Rasterises nodes and package frames onto a coarse grid and returns the
 * largest all-empty rectangle (maximal-rectangle-in-histogram) over the canvas.
 */
export function computeMaxEmptyBlockRatio(layout: LayoutResult): number {
  if (layout.width <= 0 || layout.height <= 0) return 0;
  const cell = Math.max(
    EMPTY_BLOCK_CELL,
    layout.width / EMPTY_BLOCK_MAX_CELLS,
    layout.height / EMPTY_BLOCK_MAX_CELLS,
  );
  const cols = Math.ceil(layout.width / cell);
  const rows = Math.ceil(layout.height / cell);
  const filled = new Uint8Array(cols * rows);
  const boxes: Rect[] = [...layout.nodes.map(nodeRect), ...(layout.packages ?? [])];
  for (const b of boxes) {
    const c0 = Math.max(0, Math.floor(b.x / cell));
    const c1 = Math.min(cols - 1, Math.ceil((b.x + b.width) / cell) - 1);
    const r0 = Math.max(0, Math.floor(b.y / cell));
    const r1 = Math.min(rows - 1, Math.ceil((b.y + b.height) / cell) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) filled[r * cols + c] = 1;
  }

  const heights = new Array<number>(cols).fill(0);
  let best = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = filled[r * cols + c] ? 0 : heights[c] + 1;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c];
      while (stack.length > 0 && heights[stack[stack.length - 1]] >= h) {
        const height = heights[stack.pop()!];
        const left = stack.length > 0 ? stack[stack.length - 1] + 1 : 0;
        best = Math.max(best, height * (c - left));
      }
      stack.push(c);
    }
  }
  return Math.min(1, (best * cell * cell) / (layout.width * layout.height));
}

/** Segments parallel and within [[EDGE_FLUSH_DISTANCE]] of an unrelated node side or frame border. */
function countEdgeFlush(edges: EdgeLayout[], layout: LayoutResult): number {
  const nodeBoxes = layout.nodes.map((n) => ({ id: n.id, rect: nodeRect(n) }));
  const frames = (layout.packages ?? []).map((p) => ({ id: p.id, rect: p as Rect }));
  let count = 0;
  for (const edge of edges) {
    const ends = new Set([edge.source, edge.target]);
    for (let i = 0; i + 1 < edge.points.length; i++) {
      const a = edge.points[i];
      const b = edge.points[i + 1];
      const vertical = Math.abs(a.x - b.x) < 1e-6;
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      if (vertical === horizontal) continue; // diagonal or degenerate
      for (const box of nodeBoxes) {
        if (!ends.has(box.id) && segmentFlushRect(a, b, vertical, box.rect)) count++;
      }
      for (const frame of frames) {
        if (!ends.has(frame.id) && segmentFlushRect(a, b, vertical, frame.rect)) count++;
      }
    }
  }
  return count;
}

/** True when the axis-aligned segment ab runs along a side of `r` within the flush distance. */
function segmentFlushRect(a: Point, b: Point, vertical: boolean, r: Rect): boolean {
  if (vertical) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (Math.min(hi, r.y + r.height) - Math.max(lo, r.y) <= 1e-6) return false;
    return (
      Math.abs(a.x - r.x) < EDGE_FLUSH_DISTANCE ||
      Math.abs(a.x - (r.x + r.width)) < EDGE_FLUSH_DISTANCE
    );
  }
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  if (Math.min(hi, r.x + r.width) - Math.max(lo, r.x) <= 1e-6) return false;
  return (
    Math.abs(a.y - r.y) < EDGE_FLUSH_DISTANCE ||
    Math.abs(a.y - (r.y + r.height)) < EDGE_FLUSH_DISTANCE
  );
}

/** Edges per comb needed to count it. */
export const BUNDLE_MIN_EDGES = 5;
/** Lateral distance (px) within which two same-way segments sit "side by side". */
export const BUNDLE_LATERAL_DISTANCE = 16;
/** Shared run (px) two side-by-side segments need to count. */
export const BUNDLE_MIN_RUN = 120;
/** Segments closer than this are one drawn line (an intentionally merged trunk). */
const COINCIDENT_DISTANCE = 0.5;

/** One comb: the shared end node and the ids of the edges laid side by side. */
export interface ParallelBundle {
  end: 'source' | 'target';
  node: string;
  edges: string[];
}

/** Lists source-sharing and target-sharing combs; see [[LayoutMetrics.parallelBundleCount]]. */
export function findParallelBundles(edges: EdgeLayout[]): ParallelBundle[] {
  const found: ParallelBundle[] = [];
  for (const end of ['source', 'target'] as const) {
    const byEnd = new Map<string, number[]>();
    edges.forEach((e, i) => {
      if (e.points.length < 2) return;
      const list = byEnd.get(e[end]);
      if (list) list.push(i);
      else byEnd.set(e[end], [i]);
    });
    for (const [node, members] of byEnd) {
      if (members.length < BUNDLE_MIN_EDGES) continue;
      for (const comb of combsAmong(members.map((i) => edges[i].points))) {
        if (comb.length >= BUNDLE_MIN_EDGES) found.push({ end, node, edges: comb.map((k) => edges[members[k]].id) });
      }
    }
  }
  return found;
}

function countParallelBundles(edges: EdgeLayout[]): number {
  return findParallelBundles(edges).length;
}

/** Components of polylines (as index lists) linked by side-by-side same-way segments. */
function combsAmong(polylines: Point[][]): number[][] {
  interface Seg {
    edge: number;
    horizontal: boolean;
    sign: number;
    c: number;
    lo: number;
    hi: number;
  }
  const segs: Seg[] = [];
  polylines.forEach((pts, edge) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const vertical = Math.abs(a.x - b.x) < 1e-6;
      if (horizontal === vertical) continue;
      const [from, to] = horizontal ? [a.x, b.x] : [a.y, b.y];
      if (Math.abs(to - from) < BUNDLE_MIN_RUN) continue;
      segs.push({
        edge,
        horizontal,
        sign: Math.sign(to - from),
        c: horizontal ? a.y : a.x,
        lo: Math.min(from, to),
        hi: Math.max(from, to),
      });
    }
  });
  const parent = polylines.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.edge === t.edge || s.horizontal !== t.horizontal || s.sign !== t.sign) continue;
      const lateral = Math.abs(s.c - t.c);
      if (lateral < COINCIDENT_DISTANCE || lateral > BUNDLE_LATERAL_DISTANCE) continue;
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) < BUNDLE_MIN_RUN) continue;
      parent[find(s.edge)] = find(t.edge);
    }
  }
  const comps = new Map<number, number[]>();
  polylines.forEach((_, i) => {
    const root = find(i);
    const list = comps.get(root);
    if (list) list.push(i);
    else comps.set(root, [i]);
  });
  return [...comps.values()];
}

/** Depth (px) a segment must run inside a frame to count as crossing it. */
const FRAME_CROSSING_MIN_RUN = 4;

/** Ids of the packages an endpoint lives in (itself too, when it is a package). */
function packageChain(
  id: string,
  entityPackage: Map<string, string | undefined>,
  parentOf: Map<string, string | undefined>,
): Set<string> {
  const chain = new Set<string>();
  let cur: string | undefined = parentOf.has(id) ? id : entityPackage.get(id);
  while (cur !== undefined && !chain.has(cur)) {
    chain.add(cur);
    cur = parentOf.get(cur);
  }
  return chain;
}

function countEdgeFrameCrossings(model: PlantUmlModel, edges: EdgeLayout[], layout: LayoutResult): number {
  const frames = layout.packages ?? [];
  if (frames.length === 0) return 0;
  const entityPackage = new Map(model.entities.map((e) => [e.id, e.packageId]));
  const parentOf = new Map(model.packages.map((p) => [p.id, p.parentId]));
  let count = 0;
  for (const edge of edges) {
    if (edge.points.length < 2) continue;
    const related = new Set([
      ...packageChain(edge.source, entityPackage, parentOf),
      ...packageChain(edge.target, entityPackage, parentOf),
    ]);
    for (const frame of frames) {
      if (related.has(frame.id)) continue;
      if (polylineRunsInside(edge.points, frame)) count++;
    }
  }
  return count;
}

/** True when some axis-aligned segment runs ≥ [[FRAME_CROSSING_MIN_RUN]] px strictly inside `r`. */
function polylineRunsInside(points: Point[], r: Rect): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.y - b.y) < 1e-6) {
      if (a.y <= r.y || a.y >= r.y + r.height) continue;
      if (Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x) >= FRAME_CROSSING_MIN_RUN) return true;
    } else if (Math.abs(a.x - b.x) < 1e-6) {
      if (a.x <= r.x || a.x >= r.x + r.width) continue;
      if (Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y) >= FRAME_CROSSING_MIN_RUN) return true;
    }
  }
  return false;
}
