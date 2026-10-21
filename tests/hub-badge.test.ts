import { describe, it, expect } from 'vitest';
import { renderSvg } from '../src/render/svg.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { entityTextRects, hubBadgeRect, rectsIntersect } from '../src/render/labels.js';
import { LayoutResult } from '../src/layout.js';
import { PlantUmlModel } from '../src/model.js';

function hubModel(name: string): PlantUmlModel {
  return {
    diagramType: 'class',
    entities: [{ id: 'hub', name, kind: 'class', members: [], usageCount: 12 }],
    relations: [],
    packages: [],
  };
}

describe('hub badge placement', () => {
  it('draws the badge outside the node name for long and short names', async () => {
    for (const name of ['src/util', 'src/core/interfaces', 'src/core/query']) {
      const model = hubModel(name);
      const layout = await new ElkLayoutEngine().layout(model);
      const node = layout.nodes[0];

      const badge = hubBadgeRect(node);
      for (const text of entityTextRects(model.entities[0], node)) {
        expect(rectsIntersect(badge, text)).toBe(false);
      }
      expect(computeLayoutMetrics(model, layout).badgeLabelOverlap).toBe(0);

      // The SVG badge circle is centred on the node's top-right corner.
      const svg = renderSvg(model, layout);
      const circle = /<circle cx="([\d.-]+)" cy="([\d.-]+)" r="9"/.exec(svg)!;
      expect(Number(circle[1])).toBeCloseTo(node.x + node.width, 1);
      expect(Number(circle[2])).toBeCloseTo(node.y, 1);
    }
  });

  it('counts a badge that sits on an overflowing name (counter-example)', () => {
    const model = hubModel('src/core/interfaces');
    // Node far narrower than its name: the text spills across the corner badge.
    const layout: LayoutResult = {
      nodes: [{ id: 'hub', x: 0, y: 0, width: 40, height: 34 }],
      edges: [],
      width: 80,
      height: 60,
    };
    expect(computeLayoutMetrics(model, layout).badgeLabelOverlap).toBe(1);
  });

  it('does not count plain nodes without a badge', () => {
    const model = hubModel('src/core/interfaces');
    model.entities[0].usageCount = undefined;
    const layout: LayoutResult = {
      nodes: [{ id: 'hub', x: 0, y: 0, width: 40, height: 34 }],
      edges: [],
      width: 80,
      height: 60,
    };
    expect(computeLayoutMetrics(model, layout).badgeLabelOverlap).toBe(0);
  });
});
