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

import { PlantUmlModel } from '../foundation/model.js';
import { LayoutResult, EdgeLayout, METRICS, PACKAGE_LABEL, Point, displayName } from '../foundation/layout.js';
import { countEdgeBoxIntersections, countNonOrthogonalSegments, nodeRect, Rect } from '../foundation/edge-router.js';
import { measureTextWidth } from '../foundation/text-measure.js';
import {
  entityTextRects,
  hubBadgeRect,
  placeEdgeLabels,
  rectHitsOtherEdge,
  rectsIntersect,
} from '../render/labels.js';

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
  /**
   * Edges whose polyline is longer than [[TRUNK_DETOUR_FACTOR]] times the
   * Manhattan distance between their end points — a trunk that wanders round a
   * cluster instead of running the lane between the rows.
   */
  trunkDetourCount: number;
  /**
   * Nested rectangular loops inside one package frame (edges between two nodes of the same frame): U-turns (three segments,
   * the outer two running in opposite directions) whose bounding box encloses a
   * node the edge does not end at (the route wraps a cluster) and lies inside
   * another such U-turn's — counted once per inner loop. The concentric "coil" a trunk makes when it keeps
   * circling the nodes it avoids.
   */
  nestedLoopCount: number;
  /**
   * Edge segments at least [[EDGE_NODE_FLUSH_MIN_LENGTH]] px long running
   * parallel to a side of the node they end at, within
   * [[EDGE_NODE_FLUSH_DISTANCE]] px — the line hugs the box it belongs to and
   * is hard to tell from its outline.
   */
  edgeNodeFlush: number;
  /**
   * Smallest node-area ÷ frame-area over the package frames holding at least
   * [[FRAME_FILL_MIN_NODES]] nodes (1 when no frame qualifies): low means a
   * stretched, mostly empty frame.
   */
  frameFillRatio: number;
  /**
   * Smallest distance from any edge point to a canvas side (the shorter canvas
   * side when there are no edges): a line hugging the canvas edge is easily
   * cropped.
   */
  edgeCanvasMargin: number;
  /**
   * Layout-engine wall time in milliseconds (layout only: no transforms, SVG
   * or rasterisation). Present only when the caller passes the measured time.
   */
  layoutMs?: number;
}

/**
 * A named, pure measurement over a layout. The metrics registry is the single
 * source of truth for which measurements [[computeLayoutMetrics]] reports:
 * adding a metric means registering a `Metric`, not editing the function's
 * return literal.
 */
export interface Metric {
  /** Key the value is exposed under on [[LayoutMetrics]]. */
  readonly name: string;
  compute(model: PlantUmlModel, layout: LayoutResult): number;
}

const registry: Metric[] = [];

/** Register a metric; the next [[computeLayoutMetrics]] call reports it. */
export function registerMetric(metric: Metric): void {
  if (registry.some((m) => m.name === metric.name)) {
    throw new Error(`metric already registered: ${metric.name}`);
  }
  registry.push(metric);
}

/** Remove a registered metric by name; returns whether one was removed. */
export function unregisterMetric(name: string): boolean {
  const index = registry.findIndex((m) => m.name === name);
  if (index < 0) return false;
  registry.splice(index, 1);
  return true;
}

/** Names of the currently registered metrics, in evaluation order. */
export function listMetrics(): readonly string[] {
  return registry.map((m) => m.name);
}

registerMetric({
  name: 'edgeCrossings',
  compute: (_model, layout) => countEdgeCrossings((layout.edges ?? []).map((e) => e.points)),
});
registerMetric({
  name: 'edgeNodeIntersections',
  compute: (_model, layout) => countEdgeBoxIntersections(layout.edges ?? [], layout.nodes),
});
registerMetric({
  name: 'nonOrthogonalEdgeCount',
  compute: (_model, layout) =>
    (layout.edges ?? []).filter(
      (e) => e.points.length >= 2 && countNonOrthogonalSegments(e.points) > 0,
    ).length,
});
registerMetric({
  name: 'totalEdgeLength',
  compute: (_model, layout) =>
    (layout.edges ?? []).reduce((sum, e) => sum + polylineLength(e.points), 0),
});
registerMetric({
  name: 'areaUtilization',
  compute: (_model, layout) => {
    const nodeArea = layout.nodes.reduce((sum, n) => sum + n.width * n.height, 0);
    const canvasArea = layout.width * layout.height;
    return canvasArea > 0 ? nodeArea / canvasArea : 0;
  },
});
registerMetric({
  name: 'aspectRatio',
  compute: (_model, layout) => (layout.height > 0 ? layout.width / layout.height : 0),
});
registerMetric({ name: 'textOverflowCount', compute: countTextOverflow });
registerMetric({ name: 'labelOverlapCount', compute: countLabelOverlap });
registerMetric({
  name: 'overlappingEdgeLength',
  compute: (_model, layout) => {
    const edges = layout.edges ?? [];
    return countOverlappingEdgeLength(
      edges.map((e) => e.points),
      edges.map((e): [string, string] => [e.source, e.target]),
    );
  },
});
registerMetric({ name: 'badgeLabelOverlap', compute: countBadgeLabelOverlap });
registerMetric({ name: 'edgeLabelOverlap', compute: countEdgeLabelOverlap });
registerMetric({ name: 'labelNodeOverlap', compute: countLabelNodeOverlap });
registerMetric({ name: 'labelEdgeOverlap', compute: countLabelEdgeOverlap });
registerMetric({ name: 'labelLabelOverlap', compute: countLabelLabelOverlap });
registerMetric({
  name: 'hubArrowStack',
  compute: (_model, layout) => countHubArrowStack(layout.edges ?? []),
});
registerMetric({ name: 'maxEmptyBlockRatio', compute: (_model, layout) => computeMaxEmptyBlockRatio(layout) });
registerMetric({
  name: 'edgeFlushCount',
  compute: (_model, layout) => countEdgeFlush(layout.edges ?? [], layout),
});
registerMetric({
  name: 'parallelBundleCount',
  compute: (_model, layout) => countParallelBundles(layout.edges ?? []),
});
registerMetric({
  name: 'edgeFrameCrossings',
  compute: (model, layout) => countEdgeFrameCrossings(model, layout.edges ?? [], layout),
});
registerMetric({
  name: 'trunkDetourCount',
  compute: (_model, layout) => countTrunkDetours(layout.edges ?? []),
});
registerMetric({
  name: 'nestedLoopCount',
  compute: (_model, layout) => countNestedLoops(layout.edges ?? [], layout),
});
registerMetric({
  name: 'edgeNodeFlush',
  compute: (_model, layout) => countEdgeNodeFlush(layout.edges ?? [], layout),
});
registerMetric({ name: 'frameFillRatio', compute: (_model, layout) => computeFrameFillRatio(layout) });
registerMetric({
  name: 'edgeCanvasMargin',
  compute: (_model, layout) => computeEdgeCanvasMargin(layout.edges ?? [], layout),
});

/**
 * Computes every registered metric. The registry drives the assembly, so a new
 * measurement participates without touching this function; [[LayoutMetrics]]
 * remains the strong, hand-written shape the registered names must cover.
 * `layoutMs` is not a measurement of the layout — it is the caller's wall-time
 * reading — so it is attached directly rather than registered.
 */
export function computeLayoutMetrics(
  model: PlantUmlModel,
  layout: LayoutResult,
  layoutMs?: number,
): LayoutMetrics {
  const result: Record<string, number> = {};
  for (const metric of registry) {
    result[metric.name] = metric.compute(model, layout);
  }
  if (layoutMs !== undefined) result.layoutMs = layoutMs;
  return result as unknown as LayoutMetrics;
}

/** Polyline length ÷ Manhattan distance above which an edge counts as a detour. */
export const TRUNK_DETOUR_FACTOR = 2;
/** Distance (px) and run (px) for [[LayoutMetrics.edgeNodeFlush]]. */
export const EDGE_NODE_FLUSH_DISTANCE = 4;
export const EDGE_NODE_FLUSH_MIN_LENGTH = 40;

/** Frames with at least this many nodes count for [[LayoutMetrics.frameFillRatio]]. */
export const FRAME_FILL_MIN_NODES = 6;

function computeFrameFillRatio(layout: LayoutResult): number {
  const frames = (layout.packages ?? []).slice().sort((p, q) => p.width * p.height - q.width * q.height);
  const stats = new Map<string, { area: number; count: number }>();
  for (const n of layout.nodes) {
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    const f = frames.find((p) => cx >= p.x && cx <= p.x + p.width && cy >= p.y && cy <= p.y + p.height);
    if (!f) continue;
    const s = stats.get(f.id) ?? { area: 0, count: 0 };
    s.area += n.width * n.height;
    s.count++;
    stats.set(f.id, s);
  }
  let ratio = 1;
  for (const f of frames) {
    const s = stats.get(f.id);
    if (!s || s.count < FRAME_FILL_MIN_NODES || f.width * f.height <= 0) continue;
    ratio = Math.min(ratio, s.area / (f.width * f.height));
  }
  return ratio;
}

function computeEdgeCanvasMargin(edges: EdgeLayout[], layout: LayoutResult): number {
  let margin = Math.min(layout.width, layout.height);
  for (const e of edges) {
    for (const p of e.points) {
      margin = Math.min(margin, p.x, p.y, layout.width - p.x, layout.height - p.y);
    }
  }
  return margin;
}

function countTrunkDetours(edges: EdgeLayout[]): number {
  let count = 0;
  for (const e of edges) {
    if (e.points.length < 3) continue;
    const a = e.points[0];
    const b = e.points[e.points.length - 1];
    const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (polylineLength(e.points) > TRUNK_DETOUR_FACTOR * Math.max(manhattan, 1)) count++;
  }
  return count;
}

function countNestedLoops(edges: EdgeLayout[], layout: LayoutResult): number {
  const nodes = layout.nodes;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const frames = (layout.packages ?? []).slice().sort((p, q) => p.width * p.height - q.width * q.height);
  const frameOf = (id: string): string | undefined => {
    const n = nodeById.get(id);
    if (!n) return undefined;
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    return frames.find((f) => cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height)?.id;
  };
  interface Loop { frame: string | undefined; x0: number; y0: number; x1: number; y1: number }
  const loops: Loop[] = [];
  for (const e of edges) {
    const frame = frameOf(e.source);
    if (frame === undefined || frame !== frameOf(e.target)) continue; // only coils inside one frame
    // A U-turn: three consecutive segments whose outer two run in opposite
    // directions — the route leaves, crosses over and comes back.
    for (let i = 0; i + 3 < e.points.length; i++) {
      const [p0, p1, p2, p3] = e.points.slice(i, i + 4);
      const firstVertical = Math.abs(p0.x - p1.x) < 1e-6 && Math.abs(p0.y - p1.y) > 1e-6;
      const firstHorizontal = Math.abs(p0.y - p1.y) < 1e-6 && Math.abs(p0.x - p1.x) > 1e-6;
      const d1 = firstVertical ? p1.y - p0.y : p1.x - p0.x;
      const d3 = firstVertical ? p3.y - p2.y : p3.x - p2.x;
      const middleOk = firstVertical ? Math.abs(p1.y - p2.y) < 1e-6 : Math.abs(p1.x - p2.x) < 1e-6;
      const lastOk = firstVertical ? Math.abs(p2.x - p3.x) < 1e-6 : Math.abs(p2.y - p3.y) < 1e-6;
      if ((!firstVertical && !firstHorizontal) || !middleOk || !lastOk || d1 * d3 >= 0) continue;
      const xs = [p0.x, p1.x, p2.x, p3.x];
      const ys = [p0.y, p1.y, p2.y, p3.y];
      const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      const wraps = nodes.some(
        (n) =>
          n.id !== e.source &&
          n.id !== e.target &&
          n.x > box.x0 && n.x + n.width < box.x1 &&
          n.y > box.y0 && n.y + n.height < box.y1,
      );
      if (wraps) loops.push({ frame, ...box });
    }
  }
  let count = 0;
  loops.forEach((inner, i) => {
    const nested = loops.some(
      (outer, j) =>
        j !== i &&
        outer.frame === inner.frame &&
        outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1 &&
        (outer.x0 < inner.x0 || outer.y0 < inner.y0 || outer.x1 > inner.x1 || outer.y1 > inner.y1),
    );
    if (nested) count++;
  });
  return count;
}

function countEdgeNodeFlush(edges: EdgeLayout[], layout: LayoutResult): number {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  let count = 0;
  for (const edge of edges) {
    const ends = new Set([edge.source, edge.target]);
    for (let i = 0; i + 1 < edge.points.length; i++) {
      const a = edge.points[i];
      const b = edge.points[i + 1];
      const vertical = Math.abs(a.x - b.x) < 1e-6;
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      if (vertical === horizontal) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < EDGE_NODE_FLUSH_MIN_LENGTH) continue;
      for (const id of ends) {
        const n = nodeById.get(id);
        if (n && segmentFlushRect(a, b, vertical, nodeRect(n), EDGE_NODE_FLUSH_DISTANCE)) count++;
      }
    }
  }
  return count;
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
function segmentFlushRect(a: Point, b: Point, vertical: boolean, r: Rect, distance = EDGE_FLUSH_DISTANCE): boolean {
  if (vertical) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (Math.min(hi, r.y + r.height) - Math.max(lo, r.y) <= 1e-6) return false;
    return (
      Math.abs(a.x - r.x) < distance ||
      Math.abs(a.x - (r.x + r.width)) < distance
    );
  }
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  if (Math.min(hi, r.x + r.width) - Math.max(lo, r.x) <= 1e-6) return false;
  return (
    Math.abs(a.y - r.y) < distance ||
    Math.abs(a.y - (r.y + r.height)) < distance
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
