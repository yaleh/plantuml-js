/**
 * Package-endpoint clipping. A relation that names a package (`X --> B` with
 * `package ... as X`) is laid out against a representative entity inside it,
 * so the routed polyline ends on that entity's box. The author meant the
 * package, so the polyline is cut where it crosses the package frame: the edge
 * visibly starts/ends on the frame boundary instead of reaching into it.
 */

import { PlantUmlModel } from '../model.js';
import { LayoutResult, PackageLayout, Point } from '../layout.js';

const inside = (p: Point, r: PackageLayout): boolean =>
  p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;

/** Point where segment a→b (a inside `r`, b outside) leaves the rectangle. */
function exitPoint(a: Point, b: Point, r: PackageLayout): Point {
  let t = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx > 0) t = Math.min(t, (r.x + r.width - a.x) / dx);
  if (dx < 0) t = Math.min(t, (r.x - a.x) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.height - a.y) / dy);
  if (dy < 0) t = Math.min(t, (r.y - a.y) / dy);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Cut the head of `points` at the first exit from `r`; unchanged if it never leaves. */
function clipHead(points: Point[], r: PackageLayout): Point[] {
  if (points.length < 2 || !inside(points[0], r)) return points;
  for (let i = 1; i < points.length; i++) {
    if (!inside(points[i], r)) {
      return [exitPoint(points[i - 1], points[i], r), ...points.slice(i)];
    }
  }
  return points;
}

export function clipPackageEndpoints(model: PlantUmlModel, layout: LayoutResult): LayoutResult {
  if (!model.relations.some((r) => r.sourcePackageId || r.targetPackageId)) return layout;
  const boxes = new Map((layout.packages ?? []).map((p) => [p.id, p]));
  const edges = layout.edges.map((edge) => {
    const m = /^rel-(\d+)$/.exec(edge.id);
    const rel = m ? model.relations[Number(m[1])] : undefined;
    if (!rel) return edge;
    let points = edge.points;
    const src = rel.sourcePackageId ? boxes.get(rel.sourcePackageId) : undefined;
    const dst = rel.targetPackageId ? boxes.get(rel.targetPackageId) : undefined;
    if (src) points = clipHead(points, src);
    if (dst) points = clipHead([...points].reverse(), dst).reverse();
    return points === edge.points ? edge : { ...edge, points };
  });
  return { ...layout, edges };
}
