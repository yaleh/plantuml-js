/**
 * Grid-based orthogonal edge router.
 *
 * ELK's hierarchical routing only resolves edges inside one layered run, and a
 * layered run cannot keep a large compound graph at a sensible aspect ratio.
 * The compound layout therefore lays blocks out first and hands the edges that
 * cross block boundaries to this router: an A* search on a lattice whose
 * vertices are blocked inside every node rectangle (plus a clearance margin),
 * with a bend penalty and a soft penalty for sharing a lane with an already
 * routed edge so parallel wires spread out instead of stacking.
 *
 * Every returned polyline is axis-aligned, starts and ends on the border of the
 * source/target node, and avoids every other node rectangle unless no path
 * exists (then a plain dog-leg is returned).
 */

import type { NodeLayout, Point } from '../layout.js';

export interface RouteRequest {
  id: string;
  source: NodeLayout;
  target: NodeLayout;
}

export interface GridRouterOptions {
  width: number;
  height: number;
  /** Clearance kept between a wire and any node rectangle, in pixels. */
  margin?: number;
  /** Lattice pitch in pixels; chosen from the canvas area when omitted. */
  pitch?: number;
  /**
   * Package frames. A wire running parallel to a frame border within
   * [[FRAME_CLEARANCE]] px pays [[FRAME_FLUSH_COST]] per step, so lanes keep off
   * the box outline instead of reading as part of it.
   */
  frames?: { x: number; y: number; width: number; height: number }[];
  /**
   * Wires already drawn (not re-routed). Their lanes count as used, so new wires
   * keep off them — except wires with the same source or target, which they may
   * share.
   */
  /** Cost of running along a lane another wire uses; default [[SHARED_LANE_COST]]. */
  sharedLaneCost?: number;
  /** Cost of crossing a used lane at right angles; default [[CROSSING_COST]]. */
  crossingCost?: number;
  /** Rip-up-and-re-route passes after the first routing; default [[RIPUP_PASSES]]. */
  ripupPasses?: number;
  existing?: { source: string; target: string; points: Point[] }[];
}

/** Distance (px) a lane keeps from a package frame border when it can. */
export const FRAME_CLEARANCE = 12;
const FRAME_FLUSH_COST = 5;
/**
 * Extra cost per lattice step through the interior of a package frame that
 * neither endpoint of the wire lives in, so corridors prefer the gutters
 * between frames over cutting through unrelated packages.
 */
export const FOREIGN_FRAME_COST = 7;

const BEND_COST = 3;
const SHARED_LANE_COST = 2;
const CROSSING_COST = 1.5;
/**
 * Cost of a step along a lane already used by a wire with the same source (or
 * the same target), against 1 for a fresh step: fan-outs grow a shared trunk
 * instead of spreading into a comb of parallel staircases.
 */
const GROUP_LANE_COST = 0.4;
/** Re-routing passes over the wires that still cross others, and how many wires a pass lifts at most. */
const RIPUP_PASSES = 3;
const RIPUP_MAX = 400;

/** Search window around a wire's two nodes: at least this many px beyond them, or this fraction of their span. */
const WINDOW_MIN = 240;
const WINDOW_FRACTION = 0.3;

/** Direction indices: 0 up, 1 right, 2 down, 3 left. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

interface Terminal {
  /** Lattice vertex index. */
  vertex: number;
  /** Border point the wire attaches to. */
  border: Point;
  /** Direction of travel leaving the node through this terminal. */
  outward: number;
}

/** Binary min-heap keyed by priority, over parallel typed arrays. */
class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    const keys = this.keys;
    const values = this.values;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  /** Remove the minimum; returns its value (priority is read via [[lastKey]]). */
  pop(): number {
    const keys = this.keys;
    const values = this.values;
    const topValue = values[0];
    this.lastKey = keys[0];
    const key = keys.pop()!;
    const value = values.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return topValue;
  }

  lastKey = 0;
}

/** Lanes one pitch apart must clear the near-parallel proximity (8 px) so they read as distinct lines. */
const MIN_PITCH = 9;

function choosePitch(width: number, height: number): number {
  const area = Math.max(1, width * height);
  return Math.min(20, Math.max(MIN_PITCH, Math.round(Math.sqrt(area / 250000))));
}

/**
 * Route every request. Returns a polyline per request id; requests whose
 * endpoints are the same node get an empty polyline.
 */
export function routeOrthogonal(
  requests: RouteRequest[],
  obstacles: NodeLayout[],
  options: GridRouterOptions,
): Map<string, Point[]> {
  const margin = options.margin ?? 6;
  const crossingCost = options.crossingCost ?? CROSSING_COST;
  const sharedLaneCost = options.sharedLaneCost ?? SHARED_LANE_COST;
  const pitch = options.pitch ?? choosePitch(options.width, options.height);
  const cols = Math.ceil(options.width / pitch) + 1;
  const rows = Math.ceil(options.height / pitch) + 1;
  const vertexCount = cols * rows;

  // Blocked lattice vertices: strictly inside any node rectangle grown by the margin.
  const blocked = new Uint8Array(vertexCount);
  for (const node of obstacles) {
    const c0 = Math.max(0, Math.floor((node.x - margin) / pitch) + 1);
    const c1 = Math.min(cols - 1, Math.ceil((node.x + node.width + margin) / pitch) - 1);
    const r0 = Math.max(0, Math.floor((node.y - margin) / pitch) + 1);
    const r1 = Math.min(rows - 1, Math.ceil((node.y + node.height + margin) / pitch) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
    }
  }

  // Lattice vertices hugging a frame border; `nearV` marks vertical sides (x),
  // `nearH` horizontal ones (y). Only moves *along* the side are penalised.
  const nearV = new Uint8Array(vertexCount);
  const nearH = new Uint8Array(vertexCount);
  for (const f of options.frames ?? []) {
    const markCols = (x: number, y0: number, y1: number): void => {
      const c0 = Math.max(0, Math.ceil((x - FRAME_CLEARANCE) / pitch));
      const c1 = Math.min(cols - 1, Math.floor((x + FRAME_CLEARANCE) / pitch));
      const r0 = Math.max(0, Math.ceil(y0 / pitch));
      const r1 = Math.min(rows - 1, Math.floor(y1 / pitch));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) nearV[r * cols + c] = 1;
    };
    const markRows = (y: number, x0: number, x1: number): void => {
      const r0 = Math.max(0, Math.ceil((y - FRAME_CLEARANCE) / pitch));
      const r1 = Math.min(rows - 1, Math.floor((y + FRAME_CLEARANCE) / pitch));
      const c0 = Math.max(0, Math.ceil(x0 / pitch));
      const c1 = Math.min(cols - 1, Math.floor(x1 / pitch));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) nearH[r * cols + c] = 1;
    };
    markCols(f.x, f.y, f.y + f.height);
    markCols(f.x + f.width, f.y, f.y + f.height);
    markRows(f.y, f.x, f.x + f.width);
    markRows(f.y + f.height, f.x, f.x + f.width);
  }

  // Deepest package frame whose interior holds each lattice vertex (-1 = none).
  // Frames nest, so painting larger frames first lets smaller ones overwrite.
  const frameList = options.frames ?? [];
  const frameOf = new Int32Array(vertexCount).fill(-1);
  frameList
    .map((f, index) => ({ f, index }))
    .sort((a, b) => b.f.width * b.f.height - a.f.width * a.f.height || a.index - b.index)
    .forEach(({ f, index }) => {
      const c0 = Math.max(0, Math.floor((f.x + 2) / pitch) + 1);
      const c1 = Math.min(cols - 1, Math.ceil((f.x + f.width - 2) / pitch) - 1);
      const r0 = Math.max(0, Math.floor((f.y + 2) / pitch) + 1);
      const r1 = Math.min(rows - 1, Math.ceil((f.y + f.height - 2) / pitch) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) frameOf[r * cols + c] = index;
    });
  /** Frames holding the centre of `node`: the ones a wire to or from it may cross freely. */
  const framesAround = (node: NodeLayout): number[] => {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const out: number[] = [];
    frameList.forEach((f, index) => {
      if (cx > f.x && cx < f.x + f.width && cy > f.y && cy < f.y + f.height) out.push(index);
    });
    return out;
  };

  const stateCount = vertexCount * 4;
  const hCol = new Float32Array(cols);
  const hRow = new Float32Array(rows);
  const goalStamp = new Int32Array(vertexCount);
  const ownFrames = new Uint8Array(frameList.length);
  const gScore = new Float32Array(stateCount);
  const stamp = new Int32Array(stateCount);
  const parent = new Int32Array(stateCount);
  // Wires through each lattice vertex, per axis (counts, so a wire can be lifted again).
  const usedH = new Uint16Array(vertexCount);
  const usedV = new Uint16Array(vertexCount);
  // Who used each lane: the source (src*) and target (dst*) node index + 1 of the
  // wires through the vertex, or -1 once wires with different ends share it.
  const srcH = new Int32Array(vertexCount);
  const srcV = new Int32Array(vertexCount);
  const dstH = new Int32Array(vertexCount);
  const dstV = new Int32Array(vertexCount);
  const nodeIndex = new Map<string, number>();
  const indexOf = (node: { id: string }): number => {
    let i = nodeIndex.get(node.id);
    if (i === undefined) nodeIndex.set(node.id, (i = nodeIndex.size + 1));
    return i;
  };
  const claim = (owners: Int32Array, vertex: number, who: number): void => {
    const cur = owners[vertex];
    if (cur === 0) owners[vertex] = who;
    else if (cur !== who) owners[vertex] = -1;
  };
  for (const wire of options.existing ?? []) {
    const src = indexOf({ id: wire.source });
    const dst = indexOf({ id: wire.target });
    for (let i = 0; i + 1 < wire.points.length; i++) {
      const a = wire.points[i];
      const b = wire.points[i + 1];
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      if (!horizontal && Math.abs(a.x - b.x) > 1e-6) continue;
      const mark = horizontal ? usedH : usedV;
      const srcOwners = horizontal ? srcH : srcV;
      const dstOwners = horizontal ? dstH : dstV;
      const fixed = Math.round((horizontal ? a.y : a.x) / pitch);
      const from = Math.round(Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y) / pitch);
      const to = Math.round(Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y) / pitch);
      for (let k = from; k <= to; k++) {
        const c = horizontal ? k : fixed;
        const r = horizontal ? fixed : k;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const v = r * cols + c;
        mark[v]++;
        claim(srcOwners, v, src);
        claim(dstOwners, v, dst);
      }
    }
  }
  let generation = 0;

  const terminalsOf = (node: NodeLayout): Terminal[] => {
    const out: Terminal[] = [];
    const addVertex = (c: number, r: number, border: Point, outward: number): void => {
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const vertex = r * cols + c;
      if (blocked[vertex]) return;
      out.push({ vertex, border, outward });
    };
    const colLo = Math.ceil((node.x + 4) / pitch);
    const colHi = Math.floor((node.x + node.width - 4) / pitch);
    const rowLo = Math.ceil((node.y + 4) / pitch);
    const rowHi = Math.floor((node.y + node.height - 4) / pitch);
    const topRow = Math.floor((node.y - margin) / pitch);
    const bottomRow = Math.ceil((node.y + node.height + margin) / pitch);
    const leftCol = Math.floor((node.x - margin) / pitch);
    const rightCol = Math.ceil((node.x + node.width + margin) / pitch);
    for (let c = colLo; c <= colHi; c++) {
      addVertex(c, topRow, { x: c * pitch, y: node.y }, 0);
      addVertex(c, bottomRow, { x: c * pitch, y: node.y + node.height }, 2);
    }
    for (let r = rowLo; r <= rowHi; r++) {
      addVertex(rightCol, r, { x: node.x + node.width, y: r * pitch }, 1);
      addVertex(leftCol, r, { x: node.x, y: r * pitch }, 3);
    }
    return out;
  };

  const sorted = requests
    .map((request, index) => ({ request, index }))
    .sort((a, b) => {
      const da = manhattan(a.request.source, a.request.target);
      const db = manhattan(b.request.source, b.request.target);
      return da - db || a.index - b.index;
    });

  const result = new Map<string, Point[]>();
  const routed = new Map<string, { request: RouteRequest; vertices: number[] }>();
  for (const { request } of sorted) {
    if (request.source.id === request.target.id) {
      result.set(request.id, []);
      continue;
    }
    const path = routeOne(request);
    if (path) {
      mark(path.vertices, request, 1);
      routed.set(request.id, { request, vertices: path.vertices });
    }
    result.set(request.id, path?.points ?? dogLeg(request.source, request.target));
  }

  // Rip-up and re-route: wires that still cross others are lifted one at a time
  // and routed again against everything else, which can only keep or lower
  // their lattice cost. Crossings with the fixed (`existing`) wires count too.
  const passes = options.ripupPasses ?? RIPUP_PASSES;
  let lastTotal = Infinity;
  for (let pass = 0; pass < passes && routed.size > 0; pass++) {
    const ids = [...routed.keys()];
    const lines = ids.map((id) => result.get(id)!);
    const fixed = (options.existing ?? []).map((w) => w.points);
    const counts = crossingCounts(lines, fixed);
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (total >= lastTotal) break;
    lastTotal = total;
    const order = ids
      .map((id, i) => ({ id, n: counts[i] }))
      .filter((c) => c.n > 0)
      .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1))
      .slice(0, RIPUP_MAX);
    if (order.length === 0) break;
    for (const { id } of order) {
      const entry = routed.get(id)!;
      mark(entry.vertices, entry.request, -1);
      const path = routeOne(entry.request);
      if (path) {
        mark(path.vertices, entry.request, 1);
        entry.vertices = path.vertices;
        result.set(id, path.points);
      } else {
        mark(entry.vertices, entry.request, 1);
      }
    }
  }
  return result;

  /** Add (+1) or remove (−1) a route's lane usage; ownership is only ever claimed. */
  function mark(vertices: number[], request: RouteRequest, delta: 1 | -1): void {
    const srcId = indexOf(request.source);
    const dstId = indexOf(request.target);
    for (let i = 0; i + 1 < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[i + 1];
      const horizontal = Math.abs(a - b) === 1;
      const lane = horizontal ? usedH : usedV;
      lane[a] += delta;
      lane[b] += delta;
      if (delta > 0) {
        const srcOwners = horizontal ? srcH : srcV;
        const dstOwners = horizontal ? dstH : dstV;
        claim(srcOwners, a, srcId);
        claim(srcOwners, b, srcId);
        claim(dstOwners, a, dstId);
        claim(dstOwners, b, dstId);
      }
    }
  }

  /** Route inside a window around the two nodes first (fast); the whole lattice only if that finds nothing. */
  function routeOne(request: RouteRequest): { points: Point[]; vertices: number[] } | undefined {
    const { source, target } = request;
    const x0 = Math.min(source.x, target.x);
    const x1 = Math.max(source.x + source.width, target.x + target.width);
    const y0 = Math.min(source.y, target.y);
    const y1 = Math.max(source.y + source.height, target.y + target.height);
    const reach = Math.max(WINDOW_MIN, WINDOW_FRACTION * Math.max(x1 - x0, y1 - y0));
    const window = {
      c0: Math.max(0, Math.floor((x0 - reach) / pitch)),
      c1: Math.min(cols - 1, Math.ceil((x1 + reach) / pitch)),
      r0: Math.max(0, Math.floor((y0 - reach) / pitch)),
      r1: Math.min(rows - 1, Math.ceil((y1 + reach) / pitch)),
    };
    const whole = window.c0 === 0 && window.r0 === 0 && window.c1 === cols - 1 && window.r1 === rows - 1;
    return searchPath(request, window) ?? (whole ? undefined : searchPath(request, { c0: 0, r0: 0, c1: cols - 1, r1: rows - 1 }));
  }

  function searchPath(
    request: RouteRequest,
    win: { c0: number; c1: number; r0: number; r1: number },
  ): { points: Point[]; vertices: number[] } | undefined {
    const starts = terminalsOf(request.source);
    const goals = terminalsOf(request.target);
    if (starts.length === 0 || goals.length === 0) return undefined;

    generation++;
    const goalsByVertex = new Map<number, Terminal[]>();
    for (const goal of goals) {
      const list = goalsByVertex.get(goal.vertex);
      if (list) list.push(goal);
      else goalsByVertex.set(goal.vertex, [goal]);
    }

    // Manhattan distance to the target box, split per column and per row.
    const tx0 = request.target.x;
    const tx1 = request.target.x + request.target.width;
    const ty0 = request.target.y;
    const ty1 = request.target.y + request.target.height;
    for (let c = 0; c < cols; c++) {
      const x = c * pitch;
      hCol[c] = Math.max(0, tx0 - x, x - tx1) / pitch;
    }
    for (let r = 0; r < rows; r++) {
      const y = r * pitch;
      hRow[r] = Math.max(0, ty0 - y, y - ty1) / pitch;
    }
    for (const goal of goals) goalStamp[goal.vertex] = generation;
    const heuristic = (vertex: number): number => {
      const c = vertex % cols;
      return hCol[c] + hRow[(vertex - c) / cols];
    };

    const srcId = indexOf(request.source);
    const dstId = indexOf(request.target);
    ownFrames.fill(0);
    for (const f of framesAround(request.source)) ownFrames[f] = 1;
    for (const f of framesAround(request.target)) ownFrames[f] = 1;

    const heap = new MinHeap();
    // Goal entries are encoded as stateCount + index into `goalEntries`.
    const goalEntries: { state: number; terminal: Terminal }[] = [];

    const startOf = new Map<number, Terminal>();
    for (const start of starts) {
      const state = start.vertex * 4 + start.outward;
      if (stamp[state] === generation && gScore[state] <= 0) continue;
      stamp[state] = generation;
      gScore[state] = 0;
      parent[state] = -1;
      startOf.set(state, start);
      heap.push(heuristic(start.vertex), state);
    }

    let found: { state: number; terminal: Terminal } | undefined;
    while (heap.size > 0) {
      const entry = heap.pop();
      const lastKey = heap.lastKey;
      if (entry >= stateCount) {
        found = goalEntries[entry - stateCount];
        break;
      }
      const state = entry;
      const g = gScore[state];
      if (lastKey > g + heuristic(state >> 2) + 1e-6) continue; // stale entry
      const vertex = state >> 2;
      const dir = state & 3;

      const here = goalStamp[vertex] === generation ? goalsByVertex.get(vertex) : undefined;
      if (here) {
        for (const terminal of here) {
          // Arriving head-on (moving opposite to the terminal's outward side) is free.
          const inward = (terminal.outward + 2) & 3;
          const total = g + (dir === inward ? 0 : BEND_COST);
          goalEntries.push({ state, terminal });
          heap.push(total, stateCount + goalEntries.length - 1);
        }
      }

      const c = vertex % cols;
      const r = (vertex - c) / cols;
      for (let nd = 0; nd < 4; nd++) {
        if (((nd + 2) & 3) === dir) continue; // no U-turns
        const nc = c + DX[nd];
        const nr = r + DY[nd];
        if (nc < win.c0 || nr < win.r0 || nc > win.c1 || nr > win.r1) continue;
        const nv = nr * cols + nc;
        if (blocked[nv]) continue;
        let step = 1;
        if (nd !== dir) step += BEND_COST;
        if (nd & 1 ? nearH[nv] : nearV[nv]) step += FRAME_FLUSH_COST;
        const fo = frameOf[nv];
        if (fo >= 0 && ownFrames[fo] === 0) step += FOREIGN_FRAME_COST;
        if (nd & 1) {
          if (usedH[nv]) {
            if (srcH[nv] === srcId || dstH[nv] === dstId) step = Math.min(step, step - 1 + GROUP_LANE_COST);
            else step += sharedLaneCost;
          }
          if (usedV[nv]) step += crossingCost;
        } else {
          if (usedV[nv]) {
            if (srcV[nv] === srcId || dstV[nv] === dstId) step = Math.min(step, step - 1 + GROUP_LANE_COST);
            else step += sharedLaneCost;
          }
          if (usedH[nv]) step += crossingCost;
        }
        const ns = nv * 4 + nd;
        const ng = g + step;
        if (stamp[ns] === generation && gScore[ns] <= ng) continue;
        stamp[ns] = generation;
        gScore[ns] = ng;
        parent[ns] = state;
        heap.push(ng + heuristic(nv), ns);
      }
    }
    if (!found) return undefined;

    // Walk parents back to a start terminal.
    const vertices: number[] = [];
    let state = found.state;
    let startTerminal: Terminal | undefined;
    for (;;) {
      vertices.push(state >> 2);
      const p = parent[state];
      if (p < 0) {
        startTerminal = startOf.get(state);
        break;
      }
      state = p;
    }
    vertices.reverse();
    if (!startTerminal) return undefined;

    const points: Point[] = [startTerminal.border];
    for (const v of vertices) {
      points.push({ x: (v % cols) * pitch, y: Math.floor(v / cols) * pitch });
    }
    points.push(found.terminal.border);
    return { points: simplify(points), vertices };
  }
}

/**
 * For each of `lines`, the number of proper crossings with every other line in
 * `lines` and with the static `fixed` wires (axis-aligned segments only).
 */
function crossingCounts(lines: Point[][], fixed: Point[][]): number[] {
  interface Seg {
    owner: number;
    horizontal: boolean;
    c: number;
    lo: number;
    hi: number;
  }
  const segs: Seg[] = [];
  const add = (pts: Point[], owner: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a.y - b.y) < 1e-6) segs.push({ owner, horizontal: true, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      else if (Math.abs(a.x - b.x) < 1e-6) segs.push({ owner, horizontal: false, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  };
  lines.forEach((pts, i) => add(pts, i));
  fixed.forEach((pts) => add(pts, -1));
  const horizontals = segs.filter((s) => s.horizontal).sort((a, b) => a.c - b.c);
  const verticals = segs.filter((s) => !s.horizontal);
  const counts = lines.map(() => 0);
  for (const v of verticals) {
    // First horizontal with c > v.lo (binary search), then scan while c < v.hi.
    let lo = 0;
    let hi = horizontals.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (horizontals[mid].c <= v.lo + 1e-6) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < horizontals.length && horizontals[k].c < v.hi - 1e-6; k++) {
      const h = horizontals[k];
      if (h.owner === v.owner || h.lo >= v.c - 1e-6 || h.hi <= v.c + 1e-6) continue;
      if (v.owner >= 0) counts[v.owner]++;
      if (h.owner >= 0) counts[h.owner]++;
    }
  }
  return counts;
}

function manhattan(a: NodeLayout, b: NodeLayout): number {
  return (
    Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) +
    Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))
  );
}

/** Drop repeated and collinear interior points. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01;
    const sameY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01;
    if (sameX || sameY) out.splice(i, 1);
  }
  return out;
}

/** Last-resort orthogonal route when the lattice search finds no path. */
function dogLeg(source: NodeLayout, target: NodeLayout): Point[] {
  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const vertical = source.y + source.height <= target.y || target.y + target.height <= source.y;
  if (vertical) {
    const down = ty > sy;
    const y0 = down ? source.y + source.height : source.y;
    const y1 = down ? target.y : target.y + target.height;
    const mid = (y0 + y1) / 2;
    return simplify([
      { x: sx, y: y0 },
      { x: sx, y: mid },
      { x: tx, y: mid },
      { x: tx, y: y1 },
    ]);
  }
  const right = tx > sx;
  const x0 = right ? source.x + source.width : source.x;
  const x1 = right ? target.x : target.x + target.width;
  const mid = (x0 + x1) / 2;
  return simplify([
    { x: x0, y: sy },
    { x: mid, y: sy },
    { x: mid, y: ty },
    { x: x1, y: ty },
  ]);
}
