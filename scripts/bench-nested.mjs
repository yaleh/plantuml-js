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
  pathToFileURL(join(repoRoot, 'dist', 'layout-metrics.js')).href
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

const budgets = {
  flat: { crossings: 1000, layoutMs: 2000 },
  'nested-full': { width: 10000, crossings: 800, nodeIntersect: 0, layoutMs: 5000, aspect: 3 },
  'nested-depth4': {},
};
const variants = [
  ['flat', 0],
  ['nested-full', Infinity],
  ['nested-depth4', 4],
];

const failures = [];
for (const [name, depth] of variants) {
  const model = buildModel(depth);
  const t0 = performance.now();
  const layout = await new ElkLayoutEngine().layout(model);
  const layoutMs = Math.round(performance.now() - t0);
  const m = computeLayoutMetrics(model, layout);
  const w = Math.round(layout.width);
  const h = Math.round(layout.height);
  console.log(
    `${name.padEnd(14)} packages=${model.packages.length} layoutMs=${layoutMs} canvas=${w}x${h} ` +
      `aspect=${(w / h).toFixed(2)} crossings=${m.edgeCrossings} nodeIntersect=${m.edgeNodeIntersections}`,
  );
  if (svgDir) {
    mkdirSync(svgDir, { recursive: true });
    writeFileSync(join(svgDir, `${name}.svg`), renderSvg(model, layout));
  }
  const b = budgets[name];
  const check = (ok, msg) => ok || failures.push(`${name}: ${msg}`);
  if (b.width !== undefined) check(w <= b.width, `canvas.width ${w} > ${b.width}`);
  if (b.aspect !== undefined) check(w / h <= b.aspect, `aspect ${(w / h).toFixed(2)} > ${b.aspect}`);
  if (b.crossings !== undefined) check(m.edgeCrossings <= b.crossings, `crossings ${m.edgeCrossings} > ${b.crossings}`);
  if (b.nodeIntersect !== undefined) check(m.edgeNodeIntersections === b.nodeIntersect, `nodeIntersect ${m.edgeNodeIntersections} != ${b.nodeIntersect}`);
  if (b.layoutMs !== undefined) check(layoutMs <= b.layoutMs, `layoutMs ${layoutMs} > ${b.layoutMs}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('bench-nested: all budgets met');
