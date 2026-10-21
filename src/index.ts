/**
 * @yalehwang/plantuml-js — full public API.
 *
 * Re-exports the viz-free core (`./core.js`) and adds the `@viz-js/viz` engine
 * and `renderDot`. Prefer the `./elk` subpath when you only need ELK, so your
 * bundle stays free of the Graphviz WASM.
 */

import { VizLayoutEngine } from './layout/viz.js';
import { renderDot } from './foundation/render-dot.js';
import {
  createRenderer as createCoreRenderer,
  Renderer,
  RendererOptions,
} from './core.js';

export * from './core.js';
export type { GraphvizEngine } from './foundation/render-dot.js';
export { renderDot, VizLayoutEngine };

/**
 * Build a renderer. `layout` is `'elk'` (default), `'viz'` (experimental), or a
 * custom `LayoutEngine`. `'viz'` is resolved here (in the full build) by
 * substituting a [[VizLayoutEngine]] instance and delegating to the core.
 */
export function createRenderer(options: RendererOptions = {}): Renderer {
  if (options.layout === 'viz') {
    return createCoreRenderer({ ...options, layout: new VizLayoutEngine() });
  }
  return createCoreRenderer(options);
}
