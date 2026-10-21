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

import { PlantUmlModel } from './model.js';
import { LayoutResult, EdgeLayout, METRICS, Point, displayName } from './layout.js';
import { countEdgeBoxIntersections, nodeRect, Rect } from './edge-router.js';
import { measureTextWidth } from './text-measure.js';

export interface LayoutMetrics {
  /** Proper crossings between segments of two different edges. */
  edgeCrossings: number;
  /** Edge segments passing through the interior of an unrelated node. */
  edgeNodeIntersections: number;
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
   * Summed length of collinear, overlapping segments from *different* edges —
   * the orthogonal router's "parallel-line wall" is invisible to
   * [[edgeCrossings]] (segments that merely overlap never *cross*), so this
   * counts that hidden overlap in canvas pixels.
   */
  overlappingEdgeLength: number;
  /**
   * Incoming arrowheads stacked beyond a threshold on the same side of the
   * same node — the "everything points at this hub" pile-up that
   * [[edgeCrossings]] cannot see either.
   */
  hubArrowStack: number;
}

/** Package label tab geometry, kept in step with [[../render/svg]]. */
const PACKAGE_TAB_HEIGHT = 18;
const PACKAGE_LABEL_FONT_SIZE = 12;
const PACKAGE_TAB_PADDING = 12;

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
    totalEdgeLength: edges.reduce((sum, e) => sum + polylineLength(e.points), 0),
    areaUtilization: canvasArea > 0 ? nodeArea / canvasArea : 0,
    aspectRatio: layout.height > 0 ? layout.width / layout.height : 0,
    textOverflowCount: countTextOverflow(model, layout),
    labelOverlapCount: countLabelOverlap(model, layout),
    overlappingEdgeLength: countOverlappingEdgeLength(edges.map((e) => e.points)),
    hubArrowStack: countHubArrowStack(edges),
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

  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j];
      if (t.minX > s.maxX) break;
      if (t.edge === s.edge) continue;
      if (t.maxY < s.minY || t.minY > s.maxY) continue;
      if (segmentsCross(s.a, s.b, t.a, t.b)) count++;
    }
  }
  return count;
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

    const textWidth = measureTextWidth(pkg.name, PACKAGE_LABEL_FONT_SIZE);
    const wanted = textWidth + PACKAGE_TAB_PADDING;
    const tab: Rect = {
      x: frame.x,
      y: frame.y,
      width: Math.min(frame.width, Math.max(24, wanted)),
      height: PACKAGE_TAB_HEIGHT,
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

/**
 * Summed length of collinear, overlapping segments from different edges. Two
 * axis-aligned segments that lie on the same line and overlap are a
 * "parallel-line wall": they never produce a proper crossing (so
 * [[countEdgeCrossings]] misses them) yet still read as clutter. Each
 * (segment, segment) overlap is counted once, in canvas pixels.
 */
function countOverlappingEdgeLength(polylines: Point[][]): number {
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
      total += collinearOverlapLength(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
    }
  }
  return total;
}

/** Overlap length of two segments when collinear, else 0 (in canvas pixels). */
function collinearOverlapLength(a: Point, b: Point, c: Point, d: Point): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = d.x - c.x;
  const vy = d.y - c.y;
  const lenU = Math.hypot(ux, uy);
  const lenV = Math.hypot(vx, vy);
  if (lenU < 1e-9 || lenV < 1e-9) return 0;

  // Parallel: the two direction vectors must be colinear.
  if (Math.abs(ux * vy - uy * vx) > 1e-9 * lenU * lenV) return 0;

  // Colinear: `c` must lie on the line through `a`/`b` (perpendicular distance).
  const distC = Math.abs(ux * (c.y - a.y) - uy * (c.x - a.x)) / lenU;
  if (distC > 0.01) return 0;

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
