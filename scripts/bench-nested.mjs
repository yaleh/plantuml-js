#!/usr/bin/env node
/**
 * bench-nested.mjs — compound-layout proportion benchmark.
 *
 * Lays the sanitized 789-node archguard neighbourhood
 * (tests/fixtures/archguard-neighborhood.json) out three ways — flat (no
 * packages), nested-full (one package per source directory) and nested-depth4
 * (directories truncated to four levels) — and prints layoutMs / canvas /
 * crossings / nodeIntersect for each. Exits 1 when a budget is violated.
 *
 * It then walks a synthetic nested scale ladder (500/800/2000 entities) that
 * reproduces the 0.3.0 superlinearity report: 500 and 800 nodes lay out in
 * well under a second, 2000 nodes (the reported 3186-edge nested graph) took
 * minutes because the compound layout's cross-block router and its cosmetic
 * edge-polishing passes grow with the canvas area. The budgets assert the
 * large-graph degradation keeps 2000 nodes ≤30 s without collapsing the
 * canvas aspect or routing edges through nodes.
 *
 * Usage: node scripts/bench-nested.mjs [--no-build] [--svg <dir>]
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.includes('--no-build')) {
  execSync('npx tsc -p tsconfig.json', { cwd: repoRoot, stdio: 'inherit' });
}
const svgDir = args.includes('--svg') ? args[args.indexOf('--svg') + 1] : undefined;

const { ElkLayoutEngine, transformFullGraph } = await import(
  pathToFileURL(join(repoRoot, 'dist', 'index.js')).href
);
const { renderSvg } = await import(pathToFileURL(join(repoRoot, 'dist', 'render', 'svg.js')).href);
const { computeLayoutMetrics } = await import(
  pathToFileURL(join(repoRoot, 'dist', 'layout', 'layout-metrics.js')).href
);

const fixture = JSON.parse(
  readFileSync(join(repoRoot, 'tests', 'fixtures', 'archguard-neighborhood.json'), 'utf8'),
);

/** Node id `<hash>/<dir>/…/<file>.<ext>.<Symbol>` → directory segments. */
function dirsOf(id) {
  const parts = id.split('/');
  parts.pop(); // `<file>.<ext>.<Symbol>`
  return parts;
}

function buildModel(maxDepth) {
  const index = new Map(fixture.nodes.map((n, i) => [n.id, `n${i}`]));
  const packages = new Map();
  const entities = fixture.nodes.map((n, i) => {
    const entity = { id: `n${i}`, name: n.label, kind: 'class', members: [] };
    if (maxDepth > 0) {
      const dirs = dirsOf(n.id).slice(0, maxDepth === Infinity ? undefined : maxDepth);
      let parentId;
      for (let d = 0; d < dirs.length; d++) {
        const id = dirs.slice(0, d + 1).join('/');
        if (!packages.has(id)) packages.set(id, { id, name: dirs[d], parentId });
        parentId = id;
      }
      if (parentId !== undefined) entity.packageId = parentId;
    }
    return entity;
  });
  const relations = fixture.edges
    .filter((e) => index.has(e.from) && index.has(e.to))
    .map((e) => ({ source: index.get(e.from), target: index.get(e.to), type: e.relationType }));
  return transformFullGraph({
    diagramType: 'class',
    entities,
    relations,
    packages: [...packages.values()],
  });
}

/**
 * A deterministic nested model of `nodesWanted` entities in `edgesWanted`
 * relations: top packages of four nested levels (top → sub → leaf → classes),
 * matching the reported graph's package depth and its 1.6 edges/entity density
 * at 2000 nodes. Edges stay local (70% same leaf, 15% same sub-package, 11%
 * same top package, 4% cross top package), so the scale ladder exercises the
 * nested compound layout rather than a fully random graph.
 */
function syntheticNested(nodesWanted, edgesWanted, seed = 987654321) {
  const CLASSES = 14;
  const packages = [];
  const entities = [];
  const byLeaf = new Map();
  const bySub = new Map();
  const byTop = new Map();
  for (let t = 0; entities.length < nodesWanted; t++) {
    const top = `t${t}`;
    packages.push({ id: top, name: `top${t}` });
    byTop.set(top, []);
    for (let s = 0; s < 2; s++) {
      const sub = `${top}/s${s}`;
      packages.push({ id: sub, name: `s${s}`, parentId: top });
      bySub.set(sub, []);
      for (let l = 0; l < 2; l++) {
        const leaf = `${sub}/l${l}`;
        packages.push({ id: leaf, name: `l${l}`, parentId: sub });
        byLeaf.set(leaf, []);
        for (let c = 0; c < CLASSES && entities.length < nodesWanted; c++) {
          const entity = { id: `${leaf}/C${c}`, name: `K${t}_${s}_${l}_${c}`, kind: 'class', members: [], packageId: leaf };
          entities.push(entity);
          byLeaf.get(leaf).push(entity);
          bySub.get(sub).push(entity);
          byTop.get(top).push(entity);
        }
      }
    }
  }
  let state = seed >>> 0;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const seen = new Set();
  const relations = [];
  for (let attempts = 0; relations.length < edgesWanted && attempts < edgesWanted * 50; attempts++) {
    const source = entities[Math.floor(random() * entities.length)];
    const leaf = source.packageId;
    const sub = leaf.slice(0, leaf.lastIndexOf('/'));
    const top = sub.slice(0, sub.lastIndexOf('/'));
    const roll = random();
    const pool = roll < 0.7 ? byLeaf.get(leaf) : roll < 0.85 ? bySub.get(sub) : roll < 0.96 ? byTop.get(top) : entities;
    const target = pool[Math.floor(random() * pool.length)];
    if (target.id === source.id) continue;
    const key = `${source.id}\u0000${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push({ source: source.id, target: target.id, type: 'dependency' });
  }
  return transformFullGraph({ diagramType: 'class', entities, relations, packages });
}

const budgets = {
  // 2 s was measured on an idle host; this shared 128-core box runs the same
  // layout at 2.2-2.9 s under load. 5 s still catches the 40 s compound
  // regression this guard exists for (gap-layout-flat-large-graph-regression).
  flat: { crossings: 1000, layoutMs: 5000 },
  'nested-full': { width: 10000, crossings: 800, nodeIntersect: 0, layoutMs: 5000, aspect: 3 },
  'nested-depth4': {},
};
const scaleBudgets = {
  'scale-500': { layoutMs: 5000, crossings: 500, nodeIntersect: 0, aspect: 3, aspectMin: 1 / 3 },
  'scale-800': { layoutMs: 10000, crossings: 800, nodeIntersect: 0, aspect: 3, aspectMin: 1 / 3 },
  'scale-2000': { layoutMs: 30000, crossings: 5000, nodeIntersect: 0, aspect: 3, aspectMin: 1 / 3 },
};
const cases = [
  ...['flat', 'nested-full', 'nested-depth4'].map((name) => ({
    name,
    model: () => buildModel(name === 'flat' ? 0 : name === 'nested-depth4' ? 4 : Infinity),
    budgets: budgets[name],
  })),
  ...[
    ['scale-500', 500, 202],
    ['scale-800', 800, 339],
    ['scale-2000', 2000, 3186],
  ].map(([name, entities, relations]) => ({
    name,
    model: () => syntheticNested(entities, relations),
    budgets: scaleBudgets[name],
  })),
];

const failures = [];
for (const bench of cases) {
  const { name } = bench;
  const model = bench.model();
  const t0 = performance.now();
  const layout = await new ElkLayoutEngine().layout(model);
  const layoutMs = Math.round(performance.now() - t0);
  const m = computeLayoutMetrics(model, layout);
  const w = Math.round(layout.width);
  const h = Math.round(layout.height);
  console.log(
    `${name.padEnd(14)} entities=${model.entities.length} edges=${model.relations.length} ` +
      `packages=${model.packages.length} layoutMs=${layoutMs} canvas=${w}x${h} ` +
      `aspect=${(w / h).toFixed(2)} crossings=${m.edgeCrossings} nodeIntersect=${m.edgeNodeIntersections}`,
  );
  if (svgDir) {
    mkdirSync(svgDir, { recursive: true });
    writeFileSync(join(svgDir, `${name}.svg`), renderSvg(model, layout));
  }
  const b = bench.budgets;
  const check = (ok, msg) => ok || failures.push(`${name}: ${msg}`);
  if (b.width !== undefined) check(w <= b.width, `canvas.width ${w} > ${b.width}`);
  if (b.aspect !== undefined) check(w / h <= b.aspect, `aspect ${(w / h).toFixed(2)} > ${b.aspect}`);
  if (b.aspectMin !== undefined) check(w / h >= b.aspectMin, `aspect ${(w / h).toFixed(2)} < ${b.aspectMin.toFixed(2)}`);
  if (b.crossings !== undefined) check(m.edgeCrossings <= b.crossings, `crossings ${m.edgeCrossings} > ${b.crossings}`);
  if (b.nodeIntersect !== undefined) check(m.edgeNodeIntersections === b.nodeIntersect, `nodeIntersect ${m.edgeNodeIntersections} != ${b.nodeIntersect}`);
  if (b.layoutMs !== undefined) check(layoutMs <= b.layoutMs, `layoutMs ${layoutMs} > ${b.layoutMs}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('bench-nested: all budgets met');
