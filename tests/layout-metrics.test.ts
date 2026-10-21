import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import { parsePlantUml, transformFullGraph, ElkLayoutEngine } from '../src/index.js';
import { LayoutResult } from '../src/layout.js';
import { PlantUmlModel } from '../src/model.js';

/** A minimal, no-member entity used by most synthetic fixtures below. */
function entity(id: string, name = id, packageId?: string): PlantUmlModel['entities'][number] {
  return { id, name, kind: 'class', members: [], packageId };
}

describe('computeLayoutMetrics', () => {
  it('reports exact values for a clean two-node layout', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B')],
      relations: [{ source: 'A', target: 'B', type: 'association' }],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [
        { id: 'A', x: 0, y: 0, width: 100, height: 50 },
        { id: 'B', x: 200, y: 0, width: 100, height: 50 },
      ],
      edges: [
        {
          id: 'rel-0',
          source: 'A',
          target: 'B',
          points: [
            { x: 100, y: 25 },
            { x: 200, y: 25 },
          ],
        },
      ],
      width: 300,
      height: 50,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeCrossings).toBe(0);
    expect(m.edgeNodeIntersections).toBe(0);
    expect(m.totalEdgeLength).toBe(100);
    expect(m.areaUtilization).toBeCloseTo(2 / 3, 5);
    expect(m.aspectRatio).toBe(6);
    expect(m.textOverflowCount).toBe(0);
    expect(m.labelOverlapCount).toBe(0);
  });

  it('counts a deliberate edge crossing (counter-example)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C'), entity('D')],
      relations: [
        { source: 'A', target: 'B', type: 'association' },
        { source: 'C', target: 'D', type: 'association' },
      ],
      packages: [],
    };
    const layout: LayoutResult = {
      // 1×1 node boxes at the corners of a 30×40 rectangle; the two diagonal
      // edges are a 3-4-5 triangle each, so they cross at the centre and their
      // summed length is exactly 100.
      nodes: [
        { id: 'A', x: 0, y: 0, width: 1, height: 1 },
        { id: 'B', x: 30, y: 40, width: 1, height: 1 },
        { id: 'C', x: 0, y: 40, width: 1, height: 1 },
        { id: 'D', x: 30, y: 0, width: 1, height: 1 },
      ],
      edges: [
        {
          id: 'rel-0',
          source: 'A',
          target: 'B',
          points: [
            { x: 0, y: 0 },
            { x: 30, y: 40 },
          ],
        },
        {
          id: 'rel-1',
          source: 'C',
          target: 'D',
          points: [
            { x: 0, y: 40 },
            { x: 30, y: 0 },
          ],
        },
      ],
      width: 30,
      height: 40,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeCrossings).toBe(1);
    expect(m.edgeNodeIntersections).toBe(0);
    expect(m.totalEdgeLength).toBe(100);
  });

  it('counts an edge segment passing through an unrelated node', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('G')],
      relations: [{ source: 'A', target: 'B', type: 'association' }],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [
        { id: 'A', x: 0, y: 0, width: 10, height: 10 },
        { id: 'B', x: 40, y: 0, width: 10, height: 10 },
        { id: 'G', x: 20, y: 0, width: 10, height: 10 },
      ],
      edges: [
        {
          id: 'rel-0',
          source: 'A',
          target: 'B',
          points: [
            { x: 5, y: 5 },
            { x: 45, y: 5 },
          ],
        },
      ],
      width: 50,
      height: 50,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeNodeIntersections).toBe(1);
    expect(m.edgeCrossings).toBe(0);
  });

  it('counts a member line wider than its box (overflow counter-example)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [
        {
          id: 'A',
          name: 'A',
          kind: 'class',
          members: [
            {
              visibility: 'public',
              name: 'aVeryLongMemberNameThatOverflowsTheBox',
              kind: 'field',
              modifiers: [],
              raw: '+aVeryLongMemberNameThatOverflowsTheBox',
            },
          ],
        },
      ],
      relations: [],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [{ id: 'A', x: 0, y: 0, width: 40, height: 40 }],
      edges: [],
      width: 40,
      height: 40,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m.textOverflowCount).toBe(1);
  });

  it('counts a package label tab overlapping its own content', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('Inner', 'Inner', 'P')],
      relations: [],
      packages: [{ id: 'P', name: 'A' }],
    };
    const layout: LayoutResult = {
      nodes: [{ id: 'Inner', x: 0, y: 0, width: 100, height: 40 }],
      edges: [],
      packages: [{ id: 'P', x: 0, y: 0, width: 200, height: 200 }],
      width: 200,
      height: 200,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m.labelOverlapCount).toBe(1);
    expect(m.textOverflowCount).toBe(0);
  });

  it('sums collinear overlapping segments from different edges (parallel-wall length)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C'), entity('D')],
      relations: [
        { source: 'A', target: 'B', type: 'association' },
        { source: 'C', target: 'D', type: 'association' },
      ],
      packages: [],
    };
    const layout: LayoutResult = {
      // Two horizontal edges on y=0 that overlap over x ∈ [50, 100]: they never
      // cross (so edgeCrossings stays 0), but 50px of edge lie on top of each
      // other — the orthogonal "parallel wall" this metric exists to count.
      nodes: [],
      edges: [
        {
          id: 'rel-0',
          source: 'A',
          target: 'B',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
        {
          id: 'rel-1',
          source: 'C',
          target: 'D',
          points: [
            { x: 50, y: 0 },
            { x: 150, y: 0 },
          ],
        },
      ],
      width: 150,
      height: 50,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m.edgeCrossings).toBe(0);
    expect(m.overlappingEdgeLength).toBeCloseTo(50, 5);
  });

  it('counts arrowheads stacked beyond the threshold on one node side', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [],
      relations: [],
      packages: [],
    };
    // Every edge's last segment runs left→right, so each arrowhead enters the
    // target `T` from its left side.
    const approachLeft = (count: number): LayoutResult['edges'] =>
      Array.from({ length: count }, (_, i) => ({
        id: `rel-${i}`,
        source: `S${i}`,
        target: 'T',
        points: [
          { x: 0, y: i * 4 },
          { x: 90, y: i * 4 },
        ],
      }));
    const layout = (count: number): LayoutResult => ({
      nodes: [],
      edges: approachLeft(count),
      width: 100,
      height: 100,
    });

    expect(computeLayoutMetrics(model, layout(3)).hubArrowStack).toBe(0);
    expect(computeLayoutMetrics(model, layout(4)).hubArrowStack).toBe(1);
  });

  it('counts near-parallel segments 3px apart as overlapping over their shared projection', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [],
      relations: [],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [],
      edges: [
        {
          id: 'rel-0',
          source: 'A',
          target: 'B',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
        {
          id: 'rel-1',
          source: 'C',
          target: 'D',
          points: [
            { x: 40, y: 3 },
            { x: 140, y: 3 },
          ],
        },
      ],
      width: 150,
      height: 50,
    };
    expect(computeLayoutMetrics(model, layout).overlappingEdgeLength).toBeCloseTo(60, 5);

    // Beyond the proximity threshold the lines read as separate.
    layout.edges[1].points = [
      { x: 40, y: 20 },
      { x: 140, y: 20 },
    ];
    expect(computeLayoutMetrics(model, layout).overlappingEdgeLength).toBe(0);
  });

  it('measures a non-zero near-parallel overlap on the package.elk layout', async () => {
    const puml = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'archguard-package.puml'),
      'utf8',
    );
    const model = transformFullGraph(parsePlantUml(puml));
    const layout = await new ElkLayoutEngine().layout(model);
    expect(computeLayoutMetrics(model, layout).overlappingEdgeLength).toBeGreaterThan(0);
  });

  it('returns all-zero metrics for an empty model and layout', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [],
      relations: [],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    };

    const m = computeLayoutMetrics(model, layout);
    expect(m).toEqual({
      edgeCrossings: 0,
      edgeNodeIntersections: 0,
      nonOrthogonalEdgeCount: 0,
      totalEdgeLength: 0,
      areaUtilization: 0,
      aspectRatio: 0,
      textOverflowCount: 0,
      labelOverlapCount: 0,
      overlappingEdgeLength: 0,
      badgeLabelOverlap: 0,
      edgeLabelOverlap: 0,
      labelNodeOverlap: 0,
      hubArrowStack: 0,
      maxEmptyBlockRatio: 0,
      edgeFlushCount: 0,
    });
  });

  it('measures the largest empty block (maxEmptyBlockRatio)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B')],
      relations: [],
      packages: [],
    };
    const diagonal: LayoutResult = {
      nodes: [
        { id: 'A', x: 0, y: 0, width: 100, height: 100 },
        { id: 'B', x: 100, y: 100, width: 100, height: 100 },
      ],
      edges: [],
      width: 200,
      height: 200,
    };
    // Two opposite quadrants stay free; the biggest rectangle is one quadrant.
    expect(computeLayoutMetrics(model, diagonal).maxEmptyBlockRatio).toBeCloseTo(0.25, 5);

    const corner: LayoutResult = { ...diagonal, nodes: [diagonal.nodes[0]] };
    // One quadrant filled: the free L-shape holds a 200×100 band (half the canvas).
    expect(computeLayoutMetrics(model, corner).maxEmptyBlockRatio).toBeCloseTo(0.5, 5);

    // A package frame counts as occupied space.
    const framed: LayoutResult = { ...corner, nodes: [], packages: [{ id: 'P', x: 0, y: 0, width: 200, height: 100 }] };
    expect(computeLayoutMetrics(model, framed).maxEmptyBlockRatio).toBeCloseTo(0.5, 5);
  });

  it('counts edge segments flush with an unrelated node or frame border (edgeFlushCount)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C')],
      relations: [
        { source: 'A', target: 'B', type: 'association' },
        { source: 'A', target: 'B', type: 'association' },
      ],
      packages: [],
    };
    const nodes = [
      { id: 'A', x: 0, y: 0, width: 40, height: 20 },
      { id: 'B', x: 0, y: 200, width: 40, height: 20 },
      { id: 'C', x: 100, y: 80, width: 100, height: 40 },
    ];
    const layout = (x1: number, x2: number): LayoutResult => ({
      nodes,
      packages: [],
      edges: [
        { id: 'rel-0', source: 'A', target: 'B', points: [{ x: x1, y: 20 }, { x: x1, y: 200 }] },
        { id: 'rel-1', source: 'A', target: 'B', points: [{ x: x2, y: 20 }, { x: x2, y: 200 }] },
      ],
      width: 300,
      height: 240,
    });
    // x=102 hugs C's left side (2px); x=120 is 20px from both sides; endpoints A/B never count.
    expect(computeLayoutMetrics(model, layout(102, 120)).edgeFlushCount).toBe(1);
    expect(computeLayoutMetrics(model, layout(95, 120)).edgeFlushCount).toBe(1);
    expect(computeLayoutMetrics(model, layout(94, 120)).edgeFlushCount).toBe(0);

    // A package frame border counts too (the frame is not an endpoint).
    const framed: LayoutResult = {
      ...layout(120, 130),
      packages: [{ id: 'P', x: 0, y: 0, width: 300, height: 240 }],
    };
    expect(computeLayoutMetrics(model, framed).edgeFlushCount).toBe(0);
    const hugging: LayoutResult = { ...framed, edges: [{ ...framed.edges[0], points: [{ x: 3, y: 20 }, { x: 3, y: 200 }] }] };
    expect(computeLayoutMetrics(model, hugging).edgeFlushCount).toBe(1);
  });

  it('counts an edge label rectangle that lands on a node (labelNodeOverlap)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C')],
      relations: [{ source: 'A', target: 'B', type: 'association', label: 'uses', weight: 2 }],
      packages: [],
    };
    const edge = (pts: { x: number; y: number }[]): LayoutResult['edges'] => [
      { id: 'rel-0', source: 'A', target: 'B', points: pts },
    ];
    const bad: LayoutResult = {
      // The edge's only anchor positions all fall inside the wide node C.
      nodes: [
        { id: 'A', x: 0, y: 0, width: 10, height: 10 },
        { id: 'B', x: 10, y: 0, width: 10, height: 10 },
        { id: 'C', x: -200, y: -200, width: 500, height: 500 },
      ],
      edges: edge([
        { x: 10, y: 5 },
        { x: 11, y: 5 },
      ]),
      width: 300,
      height: 300,
    };
    expect(computeLayoutMetrics(model, bad).labelNodeOverlap).toBeGreaterThan(0);
    const good: LayoutResult = {
      ...bad,
      nodes: bad.nodes.slice(0, 2),
      edges: edge([
        { x: 10, y: 5 },
        { x: 400, y: 5 },
      ]),
    };
    expect(computeLayoutMetrics(model, good).labelNodeOverlap).toBe(0);
  });

  it('counts edges that contain a diagonal segment as non-orthogonal', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C')],
      relations: [
        { source: 'A', target: 'B', type: 'association' },
        { source: 'A', target: 'C', type: 'association' },
      ],
      packages: [],
    };
    const layout: LayoutResult = {
      nodes: [
        { id: 'A', x: 0, y: 0, width: 100, height: 50 },
        { id: 'B', x: 200, y: 0, width: 100, height: 50 },
        { id: 'C', x: 200, y: 200, width: 100, height: 50 },
      ],
      edges: [
        {
          id: 'rel-0',
          source: 'A',
          target: 'B',
          points: [
            { x: 100, y: 25 },
            { x: 200, y: 25 },
          ],
        },
        {
          id: 'rel-1',
          source: 'A',
          target: 'C',
          points: [
            { x: 50, y: 50 },
            { x: 250, y: 200 },
          ],
        },
      ],
      width: 300,
      height: 250,
    };
    expect(computeLayoutMetrics(model, layout).nonOrthogonalEdgeCount).toBe(1);
  });
});
