/**
 * Approximate text measurement for the SVG renderer, pure JS (no canvas, no
 * DOM). A hand-tuned width table for a 13px monospace font: narrow glyphs
 * (i, l, punctuation) get less, wide glyphs (m, w, @) get more. Every value
 * is a conservative upper bound so a box sized from this table never clips
 * its longest member line.
 */

const BASE_FONT_SIZE = 13;
const DEFAULT_ADVANCE = 7.8;

const NARROW = new Set('il.,:;|!()[]{}\'"` ');
const WIDE = new Set('mwMW@%&_<>~#');

function advanceFor(ch: string): number {
  if (NARROW.has(ch)) return 4.8;
  if (WIDE.has(ch)) return 9.6;
  return DEFAULT_ADVANCE;
}

/**
 * Width of `text` at `fontSize` (default 13) in pixels. Deterministic and
 * scaled linearly from the base table.
 */
export function measureTextWidth(
  text: string,
  fontSize: number = BASE_FONT_SIZE,
): number {
  const scale = fontSize / BASE_FONT_SIZE;
  let width = 0;
  for (const ch of text) width += advanceFor(ch);
  return Math.ceil(width * scale * 100) / 100;
}

export interface TextMeasurer {
  width(text: string, fontSize?: number): number;
}

export function createTextMeasurer(): TextMeasurer {
  return { width: (text, fontSize) => measureTextWidth(text, fontSize) };
}
