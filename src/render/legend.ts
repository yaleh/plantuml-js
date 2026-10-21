/**
 * Legend — a small key explaining the visual encodings of a rendered diagram:
 * feedback (back) edges, hub badges, `×N` weights and the dashed/solid node
 * frames. Drawn below the diagram, so it never covers layout geometry.
 */

import { Theme } from './theme.js';

const ROW_HEIGHT = 20;
const PAD = 10;
const SWATCH_WIDTH = 34;
const FONT_SIZE = 11;

/** Entity count above which the legend is drawn by default. */
export const LEGEND_DEFAULT_NODE_THRESHOLD = 30;

export interface Legend {
  /** `<g class="uml-legend">` markup positioned at (x, y). */
  svg: string;
  width: number;
  height: number;
}

const ITEMS: string[] = [
  'feedback edge (dash-dot; closes a dependency cycle)',
  'hub badge: number of dependents (edges hidden)',
  '×N: number of merged relations',
  'dashed frame: grouped / external package',
  'solid frame: single module',
];

export function renderLegend(x: number, y: number, theme: Theme): Legend {
  const { color } = theme;
  const width = PAD * 2 + SWATCH_WIDTH + 8 + 300;
  const height = PAD * 2 + ROW_HEIGHT * ITEMS.length;
  const rowY = (i: number): number => y + PAD + ROW_HEIGHT * i + ROW_HEIGHT / 2;
  const sx = x + PAD;
  const tx = sx + SWATCH_WIDTH + 8;
  const swatches: string[] = [
    `<line x1="${sx}" y1="${rowY(0)}" x2="${sx + SWATCH_WIDTH}" y2="${rowY(0)}" stroke="${color.warn}" stroke-width="${theme.stroke.edge}" stroke-dasharray="${theme.dash.feedback}"/>`,
    `<circle cx="${sx + SWATCH_WIDTH / 2}" cy="${rowY(1)}" r="8" fill="${color.accent}"/>` +
      `<text x="${sx + SWATCH_WIDTH / 2}" y="${rowY(1) + 3.5}" text-anchor="middle" font-family="${theme.font.family}" font-size="10" fill="${color.accentText}">N</text>`,
    `<line x1="${sx}" y1="${rowY(2)}" x2="${sx + SWATCH_WIDTH}" y2="${rowY(2)}" stroke="${color.edge}" stroke-width="2.5" stroke-opacity="${theme.stroke.weightOpacity}"/>`,
    `<rect x="${sx}" y="${rowY(3) - 7}" width="${SWATCH_WIDTH}" height="14" rx="3" fill="${color.stubFill}" stroke="${color.strokeStub}" stroke-width="${theme.stroke.node}" stroke-dasharray="${theme.dash.stub}"/>`,
    `<rect x="${sx}" y="${rowY(4) - 7}" width="${SWATCH_WIDTH}" height="14" rx="3" fill="${color.nodeFill}" stroke="${color.stroke}" stroke-width="${theme.stroke.node}"/>`,
  ];
  const texts = ITEMS.map(
    (item, i) =>
      `<text x="${tx}" y="${rowY(i) + 4}" text-anchor="start" font-family="${theme.font.family}"` +
      ` font-size="${FONT_SIZE}" fill="${color.textMember}">${item.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`,
  );
  const svg =
    `<g class="uml-legend">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${color.canvas}" stroke="${color.legendStroke}" stroke-width="${theme.stroke.node}"/>` +
    swatches.join('') +
    texts.join('') +
    `</g>`;
  return { svg, width, height };
}
