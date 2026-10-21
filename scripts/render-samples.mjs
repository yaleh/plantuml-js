#!/usr/bin/env node
/**
 * Render the sample diagrams with both layout engines, convert them to PNG with
 * headless Chrome, and write layout-quality metrics to rendered/metrics.json.
 *
 *   npm run build && node scripts/render-samples.mjs [--no-png] [--baseline]
 *
 * Extra inputs: ARCHGUARD_OUTPUT=<dir> adds the real archguard
 * overview/package.puml and class/all-classes.puml (all-classes is large).
 * CHROME=<path> overrides the Chrome binary (default: google-chrome).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distEntry = join(root, 'dist', 'index.js');
if (!existsSync(distEntry)) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(1);
}
const {
  parsePlantUml,
  ElkLayoutEngine,
  VizLayoutEngine,
  renderSvg,
  computeLayoutMetrics,
} = await import(pathToFileURL(distEntry).href);

const args = new Set(process.argv.slice(2));
const outDir = join(root, 'rendered');
mkdirSync(outDir, { recursive: true });

const samples = [
  { name: 'fixture', file: join(root, 'tests/fixtures/archguard-class.puml') },
  { name: 'package', file: join(root, 'tests/fixtures/archguard-package.puml') },
];
const external = process.env.ARCHGUARD_OUTPUT;
if (external) {
  samples.push({ name: 'all-classes', file: join(external, 'class/all-classes.puml') });
}

const engines = { elk: () => new ElkLayoutEngine(), viz: () => new VizLayoutEngine() };
const chrome = process.env.CHROME ?? 'google-chrome';
const metrics = {};

for (const sample of samples) {
  const model = parsePlantUml(readFileSync(sample.file, 'utf8'));
  for (const [engineName, make] of Object.entries(engines)) {
    const key = `${sample.name}.${engineName}`;
    const layout = await make().layout(model);
    const svg = renderSvg(model, layout);
    writeFileSync(join(outDir, `${key}.svg`), svg);
    metrics[key] = {
      entities: model.entities.length,
      relations: model.relations.length,
      packages: model.packages.length,
      width: Math.round(layout.width),
      height: Math.round(layout.height),
      ...round(computeLayoutMetrics(model, layout)),
    };
    if (!args.has('--no-png')) {
      try {
        execFileSync(
          chrome,
          [
            '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
            `--window-size=${Math.ceil(layout.width)},${Math.ceil(layout.height)}`,
            `--screenshot=${join(outDir, `${key}.png`)}`,
            pathToFileURL(join(outDir, `${key}.svg`)).href,
          ],
          { stdio: 'ignore' },
        );
      } catch (err) {
        console.error(`PNG conversion failed for ${key}: ${err.message}`);
        process.exitCode = 1;
      }
    }
    console.log(key, JSON.stringify(metrics[key]));
  }
}

writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
if (args.has('--baseline')) {
  writeFileSync(join(outDir, 'metrics.baseline.json'), JSON.stringify(metrics, null, 2) + '\n');
}

function round(m) {
  return Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
  );
}
