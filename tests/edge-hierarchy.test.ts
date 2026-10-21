import { describe, it, expect } from 'vitest';
import { renderSvg } from '../src/render/svg.js';
import { defaultTheme } from '../src/render/theme.js';
import type { LayoutResult } from '../src/layout.js';
import type { PlantUmlModel } from '../src/model.js';

const { stroke, dash } = defaultTheme;

const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const model: PlantUmlModel = {
  diagramType: 'class',
  entities: ids.map((id) => ({ id, name: id, kind: 'class' as const, members: [] })),
  relations: [
    // heavy strong edge (weight 3), light weak edge, light strong edge, feedback edge
    { source: 'A', target: 'B', type: 'association', weight: 3 },
    { source: 'A', target: 'C', type: 'dependency' },
    { source: 'A', target: 'D', type: 'association' },
    { source: 'A', target: 'E', type: 'association', weight: 2 },
    { source: 'F', target: 'G', type: 'dependency', feedback: true },
  ],
  packages: [],
};
const layout: LayoutResult = {
  nodes: ids.map((id, i) => ({ id, x: i * 120, y: i === 5 || i === 6 ? 300 : 0, width: 80, height: 40 })),
  edges: model.relations.map((r, i) => ({
    id: `rel-${i}`,
    source: r.source,
    target: r.target,
    points: [
      { x: 40 + ids.indexOf(r.source) * 120, y: 40 },
      { x: 40 + ids.indexOf(r.source) * 120, y: 150 + i * 10 },
      { x: 40 + ids.indexOf(r.target) * 120, y: 150 + i * 10 },
      { x: 40 + ids.indexOf(r.target) * 120, y: i === 4 ? 300 : 0 },
    ],
  })),
  packages: [],
  width: 900,
  height: 400,
};

interface Look {
  width: string | undefined;
  opacity: string | undefined;
  dash: string | undefined;
}

function look(svg: string, source: string, target: string): Look {
  const group = new RegExp(`<g data-edge-source="${source}" data-edge-target="${target}"[^>]*>(.*?)</g>`, 's').exec(svg)![1];
  const path = /<path d="[^"]*" fill="none"[^>]*\/>/.exec(group)![0];
  const attr = (name: string): string | undefined => new RegExp(` ${name}="([^"]+)"`).exec(path)?.[1];
  return { width: attr('stroke-width'), opacity: attr('stroke-opacity'), dash: attr('stroke-dasharray') };
}

describe('edge hierarchy', () => {
  const svg = renderSvg(model, layout);
  const heavy = look(svg, 'A', 'B');
  const weak = look(svg, 'A', 'C');
  const strongLight = look(svg, 'A', 'D');
  const medium = look(svg, 'A', 'E');
  const feedback = look(svg, 'F', 'G');

  it('draws weight ≥ 3 heavier and more opaque than weight 1, from theme tokens', () => {
    expect(Number(heavy.width)).toBeGreaterThan(Number(strongLight.width));
    expect(Number(heavy.opacity)).toBeGreaterThan(Number(strongLight.opacity));
    expect(Number(medium.width)).toBeGreaterThan(Number(strongLight.width));
    expect(Number(medium.opacity)).toBeGreaterThan(Number(strongLight.opacity));
    expect(Number(heavy.opacity)).toBeGreaterThan(Number(medium.opacity));
    expect(Number(heavy.width)).toBe(stroke.edge + 2 * stroke.weightStep);
    expect(Number(heavy.opacity)).toBe(stroke.opacity.strong);
    expect(Number(strongLight.width)).toBe(stroke.edge);
    expect(Number(strongLight.opacity)).toBe(stroke.opacity.light);
  });

  it('separates strong, weak and cycle-feedback edges by width, opacity and line type', () => {
    const tiers = [heavy, weak, feedback];
    for (const key of ['width', 'opacity', 'dash'] as const) {
      expect(new Set(tiers.map((t) => t[key])).size, key).toBe(tiers.length);
    }
    expect(heavy.dash).toBeUndefined();
    expect(weak.dash).toBe(dash.weak);
    expect(feedback.dash).toBe(dash.feedback);
    expect(Number(feedback.width)).toBe(stroke.feedback);
    expect(Number(feedback.opacity)).toBe(stroke.opacity.feedback);
    expect(Number(weak.opacity)).toBe(stroke.opacity.light);
  });

  it('makes the strong/weak line type differ, not just the colour', () => {
    expect(strongLight.dash).not.toBe(weak.dash);
  });
});
