/**
 * @yalehwang/plantuml-js — public API.
 *
 * M1 exposed `createRenderer({ layout })` returning `render(puml)`, plus the
 * parser for direct IR access. M3 adds the `@viz-js/viz` engine, the
 * `checkSyntax` / `explain` diagnostics helpers, and `renderDot` for direct
 * Graphviz rendering.
 */

import { PlantUmlModel } from './model.js';
import { parsePlantUml } from './parser.js';
import { LayoutEngine } from './layout.js';
import { ElkLayoutEngine } from './layout/elk.js';
import { VizLayoutEngine } from './layout/viz.js';
import { renderSvg } from './render/svg.js';
import { renderDot } from './render-dot.js';

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

export type { GraphvizEngine } from './render-dot.js';
export { renderDot };

export interface RendererOptions {
  /** 'elk' (default) | 'viz' | a custom LayoutEngine instance. */
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

function resolveEngine(layout: RendererOptions['layout']): LayoutEngine {
  if (layout === undefined || layout === 'elk') return new ElkLayoutEngine();
  if (layout === 'viz') return new VizLayoutEngine();
  if (typeof layout === 'string') {
    throw new Error(
      `unknown layout engine ${JSON.stringify(layout)} (expected 'elk', 'viz', or a LayoutEngine instance)`,
    );
  }
  if (typeof layout?.layout !== 'function') {
    throw new Error(
      'invalid LayoutEngine: a custom engine must expose an async layout(model) method',
    );
  }
  return layout;
}

export function createRenderer(options: RendererOptions = {}): Renderer {
  const engine = resolveEngine(options.layout);
  return {
    async render(puml: string): Promise<RenderResult> {
      // Fail closed on structurally invalid puml: checkSyntax reports instead of
      // letting a malformed diagram silently render as an empty SVG.
      const syntax = checkSyntax(puml);
      if (!syntax.ok) throw new RenderError(syntax.errors);

      const model = parsePlantUml(puml);
      const layout = await engine.layout(model);
      const svg = renderSvg(model, layout);
      return { svg, diagramType: model.diagramType, warnings: [] };
    },
  };
}

const ENTITY_DECL = /^(?:abstract\s+)?(?:class|interface|enum)\s+(.+)$/i;
const ENTITY_KEYWORD = /^(?:abstract\s+)?(?:class|interface|enum)\b/i;

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
      const match = ENTITY_DECL.exec(code);
      const name = match ? extractDeclaredName(match[1]) : null;
      if (name === null) {
        errors.push({
          line: lineNo,
          severity: 'error',
          message: `malformed entity declaration: ${JSON.stringify(code)}`,
        });
      }
    }
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
    const match = ENTITY_DECL.exec(code);
    const name = match ? extractDeclaredName(match[1]) : null;
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

/**
 * Extract a declaration name from an entity line's tail, mirroring the parser:
 * accepts a bare token (`class A`) or a quoted name (`class "User Repo"`), and
 * tolerates a trailing `as <alias>`. Returns null when the name is missing or
 * the quoted name is unterminated.
 */
function extractDeclaredName(rest: string): string | null {
  const asIndex = rest.search(/\s+as\s+\S+\s*$/i);
  const core = asIndex === -1 ? rest.trim() : rest.slice(0, asIndex).trim();
  if (core === '') return null;
  if (core.startsWith('"')) {
    const close = core.indexOf('"', 1);
    if (close === -1) return null;
    return core.slice(1, close);
  }
  return core.split(/\s+/)[0] || null;
}

/** Strip PlantUML `'` line comments (a leading `'` or a trailing inline `'`). */
function stripComment(line: string): string {
  const idx = line.indexOf("'");
  if (idx === -1) return line.trim();
  return line.slice(0, idx).trim();
}

export { parsePlantUml, ElkLayoutEngine, VizLayoutEngine, renderSvg };
export { computeLayoutMetrics } from './layout-metrics.js';
export type { LayoutMetrics } from './layout-metrics.js';
