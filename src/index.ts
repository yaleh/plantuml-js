/**
 * @yalehwang/plantuml-js — public API.
 *
 * M1 exposes `createRenderer({ layout })` returning `render(puml)`, plus the
 * parser for direct IR access. `checkSyntax` / `explain` / `renderDot` and the
 * `'viz'` engine arrive with M3.
 */

import { PlantUmlModel } from './model.js';
import { parsePlantUml } from './parser.js';
import { LayoutEngine } from './layout.js';
import { ElkLayoutEngine } from './layout/elk.js';
import { renderSvg } from './render/svg.js';

export type {
  PlantUmlModel,
  PlantUmlEntity,
  PlantUmlMember,
  PlantUmlRelation,
  PlantUmlPackage,
  EntityKind,
  RelationType,
} from './model.js';

export type {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  Point,
} from './layout.js';

export interface RendererOptions {
  /** 'elk' (default) | 'viz' (M3) | a custom LayoutEngine instance. */
  layout?: 'elk' | 'viz' | LayoutEngine;
}

export interface RenderResult {
  svg: string;
  diagramType: string;
  warnings: string[];
}

export interface Renderer {
  render(puml: string): Promise<RenderResult>;
}

function resolveEngine(layout: RendererOptions['layout']): LayoutEngine {
  if (layout === undefined || layout === 'elk') return new ElkLayoutEngine();
  if (layout === 'viz') {
    throw new Error("layout 'viz' is not implemented yet (lands in M3)");
  }
  return layout;
}

export function createRenderer(options: RendererOptions = {}): Renderer {
  const engine = resolveEngine(options.layout);
  return {
    async render(puml: string): Promise<RenderResult> {
      const model = parsePlantUml(puml);
      const layout = await engine.layout(model);
      const svg = renderSvg(model, layout);
      return { svg, diagramType: model.diagramType, warnings: [] };
    },
  };
}

export { parsePlantUml, ElkLayoutEngine };
