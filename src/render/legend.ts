/**
 * Legend — a small key explaining the visual encodings of a rendered diagram:
 * feedback (back) edges, hub badges, `×N` weights and the dashed/solid node
 * frames. Drawn below the diagram, so it never covers layout geometry.
 */

import { METRICS } from '../layout.js';

const ROW_HEIGHT = 20;
const PAD = 10;
const SWATCH_WIDTH = 34;
const FONT_SIZE = 11;
const RED = '#c0392b';
const STROKE = '#333333';

/** Entity count above which the legend is drawn by default. */
export const LEGEND_DEFAULT_NODE_THRESHOLD = 30;

export interface Legend {
  /** `<g class="uml-legend">` markup positioned at (x, y). */
  svg: string;
  width: number;
  height: number;
}

const ITEMS: string[] = [
  'feedback edge (closes a dependency cycle)',
  'hub badge: number of dependents (edges hidden)',
  '×N: number of merged relations',
  'dashed frame: grouped / external package',
  'solid frame: single module',
];

export function renderLegend(x: number, y: number): Legend {
  const width = PAD * 2 + SWATCH_WIDTH + 8 + 300;
  const height = PAD * 2 + ROW_HEIGHT * ITEMS.length;
  const rowY = (i: number): number => y + PAD + ROW_HEIGHT * i + ROW_HEIGHT / 2;
  const sx = x + PAD;
  const tx = sx + SWATCH_WIDTH + 8;
  const swatches: string[] = [
    `<line x1="${sx}" y1="${rowY(0)}" x2="${sx + SWATCH_WIDTH}" y2="${rowY(0)}" stroke="${RED}" stroke-width="1.2"/>`,
    `<circle cx="${sx + SWATCH_WIDTH / 2}" cy="${rowY(1)}" r="8" fill="${RED}"/>` +
      `<text x="${sx + SWATCH_WIDTH / 2}" y="${rowY(1) + 3.5}" text-anchor="middle" font-family="${METRICS.fontFamily}" font-size="10" fill="#ffffff">N</text>`,
    `<line x1="${sx}" y1="${rowY(2)}" x2="${sx + SWATCH_WIDTH}" y2="${rowY(2)}" stroke="${STROKE}" stroke-width="2.4"/>`,
    `<rect x="${sx}" y="${rowY(3) - 7}" width="${SWATCH_WIDTH}" height="14" fill="#f6f8fa" stroke="${STROKE}" stroke-width="1.5" stroke-dasharray="5,3"/>`,
    `<rect x="${sx}" y="${rowY(4) - 7}" width="${SWATCH_WIDTH}" height="14" fill="#ffffff" stroke="${STROKE}" stroke-width="1.5"/>`,
  ];
  const texts = ITEMS.map(
    (item, i) =>
      `<text x="${tx}" y="${rowY(i) + 4}" text-anchor="start" font-family="${METRICS.fontFamily}"` +
      ` font-size="${FONT_SIZE}" fill="#000000">${item.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`,
  );
  const svg =
    `<g class="uml-legend">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff" stroke="#999999" stroke-width="1"/>` +
    swatches.join('') +
    texts.join('') +
    `</g>`;
  return { svg, width, height };
}
