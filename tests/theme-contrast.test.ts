import { describe, it, expect } from 'vitest';
import { createRenderer } from '../src/index.js';
import { defaultTheme, contrastRatio, blendOver } from '../src/render/theme.js';

const { color, dash, stroke } = defaultTheme;

describe('default theme accessibility', () => {
  it('keeps body text readable (>= 4.5:1) on its backgrounds', () => {
    for (const bg of [color.nodeFill, color.stubFill, color.canvas, ...color.packageFills]) {
      expect(contrastRatio(color.textTitle, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.textMember, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.textPackage, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps node outlines >= 3:1 against the canvas', () => {
    expect(contrastRatio(color.stroke, color.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color.strokeStub, color.canvas)).toBeGreaterThanOrEqual(3);
  });

  it('keeps feedback and plain edges >= 3:1 against the canvas and against each other', () => {
    expect(contrastRatio(color.edge, color.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color.warn, color.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color.warn, color.edge)).toBeGreaterThanOrEqual(3);
  });

  it('keeps every edge kind (incl. dashed/dotted) >= 3:1 against the deepest package fill', () => {
    const deepest = color.packageFills.reduce((a, b) => (contrastRatio(a, color.canvas) <= contrastRatio(b, color.canvas) ? a : b));
    const kinds: [string, string, number][] = [
      ['strong', color.edge, stroke.opacity.strong],
      ['strong light', color.edge, stroke.opacity.light],
      ['strong medium', color.edge, stroke.opacity.medium],
      ['weak (dotted)', color.edgeWeak, stroke.opacity.light],
      ['weak heavy', color.edgeWeak, stroke.opacity.strong],
      ['feedback', color.warn, stroke.opacity.feedback],
    ];
    for (const [name, fg, alpha] of kinds) {
      for (const bg of [...color.packageFills, color.canvas, color.nodeFill]) {
        expect(contrastRatio(blendOver(fg, bg, alpha), bg), `${name} on ${bg} (deepest ${deepest})`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps hub badge text >= 4.5:1', () => {
    expect(contrastRatio(color.accentText, color.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('marks feedback edges with a non-colour cue (dash-dot, distinct from weak dashes)', async () => {
    expect(dash.feedback).not.toBe(dash.weak);
    expect(dash.feedback.split(',').length).toBeGreaterThan(2);
    const { svg } = await createRenderer().render(
      '@startuml\nclass A\nclass B\nA --> B\nB --> A\n@enduml',
    );
    const m = /<path[^>]*stroke-dasharray="([^"]+)"[^>]*class="uml-feedback"/.exec(svg);
    expect(m?.[1]).toBe(dash.feedback);
  });
});
