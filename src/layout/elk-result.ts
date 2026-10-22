/**
 * ELK result → `LayoutResult` mapping for the ELK engine: flatten the nested
 * node tree into absolute boxes and turn edge sections into point lists.
 */

import type { ElkNode, ElkExtendedEdge, ElkEdgeSection } from 'elkjs';
import { PlantUmlModel } from '../foundation/model.js';
import { LayoutResult, NodeLayout, EdgeLayout, PackageLayout, Point } from '../foundation/layout.js';
import {
  PACKAGE_PREFIX,
  ISOLATED_PREFIX,
  packageMinWidth,
} from './elk-graph.js';
import { relationSemantics } from '../foundation/relation-semantics.js';

/**
 * INCLUDE_CHILDREN sizes a container from its content and does not honour the
 * `elk.nodeSize.minimum` we give package frames, so a single short-named
 * entity can leave the frame narrower than its label tab. Widen those frames
 * in place (never shrink) so the tab stays readable.
 */
export function enforcePackageMinWidth(model: PlantUmlModel, packages: PackageLayout[]): void {
  const byId = new Map(packages.map((p) => [p.id, p]));
  for (const pkg of model.packages) {
    const box = byId.get(pkg.id);
    if (!box) continue;
    const min = packageMinWidth(pkg.name);
    if (box.width < min) box.width = min;
  }
}

export function flatten(
  node: ElkNode,
  offsetX: number,
  offsetY: number,
  nodes: NodeLayout[],
  packages: PackageLayout[],
  offsets: Map<string, Point>,
): void {
  const x = (node.x ?? 0) + offsetX;
  const y = (node.y ?? 0) + offsetY;
  offsets.set(node.id, { x, y });

  if (node.id.startsWith(PACKAGE_PREFIX)) {
    packages.push({
      id: node.id.slice(PACKAGE_PREFIX.length),
      x,
      y,
      width: node.width ?? 0,
      height: node.height ?? 0,
    });
    for (const child of node.children ?? []) {
      flatten(child, x, y, nodes, packages, offsets);
    }
  } else if (node.id.startsWith(ISOLATED_PREFIX)) {
    for (const child of node.children ?? []) {
      flatten(child, x, y, nodes, packages, offsets);
    }
  } else {
    nodes.push({
      id: node.id,
      x,
      y,
      width: node.width ?? 0,
      height: node.height ?? 0,
    });
  }
}

export function edgePoints(
  edge: ElkExtendedEdge,
  nodeById: Map<string, NodeLayout>,
  offsets: Map<string, Point>,
): Point[] {
  const sections = edge.sections ?? [];
  if (sections.length === 0) {
    return straightEdge(edge, nodeById);
  }

  const containerOffset = offsets.get(edge.container ?? 'root') ?? {
    x: 0,
    y: 0,
  };
  const points: Point[] = [];
  for (const section of sections) {
    for (const p of sectionPoints(section)) {
      const shifted = { x: p.x + containerOffset.x, y: p.y + containerOffset.y };
      const last = points[points.length - 1];
      if (!last || Math.abs(last.x - shifted.x) > 0.01 || Math.abs(last.y - shifted.y) > 0.01) {
        points.push(shifted);
      }
    }
  }
  return points.length >= 2 ? points : straightEdge(edge, nodeById);
}

function sectionPoints(section: ElkEdgeSection): Point[] {
  const pts: Point[] = [];
  if (section.startPoint) pts.push(section.startPoint);
  for (const b of section.bendPoints ?? []) pts.push(b);
  if (section.endPoint) pts.push(section.endPoint);
  return pts;
}

function straightEdge(edge: ElkExtendedEdge, nodeById: Map<string, NodeLayout>): Point[] {
  const source = nodeById.get(edge.sources?.[0] ?? '');
  const target = nodeById.get(edge.targets?.[0] ?? '');
  if (!source || !target) return [];
  return [
    { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  ];
}

/** Map a laid-out ELK graph back to the model's `LayoutResult`. */
export function mapElkResult(model: PlantUmlModel, result: ElkNode): LayoutResult {
  const nodes: NodeLayout[] = [];
  const packages: PackageLayout[] = [];
  const offsets = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
  for (const child of result.children ?? []) {
    flatten(child, 0, 0, nodes, packages, offsets);
  }
  enforcePackageMinWidth(model, packages);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const laidEdges: EdgeLayout[] = (result.edges ?? []).map((edge, i) => {
    const relation = model.relations[i];
    const reversed = relation !== undefined && relationSemantics(relation.type).isReversed();
    const points = edgePoints(edge, nodeById, offsets);
    return {
      id: edge.id ?? `rel-${i}`,
      // Keep the model's direction (not the possibly-reversed layout
      // direction) so the renderer's arrowheads and the overlap counter both
      // see the endpoints the author wrote.
      source: relation?.source ?? (edge.sources?.[0] ?? ''),
      target: relation?.target ?? (edge.targets?.[0] ?? ''),
      points: reversed ? points.slice().reverse() : points,
    };
  });

  return {
    nodes,
    edges: laidEdges,
    packages,
    width: result.width ?? 0,
    height: result.height ?? 0,
  };
}
