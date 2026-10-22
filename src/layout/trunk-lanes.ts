/**
 * Trunk lanes. A router that has to dodge a cluster of nodes can leave an edge
 * that overshoots — out sideways, down, back across, down again — and stacked
 * edges doing this draw the concentric rectangles of a coil. When the two end
 * segments run the same axis, the edge is re-drawn as a Z: leave the source,
 * cross over on a lane between the rows (the gap between the two end points),
 * and enter the target. It runs after lane spreading and fan-out merging, so only
 * what those passes left as an overshoot is touched. A Z replaces a detour only when it is shorter, passes
 * no unrelated node or package frame, and adds at most [[EXTRA_CROSSINGS]] crossings.
 */

import { LayoutResult, NodeLayout, PackageLayout, Point } from '../foundation/layout.js';

/** Path length ÷ Manhattan distance above which an edge is considered for a Z. */
const DETOUR_FACTOR = 2;
/** Clearance between a Z segment and an unrelated node box. */
const NODE_CLEARANCE = 10;
/** The lane must sit at least this far from both end points along the main axis. */
const END_MARGIN = 14;
/** Extra crossings a straightened route may add: a few crossings read better than a coil. */
const EXTRA_CROSSINGS = 2;
/** Spacing of the candidate lanes tried between the end points. */
const LANE_STEP = 10;
/** Spacing of the candidate channels tried for an overshooting S-route. */
const CHANNEL_STEP = 6;

type Seg = [Point, Point];

const length = (pts: Point[]): number =>
  pts.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** Segment touches the box inflated by `pad` (axis-aligned segments only). */
function hitsBox(a: Point, b: Point, r: { x: number; y: number; width: number; height: number }, pad: number): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x - pad && x0 < r.x + r.width + pad && y1 > r.y - pad && y0 < r.y + r.height + pad;
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function segmentsOf(pts: Point[]): Seg[] {
  return pts.slice(1).map((p, i): Seg => [pts[i], p]);
}

function crossingCount(route: Point[], others: Point[][]): number {
  let n = 0;
  for (const s of segmentsOf(route)) {
    for (const other of others) for (const t of segmentsOf(other)) if (crosses(s[0], s[1], t[0], t[1])) n++;
  }
  return n;
}

const centreInside = (n: NodeLayout, f: PackageLayout): boolean => {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  return cx > f.x && cx < f.x + f.width && cy > f.y && cy < f.y + f.height;
};

/** Z-route with its lane at `lane` on the main axis; `vertical` = the end segments are vertical. */
function zRoute(a: Point, b: Point, lane: number, vertical: boolean): Point[] {
  return vertical
    ? [a, { x: a.x, y: lane }, { x: b.x, y: lane }, b]
    : [a, { x: lane, y: a.y }, { x: lane, y: b.y }, b];
}

export function straightenTrunkDetours(layout: LayoutResult): LayoutResult {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const frames = layout.packages ?? [];
  const routes = layout.edges.map((e) => e.points);
  let changed = false;
  layout.edges.forEach((edge, index) => {
    const pts = edge.points;
    if (pts.length < 5) return;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length(pts) <= DETOUR_FACTOR * Math.max(manhattan, 1)) return;
    const verticalEnds = Math.abs(pts[0].x - pts[1].x) < 1e-6 && Math.abs(pts[pts.length - 2].x - b.x) < 1e-6;
    const horizontalEnds = Math.abs(pts[0].y - pts[1].y) < 1e-6 && Math.abs(pts[pts.length - 2].y - b.y) < 1e-6;
    if (verticalEnds === horizontalEnds) return;
    const vertical = verticalEnds;
    const from = vertical ? a.y : a.x;
    const to = vertical ? b.y : b.x;
    const lo = Math.min(from, to) + END_MARGIN;
    const hi = Math.max(from, to) - END_MARGIN;
    if (hi < lo) return;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const endFrames = frames.filter((f) => (source && centreInside(source, f)) || (target && centreInside(target, f)));
    const obstacles = layout.nodes.filter((n) => n.id !== edge.source && n.id !== edge.target);
    const others = routes.filter((_, i) => i !== index);
    const oldCrossings = crossingCount(pts, others);
    const mid = (lo + hi) / 2;
    const lanes: number[] = [];
    for (let d = 0; mid - d >= lo || mid + d <= hi; d += LANE_STEP) {
      if (mid - d >= lo) lanes.push(mid - d);
      if (d > 0 && mid + d <= hi) lanes.push(mid + d);
    }
    const candidates = lanes.map((lane) => zRoute(a, b, lane, vertical));
    if (pts.length === 6) {
      // Overshoot through a gap in the row between: keep the two cross-over
      // lanes and slide the channel to the gap nearest the end points.
      const c0 = vertical ? pts[2].x : pts[2].y;
      const span = [vertical ? a.x : a.y, vertical ? b.x : b.y, c0];
      for (let c = Math.min(...span); c <= Math.max(...span); c += CHANNEL_STEP) {
        candidates.push(
          vertical
            ? [a, pts[1], { x: c, y: pts[1].y }, { x: c, y: pts[3].y }, { x: b.x, y: pts[3].y }, b]
            : [a, pts[1], { x: pts[1].x, y: c }, { x: pts[3].x, y: c }, { x: pts[3].x, y: b.y }, b],
        );
      }
    }
    let best: { route: Point[]; crossings: number } | undefined;
    for (const route of candidates) {
      if (best && length(route) >= length(best.route)) continue;
      const segs = segmentsOf(route);
      if (obstacles.some((n) => segs.some(([p, q]) => hitsBox(p, q, n, NODE_CLEARANCE)))) continue;
      // a frame that neither end sits in must stay unentered
      if (frames.some((f) => !endFrames.includes(f) && segs.some(([p, q]) => hitsBox(p, q, f, -1)))) continue;
      const crossings = crossingCount(route, others);
      if (crossings > oldCrossings + EXTRA_CROSSINGS) continue;
      best = { route, crossings };
    }
    if (!best || length(best.route) >= length(pts)) return;
    routes[index] = best.route;
    changed = true;
  });
  if (!changed) return layout;
  return { ...layout, edges: layout.edges.map((e, i) => ({ ...e, points: routes[i] })) };
}
