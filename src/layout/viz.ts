/**
 * VizLayoutEngine — @viz-js/viz (WASM Graphviz) as the second pluggable
 * LayoutEngine. The PlantUmlModel is lowered to a DOT digraph (entities as
 * fixed-size boxes sized by estimateEntitySize, packages as `cluster_*`
 * subgraphs), Graphviz computes positions (read back through its JSON output),
 * and those positions are mapped onto the shared LayoutResult contract so the
 * SVG renderer stays engine-agnostic.
 *
 * Graphviz's JSON output (`-Tjson0`) uses points (72/inch) with a bottom-up y
 * axis and a `bb` bounding box. This engine flips the y axis and normalises the
 * bounding-box origin so the result matches the top-down pixel space the ELK
 * engine and the SVG renderer already speak.
 */

import {
  PlantUmlModel,
  PlantUmlRelation,
  PlantUmlPackage,
  PlantUmlEntity,
} from '../foundation/model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  PackageLayout,
  PACKAGE_LABEL,
  displayName,
  estimateEntitySize,
} from '../foundation/layout.js';
import { getViz, GraphvizEngine } from './render-dot.js';
import { measureTextWidth } from '../foundation/text-measure.js';
import { relationSemantics } from '../foundation/relation-semantics.js';

const POINTS_PER_INCH = 72;
const CLUSTER_PREFIX = 'cluster_';

export class VizLayoutEngine implements LayoutEngine {
  constructor(private readonly graphvizEngine: GraphvizEngine = 'dot') {}

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const viz = await getViz();
    const json = viz.renderJSON(modelToDot(model), {
      engine: this.graphvizEngine,
    }) as GraphvizJson;

    const bb = parseBoundingBox(json.bb);
    const flipY = (y: number) => bb.maxY - y;
    const shiftX = (x: number) => x - bb.minX;

    const entityById = new Map(model.entities.map((e) => [e.id, e]));
    const objects = json.objects ?? [];

    const nodes: NodeLayout[] = [];
    const packages: PackageLayout[] = [];

    for (const obj of objects) {
      const cluster = clusterIndex(obj.name);
      if (cluster !== null) {
        const rect = drawBoundingBox(obj._draw_);
        const pkg = model.packages[cluster];
        if (pkg && rect) {
          packages.push({
            id: pkg.id,
            x: shiftX(rect.minX),
            y: flipY(rect.maxY),
            width: rect.maxX - rect.minX,
            height: rect.maxY - rect.minY,
          });
        }
        continue;
      }

      // The node box is authoritative from the shared text measurement, so a
      // member area is never under-counted; Graphviz only decides the centre.
      const entity = entityById.get(obj.name);
      const size = entity ? estimateEntitySize(entity) : objectSizePoints(obj);
      const [cx, cy] = parsePoint(obj.pos);
      nodes.push({
        id: obj.name,
        x: shiftX(cx) - size.width / 2,
        y: flipY(cy) - size.height / 2,
        width: size.width,
        height: size.height,
      });
    }

    const idByGvid = new Map(objects.map((obj) => [obj._gvid, obj.name]));
    const edges: EdgeLayout[] = (json.edges ?? []).map((edge, i) => ({
      id: `rel-${i}`,
      source: idByGvid.get(edge.tail) ?? String(edge.tail),
      target: idByGvid.get(edge.head) ?? String(edge.head),
      points: splinePoints(edge).map(([x, y]) => ({ x: shiftX(x), y: flipY(y) })),
    }));

    // Graphviz sizes a cluster from its content, so a single short-named entity
    // can leave the frame narrower than the package label. Widen such frames so
    // the label tab never spills past the border (mirrors the ELK minimum size).
    let width = bb.maxX - bb.minX;
    for (const pkg of packages) {
      const modelPkg = model.packages.find((p) => p.id === pkg.id);
      if (!modelPkg) continue;
      const minWidth =
        measureTextWidth(modelPkg.name, PACKAGE_LABEL.fontSize) +
        PACKAGE_LABEL.tabPadding;
      if (pkg.width < minWidth) pkg.width = minWidth;
      width = Math.max(width, pkg.x + pkg.width);
    }

    return {
      nodes,
      edges,
      packages,
      width,
      height: bb.maxY - bb.minY,
    };
  }
}

/** Lower a PlantUmlModel to a DOT digraph that Graphviz can lay out. */
export function modelToDot(model: PlantUmlModel): string {
  const lines: string[] = ['digraph G {'];
  // `ratio` sets the target height/width (0.6 ⇒ width/height ≈ 1.67) and only
  // scales the drawing UP, so a shallow, wide graph is stretched into a
  // balanced rectangle instead of a horizontal strip. Node sizes are untouched
  // (fixedsize), so entity boxes still match estimateEntitySize.
  lines.push(
    '  graph [rankdir="TB", nodesep="0.5", ranksep="0.6", ratio="0.6"];',
  );
  lines.push('  node [shape="box", fontname="monospace"];');

  const pkgIndex = new Map(model.packages.map((p, i) => [p.id, i]));
  const knownPkg = (id?: string) => id !== undefined && pkgIndex.has(id);

  for (const entity of model.entities) {
    if (!knownPkg(entity.packageId)) lines.push(`  ${entityNode(entity)}`);
  }

  for (const pkg of model.packages) {
    if (knownPkg(pkg.parentId)) continue; // nested — emitted under its parent
    lines.push(...clusterLines(pkg, model, pkgIndex, 1));
  }

  for (const relation of model.relations) {
    lines.push(
      `  ${quoteDotId(relation.source)} -> ${quoteDotId(relation.target)}${edgeAttrs(relation)};`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

/** A fixed-size entity box whose DOT size equals [[estimateEntitySize]]. */
function entityNode(entity: PlantUmlEntity): string {
  const size = estimateEntitySize(entity);
  const label = [displayName(entity), ...entity.members.map((m) => m.raw)].join(
    '\n',
  );
  const width = (size.width / POINTS_PER_INCH).toFixed(4);
  const height = (size.height / POINTS_PER_INCH).toFixed(4);
  return (
    `${quoteDotId(entity.id)} [label=${quoteDotLabel(label)}, ` +
    `fixedsize=true, width="${width}", height="${height}"];`
  );
}

/** A package becomes a `cluster_<index>` subgraph, index ↔ model.packages order. */
function clusterLines(
  pkg: PlantUmlPackage,
  model: PlantUmlModel,
  pkgIndex: Map<string, number>,
  depth: number,
): string[] {
  const idx = pkgIndex.get(pkg.id)!;
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  const lines: string[] = [];
  lines.push(`${pad}subgraph ${CLUSTER_PREFIX}${idx} {`);
  lines.push(`${inner}label=${quoteDotLabel(pkg.name)};`);
  lines.push(`${inner}fontname="monospace";`);
  lines.push(`${inner}labeljust="l";`);
  lines.push(`${inner}labelloc="t";`);
  for (const entity of model.entities) {
    if (entity.packageId === pkg.id) lines.push(`${inner}${entityNode(entity)}`);
  }
  for (const child of model.packages) {
    if (child.parentId === pkg.id) {
      lines.push(...clusterLines(child, model, pkgIndex, depth + 1));
    }
  }
  lines.push(`${pad}}`);
  return lines;
}

/** `cluster_0` → 0, anything else → null. */
function clusterIndex(name: string): number | null {
  if (!name.startsWith(CLUSTER_PREFIX)) return null;
  const tail = name.slice(CLUSTER_PREFIX.length);
  if (!/^\d+$/.test(tail)) return null;
  return Number(tail);
}

/** Translate the relation's semantic facts into Graphviz DOT attributes. */
function edgeAttrs(relation: PlantUmlRelation): string {
  const attrs: string[] = [];
  const semantics = relationSemantics(relation.type);
  switch (semantics.arrowKind()) {
    case 'triangle':
      attrs.push('arrowhead="empty"');
      break;
    case 'chevron':
      attrs.push('arrowhead="vee"');
      break;
    case 'diamond':
      attrs.push(`arrowhead="${semantics.isFilled() ? 'diamond' : 'odiamond'}"`);
      break;
  }
  if (semantics.isDashed()) attrs.push('style="dashed"');
  if (relation.label) attrs.push(`label=${quoteDotLabel(relation.label)}`);
  return attrs.length > 0 ? ` [${attrs.join(', ')}]` : '';
}

/** Quote a DOT node/edge identifier, escaping embedded quotes and slashes. */
function quoteDotId(id: string): string {
  return `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Quote a DOT label, escaping embedded quotes, slashes and newlines. */
function quoteDotLabel(label: string): string {
  return `"${label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')}"`;
}

function parsePoint(pos: string | undefined): [number, number] {
  if (!pos) return [0, 0];
  const [x, y] = pos.split(',');
  return [Number(x) || 0, Number(y) || 0];
}

/** A drawn polygon (`p`) or ellipse rect (`e`) op's bounding box, in points. */
function drawBoundingBox(
  draw: GraphvizDrawOp[] | undefined,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!draw) return null;
  for (const op of draw) {
    if (op.op === 'p' && op.points && op.points.length >= 2) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of op.points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return { minX, minY, maxX, maxY };
    }
    if (op.op === 'e' && op.rect && op.rect.length >= 4) {
      const [cx, cy, halfW, halfH] = op.rect;
      return {
        minX: cx - halfW,
        minY: cy - halfH,
        maxX: cx + halfW,
        maxY: cy + halfH,
      };
    }
  }
  return null;
}

function objectSizePoints(obj: GraphvizObject): { width: number; height: number } {
  // The xdot "e" rect op carries the centre plus half-width/half-height in
  // points — the most direct size source. Fall back to inches when absent.
  const rect = obj._draw_?.find((op) => op.op === 'e')?.rect;
  if (rect && rect.length >= 4) {
    return { width: rect[2] * 2, height: rect[3] * 2 };
  }
  return {
    width: (Number(obj.width) || 0) * POINTS_PER_INCH,
    height: (Number(obj.height) || 0) * POINTS_PER_INCH,
  };
}

function splinePoints(edge: GraphvizEdge): Array<[number, number]> {
  const bezier = edge._draw_?.find((op) => op.op === 'b' && op.points);
  if (!bezier?.points) return [];
  return bezier.points.map(([x, y]) => [x, y]);
}

function parseBoundingBox(bb: string | undefined): BoundingBox {
  if (!bb) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const [minX, minY, maxX, maxY] = bb.split(',').map((n) => Number(n) || 0);
  return { minX, minY, maxX, maxY };
}

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface GraphvizJson {
  bb?: string;
  objects?: GraphvizObject[];
  edges?: GraphvizEdge[];
}

interface GraphvizObject {
  name: string;
  _gvid: number;
  pos?: string;
  width?: string;
  height?: string;
  _draw_?: GraphvizDrawOp[];
}

interface GraphvizEdge {
  tail: number;
  head: number;
  _draw_?: GraphvizDrawOp[];
}

interface GraphvizDrawOp {
  op: string;
  rect?: number[];
  points?: number[][];
}
