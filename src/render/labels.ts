/**
 * Edge-label and hub-badge geometry shared by the SVG renderer and the layout
 * metrics, so a drawn label and a measured label are the same rectangle.
 *
 * Weight labels (`×N`) are placed on the edge itself over a white backing box.
 * Candidate anchors run along the edge's segments, longest first; the first
 * candidate that collides with no node and no previously placed label wins, so
 * labels of neighbouring edges do not pile onto each other.
 */

import { PlantUmlModel, PlantUmlEntity } from '../model.js';
import { LayoutResult, NodeLayout, METRICS, Point, displayName } from '../layout.js';
import { nodeRect, Rect } from '../edge-router.js';
import { measureTextWidth } from '../text-measure.js';

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

/** Where the plain `rel.label` text sits (unchanged: above the middle point). */
function plainLabelRect(text: string, points: Point[]): Rect {
  const mid = points[Math.floor(points.length / 2)];
  const width = measureTextWidth(text, 12);
  return { x: mid.x - width / 2, y: mid.y - 10 - 12 + 2, width, height: 14 };
}

/** Place every weight label and collect every plain edge label, deterministically. */
export function placeEdgeLabels(model: PlantUmlModel, layout: LayoutResult): EdgeLabelPlacement[] {
  const edgesById = new Map((layout.edges ?? []).map((e) => [e.id, e]));
  const nodeRects = layout.nodes.map(nodeRect);
  const out: EdgeLabelPlacement[] = [];

  const placed: Rect[] = [];
  // A plain label must not sit on a node box. The classic spot (above the middle
  // vertex) is tried first, then positions along the edge's segments; a label
  // that fits nowhere is left out (the renderer keeps it as a `<title>` tooltip).
  model.relations.forEach((rel, edge) => {
    const points = edgesById.get(`rel-${edge}`)?.points;
    if (!points || points.length < 2 || !rel.label) return;
    const width = measureTextWidth(rel.label, 12);
    const candidates = [
      plainLabelRect(rel.label, points),
      ...labelCandidates(points, width, 14).map((r) => ({ ...r, y: r.y - 10 })),
      ...labelCandidates(points, width, 14),
    ];
    const free = candidates.find(
      (rect) =>
        !nodeRects.some((n) => rectsIntersect(rect, n)) &&
        !placed.some((p) => rectsIntersect(rect, p)),
    );
    if (!free) return;
    placed.push(free);
    out.push({ edge, kind: 'label', text: rel.label, rect: free });
  });

  model.relations.forEach((rel, edge) => {
    const points = edgesById.get(`rel-${edge}`)?.points;
    if (!points || points.length < 2 || !rel.weight || rel.weight <= 1) return;
    const text = `×${rel.weight}`;
    const width = measureTextWidth(text, EDGE_LABEL_FONT_SIZE) + EDGE_LABEL_PAD_X * 2;
    const candidates = labelCandidates(points, width, EDGE_LABEL_HEIGHT);
    const free = candidates.find(
      (rect) =>
        !nodeRects.some((n) => rectsIntersect(rect, n)) &&
        !placed.some((p) => rectsIntersect(rect, p)),
    );
    const rect = free ?? candidates[0];
    placed.push(rect);
    out.push({ edge, kind: 'weight', text, rect });
  });
  return out;
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
