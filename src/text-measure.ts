/**
 * Monospace text measurement for the SVG renderer, pure JS (no canvas, no
 * DOM). The SVG font is monospace, so every glyph advances by the same em
 * width (0.6em — 13px × 0.6em ≈ 7.8px). A box sized from a fixed advance never
 * clips its longest member line, and narrow glyphs (`i l . , : ( )`) are no
 * longer under-counted.
 */

/** Font size the renderer draws entity text at; keep in step with [[../layout]]. */
export const MONOSPACE_FONT_SIZE = 13;
/** Monospace advance per em: 13px × 0.6em ≈ 7.8px per glyph. */
export const MONOSPACE_ADVANCE_EM = 0.6;

/**
 * Width of `text` at `fontSize` (default 13) in pixels. Deterministic and
 * linear in both the character count and the font size — every glyph, whatever
 * its shape, contributes the same advance.
 */
export function measureTextWidth(
  text: string,
  fontSize: number = MONOSPACE_FONT_SIZE,
): number {
  return Math.ceil(text.length * MONOSPACE_ADVANCE_EM * fontSize * 100) / 100;
}

export interface TextMeasurer {
  width(text: string, fontSize?: number): number;
}

export function createTextMeasurer(): TextMeasurer {
  return { width: (text, fontSize) => measureTextWidth(text, fontSize) };
}
