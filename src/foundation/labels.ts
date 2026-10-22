/**
 * Edge-label and hub-badge geometry shared by the SVG renderer and the layout
 * metrics, so a drawn label and a measured label are the same rectangle.
 *
 * Weight labels (`×N`) are placed on the edge itself over a white backing box.
 * Candidate anchors run along the edge's segments, longest first; the first
 * candidate that collides with no node and no previously placed label wins, so
 * labels of neighbouring edges do not pile onto each other.
 */

import { PlantUmlModel, PlantUmlEntity } from './model.js';
import { LayoutResult, NodeLayout, METRICS, Point, displayName } from './layout.js';
import { nodeRect, Rect } from './edge-router.js';
import { measureTextWidth } from './text-measure.js';

export const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_LABEL_PAD_X = 3;
const EDGE_LABEL_HEIGHT = 14;
/** Fractions along a segment tried, in order, for a label anchor. */
const ANCHOR_FRACTIONS = [0.5, 0.3, 0.7, 0.15, 0.85];

export const HUB_BADGE_RADIUS = 9;

export interface EdgeLabelPlacement {
  /** Index into `model.relations` (edge id `rel-<index>`). */
  edge: number;
  kind: 'weight' | 'label';
  text: string;
  rect: Rect;
}

/** Hub badge circle: centred on the node's top-right corner, half outside the box. */
export function hubBadgeCircle(node: NodeLayout): { cx: number; cy: number; r: number } {
  return { cx: node.x + node.width, cy: node.y, r: HUB_BADGE_RADIUS };
}

export function hubBadgeRect(node: NodeLayout): Rect {
  const { cx, cy, r } = hubBadgeCircle(node);
  return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
}

/** Bounding boxes of the text lines drawn inside a node (title + members). */
export function entityTextRects(entity: PlantUmlEntity, node: NodeLayout): Rect[] {
  const rects: Rect[] = [];
  const title = measureTextWidth(displayName(entity), METRICS.fontSize);
  rects.push({
    x: node.x + (node.width - title) / 2,
    y: node.y + METRICS.paddingY,
    width: title,
    height: METRICS.lineHeight,
  });
  entity.members.forEach((member, i) => {
    rects.push({
      x: node.x + METRICS.paddingX,
      y: node.y + METRICS.paddingY + METRICS.lineHeight * (i + 1),
      width: measureTextWidth(member.raw, METRICS.fontSize),
      height: METRICS.lineHeight,
    });
  });
  return rects;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Same-text labels sharing a source (or target) and the other end's package collapse to one. */
export const LABEL_DEDUPE_MIN = 3;
/** A collapsed label standing for at least this many edges carries a `×N` count. */
export const LABEL_COUNT_BADGE_MIN = 4;
const PLAIN_LABEL_FONT_SIZE = 12;
const PLAIN_LABEL_HEIGHT = 14;
/** Gap between a beside-the-line label and the line. */
const LABEL_SIDE_GAP = 2;

/** True when the segment ab touches the rectangle (Liang–Barsky clip). */
export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - r.x) &&
    clip(dx, r.x + r.width - a.x) &&
    clip(-dy, a.y - r.y) &&
    clip(dy, r.y + r.height - a.y)
  );
}

/** Edge ids (`rel-<i>`) of every segment of every edge other than `ownId` that crosses `rect`. */
export function rectHitsOtherEdge(rect: Rect, edges: { id: string; points: Point[] }[], ownId: string): boolean {
  for (const e of edges) {
    if (e.id === ownId) continue;
    for (let i = 0; i + 1 < e.points.length; i++) {
      if (segmentIntersectsRect(e.points[i], e.points[i + 1], rect)) return true;
    }
  }
  return false;
}

/**
 * Plain labels that repeat along one bundle (same text, same source — or same
 * target — and the same package at the other end) show on a single
 * representative edge; the rest keep a `<title>` tooltip. Returns the
 * representative index → group size, and the set of suppressed indexes.
 */
function dedupePlainLabels(model: PlantUmlModel): { reps: Map<number, number>; suppressed: Set<number> } {
  const pkgOf = new Map(model.entities.map((e) => [e.id, e.packageId ?? e.id]));
  const reps = new Map<number, number>();
  const suppressed = new Set<number>();
  for (const end of ['source', 'target'] as const) {
    const other = end === 'source' ? 'target' : 'source';
    const groups = new Map<string, number[]>();
    model.relations.forEach((rel, i) => {
      if (!rel.label || suppressed.has(i)) return;
      const key = `${rel[end]}\u0000${rel.label}\u0000${pkgOf.get(rel[other]) ?? rel[other]}`;
      const list = groups.get(key);
      if (list) list.push(i);
      else groups.set(key, [i]);
    });
    for (const g of groups.values()) {
      if (g.length < LABEL_DEDUPE_MIN) continue;
      const total = g.reduce((n, i) => n + (reps.get(i) ?? 1), 0);
      reps.set(g[0], total);
      for (const i of g.slice(1)) {
        suppressed.add(i);
        reps.delete(i);
      }
    }
  }
  return { reps, suppressed };
}

/**
 * Candidate rectangles for a plain label: beside each segment (longest first),
 * offset to either side so the text never sits on its own line.
 */
function plainLabelCandidates(points: Point[], width: number, height: number): Rect[] {
  const segs: { a: Point; b: Point; len: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (len > 0) segs.push({ a: points[i], b: points[i + 1], len });
  }
  segs.sort((p, q) => q.len - p.len);
  const rects: Rect[] = [];
  for (const { a, b } of segs) {
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    for (const t of ANCHOR_FRACTIONS) {
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      for (const side of [-1, 1]) {
        rects.push(
          horizontal
            ? { x: cx - width / 2, y: side < 0 ? cy - LABEL_SIDE_GAP - height : cy + LABEL_SIDE_GAP, width, height }
            : { x: side < 0 ? cx - LABEL_SIDE_GAP - width : cx + LABEL_SIDE_GAP, y: cy - height / 2, width, height },
        );
      }
    }
  }
  return rects;
}

/** Place every weight label and collect every plain edge label, deterministically. */
export function placeEdgeLabels(model: PlantUmlModel, layout: LayoutResult): EdgeLabelPlacement[] {
  const edges = layout.edges ?? [];
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const nodeRects = layout.nodes.map(nodeRect);
  const out: EdgeLabelPlacement[] = [];

  const placed: Rect[] = [];
  const { reps, suppressed } = dedupePlainLabels(model);
  // A plain label sits beside its own edge, clear of every node, every other
  // edge and every earlier label. A label that fits nowhere is left out (the
  // renderer keeps it as a `<title>` tooltip).
  model.relations.forEach((rel, edge) => {
    const points = edgesById.get(`rel-${edge}`)?.points;
    if (!points || points.length < 2 || !rel.label || suppressed.has(edge)) return;
    const count = reps.get(edge) ?? 1;
    const text = count >= LABEL_COUNT_BADGE_MIN ? `${rel.label} ×${count}` : rel.label;
    const width = measureTextWidth(text, PLAIN_LABEL_FONT_SIZE);
    const free = plainLabelCandidates(points, width, PLAIN_LABEL_HEIGHT).find(
      (rect) =>
        !nodeRects.some((n) => rectsIntersect(rect, n)) &&
        !placed.some((p) => rectsIntersect(rect, p)) &&
        !rectHitsOtherEdge(rect, edges, `rel-${edge}`) &&
        !ownEdgeTouches(rect, points),
    );
    if (!free) return;
    placed.push(free);
    out.push({ edge, kind: 'label', text, rect: free });
  });

  model.relations.forEach((rel, edge) => {
    const points = edgesById.get(`rel-${edge}`)?.points;
    if (!points || points.length < 2 || !rel.weight || rel.weight <= 1) return;
    const text = `×${rel.weight}`;
    const width = measureTextWidth(text, EDGE_LABEL_FONT_SIZE) + EDGE_LABEL_PAD_X * 2;
    const candidates = labelCandidates(points, width, EDGE_LABEL_HEIGHT);
    const clear = (rect: Rect): boolean =>
      !nodeRects.some((n) => rectsIntersect(rect, n)) && !placed.some((p) => rectsIntersect(rect, p));
    const free = candidates.find((rect) => clear(rect) && !rectHitsOtherEdge(rect, edges, `rel-${edge}`)) ??
      candidates.find(clear);
    const rect = free ?? candidates[0];
    placed.push(rect);
    out.push({ edge, kind: 'weight', text, rect });
  });
  return out;
}

function ownEdgeTouches(rect: Rect, points: Point[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    if (segmentIntersectsRect(points[i], points[i + 1], rect)) return true;
  }
  return false;
}

function labelCandidates(points: Point[], width: number, height: number): Rect[] {
  const segs: { a: Point; b: Point; len: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segs.push({ a: points[i], b: points[i + 1], len });
  }
  segs.sort((p, q) => q.len - p.len);
  const rects: Rect[] = [];
  for (const { a, b } of segs) {
    for (const t of ANCHOR_FRACTIONS) {
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      rects.push({ x: cx - width / 2, y: cy - height / 2, width, height });
    }
  }
  return rects;
}
