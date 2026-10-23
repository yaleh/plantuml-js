/**
 * LayoutEngine — the pluggable layout contract. A LayoutEngine is a pure
 * function from PlantUmlModel to concrete positions; the parser never talks
 * to a layout engine and the renderer never talks to the parser, so swapping
 * engines (ELK, Graphviz, a custom tuner) is an injection, not a rewrite.
 */

import { PlantUmlModel, PlantUmlEntity, PlantUmlMember } from './model.js';
import { measureTextWidth, MONOSPACE_FONT_SIZE } from './text-measure.js';

export interface Point {
  x: number;
  y: number;
}

export interface NodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeLayout {
  id: string;
  source: string;
  target: string;
  points: Point[];
}

export interface PackageLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  /** Package frames; engines without container support may omit this. */
  packages?: PackageLayout[];
  width: number;
  height: number;
}

export interface LayoutEngine {
  layout(model: PlantUmlModel): Promise<LayoutResult>;
}

/** Empty border the canvas keeps around every drawn mark (px). */
export const CANVAS_CONTENT_MARGIN = 16;

/** Axis-aligned rectangle, structurally compatible with `labels`/`edge-router` rects. */
export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Grow and translate a layout so every edge route point and the supplied extra
 * rectangles (edge labels) stays at least `margin` from the canvas side. Routes
 * and labels are drawn from the layout coordinates but are not part of
 * `layout.width`/`height` as produced by the engines, so a label hung beside an
 * outer detour route can sit at a negative x and be clipped by a `0 0 w h`
 * viewBox.
 *
 * Boxes are left alone — the engines already place them inside their own
 * margin — so this never moves a diagram whose routes and labels already fit:
 * the input is returned untouched and the canvas never shrinks.
 */
export function fitLayoutToContent(
  layout: LayoutResult,
  extraRects: readonly ContentRect[] = [],
  margin: number = CANVAS_CONTENT_MARGIN,
): LayoutResult {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const edge of layout.edges ?? []) {
    for (const point of edge.points) take(point.x, point.y);
  }
  for (const rect of extraRects) {
    take(rect.x, rect.y);
    take(rect.x + rect.width, rect.y + rect.height);
  }
  if (minX === Infinity) return layout;

  const dx = Math.max(0, margin - minX);
  const dy = Math.max(0, margin - minY);
  const width = Math.max(layout.width + dx, maxX + dx + margin);
  const height = Math.max(layout.height + dy, maxY + dy + margin);
  if (dx === 0 && dy === 0 && width === layout.width && height === layout.height) {
    return layout;
  }

  return {
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: layout.edges.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    })),
    packages: layout.packages?.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    width,
    height,
  };
}

/**
 * Shared drawing metrics. The renderer reads these so entity sizing and the
 * emitted SVG stay in lockstep: the font family and size are bound to the same
 * monospace advance [[../text-measure]] measures with.
 */
export const METRICS = {
  fontFamily: 'monospace',
  fontSize: MONOSPACE_FONT_SIZE,
  lineHeight: 18,
  paddingX: 10,
  paddingY: 8,
  minWidth: 60,
} as const;

/**
 * Package label-tab geometry, shared by the renderer and the layout-metrics
 * overlap counter so a drawn tab and a measured tab are the same rectangle.
 */
export const PACKAGE_LABEL = {
  tabHeight: 20,
  fontSize: 12,
  tabPadding: 8,
} as const;

/** Spacing grid (px). Entity box sizes snap up to a multiple of it. */
export const GRID = 8;

export function snapUp(n: number, grid: number = GRID): number {
  return Math.ceil(n / grid) * grid;
}

/** Reconstruct the name drawn in the title compartment, generics expanded. */
export function displayName(entity: PlantUmlEntity): string {
  const generics = entity.generics;
  if (!generics || generics.length === 0) return entity.name;
  return `${entity.name}<${generics.join(', ')}>`;
}

/**
 * Heights of the three UML compartments inside an entity box: the title band,
 * the attribute (field) band, and the operations (method) band. Each band is a
 * whole number of text rows; the compartment separator rules are zero-thickness
 * boundaries drawn *between* bands and so consume no additional height.
 *
 * The renderer and {@link estimateEntitySize} both read this, so the drawn
 * boxes and the emitted `data-title-h` / `data-attrs-h` / `data-ops-h`
 * metadata can never drift apart.
 */
export function compartmentHeights(entity: PlantUmlEntity): {
  title: number;
  attrs: number;
  ops: number;
} {
  let attrs = 0;
  let ops = 0;
  for (const member of entity.members) {
    if (member.kind === 'method') ops++;
    else attrs++;
  }
  return {
    title: METRICS.lineHeight,
    attrs: attrs * METRICS.lineHeight,
    ops: ops * METRICS.lineHeight,
  };
}

/**
 * Approximate the on-canvas size of an entity box. Height is the sum of the
 * three compartments (title rows + attribute rows + operation rows) plus the
 * top/bottom padding, snapped up to the spacing grid; width is the longest
 * rendered line measured through the text table plus padding, never below
 * MIN_WIDTH.
 */
export function estimateEntitySize(
  entity: PlantUmlEntity,
): { width: number; height: number } {
  const lines = [
    displayName(entity),
    ...entity.members.map((m) => m.display ?? m.raw),
  ];
  const longest = lines.reduce(
    (max, line) => Math.max(max, measureTextWidth(line, METRICS.fontSize)),
    0,
  );
  const width = snapUp(Math.max(METRICS.minWidth, longest + METRICS.paddingX * 2));
  const bands = compartmentHeights(entity);
  const height = snapUp(
    bands.title + bands.attrs + bands.ops + METRICS.paddingY * 2,
  );
  return { width, height };
}

/**
 * Level of member detail drawn per entity: every member (`full`), the first
 * few plus a count (`compact`), or just the class name (`names`).
 */
export type DetailLevel = 'full' | 'compact' | 'names';

/** Entity count up to which `full` is chosen automatically. */
export const DETAIL_FULL_MAX_ENTITIES = 40;
/** Entity count up to which `compact` is chosen automatically (beyond: `names`). */
export const DETAIL_COMPACT_MAX_ENTITIES = 150;
/** Member rows kept per entity in `compact` mode. */
export const COMPACT_MEMBER_ROWS = 4;

export function autoDetail(entityCount: number): DetailLevel {
  if (entityCount <= DETAIL_FULL_MAX_ENTITIES) return 'full';
  if (entityCount <= DETAIL_COMPACT_MAX_ENTITIES) return 'compact';
  return 'names';
}

/**
 * Optional caps on the member text a diagram draws. Both are applied by
 * [[applyDetail]] before layout, so an entity is sized for exactly what the
 * renderer emits; neither mutates `PlantUmlMember.raw`.
 */
export interface MemberDisplayLimits {
  /** Maximum member rows drawn per entity; the rest collapse into the count row. */
  memberMaxRows?: number;
  /** Cut each drawn member line to this many characters, ending with `…`. */
  memberMaxChars?: number;
}

/**
 * Reduce member rows to the requested detail level *before* layout, so boxes
 * are sized for what is actually drawn. `undefined` picks by entity count.
 *
 * `limits` caps the drawn rows per entity (`memberMaxRows`, replacing
 * [[COMPACT_MEMBER_ROWS]] for `compact` and also capping `full`) and the width
 * of each drawn line (`memberMaxChars`). Truncation only sets
 * `PlantUmlMember.display`; `raw` keeps the full declaration. Without limits
 * the result is byte-for-byte what it always was.
 */
export function applyDetail(
  model: PlantUmlModel,
  detail?: DetailLevel,
  limits: MemberDisplayLimits = {},
): PlantUmlModel {
  const level = detail ?? autoDetail(model.entities.length);
  const { memberMaxRows, memberMaxChars } = limits;
  const hasLimits = memberMaxRows !== undefined || memberMaxChars !== undefined;
  if (level === 'full' && !hasLimits) return model;

  const limitMember = (member: PlantUmlMember): PlantUmlMember => {
    if (memberMaxChars === undefined || member.raw.length <= memberMaxChars) return member;
    return {
      ...member,
      display: `${member.raw.slice(0, Math.max(0, memberMaxChars - 1))}…`,
    };
  };

  return {
    ...model,
    entities: model.entities.map((entity) => {
      const total = entity.members.length;
      if (level === 'names') return total === 0 ? entity : { ...entity, members: [] };
      const rowCap =
        memberMaxRows !== undefined
          ? memberMaxRows
          : level === 'compact'
            ? COMPACT_MEMBER_ROWS
            : total;
      if (total <= rowCap) {
        return hasLimits ? { ...entity, members: entity.members.map(limitMember) } : entity;
      }
      const kept = entity.members.slice(0, rowCap).map(limitMember);
      const more: PlantUmlMember = {
        visibility: 'public',
        name: '…',
        kind: 'field',
        modifiers: [],
        raw: `… +${total - rowCap} more (${total} members)`,
      };
      return { ...entity, members: [...kept, more] };
    }),
  };
}

/**
 * Group nodes into rows: within one package (or the top level), nodes whose
 * vertical extents overlap belong to the same layered-layout rank. Returns
 * arrays of node ids, each sorted top-to-bottom.
 */
export function layoutRows(model: PlantUmlModel, layout: LayoutResult): NodeLayout[][] {
  const pkgOf = new Map(model.entities.map((e) => [e.id, e.packageId ?? '']));
  const groups = new Map<string, NodeLayout[]>();
  for (const node of layout.nodes) {
    const key = pkgOf.get(node.id) ?? '';
    const list = groups.get(key);
    if (list) list.push(node);
    else groups.set(key, [node]);
  }
  const rows: NodeLayout[][] = [];
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    let row: NodeLayout[] = [];
    let bottom = -Infinity;
    for (const node of sorted) {
      if (row.length > 0 && node.y >= bottom) {
        rows.push(row);
        row = [];
        bottom = -Infinity;
      }
      row.push(node);
      bottom = Math.max(bottom, node.y + node.height);
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

/**
 * Top-align the nodes of every row (never moving a node down or out of its
 * package) and keep edges attached: an endpoint on a moved node shifts with it,
 * dragging along the next bend when the first segment is horizontal, so
 * orthogonal routes stay orthogonal. Mutates and returns `layout`.
 */
export function alignRows(model: PlantUmlModel, layout: LayoutResult): LayoutResult {
  if (model.entities.length > ALIGN_MAX_ENTITIES) return layout;
  const edges = layout.edges ?? [];
  for (const row of layoutRows(model, layout)) {
    if (row.length < 2) continue;
    const top = Math.min(...row.map((n) => n.y));
    for (const node of row) {
      const dy = top - node.y;
      if (dy === 0) continue;
      // Moving up must not run the box into another node or a foreign edge.
      const next = { x: node.x, y: top, width: node.width, height: node.height };
      if (layout.nodes.some((o) => o !== node && boxesOverlap(next, o))) continue;
      if (
        edges.some(
          (e) => e.source !== node.id && e.target !== node.id && polylineHitsBox(e.points, next),
        )
      ) {
        continue;
      }
      // Re-attach the node's own edges; refuse the move if any orthogonal
      // edge would turn diagonal.
      const patched = new Map<EdgeLayout, Point[]>();
      let ok = true;
      for (const edge of edges) {
        if (edge.source !== node.id && edge.target !== node.id) continue;
        const pts = edge.points.map((p) => ({ ...p }));
        if (pts.length < 2) continue;
        const wasOrthogonal = isOrthogonal(edge.points);
        const ends: [string, number, number][] = [
          [edge.source, 0, 1],
          [edge.target, pts.length - 1, pts.length - 2],
        ];
        for (const [id, i, nxt] of ends) {
          if (id !== node.id) continue;
          const horizontal = Math.abs(pts[i].y - pts[nxt].y) < 0.01;
          if (horizontal) {
            // A side port still inside the moved box's span needs no change.
            if (pts[i].y > top && pts[i].y < top + node.height) continue;
            pts[i].y += dy;
            if (pts.length > 2) pts[nxt].y += dy;
          } else {
            pts[i].y += dy;
          }
        }
        if (wasOrthogonal && !isOrthogonal(pts)) {
          ok = false;
          break;
        }
        patched.set(edge, pts);
      }
      if (!ok) continue;
      node.y = top;
      for (const [edge, pts] of patched) edge.points = pts;
    }
  }
  return layout;
}

/**
 * Top-align an isolated package frame (no edge touches any entity inside it)
 * with the topmost side-by-side neighbour frame, so a lone package sits level
 * with its neighbour instead of floating at its own offset. Only moves up, and
 * only when the frame (with its contents) stays clear of everything else.
 * Mutates and returns `layout`.
 */
export function alignIsolatedFrames(model: PlantUmlModel, layout: LayoutResult): LayoutResult {
  const frames = layout.packages ?? [];
  const roots = model.packages.filter((p) => p.parentId === undefined);
  if (roots.length < 2 || frames.length === 0) return layout;
  const parentOf = new Map(model.packages.map((p) => [p.id, p.parentId]));
  const rootOf = (id: string | undefined): string | undefined => {
    let cur = id;
    while (cur !== undefined && parentOf.get(cur) !== undefined) cur = parentOf.get(cur);
    return cur;
  };
  const entityRoot = new Map(model.entities.map((e) => [e.id, rootOf(e.packageId)]));
  const touched = new Set<string>();
  for (const r of model.relations) {
    for (const id of [r.source, r.target]) {
      const root = entityRoot.get(id);
      if (root !== undefined) touched.add(root);
    }
    if (r.sourcePackageId) touched.add(rootOf(r.sourcePackageId)!);
    if (r.targetPackageId) touched.add(rootOf(r.targetPackageId)!);
  }
  const byId = new Map(frames.map((f) => [f.id, f]));
  const rootFrames = roots.map((r) => byId.get(r.id)).filter((f): f is PackageLayout => f !== undefined);
  for (const frame of rootFrames) {
    if (touched.has(frame.id)) continue;
    const neighbours = rootFrames.filter(
      (g) => g !== frame && g.y < frame.y && g.y + g.height > frame.y &&
        (g.x + g.width <= frame.x || frame.x + frame.width <= g.x),
    );
    if (neighbours.length === 0) continue;
    const top = Math.min(...neighbours.map((g) => g.y));
    const dy = top - frame.y;
    const inFrame = (pid: string | undefined): boolean => rootOf(pid) === frame.id;
    const memberNodes = layout.nodes.filter((n) => inFrame(model.entities.find((e) => e.id === n.id)?.packageId));
    const memberFrames = frames.filter((f) => inFrame(f.id));
    const moved = { x: frame.x, y: top, width: frame.width, height: frame.height };
    const others = [
      ...rootFrames.filter((g) => g !== frame),
      ...layout.nodes.filter((n) => !memberNodes.includes(n)),
    ];
    if (others.some((o) => boxesOverlap(moved, o))) continue;
    if ((layout.edges ?? []).some((e) => polylineHitsBox(e.points, moved))) continue;
    for (const n of memberNodes) n.y += dy;
    for (const f of memberFrames) f.y += dy;
  }
  return layout;
}

function isOrthogonal(points: Point[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    if (Math.abs(points[i].x - points[i + 1].x) > 0.01 && Math.abs(points[i].y - points[i + 1].y) > 0.01) {
      return false;
    }
  }
  return true;
}

/** Row alignment is skipped above this size (its blocking checks are O(n·m)). */
const ALIGN_MAX_ENTITIES = 150;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** True when any segment's bounding box crosses the box interior. */
function polylineHitsBox(points: Point[], box: Box): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
    if (
      seg.x < box.x + box.width && box.x < seg.x + seg.width &&
      seg.y <= box.y + box.height && box.y <= seg.y + seg.height &&
      !(seg.width === 0 && (seg.x <= box.x || seg.x >= box.x + box.width)) &&
      !(seg.height === 0 && (seg.y <= box.y || seg.y >= box.y + box.height))
    ) {
      return true;
    }
  }
  return false;
}
