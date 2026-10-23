/**
 * PlantUmlModel → PlantUML class-diagram text.
 *
 * The inverse of [[parsePlantUml]]. The model is the only input, so the caller
 * composes the scope by picking the model
 * (`toPlantUml(applyView(model, {kind: 'neighborhood', entity, hops}))`); this
 * function never chooses a range on its own.
 *
 * For a **lossless export** of what `renderDetailed` parsed, pass its
 * `sourceModel` (the post-view/transform, pre-detail model):
 * `toPlantUml(renderDetailed(input).sourceModel)`. Passing `model` instead
 * serializes the model that was drawn — detail truncation has already dropped
 * rows there, so the text is only as complete as the drawing. Members marked
 * `synthetic` (the `… +N more (M members)` count row `applyDetail` adds) are
 * drawing scaffolding, not authored content, and are always skipped.
 *
 * Shapes that only exist after parsing (stub/external/usageCount, aggregated
 * edge weights, cycle markers) are rendering semantics with no PlantUML
 * spelling; they serialize as their plain-text equivalent (stub → class,
 * weighted edge → one edge). The parts that do have a spelling — packages
 * (nested), entity kind/generics/alias, member rows, relation arrow/label/
 * cardinality — round-trip back through [[parsePlantUml]] unchanged.
 *
 * The displayed name is always emitted quoted (`class "<<function>> halt"
 * as n0`), so names carrying a stereotype prefix or `/` path separators survive
 * the round trip as authored.
 */

import type {
  PlantUmlEntity,
  PlantUmlMember,
  PlantUmlModel,
  PlantUmlPackage,
  PlantUmlRelation,
  RelationType,
  Visibility,
} from '../foundation/model.js';

/** A bare PlantUML identifier (what `as <alias>` accepts). */
const PLANTUML_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

const INDENT = '  ';

const VISIBILITY_SYMBOL: Record<Visibility, string> = {
  public: '+',
  private: '-',
  protected: '#',
  'package-private': '~',
};

/**
 * One arrow per relation type, written in canonical source→target direction.
 * The parser's own arrow table also accepts the swapped mirror forms
 * (`<|--`, `--o`, …); emitting the canonical form is what makes the round trip
 * stable.
 */
const RELATION_ARROW: Record<RelationType, string> = {
  inheritance: '--|>',
  implementation: '..|>',
  dependency: '..>',
  association: '-->',
  aggregation: 'o--',
  composition: '*--',
};

/**
 * Serialize a model to `@startuml … @enduml` class-diagram source.
 *
 * Emitted layout: nested `package` blocks first (each holding the entities that
 * carry its `packageId`), then package-less entities, then every relation.
 * Entities always use the quoted form with an explicit alias, which is the only
 * form that carries a display name containing whitespace, `/`, or a
 * `<<stereotype>>` prefix.
 */
export function toPlantUml(model: PlantUmlModel): string {
  const entities = new AliasBook('entity');
  const packages = new AliasBook('package');
  const lines: string[] = ['@startuml'];

  const nodes = packageNodes(model);
  const emitted = new Set<string>();
  for (const node of nodes.roots) emitPackage(node, 0, lines, entities, packages, emitted);
  // Defensive: a parentId cycle leaves nodes unreachable from any root; emit
  // each remaining package as a root rather than silently dropping it.
  for (const node of nodes.all) {
    if (!emitted.has(node.pkg.id)) emitPackage(node, 0, lines, entities, packages, emitted);
  }

  for (const entity of nodes.topLevel) {
    lines.push(...entityLines(entity, 0, entities));
  }

  for (const relation of model.relations) {
    lines.push(relationLine(relation, entities));
  }

  lines.push('@enduml');
  return lines.join('\n');
}

interface PackageNode {
  pkg: PlantUmlPackage;
  children: PackageNode[];
  entities: PlantUmlEntity[];
}

interface PackageTree {
  roots: PackageNode[];
  all: PackageNode[];
  topLevel: PlantUmlEntity[];
}

/**
 * Index packages into a tree, attaching each entity to the innermost package it
 * names. An entity whose `packageId` names no declared package is emitted at
 * the top level instead of being dropped.
 */
function packageNodes(model: PlantUmlModel): PackageTree {
  const byId = new Map<string, PackageNode>();
  const all: PackageNode[] = [];
  for (const pkg of model.packages) {
    // A duplicated id keeps its first package; the parser never produces one.
    if (byId.has(pkg.id)) continue;
    const node: PackageNode = { pkg, children: [], entities: [] };
    byId.set(pkg.id, node);
    all.push(node);
  }

  const roots: PackageNode[] = [];
  for (const node of all) {
    const parentId = node.pkg.parentId;
    const parent = parentId === undefined ? undefined : byId.get(parentId);
    if (parent !== undefined && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const topLevel: PlantUmlEntity[] = [];
  for (const entity of model.entities) {
    const owner = entity.packageId === undefined ? undefined : byId.get(entity.packageId);
    if (owner !== undefined) owner.entities.push(entity);
    else topLevel.push(entity);
  }

  return { roots, all, topLevel };
}

function emitPackage(
  node: PackageNode,
  depth: number,
  lines: string[],
  entities: AliasBook,
  packages: AliasBook,
  emitted: Set<string>,
): void {
  if (emitted.has(node.pkg.id)) return;
  emitted.add(node.pkg.id);
  const indent = INDENT.repeat(depth);
  const alias = packages.alias(node.pkg.id, node.pkg.name);
  lines.push(`${indent}package ${quoteName(node.pkg.name)} as ${alias} {`);
  for (const entity of node.entities) {
    lines.push(...entityLines(entity, depth + 1, entities));
  }
  for (const child of node.children) {
    emitPackage(child, depth + 1, lines, entities, packages, emitted);
  }
  lines.push(`${indent}}`);
}

function entityKeyword(entity: PlantUmlEntity): string {
  return entity.kind === 'abstract' ? 'abstract class' : entity.kind;
}

function entityLines(
  entity: PlantUmlEntity,
  depth: number,
  aliases: AliasBook,
): string[] {
  const indent = INDENT.repeat(depth);
  const alias = aliases.alias(entity.id, entity.name);
  const head = `${entityKeyword(entity)} ${quoteName(entity.name)}${genericSuffix(entity)} as ${alias}`;
  // Synthetic rows (applyDetail's `… +N more` marker) stand in for members the
  // drawing dropped; they are not authored content, so they never serialize.
  const members = entity.members.filter((member) => member.synthetic !== true);
  if (members.length === 0) return [`${indent}${head}`];
  const lines = [`${indent}${head} {`];
  for (const member of members) {
    lines.push(`${indent}${INDENT}${memberLine(member)}`);
  }
  lines.push(`${indent}}`);
  return lines;
}

function genericSuffix(entity: PlantUmlEntity): string {
  const generics = entity.generics ?? [];
  return generics.length === 0 ? '' : `~${generics.join(',')}~`;
}

/**
 * One member row. The authored `raw` text is authoritative (it carries the
 * visibility symbol and the exact signature); a declaration without a leading
 * visibility symbol gets one prefixed so the row stays parseable. Synthetic
 * detail markers never reach this function (see [[entityLines]]).
 */
function memberLine(member: PlantUmlMember): string {
  const raw = (member.raw ?? '').trim();
  const symbol = VISIBILITY_SYMBOL[member.visibility] ?? '+';
  if (raw === '') return symbol;
  if (/^[+\-#~]/.test(raw)) return raw;
  return `${symbol} ${raw}`;
}

function relationLine(relation: PlantUmlRelation, aliases: AliasBook): string {
  const source = aliases.alias(relation.source, relation.source);
  const target = aliases.alias(relation.target, relation.target);
  const parts = [source];
  if (relation.sourceCardinality !== undefined) parts.push(quoteName(relation.sourceCardinality));
  parts.push(RELATION_ARROW[relation.type] ?? '-->');
  if (relation.targetCardinality !== undefined) parts.push(quoteName(relation.targetCardinality));
  parts.push(target);
  let line = parts.join(' ');
  if (relation.label !== undefined && relation.label !== '') {
    line += ` : ${relation.label.replace(/[\r\n]+/g, ' ')}`;
  }
  return line;
}

/** Quote a display name; a `"` inside a PlantUML name is written as `'`. */
function quoteName(name: string): string {
  const safe = name.replace(/[\r\n\t]+/g, ' ').replace(/"/g, "'");
  return `"${safe}"`;
}

/**
 * Deterministic, collision-free alias assignment, in emission order. A
 * plant-legal id is kept verbatim (so a parsed model round-trips its ids); an
 * id PlantUML cannot spell (view-internal ids such as `ov::src`, `stub::x`)
 * falls back to an identifier derived from the display name.
 */
class AliasBook {
  private readonly used = new Set<string>();
  private readonly byId = new Map<string, string>();
  private readonly fallback: string;

  constructor(fallback: string) {
    this.fallback = fallback;
  }

  alias(id: string, name: string): string {
    const existing = this.byId.get(id);
    if (existing !== undefined) return existing;

    const base = PLANTUML_ID.test(id) ? id : identifierFrom(name, this.fallback);
    let alias = base;
    let suffix = 2;
    while (this.used.has(alias)) alias = `${base}_${suffix++}`;
    this.used.add(alias);
    this.byId.set(id, alias);
    return alias;
  }
}

/** Derive a bare identifier from a display name (`Src Layer` → `Src_Layer`). */
function identifierFrom(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned === '' ? fallback : cleaned;
  return /^[A-Za-z_]/.test(base) ? base : `_${base}`;
}
