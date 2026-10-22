/**
 * @yalehwang/plantuml-js — viz-free core (the `./elk` subpath export).
 *
 * Everything a caller needs to parse, transform and render class diagrams with
 * the ELK engine, without pulling in `@viz-js/viz` (which ships a ~1MB WASM).
 * `src/index.ts` is the full build: it re-exports this core and adds the viz
 * engine + `renderDot`.
 */

import { PlantUmlModel } from './foundation/model.js';
import { parsePlantUml, parseWithDiagnostics, ENTITY_LINE, ENTITY_KEYWORD, extractDeclaredName, stripComment } from './parse/parser.js';
import { LayoutEngine, LayoutResult, DetailLevel, applyDetail } from './foundation/layout.js';
import { ThemeOverrides } from './render/theme.js';
import { ElkLayoutEngine, type ElkLayoutOptions } from './layout/elk.js';
import {
  renderSvg,
  RenderSvgOptions,
  RenderEngine,
  RenderFrameOptions,
  SvgRenderer,
  SvgRendererOptions,
} from './render/svg.js';
import { applyView, transformModel, transformModelDetailed, shouldAutoReduce, INTER_PACKAGE_AGGREGATE_ENTITY_THRESHOLD, ViewSpec, TransformOptions } from './transform/transform.js';

export type {
  PlantUmlModel,
  PlantUmlEntity,
  PlantUmlMember,
  PlantUmlRelation,
  PlantUmlPackage,
  EntityKind,
  RelationType,
} from './foundation/model.js';

export { defaultTheme, resolveTheme } from './render/theme.js';
export type { Theme, ThemeOverrides } from './render/theme.js';
export type { DetailLevel } from './foundation/layout.js';
export type {
  LayoutEngine,
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  Point,
} from './foundation/layout.js';

export interface RendererOptions {
  /**
   * `'elk'` (default) | a custom `LayoutEngine` instance. `'viz'` is only
   * accepted by the full build (`@yalehwang/plantuml-js`); this core entry
   * fails closed on it.
   */
  layout?: 'elk' | 'viz' | LayoutEngine;
  /** ELK tuning (e.g. `aspectRatio`); only applies to the `'elk'` engine, ignored by `'viz'` and custom engines. */
  layoutOptions?: ElkLayoutOptions;
  /**
   * Custom `RenderEngine` instance. Default: the built-in [[SvgRenderer]],
   * configured with `theme` and `legend`. When set, this engine owns the
   * rendering configuration, so `theme`/`legend` are not applied to it.
   */
  renderer?: RenderEngine;
  /** Collapse/expand the diagram before layout (overview, single package, …). */
  view?: ViewSpec;
  /** Extra model transforms applied on top of the view (aggregation, cycles, …). */
  transform?: TransformOptions;
  /** Draw a legend of the visual encodings. Default: on for diagrams with more than 30 entities. */
  legend?: boolean;
  /** Visual theme tokens; unspecified tokens fall back to `defaultTheme`. */
  theme?: ThemeOverrides;
  /**
   * Member detail: `'full'`, `'compact'` (first rows + count) or `'names'`.
   * Default: chosen by entity count (≤40 full, ≤150 compact, else names).
   */
  detail?: DetailLevel;
  /**
   * `'aggregate'` folds the relations between two packages into one weighted
   * box-to-box corridor edge (originals kept in its `<title>`); `'raw'` draws
   * every edge. Default: `'aggregate'` for diagrams with more than 150 entities.
   */
  interPackage?: 'aggregate' | 'raw';
  /**
   * Transitive edge reduction (A→B→C hides A→C). `'auto'` (default) reduces only
   * when every relation is a dependency/association and edges outnumber nodes
   * more than 3:1; `'transitive'` always reduces; `'none'` draws every edge.
   * Hidden edges are counted in the legend and in `data-hidden-transitive`.
   */
  edgeReduction?: 'auto' | 'transitive' | 'none';
}

export interface RenderResult {
  svg: string;
  diagramType: string;
  warnings: string[];
}

/**
 * Everything {@link renderDetailed} computed for one diagram: the model that was
 * actually laid out and drawn, the geometry the renderer used, the SVG it
 * emitted, and the reduction bookkeeping.
 *
 * This is a **public, stable API** (available from both the `.` and `./elk`
 * entries). Consumers such as an architecture tab should read geometry from
 * `layout` instead of parsing `svg` back into bounding boxes. In particular the
 * rectangle fields below are a stable contract:
 *
 * - `layout.nodes[i]` — `{ id, x, y, width, height }`; `id` is the same string
 *   the SVG puts on `<g class="uml-node" data-entity-id="…">`.
 * - `layout.packages[i]` (present for engines with container support, e.g.
 *   `'elk'`) — `{ id, x, y, width, height }`; `id` matches
 *   `<g class="uml-package" data-package-id="…">`.
 * - `layout.edges[i]` — `{ id, source, target, points }`; `source`/`target`
 *   match the SVG's `data-edge-source`/`data-edge-target` (aggregated package
 *   corridors are emitted as `data-edge-source`/`data-edge-target` pairs with
 *   `data-weight`), and `points` is the same polyline the SVG draws.
 *
 * `x`/`y` are relative to the diagram origin (the SVG's `viewBox` offset), so
 * they can be translated into a thumbnail directly.
 */
export interface DetailedRender {
  /** The model actually laid out and drawn (after view, transforms and detail). */
  model: PlantUmlModel;
  /** Geometry actually used by the renderer; its node/package/edge rectangles are a stable contract (see above). */
  layout: LayoutResult;
  svg: string;
  /** Layout engine wall time in milliseconds (excludes transforms, SVG and any rasterisation). */
  layoutMs: number;
  /** Edges hidden by transitive reduction (0 when it did not apply). */
  hiddenTransitive: number;
}

export interface Renderer {
  render(puml: string): Promise<RenderResult>;
}

/** One structured syntax finding produced by {@link checkSyntax}. */
export interface SyntaxDiagnostic {
  /** 1-based line number in the source. */
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

/** Result of {@link checkSyntax}: diagnostics, never a thrown exception. */
export interface SyntaxCheckResult {
  /** True when no `error`-severity diagnostics were found. */
  ok: boolean;
  errors: SyntaxDiagnostic[];
  warnings: SyntaxDiagnostic[];
}

/** Error thrown by {@link createRenderer}'s `render` on structurally invalid puml. */
export class RenderError extends Error {
  readonly diagnostics: SyntaxDiagnostic[];

  constructor(diagnostics: SyntaxDiagnostic[]) {
    super(
      'invalid PlantUML input:\n' +
        diagnostics.map((d) => `  line ${d.line}: ${d.message}`).join('\n'),
    );
    this.name = 'RenderError';
    this.diagnostics = diagnostics;
  }
}

function resolveEngine(
  layout: RendererOptions['layout'],
  layoutOptions?: ElkLayoutOptions,
): LayoutEngine {
  if (layout === undefined || layout === 'elk') return new ElkLayoutEngine(layoutOptions);
  if (typeof layout === 'string') {
    throw new Error(
      `unknown layout engine ${JSON.stringify(layout)} (expected 'elk' or a LayoutEngine instance; ` +
        `'viz' is only available from the full build '@yalehwang/plantuml-js')`,
    );
  }
  if (typeof layout?.layout !== 'function') {
    throw new Error(
      'invalid LayoutEngine: a custom engine must expose an async layout(model) method',
    );
  }
  return layout;
}

/**
 * Resolve the render engine the same way [[resolveEngine]] resolves layout:
 * the injected instance wins; otherwise the built-in [[SvgRenderer]] takes the
 * renderer-wide static configuration (`theme`, `legend`). Structural validation
 * fails closed instead of rendering an empty SVG.
 */
function resolveRenderer(options: RendererOptions): RenderEngine {
  const renderer = options.renderer;
  if (renderer === undefined) {
    return new SvgRenderer({ legend: options.legend, theme: options.theme });
  }
  if (typeof renderer.render !== 'function') {
    throw new Error(
      'invalid RenderEngine: a custom engine must expose a render(model, layout) method',
    );
  }
  return renderer;
}

export function createRenderer(options: RendererOptions = {}): Renderer {
  const engine = resolveEngine(options.layout, options.layoutOptions);
  const renderEngine = resolveRenderer(options);
  return {
    async render(puml: string): Promise<RenderResult> {
      // Fail closed on structurally invalid puml: checkSyntax reports instead of
      // letting a malformed diagram silently render as an empty SVG.
      const syntax = checkSyntax(puml);
      if (!syntax.ok) throw new RenderError(syntax.errors);

      const { model: parsed, diagnostics } = parseWithDiagnostics(puml);
      const { svg, model } = await renderParsed(parsed, options, engine, renderEngine);
      return { svg, diagramType: model.diagramType, warnings: diagnostics.map((d) => `line ${d.line}: ${d.message}`) };
    },
  };
}

async function renderParsed(
  parsed: PlantUmlModel,
  options: RendererOptions,
  engine: LayoutEngine,
  renderEngine: RenderEngine,
): Promise<DetailedRender> {
  const { model: transformed, hiddenTransitive } = transformForRender(parsed, options);
  const model = applyDetail(transformed, options.detail);
  const started = performance.now();
  const layout = await engine.layout(model);
  const layoutMs = Math.round((performance.now() - started) * 100) / 100;
  const svg = renderEngine.render(model, layout, { hiddenTransitive });
  return { model, layout, svg, layoutMs, hiddenTransitive };
}

/**
 * Render one diagram through the exact pipeline `createRenderer` uses
 * (view/transforms → detail → layout → svg) and return every intermediate, so
 * tooling can read real geometry instead of reverse-engineering the SVG.
 *
 * Accepts either a puml string (the counterpart of
 * `createRenderer(options).render(puml)`, with the same fail-closed
 * {@link RenderError} on invalid input) or an already-parsed
 * {@link PlantUmlModel} (used by the sample harness, which parses first to also
 * read parse diagnostics).
 *
 * Stable public API, exported from both the `.` and `./elk` package entries.
 * The returned {@link DetailedRender.layout} rectangles are the stable contract
 * documented on {@link DetailedRender}.
 */
export function renderDetailed(
  input: string,
  options?: RendererOptions,
): Promise<DetailedRender>;
export function renderDetailed(
  input: PlantUmlModel,
  options?: RendererOptions,
): Promise<DetailedRender>;
export async function renderDetailed(
  input: string | PlantUmlModel,
  options: RendererOptions = {},
): Promise<DetailedRender> {
  const parsed = typeof input === 'string' ? parseForDetailed(input) : input;
  return renderParsed(
    parsed,
    options,
    resolveEngine(options.layout, options.layoutOptions),
    resolveRenderer(options),
  );
}

/**
 * Parse the string form of {@link renderDetailed} with the same fail-closed
 * semantics as `createRenderer().render` (structured `RenderError`).
 */
function parseForDetailed(puml: string): PlantUmlModel {
  const syntax = checkSyntax(puml);
  if (!syntax.ok) throw new RenderError(syntax.errors);
  return parseWithDiagnostics(puml).model;
}

/**
 * Apply the configured view and transforms. A view collapses/expands first,
 * then the transform pipeline runs with the view's defaults (aggregation +
 * cycle marking) unless the caller overrides them. Without a view the full
 * graph runs through [[transformFullGraph]]: aggregation + cycle marking, plus
 * hub summarization once the graph is large enough that a handful of heavily
 * referenced nodes (e.g. `src/types`) would otherwise turn the canvas into an
 * unreadable arrow cluster.
 */
function transformForRender(
  model: PlantUmlModel,
  options: RendererOptions,
): { model: PlantUmlModel; hiddenTransitive: number } {
  const overrides: TransformOptions = {
    ...(options.interPackage ? { interPackage: options.interPackage } : {}),
    ...options.transform,
  };
  const mode = options.edgeReduction ?? 'auto';
  const reduction = (m: PlantUmlModel): TransformOptions =>
    overrides.transitiveReduction !== undefined || mode === 'none'
      ? {}
      : { transitiveReduction: mode === 'transitive' || shouldAutoReduce(m) };
  if (options.view) {
    const viewed = applyView(model, options.view);
    return transformModelDetailed(viewed, { ...defaultTransformOptions(viewed), ...reduction(viewed), ...overrides });
  }
  if (options.transform) {
    return transformModelDetailed(model, { interPackage: defaultInterPackage(model), ...reduction(model), ...overrides });
  }
  return transformModelDetailed(model, { ...defaultTransformOptions(model), ...reduction(model), ...overrides });
}

/**
 * Entity count at or above which the default full-graph render enables hub
 * summarization. Smaller models stay untouched so a hand-authored diagram is
 * drawn exactly as written.
 */
export const FULL_GRAPH_HUB_NODE_THRESHOLD = 40;

/**
 * Distinct-source in-degree above which a node's incoming edges are summarized
 * into a `usageCount` badge in the default full-graph render. 6 summarizes the
 * archguard package diagram's shared-infrastructure hubs (`src/types`,
 * `src/types/extensions`, `src/core/interfaces`, plus the other nodes with 8+
 * distinct dependents) while leaving ordinary modules drawn edge-by-edge.
 */
export const FULL_GRAPH_HUB_IN_DEGREE_THRESHOLD = 6;

/**
 * The transform pipeline the renderer applies to a full (unviewed) model by
 * default: aggregate parallel edges, summarize hubs on large graphs, and mark
 * cycle feedback arcs. `overrides` (a caller-supplied `transform` option) wins
 * over the defaults, so `{ hubThreshold: undefined }` re-enables per-edge
 * drawing of the hub's incoming edges.
 */
export function transformFullGraph(
  model: PlantUmlModel,
  overrides: TransformOptions = {},
): PlantUmlModel {
  return transformModel(model, { ...defaultTransformOptions(model), ...overrides });
}

/**
 * Apply a view, then the same default transforms as the full graph (computed on
 * the *viewed* model, so a large single-package view summarizes its hubs too).
 * `overrides` wins over the defaults.
 */
export function transformView(
  model: PlantUmlModel,
  view: ViewSpec,
  overrides: TransformOptions = {},
): PlantUmlModel {
  const viewed = applyView(model, view);
  return transformModel(viewed, { ...defaultTransformOptions(viewed), ...overrides });
}

function defaultInterPackage(model: PlantUmlModel): 'aggregate' | 'raw' {
  return model.entities.length > INTER_PACKAGE_AGGREGATE_ENTITY_THRESHOLD ? 'aggregate' : 'raw';
}

function defaultTransformOptions(model: PlantUmlModel): TransformOptions {
  const options: TransformOptions = { aggregate: true, cycles: true, interPackage: defaultInterPackage(model) };
  if (model.entities.length > FULL_GRAPH_HUB_NODE_THRESHOLD) {
    options.hubThreshold = FULL_GRAPH_HUB_IN_DEGREE_THRESHOLD;
  }
  return options;
}


/**
 * Validate a puml string without throwing. Returns structured diagnostics for
 * structurally invalid input (content outside a diagram, unbalanced
 * `@startuml`/`@enduml`, malformed entity declarations), so callers can surface
 * line-accurate messages instead of catching an exception.
 */
export function checkSyntax(puml: string): SyntaxCheckResult {
  const errors: SyntaxDiagnostic[] = [];
  const warnings: SyntaxDiagnostic[] = [];
  const lines = puml.split(/\r?\n/);
  let inDiagram = false;
  let sawStart = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') continue;

    if (/^@startuml\b/i.test(line)) {
      if (inDiagram) {
        warnings.push({
          line: lineNo,
          severity: 'warning',
          message: 'nested @startuml ignored',
        });
      }
      inDiagram = true;
      sawStart = true;
      continue;
    }
    if (/^@enduml\b/i.test(line)) {
      if (!inDiagram) {
        errors.push({
          line: lineNo,
          severity: 'error',
          message: '@enduml without a matching @startuml',
        });
      }
      inDiagram = false;
      continue;
    }

    if (!inDiagram) {
      const code = stripComment(line);
      if (code !== '') {
        errors.push({
          line: lineNo,
          severity: 'error',
          message: 'content outside a @startuml/@enduml block',
        });
      }
      continue;
    }

    const code = stripComment(line);
    if (code === '') continue;

    if (ENTITY_KEYWORD.test(code)) {
      const match = ENTITY_LINE.exec(code);
      const name = match ? extractDeclaredName(match[3]) : null;
      if (name === null) {
        errors.push({
          line: lineNo,
          severity: 'error',
          message: `malformed entity declaration: ${JSON.stringify(code)}`,
        });
      }
    }
  }

  for (const d of parseWithDiagnostics(puml).diagnostics) {
    warnings.push({ line: d.line, severity: 'warning', message: d.message });
  }

  if (sawStart && inDiagram) {
    errors.push({
      line: lines.length,
      severity: 'error',
      message: 'unterminated diagram: missing @enduml',
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** One per-line explanation produced by {@link explain}. */
export interface LineExplanation {
  /** 1-based line number. */
  line: number;
  /** The raw source text of the line. */
  text: string;
  kind:
    | 'directive'
    | 'entity'
    | 'member'
    | 'relation'
    | 'package'
    | 'comment'
    | 'blank'
    | 'unknown';
  /** A human-readable description of what the line means. */
  explanation: string;
}

const RELATION_RE = /--|\.\.|->|<-|o--|--o|\*--|--\*|<\|-|-\|>/;
const DIRECTIVE_RE =
  /^(?:skinparam|hide|show|title|legend|footer|header|note|scale|left|right|top|bottom|together|page|namespace)\b/i;

/**
 * Explain a puml string line by line, classifying each line (directive, entity,
 * member, relation, package, comment, blank, or unknown) with a short
 * human-readable description. Purely descriptive — it never mutates or throws.
 */
export function explain(puml: string): LineExplanation[] {
  return puml.split(/\r?\n/).map((raw, i) => {
    const line = i + 1;
    const { kind, explanation } = classifyLine(raw);
    return { line, text: raw, kind, explanation };
  });
}

function classifyLine(
  raw: string,
): { kind: LineExplanation['kind']; explanation: string } {
  const line = raw.trim();
  if (line === '') return { kind: 'blank', explanation: 'empty line' };
  if (/^@startuml\b/i.test(line))
    return { kind: 'directive', explanation: 'starts a PlantUML class diagram' };
  if (/^@enduml\b/i.test(line))
    return { kind: 'directive', explanation: 'ends the PlantUML class diagram' };
  if (/^@start\w+\b/i.test(line))
    return {
      kind: 'directive',
      explanation: 'starts a non-class diagram (ignored by this renderer)',
    };

  const code = stripComment(line);
  if (code === '') return { kind: 'comment', explanation: 'PlantUML comment' };

  if (ENTITY_KEYWORD.test(code)) {
    const match = ENTITY_LINE.exec(code);
    const name = match ? extractDeclaredName(match[3]) : null;
    if (name === null) {
      return { kind: 'entity', explanation: 'malformed entity declaration' };
    }
    const kind = /^abstract/i.test(code)
      ? 'abstract'
      : (code.split(/\s+/)[0] ?? '').toLowerCase();
    const label = kind === 'abstract' ? 'abstract class' : kind;
    return { kind: 'entity', explanation: `declares ${label} "${name}"` };
  }

  if (/^(?:package|namespace)\b/i.test(code))
    return { kind: 'package', explanation: 'package/namespace grouping' };
  if (/^[+~#-]/.test(code) || /^[{}]/.test(code))
    return { kind: 'member', explanation: 'class member (field or method)' };
  if (RELATION_RE.test(code))
    return { kind: 'relation', explanation: 'relation between entities' };
  if (DIRECTIVE_RE.test(code))
    return {
      kind: 'directive',
      explanation: 'PlantUML directive (ignored by this renderer)',
    };

  return { kind: 'unknown', explanation: 'unrecognised line (ignored)' };
}

export { parsePlantUml, ElkLayoutEngine, renderSvg, SvgRenderer };
export { toPlantUml } from './parse/serialize.js';
export type { RenderSvgOptions, RenderEngine, RenderFrameOptions, SvgRendererOptions };
export { computeLayoutMetrics } from './metrics/layout-metrics.js';
export type { LayoutMetrics } from './metrics/layout-metrics.js';
export {
  applyView,
  transformModel,
  aggregateRelations,
  transitiveReduce,
  summarizeHubs,
  markCycles,
  groupByPathPrefix,
} from './transform/transform.js';
export type { ViewSpec, TransformOptions } from './transform/transform.js';
export {
  archguardToPlantUml,
  archguardAliasMap,
  pathName,
  displayName,
  ARCHGUARD_RELATION_ARROWS,
} from './archguard.js';
export type {
  ArchguardNode,
  ArchguardEdge,
  ArchguardGraph,
  ArchguardBridgeOptions,
  ArchguardPlantUml,
} from './archguard.js';
