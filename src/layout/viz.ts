/**
 * VizLayoutEngine — @viz-js/viz (WASM Graphviz) as the second pluggable
 * LayoutEngine. The PlantUmlModel is lowered to a DOT digraph, Graphviz computes
 * positions (read back through its JSON output), and those positions are mapped
 * onto the shared LayoutResult contract so the SVG renderer stays engine-agnostic.
 *
 * Graphviz's JSON output (`-Tjson0`) uses points (72/inch) with a bottom-up y
 * axis and a `bb` bounding box. This engine flips the y axis and normalises the
 * bounding-box origin so the result matches the top-down pixel space the ELK
 * engine and the SVG renderer already speak.
 */

import { PlantUmlModel, PlantUmlRelation } from '../model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
} from '../layout.js';
import { getViz, GraphvizEngine } from '../render-dot.js';

const POINTS_PER_INCH = 72;

export class VizLayoutEngine implements LayoutEngine {
  constructor(private readonly graphvizEngine: GraphvizEngine = 'dot') {}

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const viz = await getViz();
    const json = viz.renderJSON(modelToDot(model), {
      engine: this.graphvizEngine,
    }) as GraphvizJson;

    const bb = parseBoundingBox(json.bb);
    const flipY = (y: number) => bb.maxY - y - bb.minY;
    const shiftX = (x: number) => x - bb.minX;

    const objects = json.objects ?? [];
    const nodes: NodeLayout[] = objects.map((obj) => {
      const [cx, cy] = parsePoint(obj.pos);
      const { width, height } = objectSizePoints(obj);
      return {
        id: obj.name,
        x: shiftX(cx) - width / 2,
        y: flipY(cy) - height / 2,
        width,
        height,
      };
    });

    const idByGvid = new Map(objects.map((obj) => [obj._gvid, obj.name]));
    const edges: EdgeLayout[] = (json.edges ?? []).map((edge, i) => ({
      id: `rel-${i}`,
      source: idByGvid.get(edge.tail) ?? String(edge.tail),
      target: idByGvid.get(edge.head) ?? String(edge.head),
      points: splinePoints(edge).map(([x, y]) => ({ x: shiftX(x), y: flipY(y) })),
    }));

    return {
      nodes,
      edges,
      width: bb.maxX - bb.minX,
      height: bb.maxY - bb.minY,
    };
  }
}

/** Lower a PlantUmlModel to a DOT digraph that Graphviz can lay out. */
export function modelToDot(model: PlantUmlModel): string {
  const lines: string[] = ['digraph G {'];
  lines.push('  graph [rankdir="TB"];');
  lines.push('  node [shape="box", fontname="monospace"];');
  for (const entity of model.entities) {
    lines.push(
      `  ${quoteDotId(entity.id)} [label=${quoteDotLabel(entity.name)}];`,
    );
  }
  for (const relation of model.relations) {
    lines.push(
      `  ${quoteDotId(relation.source)} -> ${quoteDotId(relation.target)}${edgeAttrs(relation)};`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

function edgeAttrs(relation: PlantUmlRelation): string {
  const attrs: string[] = [];
  switch (relation.type) {
    case 'inheritance':
      attrs.push('arrowhead="empty"');
      break;
    case 'implementation':
      attrs.push('arrowhead="empty"', 'style="dashed"');
      break;
    case 'dependency':
      attrs.push('arrowhead="vee"', 'style="dashed"');
      break;
    case 'association':
      attrs.push('arrowhead="vee"');
      break;
    case 'aggregation':
      attrs.push('arrowhead="odiamond"');
      break;
    case 'composition':
      attrs.push('arrowhead="diamond"');
      break;
  }
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
