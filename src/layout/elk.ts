/**
 * ElkLayoutEngine — the default engine, pure-JS layered layout via elkjs.
 * Packages become nested container nodes (so members stay grouped and frames
 * nest), edges use ORTHOGONAL routing to keep crossings down, and the result
 * is flattened back to absolute coordinates for the renderer.
 */

import ELKDefault from 'elkjs';
import type {
  ElkNode,
  ElkExtendedEdge,
  ElkEdgeSection,
  ElkPoint,
  ELK as ElkInstance,
  ELKConstructorArguments,
} from 'elkjs';
import { PlantUmlModel, PlantUmlEntity } from '../model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  PackageLayout,
  Point,
  PACKAGE_LABEL,
  estimateEntitySize,
} from '../layout.js';
import { measureTextWidth } from '../text-measure.js';

// elkjs ships a `typeof import(...)` default-export type under NodeNext; pin the
// real constructor shape so `new` type-checks and the layout result stays typed.
const ElkConstructor = ELKDefault as unknown as new (
  args?: ELKConstructorArguments,
) => ElkInstance;

const PACKAGE_PREFIX = 'pkg::';

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ElkConstructor();

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const children = this.buildChildren(model);
    const edges: ElkExtendedEdge[] = model.relations.map((relation, i) => ({
      id: `rel-${i}`,
      sources: [relation.source],
      targets: [relation.target],
    }));

    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '40',
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        // Soft targets: pack disconnected components into a balanced rectangle
        // instead of a long horizontal strip. (hierarchyHandling is deliberately
        // left at its default — INCLUDE_CHILDREN was measured to widen the class
        // fixture to aspect 8.6 and the package fixture to 2.9 without reducing
        // edge crossings in elkjs 0.12.)
        'elk.aspectRatio': '1.6',
        'elk.separateConnectedComponents': 'true',
      },
      children,
      edges,
    };

    const result = await this.elk.layout(graph);

    const nodes: NodeLayout[] = [];
    const packages: PackageLayout[] = [];
    const offsets = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
    for (const child of result.children ?? []) {
      this.flatten(child, 0, 0, nodes, packages, offsets);
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const laidEdges: EdgeLayout[] = (result.edges ?? []).map((edge, i) => ({
      id: edge.id ?? `rel-${i}`,
      source: edge.sources?.[0] ?? '',
      target: edge.targets?.[0] ?? '',
      points: this.edgePoints(edge, nodeById, offsets),
    }));

    return {
      nodes,
      edges: laidEdges,
      packages,
      width: result.width ?? 0,
      height: result.height ?? 0,
    };
  }

  private buildChildren(model: PlantUmlModel): ElkNode[] {
    const pkgNodes = new Map<string, ElkNode>();
    for (const pkg of model.packages) {
      // Padding at the top keeps the package label tab clear of the first
      // entity; the minimum width keeps the tab wide enough for the label when
      // a package holds only a single short-named entity.
      const labelWidth = measureTextWidth(pkg.name, PACKAGE_LABEL.fontSize);
      const minWidth = labelWidth + PACKAGE_LABEL.tabPadding + 20; // + left/right padding
      const minHeight = PACKAGE_LABEL.tabHeight + 26 + 10; // tab + top/bottom padding
      pkgNodes.set(pkg.id, {
        id: PACKAGE_PREFIX + pkg.id,
        children: [],
        layoutOptions: {
          'elk.padding': '[top=26,left=10,bottom=10,right=10]',
          'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
          'elk.nodeSize.minimum': `[${minWidth.toFixed(1)}, ${minHeight.toFixed(1)}]`,
        },
      });
    }

    const top: ElkNode[] = [];
    for (const entity of model.entities) {
      const leaf = this.entityLeaf(entity);
      const owner = entity.packageId ? pkgNodes.get(entity.packageId) : undefined;
      if (owner) owner.children!.push(leaf);
      else top.push(leaf);
    }

    // Link nested packages into their parents; packages without a parent (or
    // whose parent is unknown) sit at the top level.
    for (const pkg of model.packages) {
      const node = pkgNodes.get(pkg.id)!;
      const parent = pkg.parentId ? pkgNodes.get(pkg.parentId) : undefined;
      if (parent) parent.children!.push(node);
      else top.push(node);
    }

    return top;
  }

  private entityLeaf(entity: PlantUmlEntity): ElkNode {
    const size = estimateEntitySize(entity);
    return { id: entity.id, width: size.width, height: size.height };
  }

  private flatten(
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
        this.flatten(child, x, y, nodes, packages, offsets);
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

  private edgePoints(
    edge: ElkExtendedEdge,
    nodeById: Map<string, NodeLayout>,
    offsets: Map<string, Point>,
  ): Point[] {
    const sections = edge.sections ?? [];
    if (sections.length === 0) {
      return this.straightEdge(edge, nodeById);
    }

    const containerOffset = offsets.get(edge.container ?? 'root') ?? {
      x: 0,
      y: 0,
    };
    const points: Point[] = [];
    for (const section of sections) {
      for (const p of this.sectionPoints(section)) {
        const shifted = { x: p.x + containerOffset.x, y: p.y + containerOffset.y };
        const last = points[points.length - 1];
        if (!last || Math.abs(last.x - shifted.x) > 0.01 || Math.abs(last.y - shifted.y) > 0.01) {
          points.push(shifted);
        }
      }
    }
    return points.length >= 2 ? points : this.straightEdge(edge, nodeById);
  }

  private sectionPoints(section: ElkEdgeSection): Point[] {
    const pts: Point[] = [];
    if (section.startPoint) pts.push(section.startPoint);
    for (const b of section.bendPoints ?? []) pts.push(b);
    if (section.endPoint) pts.push(section.endPoint);
    return pts;
  }

  private straightEdge(
    edge: ElkExtendedEdge,
    nodeById: Map<string, NodeLayout>,
  ): Point[] {
    const source = nodeById.get(edge.sources?.[0] ?? '');
    const target = nodeById.get(edge.targets?.[0] ?? '');
    if (!source || !target) return [];
    return [
      { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    ];
  }
}

export type { ElkPoint };
