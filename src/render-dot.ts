/**
 * renderDot — direct DOT rendering at the layout layer.
 *
 * M3 exposes Graphviz as a first-class citizen: `renderDot(dot, engine)` feeds a
 * raw DOT string to `@viz-js/viz` (WASM Graphviz) and returns the rendered SVG.
 * The shared `getViz()` cache is also what VizLayoutEngine reuses, so a process
 * never loads the WASM runtime twice.
 */

import { instance, type Viz, type RenderResult } from '@viz-js/viz';

/** Graphviz layout engines exposed by @viz-js/viz (the `nop*` no-ops are excluded). */
export type GraphvizEngine =
  | 'dot'
  | 'neato'
  | 'fdp'
  | 'sfdp'
  | 'circo'
  | 'twopi'
  | 'osage'
  | 'patchwork';

let vizPromise: Promise<Viz> | null = null;

/** Lazily create (and cache) the WASM Graphviz instance. */
export function getViz(): Promise<Viz> {
  vizPromise ??= instance();
  return vizPromise;
}

/**
 * Render a raw DOT graph to SVG.
 *
 * Fails closed: an invalid DOT string or an unknown engine raises an Error that
 * carries Graphviz's diagnostics instead of silently returning a broken SVG.
 */
export async function renderDot(
  dot: string,
  engine: GraphvizEngine = 'dot',
): Promise<string> {
  const viz = await getViz();
  const result: RenderResult = viz.render(dot, { format: 'svg', engine });
  if (result.status === 'failure') {
    const detail = result.errors.map((e) => e.message).join('\n');
    throw new Error(
      `renderDot: Graphviz engine ${JSON.stringify(engine)} failed:\n${detail}`,
    );
  }
  return result.output;
}
