/**
 * Lane spreading. The grid router and ELK both let unrelated orthogonal edges
 * share one channel centre, so several edges end up drawn on top of each other
 * and read as one thicker line. This pass fans such coincident (or nearly
 * coincident) interior segments out onto distinct, evenly spaced lanes around
 * their common centre. Only interior segments move — the first and last
 * segments stay attached to their ports — and a move is dropped when it would
 * run through a node or fold an adjacent segment back on itself.
 */

import { LayoutResult, Point } from '../layout.js';

/** Segments closer than this on the cross axis are one lane cluster (just above PARALLEL_PROXIMITY). */
const CLUSTER_DISTANCE = 10;
/** Distance between spread lanes; strictly above [[CLUSTER_DISTANCE]] so lanes stay distinct. */
const LANE_STEP = 10;
/** Tightest lane step used when a corridor is too narrow (still above PARALLEL_PROXIMITY = 8). */
const MIN_LANE_STEP = 8.5;
/** An adjacent segment may shrink to at most this length. */
const MIN_STUB = 6;
/** Clearance between a moved segment and an unrelated node box. */
const NODE_CLEARANCE = 12;
/** Clearance between a moved segment and a package frame border it runs along. */
const FRAME_CLEARANCE = 10;
/** Spreading is repeated because moved lanes can land beside a neighbouring channel. */
const PASSES = 2;

interface Seg {
  edge: number;
  /** Index of the segment's first point within the edge polyline. */
  at: number;
  /** Cross-axis coordinate (y for horizontal, x for vertical). */
  c: number;
  lo: number;
  hi: number;
  /** Side the two neighbouring segments turn toward (−1 low side, +1 high side), summed. */
  turn: number;
}

export function spreadParallelLanes(layout: LayoutResult): LayoutResult {
  const polylines = layout.edges.map((e) => e.points.map((p) => ({ ...p })));
  const owners = layout.edges.map((e) => new Set([e.source, e.target]));
  let changed = false;
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (const horizontal of [true, false]) {
      const segs = collectSegments(polylines, horizontal);
      for (const cluster of clusterSegments(segs)) {
        if (spreadCluster(cluster, polylines, owners, layout, horizontal)) moved = true;
      }
    }
    if (!moved) break;
    changed = true;
  }
  if (!changed) return layout;
  return { ...layout, edges: layout.edges.map((e, i) => ({ ...e, points: polylines[i] })) };
}

function collectSegments(polylines: Point[][], horizontal: boolean): Seg[] {
  const segs: Seg[] = [];
  const cross = (p: Point): number => (horizontal ? p.y : p.x);
  const along = (p: Point): number => (horizontal ? p.x : p.y);
  polylines.forEach((pts, edge) => {
    // Interior segments only: both neighbours must exist.
    for (let i = 1; i + 2 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(cross(a) - cross(b)) > 1e-6) continue;
      const prev = pts[i - 1];
      const next = pts[i + 2];
      // Neighbours must be perpendicular (they absorb the shift).
      if (Math.abs(along(prev) - along(a)) > 1e-6 || Math.abs(along(next) - along(b)) > 1e-6) continue;
      const c = cross(a);
      const side = (p: Point): number => Math.sign(cross(p) - c);
      segs.push({
        edge,
        at: i,
        c,
        lo: Math.min(along(a), along(b)),
        hi: Math.max(along(a), along(b)),
        turn: side(prev) + side(next),
      });
    }
  });
  return segs;
}

/** Groups of segments (from at least two edges) that overlap within [[CLUSTER_DISTANCE]]. */
function clusterSegments(segs: Seg[]): Seg[][] {
  const order = segs.map((_, i) => i).sort((a, b) => segs[a].c - segs[b].c);
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let x = 0; x < order.length; x++) {
    const s = segs[order[x]];
    for (let y = x + 1; y < order.length; y++) {
      const t = segs[order[y]];
      if (t.c - s.c >= CLUSTER_DISTANCE) break;
      if (s.edge === t.edge) continue;
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 1) parent[find(order[x])] = find(order[y]);
    }
  }
  const groups = new Map<number, Seg[]>();
  segs.forEach((s, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(s);
    else groups.set(root, [s]);
  });
  return [...groups.values()].filter((g) => new Set(g.map((s) => s.edge)).size > 1);
}

function spreadCluster(
  cluster: Seg[],
  polylines: Point[][],
  owners: Set<string>[],
  layout: LayoutResult,
  horizontal: boolean,
): boolean {
  const lanes = cluster
    .slice()
    .sort((a, b) => a.c - b.c || a.turn - b.turn || a.edge - b.edge || a.at - b.at);
  const targets = fitToCorridor(separate(lanes.map((s) => s.c), LANE_STEP), lanes, layout, horizontal);
  let moved = false;
  lanes.forEach((seg, k) => {
    const target = targets[k];
    if (Math.abs(target - seg.c) < 1e-6) return;
    if (shift(polylines[seg.edge], seg.at, target, owners[seg.edge], layout, horizontal)) moved = true;
  });
  return moved;
}

/**
 * Least-squares positions for the sorted coordinates `c` such that neighbours
 * are at least `step` apart (pool-adjacent-violators on `c − step·i`).
 */
function separate(c: number[], step: number): number[] {
  const blocks: { sum: number; n: number }[] = [];
  c.forEach((v, i) => {
    blocks.push({ sum: v - step * i, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n + step * out.length);
  return out;
}

/**
 * Keep `targets` (sorted lanes) inside the free corridor around the cluster:
 * the gap between the nearest unrelated boxes on either side. A corridor too
 * narrow for [[LANE_STEP]] is shared at a tighter step down to [[MIN_LANE_STEP]];
 * when even that does not fit the unconstrained targets are returned (the
 * per-segment safety checks then decide what can move).
 */
function fitToCorridor(targets: number[], lanes: Seg[], layout: LayoutResult, horizontal: boolean): number[] {
  const n = targets.length;
  const lo = Math.min(...lanes.map((s) => s.lo));
  const hi = Math.max(...lanes.map((s) => s.hi));
  const centre = lanes.reduce((sum, s) => sum + s.c, 0) / n;
  const blocked: [number, number][] = [];
  const add = (a0: number, a1: number, c0: number, c1: number, clearance: number): void => {
    if (a1 > lo && a0 < hi) blocked.push([c0 - clearance, c1 + clearance]);
  };
  for (const b of layout.nodes) {
    if (horizontal) add(b.x, b.x + b.width, b.y, b.y + b.height, NODE_CLEARANCE);
    else add(b.y, b.y + b.height, b.x, b.x + b.width, NODE_CLEARANCE);
  }
  for (const f of layout.packages ?? []) {
    if (horizontal) {
      add(f.x, f.x + f.width, f.y, f.y, FRAME_CLEARANCE);
      add(f.x, f.x + f.width, f.y + f.height, f.y + f.height, FRAME_CLEARANCE);
    } else {
      add(f.y, f.y + f.height, f.x, f.x, FRAME_CLEARANCE);
      add(f.y, f.y + f.height, f.x + f.width, f.x + f.width, FRAME_CLEARANCE);
    }
  }
  let floor = -Infinity;
  let ceil = Infinity;
  for (const [a, b] of blocked) {
    if (a <= centre && centre <= b) return targets;
    if (b < centre) floor = Math.max(floor, b);
    else ceil = Math.min(ceil, a);
  }
  const room = ceil - floor;
  const needed = (n - 1) * LANE_STEP;
  if (room >= needed) {
    const first = targets[0];
    const last = targets[n - 1];
    const shiftBy = first < floor ? floor - first : last > ceil ? ceil - last : 0;
    return targets.map((t) => t + shiftBy);
  }
  if (n < 2 || room / (n - 1) < MIN_LANE_STEP) return targets;
  const step = room / (n - 1);
  return targets.map((_, i) => floor + i * step);
}

/** Move segment `at` of `pts` to cross-axis `target`; false (and unchanged) if that is unsafe. */
function shift(
  pts: Point[],
  at: number,
  target: number,
  owner: Set<string>,
  layout: LayoutResult,
  horizontal: boolean,
): boolean {
  const key = horizontal ? 'y' : 'x';
  const a = pts[at];
  const b = pts[at + 1];
  const prev = pts[at - 1];
  const next = pts[at + 2];
  // The segment may have moved already (shared with an earlier lane); read live coordinates.
  const keepsDirection = (far: Point, near: Point): boolean => {
    const before = near[key] - far[key];
    const after = target - far[key];
    return Math.sign(before) === Math.sign(after) && Math.abs(after) >= MIN_STUB;
  };
  if (!keepsDirection(prev, a) || !keepsDirection(next, b)) return false;

  const trial = [
    { ...prev },
    { ...a, [key]: target } as Point,
    { ...b, [key]: target } as Point,
    { ...next },
  ];
  for (const n of layout.nodes) {
    if (owner.has(n.id)) continue;
    const box = {
      x0: n.x - NODE_CLEARANCE,
      y0: n.y - NODE_CLEARANCE,
      x1: n.x + n.width + NODE_CLEARANCE,
      y1: n.y + n.height + NODE_CLEARANCE,
    };
    for (let i = 0; i + 1 < trial.length; i++) if (segmentHitsBox(trial[i], trial[i + 1], box)) return false;
  }
  if (
    runsAlongFrame(trial[1], trial[2], layout, horizontal) ||
    runsAlongFrame(trial[0], trial[1], layout, !horizontal) ||
    runsAlongFrame(trial[2], trial[3], layout, !horizontal)
  ) {
    return false;
  }
  a[key] = target;
  b[key] = target;
  return true;
}

/** True when the moved segment would hug a package frame border it is parallel to. */
function runsAlongFrame(p: Point, q: Point, layout: LayoutResult, horizontal: boolean): boolean {
  for (const f of layout.packages ?? []) {
    if (horizontal) {
      if (Math.max(p.x, q.x) <= f.x || Math.min(p.x, q.x) >= f.x + f.width) continue;
      if (Math.abs(p.y - f.y) < FRAME_CLEARANCE || Math.abs(p.y - (f.y + f.height)) < FRAME_CLEARANCE) return true;
    } else {
      if (Math.max(p.y, q.y) <= f.y || Math.min(p.y, q.y) >= f.y + f.height) continue;
      if (Math.abs(p.x - f.x) < FRAME_CLEARANCE || Math.abs(p.x - (f.x + f.width)) < FRAME_CLEARANCE) return true;
    }
  }
  return false;
}

function segmentHitsBox(p: Point, q: Point, box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return (
    Math.max(p.x, q.x) > box.x0 &&
    Math.min(p.x, q.x) < box.x1 &&
    Math.max(p.y, q.y) > box.y0 &&
    Math.min(p.y, q.y) < box.y1
  );
}
