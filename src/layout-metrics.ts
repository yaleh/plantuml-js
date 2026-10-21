/**
 * Layout quality metrics. Pure functions from (model, layout) to numbers, so a
 * layout strategy change can be judged by a diff in figures rather than by eye.
 * Edge polylines are taken at face value: for the viz engine they are bezier
 * control points, which is a coarse but consistent approximation.
 */

import { PlantUmlModel } from './model.js';
import { LayoutResult, METRICS, Point, displayName } from './layout.js';
import { countEdgeBoxIntersections, nodeRect, Rect } from './edge-router.js';
import { measureTextWidth } from './text-measure.js';

export interface LayoutMetrics {
  /** Proper crossings between segments of two different edges. */
  edgeCrossings: number;
  /** Edge segments passing through the interior of an unrelated node. */
  edgeNodeIntersections: number;
  totalEdgeLength: number;
  /** Sum of node areas divided by canvas area (0..1). */
  areaUtilization: number;
  /** Canvas width / height. */
  aspectRatio: number;
  /** Entity text lines wider than the box they are drawn in. */
  textOverflowCount: number;
  /** Package label tabs that overlap content or are narrower than their text. */
  labelOverlapCount: number;
}

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
