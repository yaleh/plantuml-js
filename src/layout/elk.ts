/**
 * ElkLayoutEngine — the default engine, pure-JS layered layout via elkjs.
 * Even a single entity goes through elkjs (never a hand-rolled position), so
 * the engine contract is exercised on the smallest input.
 */

import ELKDefault from 'elkjs';
import type {
  ElkNode,
  ElkExtendedEdge,
  ELK as ElkInstance,
  ELKConstructorArguments,
} from 'elkjs';
import { PlantUmlModel } from '../model.js';
import {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  Point,
  estimateEntitySize,
} from '../layout.js';

// elkjs ships a `typeof import(...)` default-export type under NodeNext; pin the
// real constructor shape so `new` type-checks and the layout result stays typed.
const ElkConstructor = ELKDefault as unknown as new (
  args?: ELKConstructorArguments,
) => ElkInstance;

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ElkConstructor();

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
