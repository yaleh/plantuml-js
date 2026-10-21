/**
 * Hand-written recursive-descent parser for the PlantUML class-diagram subset.
 *
 * M1 scope: `@startuml`/`@enduml` and single-line `class` / `interface` /
 * `enum` / `abstract class` declarations. Members, relations, generics,
 * package grouping, and aliases are added in M2; those lines are recognised
 * and skipped here rather than failing the parse.
 */

import {
  PlantUmlModel,
  PlantUmlEntity,
  EntityKind,
  emptyModel,
} from './model.js';

const ENTITY_LINE = /^(abstract\s+)?(class|interface|enum)\s+(.+)$/i;

/**
 * Parse a PlantUML source string into a PlantUmlModel.
 *
 * Unknown lines (skinparam, hide, note, title, relation lines, member lines,
 * package blocks in M1) are ignored — M1 only extracts entity declarations.
 */
export function parsePlantUml(source: string): PlantUmlModel {
  const model = emptyModel();
  const lines = source.split(/\r?\n/);
  let inDiagram = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
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

    const entity = parseEntityLine(code);
    if (entity) model.entities.push(entity);
  }

  return model;
}

function parseEntityLine(code: string): PlantUmlEntity | null {
  const match = ENTITY_LINE.exec(code);
  if (!match) return null;

  const isAbstract = match[1] !== undefined;
  const keyword = match[2].toLowerCase();
  const name = extractName(match[3]);
  if (name === null) return null;

  const kind: EntityKind = isAbstract
    ? 'abstract'
    : (keyword as 'class' | 'interface' | 'enum');

  return { id: name, name, kind, members: [] };
}

/**
 * Extract a declaration name from the tail of an entity line. Accepts a bare
 * token (`class A`) or a quoted name (`class "User Repo"`). A trailing
 * `as <alias>` is tolerated and ignored in M1 (alias handling lands in M2).
 */
function extractName(rest: string): string | null {
  const asIndex = rest.search(/\s+as\s+\S+\s*$/i);
  const core = asIndex === -1 ? rest.trim() : rest.slice(0, asIndex).trim();
  if (core === '') return null;

  if (core.startsWith('"')) {
    const close = core.indexOf('"', 1);
    if (close === -1) return null;
    return core.slice(1, close);
  }

  return core.split(/\s+/)[0];
}

/** Strip PlantUML `'` line comments (a leading `'` or a trailing inline `'`). */
function stripComment(line: string): string {
  const idx = line.indexOf("'");
  if (idx === -1) return line.trim();
  return line.slice(0, idx).trim();
}
