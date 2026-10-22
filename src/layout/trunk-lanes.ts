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
import { routeOrthogonal } from './grid-router.js';
import { findParallelBundles } from '../metrics/layout-metrics.js';

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

/** A segment this close to a side of an end node (and at least [[FLUSH_MIN_LENGTH]] long) hugs the box. */
const FLUSH_DISTANCE = 4;
const FLUSH_MIN_LENGTH = 40;
/** Distances off the node side tried for a lifted segment, nearest first. */
const FLUSH_LIFTS = Array.from({ length: 36 }, (_, i) => i + 8);
/** A lifted segment keeps this far from other edges' parallel segments it runs beside. */
const FLUSH_LANE_CLEARANCE = 9;

/** Another route has a segment parallel to a–b, closer than [[FLUSH_LANE_CLEARANCE]] and overlapping it in extent. */
function besideParallel(a: Point, b: Point, other: Point[]): boolean {
  const horizontal = Math.abs(a.y - b.y) < 1e-6;
  for (let j = 0; j + 1 < other.length; j++) {
    const c = other[j];
    const d = other[j + 1];
    if (horizontal) {
      if (Math.abs(c.y - d.y) > 1e-6 || Math.abs(c.y - a.y) >= FLUSH_LANE_CLEARANCE) continue;
      if (Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 1e-6) return true;
    } else {
      if (Math.abs(c.x - d.x) > 1e-6 || Math.abs(c.x - a.x) >= FLUSH_LANE_CLEARANCE) continue;
      if (Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 1e-6) return true;
    }
  }
  return false;
}

/**
 * Lift segments that run flush along the side of a node the edge belongs to —
 * hard to tell from the box outline — a few pixels off that side. The segment
 * moves outwards; when it was the first or last one, the original end point is
 * kept and joined by a short stub. The nearest lift that clears every node and
 * every parallel neighbour edge is used; none, and the segment stays.
 */
export function liftFlushSegments(layout: LayoutResult): LayoutResult {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  let changed = false;
  const edges = layout.edges.map((edge) => {
    let pts = edge.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const vertical = Math.abs(a.x - b.x) < 1e-6;
      if (horizontal === vertical || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < FLUSH_MIN_LENGTH) continue;
      for (const id of [edge.source, edge.target]) {
        const n = nodeById.get(id);
        if (!n) continue;
        const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
        const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        const n0 = horizontal ? n.x : n.y;
        const n1 = horizontal ? n.x + n.width : n.y + n.height;
        if (Math.min(hi, n1) - Math.max(lo, n0) <= 1e-6) continue;
        const at = horizontal ? a.y : a.x;
        const side0 = horizontal ? n.y : n.x;
        const side1 = horizontal ? n.y + n.height : n.x + n.width;
        const nearLow = Math.abs(at - side0) < FLUSH_DISTANCE;
        const nearHigh = Math.abs(at - side1) < FLUSH_DISTANCE;
        if (!nearLow && !nearHigh) continue;
        let lifted: Point[] | undefined;
        // First pass keeps clear of every neighbouring lane; the second takes the
        // nearest lift that merely clears the nodes — a lane beside another lane
        // reads better than a line that is part of a box outline.
        for (const strict of [true, false]) for (const lift of lifted ? [] : FLUSH_LIFTS) {
          const to = nearLow ? side0 - lift : side1 + lift;
          const a2 = horizontal ? { x: a.x, y: to } : { x: to, y: a.y };
          const b2 = horizontal ? { x: b.x, y: to } : { x: to, y: b.y };
          if (layout.nodes.some((o) => hitsBox(a2, b2, o, 2))) continue;
          if (strict && layout.edges.some((o) => o !== edge && besideParallel(a2, b2, o.points))) continue;
          lifted = [...pts.slice(0, i), ...(i === 0 ? [a] : []), a2, b2, ...(i + 2 === pts.length ? [b] : []), ...pts.slice(i + 2)];
          break;
        }
        if (!lifted) continue;
        pts = lifted;
        changed = true;
        break;
      }
    }
    return pts === edge.points ? edge : { ...edge, points: pts };
  });
  return changed ? { ...layout, edges } : layout;
}

/** Crossing prices an un-coil re-route is tried with, dearest first, and the crossings it may add. */
const UNCOIL_CROSSING_COSTS = [6, 3, 1.5];
const UNCOIL_EXTRA_CROSSINGS = 5;

/** Nodes (other than its ends) enclosed by the boxes of the route's U-turns (outer segments opposite), summed. */
function wrapCount(pts: Point[], nodes: NodeLayout[], ends: string[]): number {
  let wrapped = 0;
  for (let i = 0; i + 3 < pts.length; i++) {
    const [p0, p1, p2, p3] = pts.slice(i, i + 4);
    const vertical = Math.abs(p0.x - p1.x) < 1e-6 && Math.abs(p0.y - p1.y) > 1e-6;
    const horizontal = Math.abs(p0.y - p1.y) < 1e-6 && Math.abs(p0.x - p1.x) > 1e-6;
    if (!vertical && !horizontal) continue;
    const d1 = vertical ? p1.y - p0.y : p1.x - p0.x;
    const d3 = vertical ? p3.y - p2.y : p3.x - p2.x;
    const middleOk = vertical ? Math.abs(p1.y - p2.y) < 1e-6 : Math.abs(p1.x - p2.x) < 1e-6;
    const lastOk = vertical ? Math.abs(p2.x - p3.x) < 1e-6 : Math.abs(p2.y - p3.y) < 1e-6;
    if (!middleOk || !lastOk || d1 * d3 >= 0) continue;
    const x0 = Math.min(p0.x, p1.x, p2.x, p3.x);
    const x1 = Math.max(p0.x, p1.x, p2.x, p3.x);
    const y0 = Math.min(p0.y, p1.y, p2.y, p3.y);
    const y1 = Math.max(p0.y, p1.y, p2.y, p3.y);
    wrapped += nodes.filter((n) => !ends.includes(n.id) && n.x > x0 && n.x + n.width < x1 && n.y > y0 && n.y + n.height < y1).length;
  }
  return wrapped;
}

/**
 * Un-coil: an edge whose route wraps round other nodes (the U of a trunk that
 * circles a cluster — stacked, the concentric rectangles of a coil) is routed
 * again on the lattice with cheaper crossings, against every other edge as a
 * fixed wire. The new route is kept when it wraps fewer nodes, adds at most
 * [[UNCOIL_EXTRA_CROSSINGS]] crossings and opens no new comb at either end.
 * Runs after fan-out merging, so a hub's trunk has been settled by then.
 */
export function uncoilWraps(layout: LayoutResult): LayoutResult {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const routes = layout.edges.map((e) => e.points);
  const combKeys = (): Set<string> =>
    new Set(
      findParallelBundles(layout.edges.map((e, i) => ({ ...e, points: routes[i] }))).map((b) => `${b.end}\u0000${b.node}`),
    );
  const combsBefore = combKeys();
  let changed = false;
  layout.edges.forEach((edge, index) => {
    const pts = routes[index];
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const ends = [edge.source, edge.target];
    const wrapped = source && target && pts.length >= 4 ? wrapCount(pts, layout.nodes, ends) : 0;
    if (!source || !target || wrapped === 0) return;
    const others = routes.filter((_, i) => i !== index);
    const oldCrossings = crossingCount(pts, others);
    const existing = layout.edges
      .map((e, i) => ({ source: e.source, target: e.target, points: routes[i] }))
      .filter((_, i) => i !== index);
    for (const crossingCost of UNCOIL_CROSSING_COSTS) {
      const route = routeOrthogonal([{ id: 'uncoil', source, target }], layout.nodes, {
        width: layout.width,
        height: layout.height,
        frames: layout.packages,
        existing,
        crossingCost,
        ripupPasses: 0,
      }).get('uncoil');
      if (!route || route.length < 2 || wrapCount(route, layout.nodes, ends) >= wrapped) continue;
      if (crossingCount(route, others) > oldCrossings + UNCOIL_EXTRA_CROSSINGS) continue;
      const previous = routes[index];
      routes[index] = route;
      const opened = [...combKeys()].some((k) => !combsBefore.has(k));
      if (opened) {
        routes[index] = previous;
        continue;
      }
      changed = true;
      break;
    }
  });
  if (!changed) return layout;
  return { ...layout, edges: layout.edges.map((e, i) => ({ ...e, points: routes[i] })) };
}
