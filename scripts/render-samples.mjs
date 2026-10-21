#!/usr/bin/env node
/**
 * render-samples.mjs — render + measure harness for layout quality.
 *
 * Renders the archguard class/package fixtures (plus, optionally, every .puml
 * in an external archguard output directory) with BOTH layout engines, writes
 * each SVG to `rendered/`, converts it to a PNG via headless Chrome, and emits
 * `rendered/metrics.json` (one record per diagram). With `--baseline` it also
 * writes `rendered/metrics.baseline.json` — the committed snapshot a later
 * layout change is diffed against.
 *
 * Usage:
 *   node scripts/render-samples.mjs [--baseline] [<archguard-output-dir>]
 *
 * The script builds `dist/` first so it can import the compiled TypeScript
 * modules (parsePlantUml / engines / renderSvg / computeLayoutMetrics) as plain
 * ES modules without a TS loader.
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename, extname } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const renderedDir = join(repoRoot, 'rendered');
const fixturesDir = join(repoRoot, 'tests', 'fixtures');

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const baseline = argv.includes('--baseline');
const views = argv.includes('--views');
const externalDir = argv.find((a) => !a.startsWith('--'));

// ── build + import the compiled library ────────────────────────────────────
console.log('building dist/ …');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

const distIndex = pathToFileURL(join(repoRoot, 'dist', 'index.js')).href;
const distSvg = pathToFileURL(join(repoRoot, 'dist', 'render', 'svg.js')).href;
const distMetrics = pathToFileURL(
  join(repoRoot, 'dist', 'layout-metrics.js'),
).href;

const { parsePlantUml, ElkLayoutEngine, VizLayoutEngine, applyView, transformModel, transformFullGraph } =
  await import(distIndex);
const { renderSvg } = await import(distSvg);
const { computeLayoutMetrics } = await import(distMetrics);

const engines = {
  elk: () => new ElkLayoutEngine(),
  viz: () => new VizLayoutEngine(),
};

// ── chrome resolution (PNG conversion) ─────────────────────────────────────
let chromeBinCache;
function chromeBin() {
  if (chromeBinCache) return chromeBinCache;
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      chromeBinCache = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'no headless Chrome binary found (set CHROME_BIN or install chromium)',
  );
}

function screenshot(svgPath, pngPath, width, height) {
  const bin = chromeBin();
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const url = pathToFileURL(svgPath).href;
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${w},${h}`,
    `--screenshot=${pngPath}`,
    url,
  ];
  execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

// ── inputs: the two fixtures + optional external archguard dir ─────────────
const inputs = [
  { group: 'fixture', pumlPath: join(fixturesDir, 'archguard-class.puml') },
  { group: 'package', pumlPath: join(fixturesDir, 'archguard-package.puml') },
];

if (externalDir) {
  if (!existsSync(externalDir)) {
    throw new Error(`external archguard dir not found: ${externalDir}`);
  }
  for (const entry of readdirSync(externalDir).sort()) {
    if (extname(entry).toLowerCase() !== '.puml') continue;
    inputs.push({ group: basename(entry, '.puml'), pumlPath: join(externalDir, entry) });
  }
}

// ── render + measure ───────────────────────────────────────────────────────
mkdirSync(renderedDir, { recursive: true });
const records = [];

for (const { group, pumlPath } of inputs) {
  if (!existsSync(pumlPath)) {
    throw new Error(`input puml not found: ${pumlPath}`);
  }
  const puml = readFileSync(pumlPath, 'utf8');
  const parsed = parsePlantUml(puml);
  // The full graph goes through the same default pipeline the renderer applies:
  // aggregation + cycle marking, plus hub summarization once the graph is large
  // enough (see `transformFullGraph` in src/index.ts).
  const model = transformFullGraph(parsed);

  for (const [engineName, makeEngine] of Object.entries(engines)) {
    const layout = await makeEngine().layout(model);
    const svg = renderSvg(model, layout);
    const metrics = computeLayoutMetrics(model, layout);

    const svgName = `${group}.${engineName}.svg`;
    const pngName = `${group}.${engineName}.png`;
    const svgPath = join(renderedDir, svgName);
    const pngPath = join(renderedDir, pngName);

    writeFileSync(svgPath, svg);
    screenshot(svgPath, pngPath, layout.width, layout.height);

    records.push({
      group,
      engine: engineName,
      svg: svgName,
      png: pngName,
      width: round(layout.width),
      height: round(layout.height),
      metrics,
    });
    console.log(`rendered ${svgName} + ${pngName} (${engineName})`);
  }
}

// ── views: overview + single-package collapses (--views) ───────────────────
if (views) {
  const packageInput = inputs.find((i) => i.group === 'package');
  if (!packageInput) throw new Error('--views needs the package fixture');

  const model = parsePlantUml(readFileSync(packageInput.pumlPath, 'utf8'));

  const renderView = async ({ group, view, png }) => {
    const viewed = transformModel(applyView(model, view), {
      aggregate: true,
      cycles: true,
    });
    const layout = await engines.elk().layout(viewed);
    const svg = renderSvg(viewed, layout);
    const metrics = computeLayoutMetrics(viewed, layout);

    const svgName = `${group}.elk.svg`;
    const pngName = `${group}.elk.png`;
    const svgPath = join(renderedDir, svgName);
    const pngPath = join(renderedDir, pngName);
    writeFileSync(svgPath, svg);
    if (png) screenshot(svgPath, pngPath, layout.width, layout.height);

    records.push({
      group,
      engine: 'elk',
      svg: svgName,
      png: pngName,
      width: round(layout.width),
      height: round(layout.height),
      metrics,
    });
    console.log(`rendered ${svgName}${png ? ` + ${pngName}` : ''} (view)`);
    return { group, metrics };
  };

  const overview = await renderView({
    group: 'package-overview',
    view: { kind: 'overview', depth: 2 },
    png: true,
  });

  // Two single-package views: the two packages holding the most entities.
  const entityCount = new Map();
  for (const e of model.entities) {
    if (e.packageId) entityCount.set(e.packageId, (entityCount.get(e.packageId) ?? 0) + 1);
  }
  const chosen = [...entityCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => id);
  for (const id of chosen) {
    await renderView({ group: `package-pkg-${id}`, view: { kind: 'package', id }, png: true });
  }

  // Overview must beat the committed baseline for the full package diagram.
  const baselineRecords = JSON.parse(
    readFileSync(join(renderedDir, 'metrics.baseline.json'), 'utf8'),
  );
  const baselinePackage = baselineRecords.find(
    (r) => r.group === 'package' && r.engine === 'elk',
  );
  if (baselinePackage) {
    const ok =
      overview.metrics.edgeCrossings < baselinePackage.metrics.edgeCrossings &&
      overview.metrics.totalEdgeLength < baselinePackage.metrics.totalEdgeLength;
    console.log(
      `views: overview edgeCrossings ${overview.metrics.edgeCrossings} (baseline ${baselinePackage.metrics.edgeCrossings}), ` +
        `totalEdgeLength ${round(overview.metrics.totalEdgeLength)} (baseline ${round(baselinePackage.metrics.totalEdgeLength)})`,
    );
    if (!ok) {
      console.error('views: FAIL — overview metrics did not drop below baseline');
      process.exitCode = 1;
    }
  }
}

// ── every package of an external all-classes.puml renders without overflow ──
if (views && externalDir) {
  const allClasses = join(externalDir, 'all-classes.puml');
  if (!existsSync(allClasses)) {
    console.warn(`views: no all-classes.puml in ${externalDir} — skipping package sweep`);
  } else {
    const model = parsePlantUml(readFileSync(allClasses, 'utf8'));
    let failed = 0;
    for (const pkg of model.packages) {
      const viewed = transformModel(applyView(model, { kind: 'package', id: pkg.id }), {
        aggregate: true,
        cycles: true,
      });
      const layout = await engines.elk().layout(viewed);
      const metrics = computeLayoutMetrics(viewed, layout);
      if (metrics.textOverflowCount !== 0) {
        failed++;
        console.error(`views: package ${pkg.id} textOverflowCount=${metrics.textOverflowCount}`);
      }
    }
    console.log(
      `views: rendered ${model.packages.length} all-classes package views (${failed} with overflow)`,
    );
    if (failed > 0) {
      console.error('views: FAIL — some package views overflow their text');
      process.exitCode = 1;
    }
  }
}

writeFileSync(
  join(renderedDir, 'metrics.json'),
  JSON.stringify(records, null, 2) + '\n',
);
if (baseline) {
  writeFileSync(
    join(renderedDir, 'metrics.baseline.json'),
    JSON.stringify(records, null, 2) + '\n',
  );
}

console.log(`wrote rendered/metrics.json (${records.length} records)`);
if (baseline) console.log('wrote rendered/metrics.baseline.json');

function round(n) {
  return Math.round(n * 100) / 100;
}
