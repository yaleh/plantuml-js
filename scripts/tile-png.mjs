/**
 * tile-png.mjs — cut an SVG into 1:1 pixel PNG tiles (<= 1800x1200 each) plus a
 * downscaled overview PNG with the tile grid marked, so large layouts can be
 * inspected at native resolution without rasterising the whole canvas (a 100+ MP
 * canvas OOM-kills headless Chrome).
 *
 * Each tile is a copy of the SVG whose root `viewBox` is narrowed to the tile
 * rectangle and whose `width`/`height` equal the tile size; Chrome only paints
 * that viewport.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TILE_W = 1800;
export const TILE_H = 1200;
const OVERVIEW_MAX = 1600;

export function parseSvgSize(svg) {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const w = /\bwidth="([\d.]+)"/.exec(root ?? '');
  const h = /\bheight="([\d.]+)"/.exec(root ?? '');
  if (!w || !h) throw new Error('svg root has no width/height');
  return { width: Math.ceil(Number(w[1])), height: Math.ceil(Number(h[1])) };
}

/** Row-major grid of {row, col, x, y, w, h}; edge tiles are clipped to the canvas. */
export function tileGrid(width, height, tileW = TILE_W, tileH = TILE_H) {
  const tiles = [];
  for (let row = 0, y = 0; y < height; row++, y += tileH) {
    for (let col = 0, x = 0; x < width; col++, x += tileW) {
      tiles.push({ row, col, x, y, w: Math.min(tileW, width - x), h: Math.min(tileH, height - y) });
    }
  }
  return tiles;
}

function withRoot(svg, attrs, extra = '') {
  return svg
    .replace(/<svg\b[^>]*>/, (root) => {
      const stripped = root.replace(/\s(width|height|viewBox)="[^"]*"/g, '');
      return stripped.replace(/>$/, ` ${attrs}>`);
    })
    .replace(/<\/svg>\s*$/, `${extra}</svg>`);
}

/**
 * Writes `<outDir>/r<row>c<col>.png` for every tile and `<outDir>/overview.png`.
 * `shoot(svgFile, pngFile, width, height)` rasterises one file (may be async);
 * at most `concurrency` calls run at once. Returns the tile list.
 */
export async function writeTiles({ svg, outDir, shoot, concurrency = 4 }) {
  const { width, height } = parseSvgSize(svg);
  mkdirSync(outDir, { recursive: true });
  const tiles = tileGrid(width, height);

  let next = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const t = tiles[next++];
      const name = `r${t.row}c${t.col}`;
      const tmp = join(outDir, `.${name}.svg`);
      writeFileSync(tmp, withRoot(svg, `width="${t.w}" height="${t.h}" viewBox="${t.x} ${t.y} ${t.w} ${t.h}"`));
      try {
        await shoot(tmp, join(outDir, `${name}.png`), t.w, t.h);
      } finally {
        rmSync(tmp, { force: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));

  // Overview: whole canvas scaled to <= OVERVIEW_MAX px, tile boundaries + labels overlaid.
  const scale = Math.min(1, OVERVIEW_MAX / Math.max(width, height));
  const stroke = Math.max(2, Math.round(2 / scale));
  const font = Math.max(14, Math.round(18 / scale));
  const grid = tiles
    .map(
      (t) =>
        `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" fill="none" stroke="#e11" stroke-width="${stroke}"/>` +
        `<text x="${t.x + font / 2}" y="${t.y + font * 1.2}" font-size="${font}" fill="#e11" font-family="monospace">r${t.row}c${t.col}</text>`,
    )
    .join('');
  const ow = Math.max(1, Math.ceil(width * scale));
  const oh = Math.max(1, Math.ceil(height * scale));
  const tmp = join(outDir, '.overview.svg');
  writeFileSync(tmp, withRoot(svg, `width="${ow}" height="${oh}" viewBox="0 0 ${width} ${height}"`, grid));
  try {
    await shoot(tmp, join(outDir, 'overview.png'), ow, oh);
  } finally {
    rmSync(tmp, { force: true });
  }
  return tiles;
}
