#!/usr/bin/env node
/**
 * render-docs.mjs — regenerate the committed doc gallery.
 *
 * Renders every figure in scripts/docs-gallery.json through the public
 * `renderDetailed` pipeline, writes `docs/img/<id>.<engine>.{svg,png}`, and
 * rewrites `docs/gallery.md` from the manifest. Both the images and the page
 * are committed, so the README (npmjs + GitHub) can hotlink them via absolute
 * raw.githubusercontent.com URLs and the gallery always matches the sources.
 *
 *   node scripts/render-docs.mjs            # regenerate + write
 *   node scripts/render-docs.mjs --check    # regenerate, then fail (non-zero)
 *                                           # if docs/gallery.md drifted
 *
 * Deliberate scope limits (vs scripts/render-samples.mjs, the quality gate):
 *   - `docs/gallery.md` carries only what is stable given the manifest + the
 *     committed `.puml` sources (title, caption, engine, node/edge counts).
 *     Layout metrics and canvas size are volatile across layout changes and
 *     stay in `rendered/metrics.json` (gitignored) — embedding them here would
 *     make the gallery churn on every layout iteration.
 *   - `--check` diffs `docs/gallery.md` only. PNG bytes are not diffed:
 *     headless-Chrome rasterisation varies subtly across machines/fonts, so an
 *     image byte-diff would false-positive in CI.
 *
 * The headless-Chrome screenshot helper mirrors render-samples.mjs on purpose
 * (docs generation stays independent of the quality gate's CLI flags).
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { filterPackagesMatching } from './samples-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imgDir = join(root, 'docs', 'img');
const sourcesDir = join(root, 'docs', 'gallery-sources');
const fixturesDir = join(root, 'tests', 'fixtures');
const manifestPath = join(root, 'scripts', 'docs-gallery.json');
const galleryPath = join(root, 'docs', 'gallery.md');

const checkOnly = process.argv.includes('--check');

// ── build + import the compiled library ────────────────────────────────────
execSync('npm run build', { cwd: root, stdio: 'inherit' });
const distIndex = pathToFileURL(join(root, 'dist', 'index.js')).href;
const { parsePlantUml, ElkLayoutEngine, VizLayoutEngine, renderDetailed } =
  await import(distIndex);

const engines = {
  elk: () => new ElkLayoutEngine(),
  viz: () => new VizLayoutEngine(),
};

/** Resolve a figure source against the committed gallery sources, then fixtures. */
function resolveSource(name) {
  for (const dir of [sourcesDir, fixturesDir]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`gallery source not found: ${name}`);
}

// ── headless-Chrome resolution (PNG conversion) ─────────────────────────────
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
  throw new Error('no headless Chrome binary found (set CHROME_BIN or install chromium)');
}

/** Canvases above this many pixels are not rasterised (mirrors render-samples.mjs). */
const MAX_PNG_PIXELS = 100e6;

/** Returns true when a PNG was written, false when the canvas was too large to rasterise. */
function screenshot(svgPath, pngPath, width, height) {
  const pixels = Math.ceil(width) * Math.ceil(height);
  if (pixels > MAX_PNG_PIXELS) {
    console.log(
      `skipping PNG for ${basename(svgPath)}: ${Math.round(pixels / 1e6)} MP exceeds the ${MAX_PNG_PIXELS / 1e6} MP limit (SVG still written)`,
    );
    return false;
  }
  const bin = chromeBin();
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  execFileSync(
    bin,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`,
      `--screenshot=${pngPath}`,
      pathToFileURL(svgPath).href,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return true;
}

// ── render ──────────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
mkdirSync(imgDir, { recursive: true });

const figures = [];
for (const fig of manifest.figures) {
  const puml = readFileSync(resolveSource(fig.source), 'utf8');
  let parsed = parsePlantUml(puml);
  if (fig.packagesMatching) parsed = filterPackagesMatching(parsed, fig.packagesMatching);

  const engineName = fig.engine ?? 'elk';
  const { model, layout, svg } = await renderDetailed(parsed, {
    layout: engines[engineName](),
    ...(fig.view ? { view: fig.view } : {}),
    ...(fig.detail ? { detail: fig.detail } : {}),
    ...(fig.memberMaxRows ? { memberMaxRows: fig.memberMaxRows } : {}),
    ...(fig.memberMaxChars ? { memberMaxChars: fig.memberMaxChars } : {}),
  });

  const svgName = `${fig.id}.${engineName}.svg`;
  const pngName = `${fig.id}.${engineName}.png`;
  const svgPath = join(imgDir, svgName);
  writeFileSync(svgPath, svg);
  const wrotePng = screenshot(svgPath, join(imgDir, pngName), layout.width, layout.height);

  figures.push({
    ...fig,
    engineName,
    svgName,
    pngName: wrotePng ? pngName : null,
    nodes: model.entities.length,
    edges: model.relations.length,
  });
  console.log(`rendered docs/img/${svgName}${wrotePng ? ` + ${pngName}` : ''} (${engineName})`);
}

// ── emit docs/gallery.md ────────────────────────────────────────────────────
const sections = [];
for (const fig of figures) {
  if (!sections.includes(fig.section)) sections.push(fig.section);
}

const lines = [
  '# Gallery',
  '',
  '> Generated by `scripts/render-docs.mjs` from `scripts/docs-gallery.json` — do',
  '> not edit this file by hand. Edit the manifest (or a source `.puml`), then run',
  '> `npm run docs`. `npm run docs:check` fails in CI when this page has drifted.',
  '',
];

for (const section of sections) {
  lines.push(`## ${section}`, '');
  for (const fig of figures.filter((f) => f.section === section)) {
    lines.push(`### ${fig.title}`, '');
    if (fig.pngName) lines.push(`![${fig.title}](${join('img', fig.pngName)})`, '');
    lines.push(fig.caption, '');
    const links = [`[source](${join('gallery-sources', fig.source)})`];
    if (fig.svgName) links.push(`[svg](${join('img', fig.svgName)})`);
    lines.push(
      `**Engine** ${fig.engineName} · **Nodes** ${fig.nodes} · **Edges** ${fig.edges} · ` +
        links.join(' · '),
      '',
    );
  }
}

writeFileSync(galleryPath, lines.join('\n'));
console.log(`wrote docs/gallery.md (${figures.length} figures)`);

// ── drift check ─────────────────────────────────────────────────────────────
if (checkOnly) {
  try {
    execSync(`git diff --exit-code -- docs/gallery.md`, { cwd: root, stdio: 'inherit' });
    console.log('docs:check — docs/gallery.md is up to date');
  } catch {
    console.error(
      'docs:check — FAIL: docs/gallery.md is out of date. Run `npm run docs` and commit the result.',
    );
    process.exit(1);
  }
}
