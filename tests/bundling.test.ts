import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, transformFullGraph, ElkLayoutEngine } from '../src/index.js';
import { renderSvg, EDGE_BUNDLE_MIN } from '../src/render/svg.js';
import type { LayoutResult } from '../src/layout.js';
import type { PlantUmlModel } from '../src/model.js';

const testDir = dirname(fileURLToPath(import.meta.url));

function fanOut(n: number): { model: PlantUmlModel; layout: LayoutResult } {
  const targets = Array.from({ length: n }, (_, i) => `T${i}`);
  const model: PlantUmlModel = {
    diagramType: 'class',
    entities: [{ id: 'S', name: 'S', kind: 'class', members: [] }, ...targets.map((t) => ({ id: t, name: t, kind: 'class' as const, members: [] }))],
    relations: targets.map((t, i) => ({ source: 'S', target: t, type: 'dependency' as const, weight: i === 0 ? 3 : undefined })),
    packages: [],
  };
  const layout: LayoutResult = {
    nodes: [
      { id: 'S', x: 0, y: 0, width: 400, height: 40 },
      ...targets.map((t, i) => ({ id: t, x: i * 100, y: 300, width: 80, height: 40 })),
    ],
    // Every edge leaves S downward from its own x, runs along a shared bus at y=150.
    edges: targets.map((t, i) => ({
      id: `rel-${i}`,
      source: 'S',
      target: t,
      points: [
        { x: 40 + i * 20, y: 40 },
        { x: 40 + i * 20, y: 150 },
        { x: 40 + i * 100, y: 150 },
        { x: 40 + i * 100, y: 300 },
      ],
    })),
    packages: [],
    width: 600,
    height: 360,
  };
  return { model, layout };
}

/** Visible line elements (paths) inside edge groups sourced at S. */
function edgePaths(svg: string, source: string): string[] {
  const groups = svg.match(new RegExp(`<g data-edge-source="${source}"[^>]*>.*?</g>(?=<g|<rect|<text|</svg>)`, 'gs')) ?? [];
  return groups.flatMap((g) => g.match(/<path d="[^"]*"[^>]*\/>/g) ?? []).filter((p) => !p.includes('uml-arrow'));
}

describe('edge bundling', () => {
  it('merges a ≥5-edge fan-out into one visible line carrying the summed weight', () => {
    const { model, layout } = fanOut(6);
    const svg = renderSvg(model, layout);
    expect(svg).toContain('uml-edge-bundle');
    expect(svg).toContain('data-bundle-size="6"');
    expect(svg).toContain('data-weight="8"'); // 3 + 5×1
    expect(edgePaths(svg, 'S').length).toBeLessThanOrEqual(2);
    // Each target keeps its own arrowhead.
    expect(svg.match(/uml-bundle-head/g)?.length).toBe(6);
    for (let i = 0; i < 6; i++) expect(svg).toContain(`data-edge-target="T${i}"`);
  });

  it('leaves fan-outs below the threshold as one line per edge', () => {
    const { model, layout } = fanOut(EDGE_BUNDLE_MIN - 1);
    const svg = renderSvg(model, layout);
    expect(svg).not.toContain('uml-edge-bundle');
    expect(edgePaths(svg, 'S').length).toBe(EDGE_BUNDLE_MIN - 1);
  });

  it('draws shared segments only once', () => {
    const { model, layout } = fanOut(5);
    // Make every edge identical up to the last leg so the trunk is common.
    layout.edges.forEach((e, i) => {
      e.points = [
        { x: 200, y: 40 },
        { x: 200, y: 150 },
        { x: 40 + i * 100, y: 150 },
        { x: 40 + i * 100, y: 300 },
      ];
    });
    const svg = renderSvg(model, layout);
    expect(svg.match(/M200 40L200 150/g)?.length).toBe(1);
  });

  it('bundles the src/cli/commands comb in the m-package rendering', async () => {
    const puml = readFileSync(join(testDir, 'fixtures', 'archguard-package.puml'), 'utf8');
    const model = transformFullGraph(parsePlantUml(puml));
    const layout = await new ElkLayoutEngine().layout(model);
    const svg = renderSvg(model, layout);
    const fan = model.relations.filter((r) => r.source === 'src_cli_commands' && r.type === 'dependency').length;
    expect(fan).toBeGreaterThanOrEqual(EDGE_BUNDLE_MIN);
    // The ≥5 edges leaving src/cli/commands in one direction collapse into a
    // single bundle element holding exactly one drawn line.
    const bundle = svg.match(/<g data-edge-source="src_cli_commands"[^>]*uml-edge-bundle">.*?<\/g>(?=<g data-edge|<rect|<text|<\/svg>)/s);
    expect(bundle).not.toBeNull();
    const size = Number(bundle![0].match(/data-bundle-size="(\d+)"/)![1]);
    expect(size).toBeGreaterThanOrEqual(EDGE_BUNDLE_MIN);
    expect(bundle![0]).toMatch(/data-weight="\d+"/);
    expect((bundle![0].match(/<path d="[^"]*" fill="none"/g) ?? []).length).toBe(1);
  });
});
