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
  return Math.ceil(textUnits(text) * MONOSPACE_ADVANCE_EM * fontSize * 100) / 100;
}

/** East Asian wide / fullwidth ranges: these glyphs advance two monospace cells. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Width of `text` in monospace cells: CJK / fullwidth code points count 2, the rest 1. */
export function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return units;
}

export interface TextMeasurer {
  width(text: string, fontSize?: number): number;
}

export function createTextMeasurer(): TextMeasurer {
  return { width: (text, fontSize) => measureTextWidth(text, fontSize) };
}
