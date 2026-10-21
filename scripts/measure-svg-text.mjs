#!/usr/bin/env node
/**
 * measure-svg-text.mjs — independent text-overflow truth via headless Chrome.
 *
 * The built-in `textOverflowCount` metric measures the same synthetic
 * `measureTextWidth` the renderer uses to size boxes, so the metric and the
 * renderer share the same mistake when the advance guess is wrong. This script
 * is the independent witness: it loads a rendered SVG in headless Chrome and
 * compares each entity `<text>` element's *real* `getBBox().width` against the
 * entity `<rect>` it is drawn inside — the same `width + paddingX*2` comparison
 * `computeLayoutMetrics` makes, but with the browser's font engine instead of
 * the fixed 0.61em advance.
 *
 * Entity rects are the only `<rect>` elements with rounded corners (`rx`), so a
 * `<text>` is attributed to the first such rect that contains its anchor point.
 * Package-label tabs and edge labels carry no rounded rect and are skipped.
 *
 * Usage (CLI):
 *   node scripts/measure-svg-text.mjs <svg> [<svg>...]
 *
 * As a module it exports `measureSvgTextOverflow(svgPath)`, which
 * `render-samples.mjs` calls to record `chromeTextOverflow` in metrics.json.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Horizontal padding on each side of an entity box (`METRICS.paddingX`). */
const PADDING_X = 10;

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

/** Measure one SVG file; returns the number of overflowing entity text lines. */
export async function measureSvgTextOverflow(svgPath) {
  const svg = readFileSync(svgPath, 'utf8');
  const html = wrapperHtml(svg);

  const dir = mkdtempSync(join(tmpdir(), 'svg-measure-'));
  const htmlPath = join(dir, 'measure.html');
  writeFileSync(htmlPath, html);

  try {
    const bin = chromeBin();
    const url = pathToFileURL(htmlPath).href;
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--virtual-time-budget=5000',
      '--dump-dom',
      url,
    ];
    const dom = execFileSync(bin, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const match = /RESULT:([-+]?\d+)/.exec(dom);
    if (!match) {
      throw new Error(
        `measure-svg-text: Chrome did not report a result for ${svgPath}` +
          ` (did the inline script run?)`,
      );
    }
    return Number(match[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Wrap the SVG in an HTML page whose script computes the overflow count. */
function wrapperHtml(svg) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>PENDING</title></head>
<body>
${svg}
<script>
(function () {
  var count = 0;
  try {
    var rects = Array.from(document.querySelectorAll('rect[rx]'));
    document.querySelectorAll('text').forEach(function (t) {
      var x = parseFloat(t.getAttribute('x'));
      var y = parseFloat(t.getAttribute('y'));
      var box = null;
      for (var r of rects) {
        var rx = parseFloat(r.getAttribute('x'));
        var ry = parseFloat(r.getAttribute('y'));
        var rw = parseFloat(r.getAttribute('width'));
        var rh = parseFloat(r.getAttribute('height'));
        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) { box = r; break; }
      }
      if (!box) return;
      var needed = t.getBBox().width + ${PADDING_X} * 2;
      if (needed > parseFloat(box.getAttribute('width')) + 0.01) count++;
    });
  } catch (e) {
    document.title = 'ERROR:' + e.message;
    return;
  }
  document.title = 'RESULT:' + count;
})();
</script>
</body>
</html>
`;
}

// CLI entry point: `node scripts/measure-svg-text.mjs <svg> [<svg>...]`.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: node scripts/measure-svg-text.mjs <svg> [<svg>...]');
    process.exit(2);
  }
  for (const path of paths) {
    const overflow = await measureSvgTextOverflow(path);
    console.log(`${path}\t${overflow}`);
  }
}
