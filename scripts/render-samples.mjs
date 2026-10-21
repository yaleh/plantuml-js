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
 *   node scripts/render-samples.mjs [--baseline] [--views] [<archguard-output-dir>]
 *   node scripts/render-samples.mjs [--manifest [<archguard-output-dir>]] [--tiles]
 *                                   [--compare [<baseline.json>]] [--baseline]
 *
 * Sample mode (`--manifest` and/or `--tiles`) renders the tiered S/M/L/XL set
 * declared in scripts/samples.json (elk for all, viz for S/M), prints a
 * per-tier metrics table, writes `rendered/metrics.json` (each record carries
 * `tier`), exits non-zero when a declared threshold is violated, and with
 * `--compare` additionally checks every elk record against the committed
 * `rendered/metrics.baseline.json` (or the given file): edgeCrossings may grow
 * ≤25%, areaUtilization shrink ≤30%, maxEmptyBlockRatio grow ≤0.05, otherwise
 * the exit code is non-zero. `--baseline` (sample mode) merges the fresh records
 * into the baseline file. With `--tiles` also cuts each diagram into 1:1 PNG tiles under
 * `rendered/tiles/<id>/` plus an `overview.png` marking the tile grid.
 *
 * `<archguard-output-dir>` is either a directory holding .puml files directly or
 * an archguard output root: `class/all-classes.puml` and `overview/package.puml`
 * (any `*.puml` in those subdirectories) are discovered automatically.
 *
 * The script builds `dist/` first so it can import the compiled TypeScript
 * modules (parsePlantUml / engines / renderDetailed / computeLayoutMetrics) as plain
 * ES modules without a TS loader.
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename, extname } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { measureSvgTextOverflow } from './measure-svg-text.mjs';
import { writeTiles } from './tile-png.mjs';
import {
  compareToBaseline,
  defaultBaselinePath,
  evaluateThresholds,
  filterPackagesMatching,
  mergeRecords,
  loadManifest,
  resolveSource,
  TIERS,
} from './samples-lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const renderedDir = join(repoRoot, 'rendered');
const fixturesDir = join(repoRoot, 'tests', 'fixtures');

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const baseline = argv.includes('--baseline');
const views = argv.includes('--views');
const tiles = argv.includes('--tiles');
const compareIdx = argv.indexOf('--compare');
const comparePath =
  compareIdx === -1
    ? null
    : argv[compareIdx + 1] && !argv[compareIdx + 1].startsWith('--')
      ? argv[compareIdx + 1]
      : defaultBaselinePath;
const manifestIdx = argv.indexOf('--manifest');
const manifestMode = manifestIdx !== -1;
const manifestDir =
  manifestMode && argv[manifestIdx + 1] && !argv[manifestIdx + 1].startsWith('--')
    ? argv[manifestIdx + 1]
    : null;
const externalDir = argv.find((a, i) => !a.startsWith('--') && !(manifestMode && i === manifestIdx + 1) && !(comparePath && i === compareIdx + 1));
// Multi-scale sample mode (scripts/samples.json): enabled by --manifest and/or --tiles.
const samplesMode = manifestMode || tiles || comparePath !== null;

// ── build + import the compiled library ────────────────────────────────────
console.log('building dist/ …');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

const distIndex = pathToFileURL(join(repoRoot, 'dist', 'index.js')).href;

const { parsePlantUml, ElkLayoutEngine, VizLayoutEngine, renderDetailed, computeLayoutMetrics } =
  await import(distIndex);

const engines = {
  elk: () => new ElkLayoutEngine(),
  viz: () => new VizLayoutEngine(),
};

// Every render goes through the public pipeline (src/core.ts renderDetailed):
// view/transforms → detail → layout → svg, exactly what createRenderer does.
const renderViaPipeline = (parsed, engineName, view) =>
  renderDetailed(parsed, { layout: engines[engineName](), view });

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

/** Canvases above this many pixels are not rasterised: headless Chrome is OOM-killed on them. */
const MAX_PNG_PIXELS = 100e6;

/** Returns true when a PNG was written, false when the canvas was too large to rasterise. */
function screenshot(svgPath, pngPath, width, height) {
  const pixels = Math.ceil(width) * Math.ceil(height);
  if (pixels > MAX_PNG_PIXELS) {
    console.log(
      `skipping PNG for ${basename(svgPath)}: ${round(pixels / 1e6)} MP exceeds the ${MAX_PNG_PIXELS / 1e6} MP limit (SVG still written)`,
    );
    return false;
  }
  rawShotArgs(svgPath, pngPath, width, height).run();
  return true;
}

/** Builds the headless-Chrome invocation; `run()` is sync, `runAsync()` for parallel tiling. */
function rawShotArgs(svgPath, pngPath, width, height) {
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
  return {
    run: () => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] }),
    runAsync: () => promisify(execFile)(bin, args, { maxBuffer: 1 << 20 }),
  };
}

// ── sample mode: tiered manifest ───────────────────────────────────────────
if (samplesMode) {
  const code = await runSamples();
  process.exit(code);
}

async function runSamples() {
  const manifest = loadManifest();
  const outRecords = [];
  const failures = [];
  mkdirSync(renderedDir, { recursive: true });

  for (const sample of manifest.samples) {
    const puml = readFileSync(resolveSource(sample, manifestDir), 'utf8');
    let parsed = parsePlantUml(puml);
    if (sample.packagesMatching) parsed = filterPackagesMatching(parsed, sample.packagesMatching);
    const engineNames = ['elk', ...(sample.tier === 'S' || sample.tier === 'M' ? ['viz'] : [])];

    for (const engineName of engineNames) {
      const { model, layout, svg } = await renderViaPipeline(parsed, engineName, sample.view);
      const metrics = computeLayoutMetrics(model, layout);
      const svgName = `${sample.id}.${engineName}.svg`;
      const pngName = `${sample.id}.${engineName}.png`;
      const svgPath = join(renderedDir, svgName);
      writeFileSync(svgPath, svg);

      // XL-size canvases are never rasterised whole (see MAX_PNG_PIXELS); tiles cover them.
      const wrotePng = screenshot(svgPath, join(renderedDir, pngName), layout.width, layout.height);
      metrics.chromeTextOverflow = await measureSvgTextOverflow(svgPath);

      // Thresholds gate the elk run (the shipping engine); viz is reported for comparison.
      const violated = engineName === 'elk' ? evaluateThresholds(metrics, sample.thresholds) : [];
      if (violated.length) failures.push(`${sample.id} [${sample.tier}]: ${violated.join('; ')}`);

      outRecords.push({
        group: sample.id,
        tier: sample.tier,
        engine: engineName,
        entities: model.entities.length,
        svg: svgName,
        png: wrotePng ? pngName : null,
        width: round(layout.width),
        height: round(layout.height),
        metrics,
        violations: violated,
      });

      if (tiles && engineName === 'elk') {
        const tileDir = join(renderedDir, 'tiles', sample.id);
        rmSync(tileDir, { recursive: true, force: true });
        const t = await writeTiles({
          svg,
          outDir: tileDir,
          shoot: (svgFile, pngFile, w, h) => rawShotArgs(svgFile, pngFile, w, h).runAsync(),
        });
        console.log(`tiled ${sample.id}: ${t.length} tiles → rendered/tiles/${sample.id}/`);
      }
      console.log(`rendered ${svgName} (${engineName}, ${sample.tier})`);
    }
  }

  writeFileSync(join(renderedDir, 'metrics.json'), JSON.stringify(outRecords, null, 2) + '\n');
  printTierTable(outRecords);
  console.log(`wrote rendered/metrics.json (${outRecords.length} records)`);
  if (comparePath) {
    const regressions = compareToBaseline(JSON.parse(readFileSync(comparePath, 'utf8')), outRecords);
    for (const r of regressions) failures.push(`regression vs ${basename(comparePath)}: ${r}`);
    if (!regressions.length) console.log(`no regressions vs ${basename(comparePath)}`);
  }
  if (baseline && !failures.length) {
    const path = defaultBaselinePath;
    const old = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    writeFileSync(path, JSON.stringify(mergeRecords(old, outRecords), null, 2) + '\n');
    console.log('merged sample records into rendered/metrics.baseline.json');
  }
  if (failures.length) {
    console.error(`\nthreshold violations (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    if (failures.some((f) => f.includes(': missing'))) {
      console.error(
        '度量缺失（可能是 dist 过期）: run a clean build (`npm run build` wipes dist first) and retry.',
      );
    }
    return 1;
  }
  console.log('all sample thresholds satisfied');
  return 0;
}

function printTierTable(recs) {
  const cols = ['id', 'engine', 'ents', 'w×h', 'cross', 'edge×node', 'nonOrth', 'areaUtil', 'aspect', 'overflow', 'ok'];
  for (const tier of TIERS) {
    const rows = recs.filter((r) => r.tier === tier);
    if (!rows.length) continue;
    console.log(`\n── tier ${tier} ──`);
    const lines = rows.map((r) => [
      r.group,
      r.engine,
      r.entities,
      `${Math.round(r.width)}×${Math.round(r.height)}`,
      r.metrics.edgeCrossings,
      r.metrics.edgeNodeIntersections,
      r.metrics.nonOrthogonalEdgeCount,
      round(r.metrics.areaUtilization),
      round(r.metrics.aspectRatio),
      r.metrics.textOverflowCount,
      r.engine === 'elk' ? (r.violations.length ? 'FAIL' : 'pass') : '-',
    ].map(String));
    const widths = cols.map((c, i) => Math.max(c.length, ...lines.map((l) => l[i].length)));
    const fmtRow = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
    console.log(fmtRow(cols));
    for (const l of lines) console.log(fmtRow(l));
  }
}

// ── inputs: the two fixtures + optional external archguard dir ─────────────
const inputs = [
  { group: 'fixture', pumlPath: join(fixturesDir, 'archguard-class.puml') },
  { group: 'package', pumlPath: join(fixturesDir, 'archguard-package.puml') },
];

/** Directories searched for .puml inputs: the dir itself plus archguard's `class/` and `overview/`. */
function discoverPumlDirs(root) {
  const dirs = [root];
  for (const sub of ['class', 'overview']) {
    const dir = join(root, sub);
    if (existsSync(dir) && statSync(dir).isDirectory()) dirs.push(dir);
  }
  return dirs;
}

/** Locate `all-classes.puml` directly in, or under `class/` of, an archguard output dir. */
function findAllClasses(root) {
  for (const dir of discoverPumlDirs(root)) {
    const candidate = join(dir, 'all-classes.puml');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

if (externalDir) {
  if (!existsSync(externalDir)) {
    throw new Error(`external archguard dir not found: ${externalDir}`);
  }
  const usedGroups = new Set(inputs.map((i) => i.group));
  for (const dir of discoverPumlDirs(externalDir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (extname(entry).toLowerCase() !== '.puml') continue;
      let group = basename(entry, '.puml');
      if (usedGroups.has(group)) group = `${basename(dir)}-${group}`;
      usedGroups.add(group);
      inputs.push({ group, pumlPath: join(dir, entry) });
    }
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

  for (const engineName of Object.keys(engines)) {
    const { model, layout, svg } = await renderViaPipeline(parsed, engineName);
    const metrics = computeLayoutMetrics(model, layout);

    const svgName = `${group}.${engineName}.svg`;
    const pngName = `${group}.${engineName}.png`;
    const svgPath = join(renderedDir, svgName);
    const pngPath = join(renderedDir, pngName);

    writeFileSync(svgPath, svg);
    const wrotePng = screenshot(svgPath, pngPath, layout.width, layout.height);
    // Independent text-overflow truth: headless Chrome re-measures every
    // `<text>` with the browser's font engine (see measure-svg-text.mjs),
    // so a wrong advance in text-measure.ts cannot hide behind a metric that
    // shares the same mistake.
    metrics.chromeTextOverflow = await measureSvgTextOverflow(svgPath);

    records.push({
      group,
      engine: engineName,
      svg: svgName,
      png: wrotePng ? pngName : null,
      width: round(layout.width),
      height: round(layout.height),
      metrics,
    });
    console.log(`rendered ${svgName}${wrotePng ? ` + ${pngName}` : ''} (${engineName})`);
  }
}

// ── views: overview + single-package collapses (--views) ───────────────────
if (views) {
  const packageInput = inputs.find((i) => i.group === 'package');
  if (!packageInput) throw new Error('--views needs the package fixture');

  const model = parsePlantUml(readFileSync(packageInput.pumlPath, 'utf8'));

  const renderView = async ({ group, view, png }) => {
    // Same default transforms as the full graph (aggregation, cycles, hubs).
    const { model: viewed, layout, svg } = await renderViaPipeline(model, 'elk', view);
    const metrics = computeLayoutMetrics(viewed, layout);

    const svgName = `${group}.elk.svg`;
    const pngName = `${group}.elk.png`;
    const svgPath = join(renderedDir, svgName);
    const pngPath = join(renderedDir, pngName);
    writeFileSync(svgPath, svg);
    const wrotePng = png && screenshot(svgPath, pngPath, layout.width, layout.height);
    metrics.chromeTextOverflow = await measureSvgTextOverflow(svgPath);

    records.push({
      group,
      engine: 'elk',
      svg: svgName,
      png: wrotePng ? pngName : null,
      width: round(layout.width),
      height: round(layout.height),
      metrics,
    });
    console.log(`rendered ${svgName}${wrotePng ? ` + ${pngName}` : ''} (view)`);
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
  const allClasses = findAllClasses(externalDir);
  if (allClasses === null) {
    console.warn(`views: no all-classes.puml in ${externalDir} (or its class/ subdir) — skipping package sweep`);
  } else {
    const model = parsePlantUml(readFileSync(allClasses, 'utf8'));
    let failed = 0;
    for (const pkg of model.packages) {
      const { model: viewed, layout } = await renderViaPipeline(model, 'elk', { kind: 'package', id: pkg.id });
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
