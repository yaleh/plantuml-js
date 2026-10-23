import { describe, it, expect } from 'vitest';
import { parsePlantUml } from '../src/index.js';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { renderSvg } from '../src/render/svg.js';
import {
  compartmentHeights,
  estimateEntitySize,
  METRICS,
  PACKAGE_LABEL,
  snapUp,
} from '../src/foundation/layout.js';
import { computeLayoutMetrics } from '../src/metrics/layout-metrics.js';
import { PlantUmlModel } from '../src/foundation/model.js';

const compositePuml = [
  '@startuml',
  'class Service {',
  '  +name: string',
  '  +start(): void',
  '  +stop(): void',
  '}',
  '@enduml',
].join('\n');

const interfacePuml = [
  '@startuml',
  'interface Runner {',
  '  +run(): void',
  '}',
  '@enduml',
].join('\n');

/** Count non-overlapping occurrences of `needle`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The `<g class="uml-node">` group of the first entity, up to its closing tag. */
function nodeGroup(svg: string): string {
  const match = svg.match(/<g data-entity-id="[^"]*"[\s\S]*?<\/g>/);
  expect(match).not.toBeNull();
  return match![0];
}

function num(group: string, attr: string): number {
  const match = group.match(new RegExp(`\\b${attr}="([^"]+)"`));
  expect(match, `missing ${attr}`).not.toBeNull();
  return Number(match![1]);
}

async function modelOf(puml: string): Promise<PlantUmlModel> {
  return parsePlantUml(puml);
}

describe('render-compartments: three-compartment class boxes', () => {
  it('groups fields and methods into attr/ops compartments with two rules', async () => {
    const model = await modelOf(compositePuml);
    const entity = model.entities[0];
    expect(entity.members.map((m) => m.kind)).toEqual(['field', 'method', 'method']);

    const layout = await new ElkLayoutEngine().layout(model);
    const svg = renderSvg(model, layout);

    expect(count(svg, 'class="uml-compartment-rule"')).toBe(2);
    expect(svg).toContain('data-rule="title"');
    expect(svg).toContain('data-rule="ops"');

    // Member text carries its compartment class.
    expect(svg).toMatch(/<text[^>]*class="uml-attr"[^>]*>\+name: string<\/text>/);
    expect(svg).toMatch(/<text[^>]*class="uml-op"[^>]*>\+start\(\): void<\/text>/);
    expect(svg).toMatch(/<text[^>]*class="uml-op"[^>]*>\+stop\(\): void<\/text>/);
  });

  it('draws a single title rule for a methods-only interface', async () => {
    const model = await modelOf(interfacePuml);
    const entity = model.entities[0];
    expect(entity.kind).toBe('interface');
    expect(entity.members.every((m) => m.kind === 'method')).toBe(true);

    const layout = await new ElkLayoutEngine().layout(model);
    const svg = renderSvg(model, layout);

    expect(count(svg, 'class="uml-compartment-rule"')).toBe(1);
    expect(svg).toContain('data-rule="title"');
    expect(svg).not.toContain('data-rule="ops"');
    expect(svg).toMatch(/<text[^>]*class="uml-op"[^>]*>\+run\(\): void<\/text>/);
  });

  it('keeps both separator rules when all text is hidden (LOD zoom)', async () => {
    const model = await modelOf(compositePuml);
    const layout = await new ElkLayoutEngine().layout(model);
    const svg = renderSvg(model, layout);
    const withoutText = svg.replace(/<text\b[\s\S]*?<\/text>/g, '');

    expect(count(withoutText, 'class="uml-compartment-rule"')).toBe(2);
  });
});

describe('render-compartments: size consistency', () => {
  it('sizes the box as title + attr rows + op rows and matches the layout node', async () => {
    const model = await modelOf(compositePuml);
    const entity = model.entities[0];
    const bands = compartmentHeights(entity);

    expect(bands).toEqual({
      title: METRICS.lineHeight,
      attrs: METRICS.lineHeight,
      ops: 2 * METRICS.lineHeight,
    });

    const size = estimateEntitySize(entity);
    expect(size.height).toBe(
      snapUp(bands.title + bands.attrs + bands.ops + METRICS.paddingY * 2),
    );

    const layout = await new ElkLayoutEngine().layout(model);
    const node = layout.nodes[0];
    expect(node.height).toBe(size.height);
    expect(node.width).toBe(size.width);
    expect(computeLayoutMetrics(model, layout).textOverflowCount).toBe(0);

    const svg = renderSvg(model, layout);
    const group = nodeGroup(svg);
    const rect = group.match(/<rect\b[^>]*>/);
    expect(rect).not.toBeNull();
    expect(num(rect![0], 'height')).toBe(node.height);
    expect(num(rect![0], 'width')).toBe(node.width);

    // Every member row stays inside the drawn box.
    const opsTop = node.y + METRICS.paddingY + bands.title + bands.attrs;
    const lastRowBottom = opsTop + bands.ops;
    expect(lastRowBottom).toBeLessThanOrEqual(node.y + node.height);
  });
});

describe('render-compartments: geometry metadata', () => {
  it('puts x/y/w/h and per-compartment heights on the uml-node group', async () => {
    const model = await modelOf(compositePuml);
    const layout = await new ElkLayoutEngine().layout(model);
    const node = layout.nodes[0];
    const bands = compartmentHeights(model.entities[0]);
    const svg = renderSvg(model, layout);
    const group = nodeGroup(svg);

    expect(group).toContain('class="uml-node"');
    expect(num(group, 'data-x')).toBe(node.x);
    expect(num(group, 'data-y')).toBe(node.y);
    expect(num(group, 'data-w')).toBe(node.width);
    expect(num(group, 'data-h')).toBe(node.height);
    expect(num(group, 'data-title-h')).toBe(bands.title);
    expect(num(group, 'data-attrs-h')).toBe(bands.attrs);
    expect(num(group, 'data-ops-h')).toBe(bands.ops);
  });
});

describe('render-compartments: closed package tab', () => {
  it('draws a closed tab path with tab geometry metadata', async () => {
    const model = await modelOf(
      '@startuml\npackage "X" {\n  class A\n}\n@enduml',
    );
    const layout = await new ElkLayoutEngine().layout(model);
    const box = layout.packages!.find((p) => p.id === 'X')!;
    const svg = renderSvg(model, layout);

    expect(svg).toContain('<path class="uml-package-tab"');
    expect(svg).not.toContain('<line class="uml-package-tab"');

    const tab = svg.match(/<path class="uml-package-tab"[^>]*>/);
    expect(tab).not.toBeNull();
    const d = tab![0].match(/\bd="([^"]+)"/)![1];
    // Closed rectangle: M x,y → H right → V bottom → H left → Z.
    const coords = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(d).toMatch(/^M .+ H .+ V .+ H .+ Z$/);
    const [x, y, right, bottom, left] = coords;
    expect(x).toBe(box.x);
    expect(y).toBe(box.y);
    expect(left).toBe(box.x);
    expect(right).toBeGreaterThan(x);
    expect(bottom).toBe(y + PACKAGE_LABEL.tabHeight);

    const group = svg.match(/<g data-package-id="X"[^>]*>/);
    expect(group).not.toBeNull();
    expect(num(group![0], 'data-x')).toBe(box.x);
    expect(num(group![0], 'data-y')).toBe(box.y);
    expect(num(group![0], 'data-w')).toBe(box.width);
    expect(num(group![0], 'data-h')).toBe(box.height);
    expect(num(group![0], 'data-tab-h')).toBe(PACKAGE_LABEL.tabHeight);
    expect(num(group![0], 'data-tab-w')).toBe(right - x);
  });
});
