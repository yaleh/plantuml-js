/**
 * Orthogonal edge-routing helpers. The layout engine delegates the actual
 * routing to elkjs (`elk.edgeRouting: ORTHOGONAL`); this module exposes the
 * geometry predicates used to assert the *outcome* — that edges bend at right
 * angles and never pass through an unrelated class box.
 */

import { EdgeLayout, NodeLayout, Point } from './layout.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function nodeRect(node: NodeLayout): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/**
 * True when the open segment a→b passes through the *interior* of `rect`
 * (boundary touches and corner grazes do not count as "passing through").
 */
export function segmentCrossesRect(a: Point, b: Point, rect: Rect): boolean {
  const minX = rect.x;
  const minY = rect.y;
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - minX, maxX - a.x, a.y - minY, maxY - a.y];

  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  if (t0 >= t1) return false;

  // The clip span must cross the interior, not merely graze a boundary.
  const mid = {
    x: a.x + dx * ((t0 + t1) / 2),
    y: a.y + dy * ((t0 + t1) / 2),
  };
  return mid.x > minX && mid.x < maxX && mid.y > minY && mid.y < maxY;
}

/**
 * Number of polyline segments that pass through a class box the edge is not
 * connected to. Zero means no spider-web crossing.
 */
export function countEdgeBoxIntersections(
  edges: EdgeLayout[],
  nodes: NodeLayout[],
): number {
  const rects = new Map(nodes.map((n) => [n.id, nodeRect(n)]));
  let count = 0;
  for (const edge of edges) {
    for (let i = 0; i + 1 < edge.points.length; i++) {
      for (const node of nodes) {
        if (node.id === edge.source || node.id === edge.target) continue;
        if (segmentCrossesRect(edge.points[i], edge.points[i + 1], rects.get(node.id)!)) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Number of polyline segments that are neither horizontal nor vertical — a
 * straight-diagonal router yields many, an orthogonal router yields zero.
 */
export function countNonOrthogonalSegments(points: Point[]): number {
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const dx = Math.abs(points[i + 1].x - points[i].x);
    const dy = Math.abs(points[i + 1].y - points[i].y);
    const horizontal = dx > 0.01 && dy <= 0.01;
    const vertical = dy > 0.01 && dx <= 0.01;
    if (!horizontal && !vertical) n++;
  }
  return n;
}
