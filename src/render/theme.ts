/**
 * Theme — every visual decision of the SVG renderer as a token. `svg.ts` and
 * `legend.ts` read only from a resolved Theme, so no colour, size or dash
 * pattern lives as a literal in drawing code. Rationale and the font decision
 * are recorded in docs/visual-design.md.
 */

export interface Theme {
  font: {
    /** Monospace keeps the pure-JS width table (src/text-measure.ts) exact. */
    family: string;
    /** Size ladder: title/member/package label/edge label/badge. */
    size: { title: number; member: number; packageLabel: number; edgeLabel: number; badge: number };
    weight: { title: string; member: string; packageLabel: string };
  };
  color: {
    canvas: string;
    /** Node/package outlines (slate, never pure black). */
    stroke: string;
    strokeStub: string;
    nodeFill: string;
    stubFill: string;
    textTitle: string;
    textMember: string;
    textPackage: string;
    edge: string;
    edgeWeak: string;
    /** Halo drawn around edge-label text so a line never strikes through it. */
    labelHalo: string;
    /** Cycle feedback edges — the only use of red. */
    warn: string;
    /** Neutral informational accent (hub badge). */
    accent: string;
    accentText: string;
    /** Low-saturation package fills, cycled by layer / nesting depth. */
    packageFills: string[];
    packageStroke: string;
    legendStroke: string;
  };
  shape: { nodeRadius: number; packageRadius: number; edgeCornerRadius: number };
  stroke: {
    node: number;
    package: number;
    edge: number;
    arrow: number;
    /** Extra width per merged relation and the cap. */
    weightStep: number;
    weightMax: number;
    /** Width of a cycle feedback edge (weight can only widen it). */
    feedback: number;
    /** Weight (merged relations) from which an edge counts as heavy. */
    heavyWeight: number;
    /** Edge opacity tiers: light = weight 1, medium = weight 2, strong = heavy, feedback = cycle back edge. */
    opacity: { light: number; medium: number; strong: number; feedback: number };
    /** Width of the label halo stroke. */
    labelHalo: number;
  };
  /** Line types: weak = dependency, implementation = realisation, feedback = cycle back edge. */
  dash: { weak: string; implementation: string; stub: string; feedback: string };
  arrow: { triangle: number; chevron: number; diamond: number };
  /** Spacing grid (px); node sizes snap to it. */
  grid: number;
}

export const defaultTheme: Theme = {
  font: {
    family: 'monospace',
    size: { title: 13, member: 12, packageLabel: 12, edgeLabel: 11, badge: 11 },
    weight: { title: 'bold', member: 'normal', packageLabel: 'bold' },
  },
  color: {
    canvas: '#ffffff',
    stroke: '#64748b',
    strokeStub: '#7c8ba1',
    nodeFill: '#ffffff',
    stubFill: '#f1f5f9',
    textTitle: '#1e293b',
    textMember: '#475569',
    textPackage: '#334155',
    edge: '#7c8ba1',
    edgeWeak: '#7c8ba1',
    labelHalo: '#ffffff',
    warn: '#6b1414',
    accent: '#475569',
    accentText: '#ffffff',
    packageFills: ['#f8fafc', '#f1f5f9', '#eef2f7', '#e8eef5'],
    packageStroke: '#94a3b8',
    legendStroke: '#94a3b8',
  },
  shape: { nodeRadius: 6, packageRadius: 8, edgeCornerRadius: 6 },
  stroke: {
    node: 1,
    package: 1,
    edge: 1,
    arrow: 1,
    weightStep: 0.5,
    weightMax: 6,
    feedback: 1.5,
    heavyWeight: 3,
    opacity: { light: 0.75, medium: 0.9, strong: 1, feedback: 0.95 },
    labelHalo: 3,
  },
  dash: { weak: '2,4', implementation: '6,3', stub: '5,3', feedback: '10,3,2,3' },
  arrow: { triangle: 12, chevron: 10, diamond: 14 },
  grid: 8,
};

export type ThemeOverrides = {
  [K in keyof Theme]?: Theme[K] extends readonly unknown[]
    ? Theme[K]
    : Theme[K] extends object
      ? { [P in keyof Theme[K]]?: Theme[K][P] extends object ? Partial<Theme[K][P]> : Theme[K][P] }
      : Theme[K];
};

/** Merge a partial theme over the defaults (arrays replace, objects merge). */
export function resolveTheme(overrides?: ThemeOverrides): Theme {
  return mergeDeep(defaultTheme, overrides ?? {}) as Theme;
}

function mergeDeep(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (
    typeof base === 'object' && base !== null && !Array.isArray(base) &&
    typeof over === 'object' && over !== null && !Array.isArray(over)
  ) {
    const out: Record<string, unknown> = {};
    const b = base as Record<string, unknown>;
    const o = over as Record<string, unknown>;
    for (const key of Object.keys(b)) out[key] = mergeDeep(b[key], o[key]);
    return out;
  }
  return over;
}

/** Every colour value of a theme (for token-membership assertions). */
export function themeColors(theme: Theme): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(theme.color)) {
    if (Array.isArray(v)) v.forEach((c) => out.add(c));
    else out.add(v);
  }
  return out;
}

/** `fg` at `alpha` composited over `bg` (both `#rrggbb`), as a `#rrggbb` colour. */
export function blendOver(fg: string, bg: string, alpha: number): string {
  const f = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const mix = (shift: number): number =>
    Math.round(alpha * ((f >> shift) & 255) + (1 - alpha) * ((b >> shift) & 255));
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
}

/** WCAG relative luminance contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
