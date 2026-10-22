import { describe, it, expect } from 'vitest';
import { straightenTrunkDetours } from '../src/layout/trunk-lanes.js';
import { computeLayoutMetrics } from '../src/metrics/layout-metrics.js';
import { LayoutResult } from '../src/foundation/layout.js';
import { PlantUmlModel } from '../src/foundation/model.js';

const emptyModel: PlantUmlModel = { diagramType: 'class', entities: [], relations: [], packages: [] };
const node = (id: string, x: number, y: number, w = 100, h = 40) => ({ id, x, y, width: w, height: h });
const pts = (list: Array<[number, number]>) => list.map(([x, y]) => ({ x, y }));

/**
 * One source on top, its target at the bottom, and a row of unrelated nodes
 * between them. The routed edge overshoots to a far gap in the row and comes
 * back; the lane between the rows is the shorter way.
 */
function clusterBetween(): LayoutResult {
  return {
    nodes: [
      node('S', 100, 0),
      node('T', 160, 300),
      node('C1', 0, 120, 140, 40),
      node('C2', 180, 120, 140, 40),
      node('C3', 360, 120, 140, 40),
    ],
    edges: [
      {
        id: 'rel-0',
        source: 'S',
        target: 'T',
        points: pts([[150, 40], [150, 60], [740, 60], [740, 220], [210, 220], [210, 300]]),
      },
    ],
    packages: [{ id: 'P', x: -20, y: -20, width: 800, height: 400 }],
    width: 560,
    height: 400,
  };
}

describe('straightenTrunkDetours', () => {
  it('pulls an overshooting trunk back onto a lane between the rows', () => {
    const before = clusterBetween();
    expect(computeLayoutMetrics(emptyModel, before).trunkDetourCount).toBe(1);
    const after = straightenTrunkDetours(before);
    const path = after.edges[0].points;
    expect(computeLayoutMetrics(emptyModel, after).trunkDetourCount).toBe(0);
    expect(computeLayoutMetrics(emptyModel, after).edgeNodeIntersections).toBe(0);
    // ends stay attached to their ports
    expect(path[0]).toEqual({ x: 150, y: 40 });
    expect(path[path.length - 1]).toEqual({ x: 210, y: 300 });
    // the sideways run sits in the gap between the source row and the cluster row
    const horizontal = path.slice(1).filter((p, i) => p.y === path[i].y && p.x !== path[i].x);
    expect(horizontal.length).toBeGreaterThan(0);
    for (const p of horizontal) expect(p.y < 120 || p.y > 160).toBe(true); // not inside the cluster row
    const length = path.slice(1).reduce((s, p, i) => s + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);
    expect(length).toBeLessThan(500);
  });

  it('never routes through a node: when no lane is clear the edge is left alone', () => {
    const blocked = clusterBetween();
    // a full-width wall under the source leaves no gap to cross
    blocked.nodes.push(node('W', -30, 70, 860, 40));
    const out = straightenTrunkDetours(blocked);
    expect(out.edges[0].points).toEqual(blocked.edges[0].points);
  });

  it('leaves direct routes untouched', () => {
    const direct: LayoutResult = {
      nodes: [node('A', 0, 0), node('B', 0, 200)],
      edges: [{ id: 'rel-0', source: 'A', target: 'B', points: pts([[50, 40], [50, 200]]) }],
      width: 100,
      height: 240,
    };
    expect(straightenTrunkDetours(direct)).toBe(direct);
  });
});
