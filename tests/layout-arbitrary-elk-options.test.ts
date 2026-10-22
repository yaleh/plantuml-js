import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ElkLayoutEngine } from '../src/layout/elk.js';
import { createRenderer } from '../src/core.js';
import type { PlantUmlEntity, PlantUmlModel, PlantUmlPackage, PlantUmlRelation } from '../src/foundation/model.js';

const testDir = dirname(fileURLToPath(import.meta.url));

/** The elkjs graph shape the probe below only needs to read back. */
interface ProbedNode {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: ProbedNode[];
}

/**
 * Capture every graph handed to the engine's elkjs instance. Monkey-patching the
 * private instance is the probe used elsewhere in the suite (see
 * layout-compound-proportion.test.ts) and is the only place the *exact*
 * `layoutOptions` ELK receives are visible.
 */
function captureGraphs(engine: ElkLayoutEngine): ProbedNode[] {
  const graphs: ProbedNode[] = [];
  const elk = (engine as unknown as { elk: { layout: (graph: ProbedNode) => Promise<unknown> } }).elk;
  const realLayout = elk.layout.bind(elk);
  elk.layout = (graph) => {
    graphs.push(graph);
    return realLayout(graph);
  };
  return graphs;
}

/** All nodes of a probed graph whose id marks a package container (`pkg::…`). */
function packageContainers(graph: ProbedNode): { node: ProbedNode; depth: number }[] {
  const out: { node: ProbedNode; depth: number }[] = [];
  const walk = (node: ProbedNode, depth: number): void => {
    if (node.id.startsWith('pkg::')) out.push({ node, depth });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const child of graph.children ?? []) walk(child, 1);
  return out;
}

function entity(id: string): PlantUmlEntity {
  return { id, name: id, kind: 'class', members: [] };
}

/**
 * 22 memberless nodes on four layers (1 → 7 → 7 → 7). Laid out normally the
 * canvas is wide (seven siblings side by side); Coffman-Graham with a layer
 * bound of 2 must stack those siblings instead and make it narrow.
 */
function fanModel(): PlantUmlModel {
  const entities: PlantUmlEntity[] = [];
  for (let i = 0; i < 22; i++) entities.push(entity(`n${i}`));
  const relations: PlantUmlRelation[] = [];
  for (let i = 1; i <= 7; i++) {
    relations.push({ source: 'n0', target: `n${i}`, type: 'dependency' });
    relations.push({ source: `n${i}`, target: `n${i + 7}`, type: 'dependency' });
    relations.push({ source: `n${i + 7}`, target: `n${i + 14}`, type: 'dependency' });
  }
  return { diagramType: 'class', entities, relations, packages: [] };
}

/** Packages nested two deep: one top-level package, two sub-packages, leaves. */
function nestedModel(): PlantUmlModel {
  const packages: PlantUmlPackage[] = [
    { id: 'top', name: 'top' },
    { id: 'top.a', name: 'a', parentId: 'top' },
    { id: 'top.b', name: 'b', parentId: 'top' },
    { id: 'top.a.inner', name: 'inner', parentId: 'top.a' },
  ];
  const entities: PlantUmlEntity[] = [
    { id: 'a1', name: 'A1', kind: 'class', members: [], packageId: 'top.a' },
    { id: 'a2', name: 'A2', kind: 'class', members: [], packageId: 'top.a' },
    { id: 'b1', name: 'B1', kind: 'class', members: [], packageId: 'top.b' },
    { id: 'i1', name: 'I1', kind: 'class', members: [], packageId: 'top.a.inner' },
    { id: 'i2', name: 'I2', kind: 'class', members: [], packageId: 'top.a.inner' },
  ];
  const relations: PlantUmlRelation[] = [
    { source: 'a1', target: 'a2', type: 'dependency' },
    { source: 'a1', target: 'i1', type: 'dependency' },
    { source: 'i1', target: 'i2', type: 'dependency' },
    { source: 'a2', target: 'b1', type: 'dependency' },
  ];
  return { diagramType: 'class', entities, relations, packages };
}

const AC1_ELK = {
  'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
  'elk.layered.layering.coffmanGraham.layerBound': '2',
};

describe('layoutOptions.elk — raw ELK options escape hatch', () => {
  it('injects the raw keys into the root graph and narrows the canvas', async () => {
    const model = fanModel();
    const baselineEngine = new ElkLayoutEngine();
    const baselineGraphs = captureGraphs(baselineEngine);
    const baseline = await baselineEngine.layout(model);
    const boundEngine = new ElkLayoutEngine({ elk: AC1_ELK });
    const boundGraphs = captureGraphs(boundEngine);
    const bound = await boundEngine.layout(model);

    // One hierarchical run each, and the raw keys reach the root verbatim.
    expect(baselineGraphs).toHaveLength(1);
    expect(boundGraphs).toHaveLength(1);
    const rootOptions = boundGraphs[0].layoutOptions ?? {};
    for (const [key, value] of Object.entries(AC1_ELK)) {
      expect(rootOptions[key]).toBe(value);
      // The baseline never carries a key it was not given.
      expect(baselineGraphs[0].layoutOptions?.[key]).toBeUndefined();
    }

    // Seven siblings side by side is wide; a layer bound of 2 is a tall sliver.
    const baselineAspect = baseline.width / baseline.height;
    const boundAspect = bound.width / bound.height;
    expect(baselineAspect).toBeGreaterThan(1);
    expect(boundAspect).toBeLessThan(1);
    expect(boundAspect).toBeLessThan(baselineAspect * 0.75);
  });

  it('reaches every package container node, recursively (≥2 nesting levels)', async () => {
    const model = nestedModel();
    const engine = new ElkLayoutEngine({ elk: AC1_ELK });
    const graphs = captureGraphs(engine);
    await engine.layout(model);

    const containers = graphs.flatMap(packageContainers);
    const ids = containers.map(({ node }) => node.id);
    // The probe must actually have seen the nested structure: the top package,
    // its two children and the grandchild container.
    expect(ids).toEqual(expect.arrayContaining(['pkg::top', 'pkg::top.a', 'pkg::top.b', 'pkg::top.a.inner']));
    expect(Math.max(...containers.map(({ depth }) => depth))).toBeGreaterThanOrEqual(3);
    for (const { node } of containers) {
      for (const [key, value] of Object.entries(AC1_ELK)) {
        expect(node.layoutOptions?.[key], `${node.id} ${key}`).toBe(value);
      }
    }
  });

  it('lets an explicitly-set named option win a same-key collision, but not a default', async () => {
    const engine = new ElkLayoutEngine({
      aspectRatio: 3,
      elk: { 'elk.aspectRatio': '0.5', 'elk.edgeRouting': 'POLYLINE' },
    });
    const graphs = captureGraphs(engine);
    await engine.layout(fanModel());
    // The hierarchical run is the root graph; the compound path also probes
    // candidate rect packings that deliberately retune the ratio.
    const root = graphs.find((g) => g.id === 'root');
    expect(root).toBeDefined();
    const rootOptions = root!.layoutOptions ?? {};
    // Named option wins over the raw key of the same name...
    expect(rootOptions['elk.aspectRatio']).toBe('3');
    // ...while a raw key only overrides the built-in default.
    expect(rootOptions['elk.edgeRouting']).toBe('POLYLINE');
  });

  it('omitting elk renders byte-identically (empty elk changes nothing)', async () => {
    const puml = readFileSync(join(testDir, 'fixtures', 'archguard-package.puml'), 'utf8');
    const base = await createRenderer().render(puml);
    const empty = await createRenderer({ layout: 'elk', layoutOptions: { elk: {} } }).render(puml);
    expect(empty.svg).toBe(base.svg);

    const model = nestedModel();
    const a = await new ElkLayoutEngine().layout(model);
    const b = await new ElkLayoutEngine({ elk: {} }).layout(model);
    expect(b).toEqual(a);
  });
});
