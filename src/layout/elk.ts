/**
 * ElkLayoutEngine — the default engine, pure-JS layered layout via elkjs.
 * Even a single entity goes through elkjs (never a hand-rolled position), so
 * the engine contract is exercised on the smallest input.
 */

import ELKDefault, { ElkNode, ElkExtendedEdge } from 'elkjs';
import { PlantUmlModel } from '../model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  Point,
  estimateEntitySize,
} from '../layout.js';

// elkjs ships ESM-syntax .d.ts inside a CommonJS package, which confuses
// NodeNext into typing the default export as the module namespace. The
// runtime default export is a plain constructable class; pin that shape here.
interface ElkLayoutOutput {
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkExtendedEdge[];
}

const ELK = ELKDefault as unknown as new () => {
  layout(graph: ElkNode): Promise<ElkLayoutOutput>;
};

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ELK();

  async layout(model: PlantUmlModel): Promise<LayoutResult> {
    const children: ElkNode[] = model.entities.map((entity) => {
      const size = estimateEntitySize(entity);
      return { id: entity.id, width: size.width, height: size.height };
    });

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
      },
      children,
      edges,
    };

    const result = await this.elk.layout(graph);

    const nodes: NodeLayout[] = (result.children ?? []).map((child) => ({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    }));

    const laidEdges: EdgeLayout[] = (result.edges ?? []).map((edge, i) => {
      const section = edge.sections?.[0];
      const points: Point[] =
        section && section.startPoint && section.endPoint
          ? [section.startPoint, section.endPoint]
          : [];
      return {
        id: edge.id ?? `rel-${i}`,
        source: edge.sources?.[0] ?? '',
        target: edge.targets?.[0] ?? '',
        points,
      };
    });

    return {
      nodes,
      edges: laidEdges,
      width: result.width ?? 0,
      height: result.height ?? 0,
    };
  }
}
