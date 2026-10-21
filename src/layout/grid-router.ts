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
}

const BEND_COST = 3;
const SHARED_LANE_COST = 2;
const CROSSING_COST = 1.5;

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

function choosePitch(width: number, height: number): number {
  const area = Math.max(1, width * height);
  return Math.min(20, Math.max(8, Math.round(Math.sqrt(area / 250000))));
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

  const stateCount = vertexCount * 4;
  const gScore = new Float32Array(stateCount);
  const stamp = new Int32Array(stateCount);
  const parent = new Int32Array(stateCount);
  const usedH = new Uint8Array(vertexCount);
  const usedV = new Uint8Array(vertexCount);
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
  for (const { request } of sorted) {
    if (request.source.id === request.target.id) {
      result.set(request.id, []);
      continue;
    }
    const path = routeOne(request);
    result.set(request.id, path ?? dogLeg(request.source, request.target));
  }
  return result;

  function routeOne(request: RouteRequest): Point[] | undefined {
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

    const tx0 = request.target.x;
    const tx1 = request.target.x + request.target.width;
    const ty0 = request.target.y;
    const ty1 = request.target.y + request.target.height;
    const heuristic = (vertex: number): number => {
      const x = (vertex % cols) * pitch;
      const y = Math.floor(vertex / cols) * pitch;
      const dx = Math.max(0, tx0 - x, x - tx1);
      const dy = Math.max(0, ty0 - y, y - ty1);
      return (dx + dy) / pitch;
    };

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

      const here = goalsByVertex.get(vertex);
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
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nv = nr * cols + nc;
        if (blocked[nv]) continue;
        let step = 1;
        if (nd !== dir) step += BEND_COST;
        if (nd & 1) {
          if (usedH[nv]) step += SHARED_LANE_COST;
          if (usedV[nv]) step += CROSSING_COST;
        } else {
          if (usedV[nv]) step += SHARED_LANE_COST;
          if (usedH[nv]) step += CROSSING_COST;
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

    // Mark lanes as used.
    for (let i = 0; i + 1 < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[i + 1];
      const horizontal = Math.abs(a - b) === 1;
      const mark = horizontal ? usedH : usedV;
      mark[a] = 1;
      mark[b] = 1;
    }

    const points: Point[] = [startTerminal.border];
    for (const v of vertices) {
      points.push({ x: (v % cols) * pitch, y: Math.floor(v / cols) * pitch });
    }
    points.push(found.terminal.border);
    return simplify(points);
  }
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
