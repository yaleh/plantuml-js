/**
 * Fan-out trunks. A node that sends (or receives) many edges the same way gets
 * a "comb" from the routers: every edge takes its own port and its own bend
 * level, so a dozen nested right-angle staircases run side by side. This pass
 * redraws such a group as a tree: one shared trunk leaves the node, runs to a
 * common branch level, and a shared bus there fans out to short drops that end
 * at each target. Edges stay orthogonal and keep their endpoints' sides; a
 * group is only rewritten when the new geometry stays clear of every other node.
 *
 * Only edges shaped "out, across, onward" (first and third segments along the
 * same direction, the second across) take part — the shape both ELK and the
 * grid router give a plain fan-out. Anything else in the group is left alone.
 */

import { LayoutResult, NodeLayout, Point } from '../layout.js';
import { PlantUmlModel } from '../model.js';
import { findParallelBundles } from '../layout-metrics.js';
import { routeOrthogonal, RouteRequest } from './grid-router.js';

/** Edges leaving (or entering) one side that make a group worth merging. */
export const TRUNK_MIN_EDGES = 5;
/** Shortest trunk worth drawing (px), measured from the node border. */
const MIN_TRUNK = 16;
/** Preferred distance between the bus and the nearest drop's far end. */
const BRANCH_GAP = 24;
/** Tightest bus-to-corner distance accepted when the preferred gap does not fit. */
const MIN_BRANCH_GAP = 12;
/** Clearance between a new segment and an unrelated node box. */
/** Extra crossings a re-routed comb may add (the tree trades a few crossings for one clean trunk). */
const REROUTE_CROSSING_BUDGET = 6;
/** Lattice cost of crossing another wire while re-routing a comb (default routing: 1.5). */
const REROUTE_CROSSING_COST = 12;
/** Lattice cost of running along another wire's lane while re-routing a comb (default routing: 2). */
const REROUTE_SHARED_LANE_COST = 8;
const NODE_CLEARANCE = 4;
/** A drop lands this far inside its target's side, away from the corners. */
const DROP_INSET = 10;
/** Spacing of the candidate drop columns tried along a target's face. */
const DROP_STEP = 8;
/** Parallel segments of different edges closer than this (and not on top of each other) read as one wall. */
const CROWD_DISTANCE = 10;

interface Oriented {
  /** Index into layout.edges. */
  edge: number;
  /** Polyline oriented so the grouped node is first. */
  points: Point[];
}

export function mergeFanoutTrunks(model: PlantUmlModel, layout: LayoutResult): LayoutResult {
  const polylines = layout.edges.map((e) => dropRepeats(e.points));
  const typeOf = (id: string): string => {
    const index = Number(id.startsWith('rel-') ? id.slice(4) : NaN);
    return model.relations[index]?.type ?? '';
  };
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  let changed = false;

  for (const end of ['source', 'target'] as const) {
    // Family = the edges of one kind at one node; each may leave through several
    // sides (every side its far node lies beyond). Sides are taken greedily, the
    // one that most unassigned edges can use first, while a group of enough remains.
    const families = new Map<string, { edge: number; dirs: Dir[] }[]>();
    layout.edges.forEach((e, i) => {
      if (polylines[i].length < 2) return;
      const here = nodeById.get(e[end]);
      const far = nodeById.get(end === 'source' ? e.target : e.source);
      const dirs = here && far ? facing(here, far) : [];
      if (dirs.length === 0) return;
      const key = `${e[end]}\u0000${typeOf(e.id)}`;
      const list = families.get(key);
      if (list) list.push({ edge: i, dirs });
      else families.set(key, [{ edge: i, dirs }]);
    });
    for (const family of families.values()) {
      let rest = family;
      while (rest.length >= TRUNK_MIN_EDGES) {
        const counts = new Map<Dir, number>();
        for (const m of rest) for (const d of m.dirs) counts.set(d, (counts.get(d) ?? 0) + 1);
        const [dir, count] = [...counts].sort((x, y) => y[1] - x[1] || DIRS.indexOf(x[0]) - DIRS.indexOf(y[0]))[0];
        if (count < TRUNK_MIN_EDGES) break;
        const picked = rest.filter((m) => m.dirs.includes(dir));
        rest = rest.filter((m) => !m.dirs.includes(dir));
        const members = picked.map((m) => ({
          edge: m.edge,
          points: end === 'source' ? polylines[m.edge] : polylines[m.edge].slice().reverse(),
        }));
        const rewritten = mergeGroup(members, dir, layout, polylines, end);
        if (!rewritten) continue;
        for (const m of rewritten) polylines[m.edge] = end === 'source' ? m.points : m.points.slice().reverse();
        changed = true;
      }
    }
  }
  if (rerouteCombs(model, layout, polylines)) changed = true;
  if (!changed) return layout;
  return { ...layout, edges: layout.edges.map((e, i) => ({ ...e, points: polylines[i] })) };
}

/**
 * Combs the direct tree could not replace (their targets sit behind other
 * nodes) are re-routed together on the lattice router, which grows a shared
 * trunk wherever wires of one source (or target) run alike. A comb is kept
 * re-routed only when that really removes it without piling up crossings.
 */
function rerouteCombs(model: PlantUmlModel, layout: LayoutResult, polylines: Point[][]): boolean {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const indexOfEdge = new Map(layout.edges.map((e, i) => [e.id, i]));
  const snapshot = (): LayoutResult['edges'] => layout.edges.map((e, i) => ({ ...e, points: polylines[i] }));
  let changed = false;
  for (const comb of findParallelBundles(snapshot())) {
    // The whole family (same node, same end, same kind) is re-routed so the tree is complete.
    const typeOf = (i: number): string => model.relations[Number(layout.edges[i].id.slice(4))]?.type ?? '';
    const seed = indexOfEdge.get(comb.edges[0])!;
    const members = layout.edges
      .map((e, i) => i)
      .filter((i) => layout.edges[i][comb.end] === comb.node && typeOf(i) === typeOf(seed) && polylines[i].length >= 2);
    const requests: RouteRequest[] = [];
    for (const i of members) {
      const source = nodeById.get(layout.edges[i].source);
      const target = nodeById.get(layout.edges[i].target);
      if (!source || !target) break;
      requests.push({ id: String(i), source, target });
    }
    if (requests.length !== members.length) continue;
    const taken = new Set(members);
    const others = layout.edges
      .map((e, i) => ({ source: e.source, target: e.target, points: polylines[i] }))
      .filter((_, i) => !taken.has(i));
    const routed = routeOrthogonal(requests, layout.nodes, {
      width: layout.width,
      height: layout.height,
      frames: layout.packages,
      existing: others,
      crossingCost: REROUTE_CROSSING_COST,
      sharedLaneCost: REROUTE_SHARED_LANE_COST,
    });
    const group = (pts: (i: number) => Point[]): Point[][] => members.map(pts);
    const otherLines = others.map((o) => o.points);
    const before = crossingTotal(group((i) => polylines[i]), otherLines);
    const next = (i: number): Point[] => routed.get(String(i)) ?? polylines[i];
    const after = crossingTotal(group(next), otherLines);
    if (after > before + REROUTE_CROSSING_BUDGET) continue;
    const crowdBefore = group((i) => polylines[i]).reduce((n, g) => n + otherLines.reduce((m, o) => m + crowdedSegments(g, o), 0), 0);
    const crowdAfter = group(next).reduce((n, g) => n + otherLines.reduce((m, o) => m + crowdedSegments(g, o), 0), 0);
    if (crowdAfter > crowdBefore * 1.25 + 2) continue;
    const saved = members.map((i) => polylines[i]);
    members.forEach((i) => (polylines[i] = next(i)));
    const stillCombed = findParallelBundles(snapshot()).some((b) => b.node === comb.node && b.end === comb.end);
    if (stillCombed) {
      members.forEach((i, k) => (polylines[i] = saved[k]));
      continue;
    }
    changed = true;
  }
  return changed;
}

function crossingTotal(group: Point[][], others: Point[][]): number {
  let n = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) n += polylineCrossings(group[i], group[j]);
    for (const o of others) n += polylineCrossings(group[i], o);
  }
  return n;
}

type Dir = 'N' | 'S' | 'E' | 'W';
/** Tie-break order between sides (vertical trunks first). */
const DIRS: Dir[] = ['S', 'N', 'E', 'W'];

/** Gap (px) that must separate two nodes for one to count as lying "beyond" the other. */
const FACING_GAP = MIN_TRUNK + MIN_BRANCH_GAP;

/** Sides of `here` that `far` lies beyond by a clear gap (none when they overlap in both axes). */
function facing(here: NodeLayout, far: NodeLayout): Dir[] {
  const out: Dir[] = [];
  if (far.y >= here.y + here.height + FACING_GAP) out.push('S');
  if (far.y + far.height <= here.y - FACING_GAP) out.push('N');
  if (far.x >= here.x + here.width + FACING_GAP) out.push('E');
  if (far.x + far.width <= here.x - FACING_GAP) out.push('W');
  return out;
}

/** Rewritten members of one group (the ones a clear tree route exists for), or undefined. */
function mergeGroup(
  members: Oriented[],
  dir: Dir,
  layout: LayoutResult,
  polylines: Point[][],
  end: 'source' | 'target',
): Oriented[] | undefined {
  const edges = layout.edges;
  const nodes = layout.nodes;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const vertical = dir === 'N' || dir === 'S';
  // Work in (along, cross) coordinates so one code path serves all four directions.
  const along = (p: Point): number => (vertical ? p.y : p.x);
  const cross = (p: Point): number => (vertical ? p.x : p.y);
  const make = (a: number, c: number): Point => (vertical ? { x: c, y: a } : { x: a, y: c });
  const sign = dir === 'S' || dir === 'E' ? 1 : -1;
  const here = nodeById.get(edges[members[0].edge][end])!;
  const border = dir === 'S' ? here.y + here.height : dir === 'N' ? here.y : dir === 'E' ? here.x + here.width : here.x;
  const orient = (pts: Point[]): Point[] => (end === 'source' ? pts : pts.slice().reverse());

  // The far node of each member and the near face / cross range it presents.
  interface Far {
    m: Oriented;
    face: number;
    lo: number;
    hi: number;
    origin: number;
  }
  const fars: Far[] = [];
  const startAlong = sign * border;
  for (const m of members) {
    const e = edges[m.edge];
    const node = nodeById.get(end === 'source' ? e.target : e.source);
    if (!node) continue;
    const near = vertical ? (sign > 0 ? node.y : node.y + node.height) : sign > 0 ? node.x : node.x + node.width;
    const lo = vertical ? node.x : node.y;
    const hi = vertical ? node.x + node.width : node.y + node.height;
    const last = m.points[m.points.length - 1];
    fars.push({ m, face: sign * near, lo: lo + DROP_INSET, hi: hi - DROP_INSET, origin: cross(last) });
  }
  const ahead = fars.filter((f) => f.face - startAlong >= MIN_TRUNK + MIN_BRANCH_GAP && f.hi >= f.lo);
  if (ahead.length < TRUNK_MIN_EDGES) return undefined;

  // The trunk leaves the node level with where most of its targets lie.
  const centres = ahead.map((f) => (f.lo + f.hi) / 2).sort((a, b) => a - b);
  const hereLo = (vertical ? here.x : here.y) + DROP_INSET;
  const hereHi = (vertical ? here.x + here.width : here.y + here.height) - DROP_INSET;
  const trunk = hereLo <= hereHi ? clamp(centres[(centres.length - 1) >> 1], hereLo, hereHi) : (hereLo + hereHi) / 2;
  const nearest = Math.min(...ahead.map((f) => f.face));
  const levels = [BRANCH_GAP, MIN_BRANCH_GAP, BRANCH_GAP + 12, BRANCH_GAP + 24, BRANCH_GAP + 36, BRANCH_GAP + 48]
    .map((gap) => nearest - gap)
    .filter((l) => l >= startAlong + MIN_TRUNK);

  const before = (picked: Oriented[]): Quality =>
    quality(picked.map((m) => orient(m.points)), others(picked), edges, picked, layout);
  const others = (picked: Oriented[]): Point[][] => {
    const taken = new Set(picked.map((m) => m.edge));
    return polylines.filter((_, i) => !taken.has(i));
  };

  for (const level of levels) {
    const L = sign * level;
    const out: Oriented[] = [];
    for (const f of ahead) {
      if (f.face <= level + 1) continue;
      const startPoint = make(border, trunk);
      const faceAlong = sign * f.face;
      // Candidate drop columns: where the old route arrived, the middle, then a sweep.
      const mid = (f.lo + f.hi) / 2;
      const columns = [clamp(f.origin, f.lo, f.hi), clamp(trunk, f.lo, f.hi), mid];
      for (let c = f.lo; c <= f.hi; c += DROP_STEP) columns.push(c);
      columns.sort((a, b) => Math.abs(a - f.origin) - Math.abs(b - f.origin));
      for (const column of new Set(columns)) {
        const points = dropCollinear(dropRepeats([startPoint, make(L, trunk), make(L, column), make(faceAlong, column)]));
        if (clearOfNodes(points, edges[f.m.edge], nodes)) {
          out.push({ edge: f.m.edge, points });
          break;
        }
      }
    }
    if (out.length < TRUNK_MIN_EDGES) continue;
    const original = out.map((o) => members.find((m) => m.edge === o.edge)!);
    const prior = before(original);
    const after = quality(out.map((o) => orient(o.points)), others(out), edges, out, layout);
    if (after.crossings <= prior.crossings && after.frames <= prior.frames && after.crowding <= prior.crowding) return out;
  }
  return undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface Quality {
  /** Crossings among the group and between the group and every other edge. */
  crossings: number;
  /** (edge, frame) pairs where an edge runs through a frame neither end sits in. */
  frames: number;
  /** Group segments lying close to (but not on) a foreign edge's parallel segment. */
  crowding: number;
}

function quality(
  group: Point[][],
  others: Point[][],
  edges: LayoutResult['edges'],
  members: Oriented[],
  layout: LayoutResult,
): Quality {
  let crossings = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) crossings += polylineCrossings(group[i], group[j]);
    for (const o of others) crossings += polylineCrossings(group[i], o);
  }
  let frames = 0;
  const frameRects = layout.packages ?? [];
  members.forEach((m, k) => {
    const edge = edges[m.edge];
    const ends = [layout.nodes.find((n) => n.id === edge.source), layout.nodes.find((n) => n.id === edge.target)];
    for (const f of frameRects) {
      const own = ends.some((n) => n && n.x + n.width / 2 > f.x && n.x + n.width / 2 < f.x + f.width && n.y + n.height / 2 > f.y && n.y + n.height / 2 < f.y + f.height);
      if (!own && polylineRunsInsideRect(group[k], f)) frames++;
    }
  });
  let crowding = 0;
  for (const g of group) for (const o of others) crowding += crowdedSegments(g, o);
  return { crossings, frames, crowding };
}

function segs(points: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]]);
  return out;
}

function polylineCrossings(a: Point[], b: Point[]): number {
  let n = 0;
  for (const [p, q] of segs(a)) {
    for (const [r, t] of segs(b)) {
      const pv = Math.abs(p.x - q.x) < 1e-6;
      const rv = Math.abs(r.x - t.x) < 1e-6;
      if (pv === rv) continue;
      const [v0, v1, h0, h1] = pv ? [p, q, r, t] : [r, t, p, q];
      if (
        v0.x > Math.min(h0.x, h1.x) + 1e-6 && v0.x < Math.max(h0.x, h1.x) - 1e-6 &&
        h0.y > Math.min(v0.y, v1.y) + 1e-6 && h0.y < Math.max(v0.y, v1.y) - 1e-6
      ) n++;
    }
  }
  return n;
}

/** Pairs of parallel segments up to 10 px apart (or on top of each other) that share a run of at least 20 px. */
function crowdedSegments(a: Point[], b: Point[]): number {
  let n = 0;
  for (const [p, q] of segs(a)) {
    for (const [r, t] of segs(b)) {
      const horizontal = Math.abs(p.y - q.y) < 1e-6;
      if (horizontal !== (Math.abs(r.y - t.y) < 1e-6)) continue;
      if (!horizontal && (Math.abs(p.x - q.x) > 1e-6 || Math.abs(r.x - t.x) > 1e-6)) continue;
      const lateral = horizontal ? Math.abs(p.y - r.y) : Math.abs(p.x - r.x);
      if (lateral > CROWD_DISTANCE) continue;
      const [a0, a1] = horizontal ? [p.x, q.x] : [p.y, q.y];
      const [b0, b1] = horizontal ? [r.x, t.x] : [r.y, t.y];
      if (Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1)) >= 20) n++;
    }
  }
  return n;
}

function polylineRunsInsideRect(points: Point[], r: { x: number; y: number; width: number; height: number }): boolean {
  for (const [a, b] of segs(points)) {
    if (Math.abs(a.y - b.y) < 1e-6) {
      if (a.y > r.y && a.y < r.y + r.height && Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x) >= 4) return true;
    } else if (Math.abs(a.x - b.x) < 1e-6) {
      if (a.x > r.x && a.x < r.x + r.width && Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y) >= 4) return true;
    }
  }
  return false;
}

/** True when no segment of `points` passes through a node other than the edge's own endpoints. */
function clearOfNodes(points: Point[], edge: { source: string; target: string }, nodes: NodeLayout[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const x0 = Math.min(points[i].x, points[i + 1].x);
    const x1 = Math.max(points[i].x, points[i + 1].x);
    const y0 = Math.min(points[i].y, points[i + 1].y);
    const y1 = Math.max(points[i].y, points[i + 1].y);
    for (const n of nodes) {
      if (n.id === edge.source || n.id === edge.target) continue;
      if (
        x1 > n.x - NODE_CLEARANCE &&
        x0 < n.x + n.width + NODE_CLEARANCE &&
        y1 > n.y - NODE_CLEARANCE &&
        y0 < n.y + n.height + NODE_CLEARANCE
      ) {
        return false;
      }
    }
  }
  return true;
}

function dropRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || Math.abs(p.x - points[i - 1].x) > 1e-6 || Math.abs(p.y - points[i - 1].y) > 1e-6);
}

function dropCollinear(points: Point[]): Point[] {
  const out = points.slice();
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if ((Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) || (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6)) {
      out.splice(i, 1);
    }
  }
  return out;
}
