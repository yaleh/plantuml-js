import { describe, it, expect } from 'vitest';
import { renderSvg } from '../src/render/svg.js';
import { defaultTheme } from '../src/render/theme.js';
import type { LayoutResult } from '../src/foundation/layout.js';
import type { PlantUmlModel, PlantUmlRelation } from '../src/foundation/model.js';

const { stroke, dash } = defaultTheme;

const types: PlantUmlRelation['type'][] = ['inheritance', 'implementation', 'composition', 'aggregation', 'association', 'dependency'];
const ids = ['S', ...types.map((_, i) => `T${i}`), 'H', 'L', 'W', 'X'];
const rels: PlantUmlRelation[] = [
  ...types.map((type, i) => ({ source: 'S', target: `T${i}`, type })),
  { source: 'H', target: 'L', type: 'association', weight: 5 },
  { source: 'H', target: 'W', type: 'association' },
  { source: 'W', target: 'X', type: 'association', feedback: true },
];
const model: PlantUmlModel = {
  diagramType: 'class',
  entities: ids.map((id) => ({ id, name: id, kind: 'class' as const, members: [] })),
  relations: rels,
  packages: [],
};
const pos = (id: string): number => ids.indexOf(id) * 120;
const layout: LayoutResult = {
  nodes: ids.map((id) => ({ id, x: pos(id), y: 0, width: 80, height: 40 })),
  edges: rels.map((r, i) => ({
    id: `rel-${i}`,
    source: r.source,
    target: r.target,
    points: [
      { x: pos(r.source) + 40, y: 40 },
      { x: pos(r.source) + 40, y: 100 + i * 6 },
      { x: pos(r.target) + 40, y: 100 + i * 6 },
      { x: pos(r.target) + 40, y: 40 },
    ],
  })),
  packages: [],
  width: 1600,
  height: 300,
};

function path(svg: string, source: string, target: string): string {
  const group = new RegExp(`<g data-edge-source="${source}" data-edge-target="${target}"[^>]*>(.*?)</g>`, 's').exec(svg)![1];
  return /<path d="[^"]*" fill="none"[^>]*\/>/.exec(group)![0];
}
const attr = (p: string, name: string): string | undefined => new RegExp(` ${name}="([^"]+)"`).exec(p)?.[1];

describe('line semantics', () => {
  const svg = renderSvg(model, layout);

  it('draws inheritance/implementation/composition/aggregation/association solid', () => {
    types.slice(0, 5).forEach((_, i) => expect(attr(path(svg, 'S', `T${i}`), 'stroke-dasharray')).toBeUndefined());
  });

  it('draws a dependency dashed and a feedback edge dash-dot, from theme tokens', () => {
    expect(attr(path(svg, 'S', 'T5'), 'stroke-dasharray')).toBe(dash.weak);
    expect(attr(path(svg, 'W', 'X'), 'stroke-dasharray')).toBe(dash.feedback);
    expect(dash.feedback).not.toBe(dash.weak);
  });

  it('encodes weight with width and opacity, not dashes', () => {
    const heavy = path(svg, 'H', 'L');
    const light = path(svg, 'H', 'W');
    expect(Number(attr(heavy, 'stroke-width'))).toBeGreaterThan(Number(attr(light, 'stroke-width')));
    expect(Number(attr(heavy, 'stroke-opacity'))).toBeGreaterThan(Number(attr(light, 'stroke-opacity')));
    expect(Number(attr(light, 'stroke-width'))).toBe(stroke.edge);
    expect(attr(heavy, 'stroke-dasharray')).toBeUndefined();
  });
});
