/**
 * Hand-written recursive-descent parser for the PlantUML class-diagram subset.
 *
 * M2 scope adds members (visibility `-`/`+`/`#`/`~`, fields, method
 * signatures), relations (inheritance / implementation / dependency /
 * association / aggregation / composition with cardinality and labels),
 * generics (`List~Item~`, `BaseEntity<T>`), package/namespace grouping,
 * aliases, and tolerant skipping of skinparam/hide/note directives.
 */

import {
  PlantUmlModel,
  PlantUmlEntity,
  PlantUmlMember,
  PlantUmlRelation,
  EntityKind,
  Visibility,
  RelationType,
  emptyModel,
} from '../foundation/model.js';

type Frame = { kind: 'package' | 'entity'; id: string };

export const ENTITY_LINE = /^(abstract\s+)?(class|interface|enum)\s+(.+)$/i;

export const ENTITY_KEYWORD = /^(?:abstract\s+)?(?:class|interface|enum)\b/i;

const ARROWS: Record<string, { type: RelationType; swap?: boolean }> = {
  '--|>': { type: 'inheritance' },
  '<|--': { type: 'inheritance', swap: true },
  '..|>': { type: 'implementation' },
  '<|..': { type: 'implementation', swap: true },
  '..>': { type: 'dependency' },
  '<..': { type: 'dependency', swap: true },
  '-->': { type: 'association' },
  '<--': { type: 'association', swap: true },
  '--': { type: 'association' },
  'o--': { type: 'aggregation' },
  '--o': { type: 'aggregation', swap: true },
  '*--': { type: 'composition' },
  '--*': { type: 'composition', swap: true },
};

/**
 * Parse a PlantUML source string into a PlantUmlModel.
 *
 * The parser is total: unrecognised lines (skinparam, hide, note, title,
 * legend, …) are tolerated and skipped rather than failing the parse.
 */
export function parsePlantUml(source: string): PlantUmlModel {
  return parseWithDiagnostics(source).model;
}

/** An undeclared relation endpoint that the parser resolved on the author's behalf. */
export interface EndpointDiagnostic {
  /** 1-based source line of the relation. */
  line: number;
  message: string;
}

/**
 * Parse and also report how relation endpoints were resolved: endpoints naming
 * a package are re-attached to a representative entity inside it, and endpoints
 * naming nothing declared become implicit (empty) classes, as PlantUML does.
 */
export function parseWithDiagnostics(source: string): {
  model: PlantUmlModel;
  diagnostics: EndpointDiagnostic[];
} {
  const relationLines: number[] = [];
  const model = parseRaw(source, relationLines);
  const diagnostics = resolveEndpoints(model, relationLines);
  return { model, diagnostics };
}

function resolveEndpoints(model: PlantUmlModel, relationLines: number[]): EndpointDiagnostic[] {
  const diagnostics: EndpointDiagnostic[] = [];
  const entityIds = new Set(model.entities.map((e) => e.id));
  const packageIds = new Set(model.packages.map((p) => p.id));
  const parentOf = new Map(model.packages.map((p) => [p.id, p.parentId]));

  const inPackage = (entityPkg: string | undefined, pkg: string): boolean => {
    for (let cur = entityPkg; cur !== undefined; cur = parentOf.get(cur)) {
      if (cur === pkg) return true;
    }
    return false;
  };
  const representative = (pkg: string): string | undefined =>
    model.entities.find((e) => inPackage(e.packageId, pkg))?.id;

  // An endpoint may name a package by its id or by the identifier form of its
  // display name (`CLI_Layer` for `"CLI Layer (命令层)"`), as authors write it.
  const packageByKey = new Map<string, string>();
  for (const p of model.packages) {
    for (const key of [p.id, packageKey(p.name)]) {
      if (!packageByKey.has(key)) packageByKey.set(key, p.id);
    }
  }
  const asPackage = (id: string): string | undefined =>
    packageIds.has(id) ? id : packageByKey.get(id);

  const resolve = (id: string, line: number, pkgOut: (p: string) => void): string => {
    if (entityIds.has(id)) return id;
    const pkg = asPackage(id);
    if (pkg !== undefined) {
      const rep = representative(pkg);
      if (rep !== undefined) {
        diagnostics.push({
          line,
          message: `relation endpoint "${id}" is a package; edge attached to "${rep}" inside it`,
        });
        pkgOut(pkg);
        return rep;
      }
    }
    model.entities.push({
      id,
      name: id,
      generics: [],
      kind: 'class',
      members: [],
      external: true,
    });
    entityIds.add(id);
    diagnostics.push({
      line,
      message: `relation endpoint "${id}" is not declared; implicit class created`,
    });
    return id;
  };

  model.relations.forEach((r, i) => {
    const line = relationLines[i] ?? 0;
    r.source = resolve(r.source, line, (p) => {
      r.sourcePackageId = p;
    });
    r.target = resolve(r.target, line, (p) => {
      r.targetPackageId = p;
    });
  });
  return diagnostics;
}

/** Identifier form of a package display name: parenthetical dropped, non-word runs → `_`. */
function packageKey(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_');
}

function parseRaw(source: string, relationLines: number[]): PlantUmlModel {
  const model = emptyModel();
  const lines = source.split(/\r?\n/);
  let inDiagram = false;
  const stack: Frame[] = [];
  let lastDeclaration: { kind: 'package' | 'entity'; id: string } | null =
    null;

  const open = (frame: Frame) => {
    stack.push(frame);
    lastDeclaration = null;
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (line === '') continue;

    if (/^@startuml\b/i.test(line)) {
      inDiagram = true;
      continue;
    }
    if (/^@enduml\b/i.test(line)) {
      inDiagram = false;
      continue;
    }
    if (!inDiagram) continue;

    const code = stripComment(line);
    if (code === '') continue;

    // Directives that carry no class-model content — tolerated, not rendered.
    if (
      /^(skinparam\b|hide\b|title\b|legend\b|note\b|end\s+note\b|scale\b|left-to-right\b|top-to-bottom\b)/i.test(
        code,
      )
    ) {
      lastDeclaration = null;
      continue;
    }

    // A bare `{` opens a block for the most recent `class Foo` / `package X`
    // declaration that was written without an inline brace.
    if (code === '{') {
      if (lastDeclaration) open({ kind: lastDeclaration.kind, id: lastDeclaration.id });
      continue;
    }
    if (code === '}') {
      stack.pop();
      lastDeclaration = null;
      continue;
    }

    const pkg = parsePackageLine(code);
    if (pkg) {
      const record: PlantUmlModel['packages'][number] = {
        id: pkg.id,
        name: pkg.name,
        parentId: currentPackageId(stack),
      };
      if (pkg.layer !== undefined) record.layer = pkg.layer;
      model.packages.push(record);
      if (pkg.opensBlock) open({ kind: 'package', id: pkg.id });
      else lastDeclaration = { kind: 'package', id: pkg.id };
      continue;
    }

    const ent = parseEntityLine(code);
    if (ent) {
      ent.entity.packageId = currentPackageId(stack);
      model.entities.push(ent.entity);
      if (ent.opensBlock) open({ kind: 'entity', id: ent.entity.id });
      else lastDeclaration = { kind: 'entity', id: ent.entity.id };
      continue;
    }

    // Member lines belong to the innermost open entity body.
    if (stack.length > 0 && stack[stack.length - 1].kind === 'entity') {
      const member = parseMemberLine(code);
      if (member) {
        const ownerId = stack[stack.length - 1].id;
        const owner = model.entities.find((e) => e.id === ownerId);
        owner?.members.push(member);
        continue;
      }
    }

    // Relation lines are valid at top level and inside a package, never
    // inside an entity body.
    if (stack.length === 0 || stack[stack.length - 1].kind === 'package') {
      const relation = parseRelationLine(code);
      if (relation) {
        model.relations.push(relation);
        relationLines.push(lineIdx + 1);
        lastDeclaration = null;
        continue;
      }
    }
  }

  return model;
}

function currentPackageId(stack: Frame[]): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === 'package') return stack[i].id;
  }
  return undefined;
}

function parsePackageLine(
  code: string,
): { id: string; name: string; opensBlock: boolean; layer?: string } | null {
  let opensBlock = false;
  if (code.endsWith('{')) {
    opensBlock = true;
    code = code.slice(0, -1).trim();
  }
  const m = /^(package|namespace)\s+(.+)$/i.exec(code);
  if (!m) return null;

  const rest = m[2].trim();
  const asMatch = /\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(rest);
  const alias = asMatch?.[1];
  const core = asMatch ? rest.slice(0, asMatch.index).trim() : rest;

  let name: string;
  if (core.startsWith('"')) {
    const close = core.indexOf('"', 1);
    if (close === -1) return null;
    name = core.slice(1, close);
  } else {
    name = core.split(/\s+/)[0];
  }
  if (name === '') return null;

  return { id: alias ?? name, name, opensBlock, layer: layerFromName(name) };
}

/**
 * Derive a semantic layer from the `"X Layer"` name convention used by the
 * archguard package diagrams (`"Src Layer"` → `"Src"`). Non-matching names and
 * a bare `"Layer"` carry no layer.
 */
function layerFromName(name: string): string | undefined {
  const m = /^(.*)\s+Layer$/i.exec(name);
  if (!m) return undefined;
  const core = m[1].trim();
  return core === '' ? undefined : core;
}

function parseEntityLine(
  code: string,
): { entity: PlantUmlEntity; opensBlock: boolean } | null {
  let opensBlock = false;
  if (code.endsWith('{')) {
    opensBlock = true;
    code = code.slice(0, -1).trim();
  }

  const m = ENTITY_LINE.exec(code);
  if (!m) return null;

  const isAbstract = m[1] !== undefined;
  const keyword = m[2].toLowerCase();
  const rest = m[3].trim();

  const asMatch = /\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(rest);
  const alias = asMatch?.[1];
  const core = asMatch ? rest.slice(0, asMatch.index).trim() : rest;

  const parsed = parseNameAndGenerics(core);
  if (!parsed) return null;

  const kind: EntityKind = isAbstract
    ? 'abstract'
    : (keyword as 'class' | 'interface' | 'enum');

  return {
    entity: {
      id: alias ?? parsed.name,
      name: parsed.name,
      generics: parsed.generics,
      kind,
      members: [],
    },
    opensBlock,
  };
}

function parseNameAndGenerics(
  core: string,
): { name: string; generics: string[] } | null {
  core = core.trim();
  if (core === '') return null;

  if (core.startsWith('"')) {
    const close = core.indexOf('"', 1);
    if (close === -1) return null;
    const name = core.slice(1, close);
    const tail = core.slice(close + 1).trim();
    return { name, generics: parseGenericTail(tail) };
  }

  // Drop a stereotype suffix (`<< ... >>`) — not part of the name in M2.
  const stereo = core.indexOf('<<');
  if (stereo !== -1) core = core.slice(0, stereo).trim();

  const tilde = /^(\S+?)~([^~]+)~$/.exec(core);
  if (tilde) return { name: tilde[1], generics: splitArgs(tilde[2]) };

  const angle = /^(\S+?)<([^>]+)>$/.exec(core);
  if (angle) return { name: angle[1], generics: splitArgs(angle[2]) };

  return { name: core.split(/\s+/)[0], generics: [] };
}

function parseGenericTail(tail: string): string[] {
  const angle = /^<([^>]+)>$/.exec(tail);
  if (angle) return splitArgs(angle[1]);
  const tilde = /^~([^~]+)~$/.exec(tail);
  if (tilde) return splitArgs(tilde[1]);
  return [];
}

function splitArgs(args: string): string[] {
  return args
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function parseMemberLine(code: string): PlantUmlMember | null {
  const visMap: Record<string, Visibility> = {
    '+': 'public',
    '-': 'private',
    '#': 'protected',
    '~': 'package-private',
  };
  const symbol = code[0];
  const visibility = visMap[symbol];
  if (!visibility) return null;

  const raw = code.trim();
  let rest = code.slice(1).trim();

  // Strip leading modifier tokens ({static}/{abstract} and bare async/…).
  const modifiers: string[] = [];
  for (;;) {
    const brace = /^\{[^{}]*\}\s*/.exec(rest);
    if (brace) {
      modifiers.push(brace[0].trim());
      rest = rest.slice(brace[0].length).trim();
      continue;
    }
    const word = /^(async|abstract|static)\s+/.exec(rest);
    if (word) {
      modifiers.push(word[1]);
      rest = rest.slice(word[0].length).trim();
      continue;
    }
    break;
  }

  const paren = rest.indexOf('(');
  if (paren !== -1) {
    const name = rest.slice(0, paren).trim();
    const close = matchingParen(rest, paren);
    if (close === -1) return null;
    const parameters = rest.slice(paren, close + 1);
    const after = rest.slice(close + 1).trim();
    const type = after.startsWith(':') ? after.slice(1).trim() : undefined;
    return { visibility, name, kind: 'method', type, parameters, modifiers, raw };
  }

  const colon = rest.indexOf(':');
  if (colon !== -1) {
    let name = rest.slice(0, colon).trim();
    const optional = name.endsWith('?');
    if (optional) name = name.slice(0, -1).trim();
    const type = rest.slice(colon + 1).trim();
    return { visibility, name, kind: 'field', type, modifiers, optional, raw };
  }

  let name = rest;
  const optional = name.endsWith('?');
  if (optional) name = name.slice(0, -1).trim();
  return { visibility, name, kind: 'field', modifiers, optional, raw };
}

function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseRelationLine(code: string): PlantUmlRelation | null {
  // Split a trailing `: label` at the last top-level colon.
  let label: string | undefined;
  const colon = lastTopLevelColon(code);
  if (colon !== -1) {
    label = code.slice(colon + 1).trim();
    code = code.slice(0, colon).trim();
  }

  const tokens = code.split(/\s+/).filter(Boolean);
  const arrowIdx = tokens.findIndex((t) => ARROWS[t] !== undefined);
  if (arrowIdx === -1) return null;

  const left = tokens.slice(0, arrowIdx);
  const right = tokens.slice(arrowIdx + 1);
  if (left.length === 0 || right.length === 0) return null;

  let source = endpointName(left[0]);
  let target = endpointName(right[right.length - 1]);
  let sourceCardinality = left[1] ? stripQuotes(left[1]) : undefined;
  let targetCardinality =
    right.length > 1 ? stripQuotes(right[0]) : undefined;

  const arrow = ARROWS[tokens[arrowIdx]];
  if (arrow.swap) {
    [source, target] = [target, source];
    [sourceCardinality, targetCardinality] = [targetCardinality, sourceCardinality];
  }

  return {
    source,
    target,
    type: arrow.type,
    label: label === '' ? undefined : label,
    sourceCardinality,
    targetCardinality,
  };
}

function lastTopLevelColon(s: string): number {
  let quote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (c === ':' && !quote) return i;
  }
  return -1;
}

function endpointName(token: string): string {
  const generic = /^(\S+?)(?:~[^~]*~|<[^>]*>)$/.exec(token);
  return generic ? generic[1] : token;
}

function stripQuotes(token: string): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  return token;
}

/** Strip PlantUML `'` line comments (a leading `'` or a trailing inline `'`). */
export function stripComment(line: string): string {
  const idx = line.indexOf("'");
  if (idx === -1) return line.trim();
  return line.slice(0, idx).trim();
}

/**
 * Extract a declaration name from an entity line's tail, mirroring the parser:
 * accepts a bare token (`class A`) or a quoted name (`class "User Repo"`), and
 * tolerates a trailing `as <alias>`. Returns null when the name is missing or
 * the quoted name is unterminated.
 */
export function extractDeclaredName(rest: string): string | null {
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
