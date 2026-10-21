/**
 * Monospace text measurement for the SVG renderer, pure JS (no canvas, no
 * DOM). The SVG font is monospace, so every glyph advances by the same em
 * width (0.61em — 13px × 0.61em ≈ 7.93px). A box sized from a fixed advance
 * never clips its longest member line, and narrow glyphs (`i l . , : ( )`) are
 * no longer under-counted.
 *
 * The advance is 0.61em, not the nominal 0.6em: headless-Chrome truth
 * (`scripts/measure-svg-text.mjs`) measures DejaVu Sans Mono — the font the
 * browser resolves `font-family="monospace"` to — at ≈0.602em advance, so a
 * 0.6em advance under-sizes every box by ~0.3% and lets the longest member
 * lines clip. 0.61em covers that advance with a small safety margin.
 */

/** Font size the renderer draws entity text at; keep in step with [[../layout]]. */
export const MONOSPACE_FONT_SIZE = 13;
/** Monospace advance per em: 13px × 0.61em ≈ 7.93px per glyph. */
export const MONOSPACE_ADVANCE_EM = 0.61;

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
