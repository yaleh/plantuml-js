import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeLayoutMetrics } from '../src/layout/layout-metrics.js';
import { parsePlantUml, transformFullGraph, ElkLayoutEngine } from '../src/index.js';
import { LayoutResult, PACKAGE_LABEL } from '../src/foundation/layout.js';
import { PlantUmlModel } from '../src/foundation/model.js';

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

  it('measures the package tab with the same geometry the renderer draws (PACKAGE_LABEL)', () => {
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('Inner', 'Inner', 'P')],
      relations: [],
      packages: [{ id: 'P', name: 'A' }],
    };
    const at = (y: number): LayoutResult => ({
      nodes: [{ id: 'Inner', x: 0, y, width: 100, height: 40 }],
      edges: [],
      packages: [{ id: 'P', x: 0, y: 0, width: 200, height: 200 }],
      width: 200,
      height: 200,
    });
    // Node starting one pixel inside the drawn tab overlaps; one starting at its bottom edge does not.
    expect(computeLayoutMetrics(model, at(PACKAGE_LABEL.tabHeight - 1)).labelOverlapCount).toBe(1);
    expect(computeLayoutMetrics(model, at(PACKAGE_LABEL.tabHeight)).labelOverlapCount).toBe(0);
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
      labelEdgeOverlap: 0,
      labelLabelOverlap: 0,
      hubArrowStack: 0,
      maxEmptyBlockRatio: 0,
      edgeFlushCount: 0,
      parallelBundleCount: 0,
      edgeFrameCrossings: 0,
      trunkDetourCount: 0,
      nestedLoopCount: 0,
      edgeNodeFlush: 0,
      frameFillRatio: 1,
      edgeCanvasMargin: 0,
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

  it('counts labels struck by a foreign edge (labelEdgeOverlap) and label pairs that collide (labelLabelOverlap)', () => {
    const rel = (label?: string, weight?: number) =>
      ({ source: 'A', target: 'B', type: 'association', label, weight }) as PlantUmlModel['relations'][number];
    const nodes = [
      { id: 'A', x: 0, y: 0, width: 20, height: 50 },
      { id: 'B', x: 220, y: 0, width: 20, height: 50 },
      { id: 'C', x: 100, y: 200, width: 20, height: 20 },
      { id: 'D', x: 100, y: 300, width: 20, height: 20 },
    ];
    const ab = [{ x: 20, y: 25 }, { x: 220, y: 25 }];

    // Clean: a labelled edge alone on the canvas.
    const clean: PlantUmlModel = {
      diagramType: 'class', entities: [entity('A'), entity('B')], relations: [rel('uses')], packages: [],
    };
    const cleanLayout: LayoutResult = {
      nodes: nodes.slice(0, 2), edges: [{ id: 'rel-0', source: 'A', target: 'B', points: ab }], width: 240, height: 50,
    };
    expect(computeLayoutMetrics(clean, cleanLayout)).toMatchObject({ labelEdgeOverlap: 0, labelLabelOverlap: 0 });

    // Struck: a dense comb of foreign verticals crosses every spot along the edge.
    const xs = Array.from({ length: 40 }, (_, k) => 24 + k * 5);
    const struck: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B'), entity('C'), entity('D')],
      relations: [rel(undefined, 3), { source: 'C', target: 'D', type: 'association' }],
      packages: [],
    };
    const struckLayout: LayoutResult = {
      nodes,
      edges: [
        { id: 'rel-0', source: 'A', target: 'B', points: ab },
        ...xs.map((x, k) => ({ id: `rel-${k === 0 ? 1 : 100 + k}`, source: 'C', target: 'D', points: [{ x, y: -40 }, { x, y: 90 }] })),
      ],
      width: 240,
      height: 320,
    };
    expect(computeLayoutMetrics(struck, struckLayout)).toMatchObject({ labelEdgeOverlap: 1, labelLabelOverlap: 0 });

    // Colliding: two weighted edges over the same 14px stub leave no free spot.
    const collide: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity('A'), entity('B')],
      relations: [rel(undefined, 2), rel(undefined, 2)],
      packages: [],
    };
    const stub = [{ x: 20, y: 25 }, { x: 34, y: 25 }];
    const collideLayout: LayoutResult = {
      nodes: [nodes[0], { id: 'B', x: 34, y: 0, width: 20, height: 50 }],
      edges: [
        { id: 'rel-0', source: 'A', target: 'B', points: stub },
        { id: 'rel-1', source: 'A', target: 'B', points: stub },
      ],
      width: 60,
      height: 50,
    };
    expect(computeLayoutMetrics(collide, collideLayout).labelLabelOverlap).toBe(1);
  });
});

describe('computeLayoutMetrics: parallelBundleCount', () => {
  const emptyModel: PlantUmlModel = { diagramType: 'class', entities: [], relations: [], packages: [] };
  /** `count` edges leaving one source, each a 300px horizontal run `spacing`px below the previous. */
  const comb = (count: number, spacing: number, source = (i: number) => 'S'): LayoutResult => ({
    nodes: [],
    edges: Array.from({ length: count }, (_, i) => ({
      id: `rel-${i}`,
      source: source(i),
      target: `T${i}`,
      points: [
        { x: 0, y: i * spacing },
        { x: 300, y: i * spacing },
      ],
    })),
    width: 400,
    height: Math.max(50, count * spacing),
  });

  it('counts a comb of 12 parallel lines from one source as one bundle', () => {
    expect(computeLayoutMetrics(emptyModel, comb(12, 8)).parallelBundleCount).toBe(1);
    expect(computeLayoutMetrics(emptyModel, comb(5, 16)).parallelBundleCount).toBe(1);
  });

  it('counts combs that share a target as well', () => {
    const layout = comb(8, 10);
    layout.edges.forEach((e, i) => {
      e.source = `S${i}`;
      e.target = 'T';
    });
    expect(computeLayoutMetrics(emptyModel, layout).parallelBundleCount).toBe(1);
  });

  it('ignores groups below five edges, lines further than 16px apart and unrelated edges', () => {
    expect(computeLayoutMetrics(emptyModel, comb(4, 8)).parallelBundleCount).toBe(0);
    expect(computeLayoutMetrics(emptyModel, comb(12, 20)).parallelBundleCount).toBe(0);
    expect(computeLayoutMetrics(emptyModel, comb(12, 8, (i) => `S${i}`)).parallelBundleCount).toBe(0);
  });

  it('ignores runs shorter than 120px', () => {
    const layout = comb(12, 8);
    for (const e of layout.edges) e.points[1].x = 100;
    expect(computeLayoutMetrics(emptyModel, layout).parallelBundleCount).toBe(0);
  });

  it('does not count a merged trunk (edges drawn exactly on top of each other)', () => {
    expect(computeLayoutMetrics(emptyModel, comb(12, 0)).parallelBundleCount).toBe(0);
  });

  it('does not count a trunk-and-branch tree as overlapping clutter either', () => {
    const layout = comb(6, 0);
    expect(computeLayoutMetrics(emptyModel, layout).overlappingEdgeLength).toBe(0);
  });
});

describe('computeLayoutMetrics: edgeFrameCrossings', () => {
  const model: PlantUmlModel = {
    diagramType: 'class',
    entities: [entity('a', 'a', 'A'), entity('b', 'b', 'B'), entity('c', 'c', 'C'), entity('q', 'q', 'Q')],
    relations: [],
    packages: [
      { id: 'A', name: 'A' },
      { id: 'B', name: 'B' },
      { id: 'C', name: 'C' },
      { id: 'P', name: 'P' },
      { id: 'Q', name: 'Q', parentId: 'P' },
    ],
  };
  const frame = (id: string, x: number, y: number, width: number, height: number) => ({ id, x, y, width, height });
  const layoutWith = (points: { x: number; y: number }[], source = 'a', target = 'c'): LayoutResult => ({
    nodes: [
      { id: 'a', x: 60, y: 120, width: 80, height: 40 },
      { id: 'b', x: 360, y: 120, width: 80, height: 40 },
      { id: 'c', x: 660, y: 120, width: 80, height: 40 },
      { id: 'q', x: 960, y: 140, width: 40, height: 20 },
    ],
    edges: [{ id: 'rel-0', source, target, points }],
    packages: [
      frame('A', 40, 100, 120, 100),
      frame('B', 340, 100, 120, 100),
      frame('C', 640, 100, 120, 100),
      frame('P', 900, 100, 160, 160),
      frame('Q', 940, 120, 100, 100),
    ],
    width: 1100,
    height: 300,
  });

  it('counts an edge cut straight through an unrelated package frame', () => {
    const across = [
      { x: 140, y: 140 },
      { x: 660, y: 140 },
    ];
    expect(computeLayoutMetrics(model, layoutWith(across)).edgeFrameCrossings).toBe(1);
  });

  it('does not count an edge that runs in the gutters around the frame', () => {
    const around = [
      { x: 100, y: 120 },
      { x: 100, y: 60 },
      { x: 700, y: 60 },
      { x: 700, y: 120 },
    ];
    expect(computeLayoutMetrics(model, layoutWith(around)).edgeFrameCrossings).toBe(0);
  });

  it("does not count the frames of the edge's own endpoints or their ancestors", () => {
    const into = [
      { x: 140, y: 140 },
      { x: 960, y: 140 },
    ];
    // a → q: A (a's own frame) and P/Q (q's frame and its parent) are related; B and C sit between.
    const m = computeLayoutMetrics(model, layoutWith(into, 'a', 'q'));
    expect(m.edgeFrameCrossings).toBe(2);
    const own = [
      { x: 100, y: 120 },
      { x: 100, y: 180 },
    ];
    expect(computeLayoutMetrics(model, layoutWith(own, 'a', 'a')).edgeFrameCrossings).toBe(0);
  });
});

describe('computeLayoutMetrics: trunk detours, nested loops, node-flush edges', () => {
  const emptyModel: PlantUmlModel = { diagramType: 'class', entities: [], relations: [], packages: [] };
  const node = (id: string, x: number, y: number, w = 40, h = 40) => ({ id, x, y, width: w, height: h });
  const edge = (id: string, source: string, target: string, pts: Array<[number, number]>) => ({
    id,
    source,
    target,
    points: pts.map(([x, y]) => ({ x, y })),
  });

  it('counts a trunk that circles a cluster as a detour and a nested loop', () => {
    const layout: LayoutResult = {
      nodes: [node('S', 0, 100), node('T', 400, 100), node('C1', 150, 100), node('C2', 220, 100)],
      edges: [
        // direct lane between the rows: straight, no detour
        edge('rel-0', 'S', 'T', [[40, 120], [400, 120]]),
        // outer loop round the cluster: 40,120 -> up -> across -> down -> T
        edge('rel-1', 'S', 'T', [[20, 100], [20, 0], [420, 0], [420, 100]]),
        // inner loop round the cluster, strictly inside the outer one
        edge('rel-2', 'S', 'T', [[30, 100], [30, 20], [410, 20], [410, 100]]),
      ],
      packages: [{ id: 'P', x: 0, y: 0, width: 460, height: 200 }],
      width: 460,
      height: 200,
    };
    const m = computeLayoutMetrics(emptyModel, layout);
    expect(m.trunkDetourCount).toBe(0);
    expect(m.nestedLoopCount).toBe(0); // the loops enclose no node: they are not coils yet
    const wrapping: LayoutResult = {
      ...layout,
      nodes: [node('S', 0, 100), node('T', 400, 100), node('C1', 100, 40), node('C2', 200, 40)],
      edges: [
        edge('rel-1', 'S', 'T', [[20, 100], [20, 0], [420, 0], [420, 100]]),
        edge('rel-2', 'S', 'T', [[30, 100], [30, 20], [410, 20], [410, 100]]),
      ],
    };
    const w = computeLayoutMetrics(emptyModel, wrapping);
    expect(w.nestedLoopCount).toBe(1);
    expect(w.trunkDetourCount).toBe(0);
    // a short hop that goes up, over and back down: 250px of line for 50px of distance
    const hop = { ...wrapping, edges: [edge('rel-3', 'S', 'T', [[0, 100], [0, 0], [50, 0], [50, 100]])] };
    expect(computeLayoutMetrics(emptyModel, hop).trunkDetourCount).toBe(1);
  });

  it('leaves a lane between rows alone', () => {
    const layout: LayoutResult = {
      nodes: [node('S', 0, 0), node('T', 300, 200), node('C', 150, 0)],
      edges: [edge('rel-0', 'S', 'T', [[20, 40], [20, 120], [320, 120], [320, 200]])],
      packages: [{ id: 'P', x: 0, y: 0, width: 400, height: 260 }],
      width: 400,
      height: 260,
    };
    const m = computeLayoutMetrics(emptyModel, layout);
    expect(m.trunkDetourCount).toBe(0);
    expect(m.nestedLoopCount).toBe(0);
  });

  it('counts a long segment hugging its own node as edgeNodeFlush', () => {
    const hugging: LayoutResult = {
      nodes: [node('A', 0, 0, 200, 40), node('B', 300, 100)],
      edges: [edge('rel-0', 'A', 'B', [[0, 41], [200, 41], [200, 120], [300, 120]])],
      width: 400,
      height: 200,
    };
    expect(computeLayoutMetrics(emptyModel, hugging).edgeNodeFlush).toBe(1);
    const clear: LayoutResult = {
      ...hugging,
      edges: [edge('rel-0', 'A', 'B', [[100, 40], [100, 120], [300, 120]])],
    };
    expect(computeLayoutMetrics(emptyModel, clear).edgeNodeFlush).toBe(0);
  });
});

describe('computeLayoutMetrics: frameFillRatio and edgeCanvasMargin', () => {
  const emptyModel: PlantUmlModel = { diagramType: 'class', entities: [], relations: [], packages: [] };
  const node = (id: string, x: number, y: number) => ({ id, x, y, width: 50, height: 20 });

  it('measures the emptiest frame holding at least 6 nodes', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`, 10 + (i % 2) * 100, 10 + Math.floor(i / 2) * 40));
    const layout: LayoutResult = {
      nodes: [...nodes, node('lone', 400, 10)],
      edges: [],
      packages: [
        { id: 'Big', x: 0, y: 0, width: 200, height: 150 },
        { id: 'Small', x: 390, y: 0, width: 100, height: 100 },
      ],
      width: 500,
      height: 200,
    };
    // 6 nodes × 1000 px² in a 200×150 frame; the 1-node frame is ignored
    expect(computeLayoutMetrics(emptyModel, layout).frameFillRatio).toBeCloseTo(6000 / 30000, 6);
    expect(computeLayoutMetrics(emptyModel, { ...layout, packages: [] }).frameFillRatio).toBe(1);
  });

  it('measures the closest edge point to any canvas side', () => {
    const layout: LayoutResult = {
      nodes: [node('A', 30, 30), node('B', 200, 30)],
      edges: [{ id: 'rel-0', source: 'A', target: 'B', points: [{ x: 80, y: 40 }, { x: 80, y: 7 }, { x: 225, y: 7 }, { x: 225, y: 30 }] }],
      width: 300,
      height: 100,
    };
    expect(computeLayoutMetrics(emptyModel, layout).edgeCanvasMargin).toBe(7);
    expect(computeLayoutMetrics(emptyModel, { ...layout, edges: [] }).edgeCanvasMargin).toBe(100);
  });
});
