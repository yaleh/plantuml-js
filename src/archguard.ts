/**
 * ArchGuard neighbourhood-JSON → PlantUML class-diagram bridge.
 *
 * Converts ArchGuard's neighbourhood shape
 *   { nodes: [{ id, label, distance }], edges: [{ from, to, relationType }] }
 * into a `@startuml … @enduml` string the renderer consumes. `id` is
 * `<scopeKey>/<relpath>.<EntityName>`; the bridge drops the scopeKey prefix for
 * display and keeps `relpath.EntityName` (with its `/` separators) so the
 * renderer's path-prefix overview (`view: {kind:'overview', depth}`) can group
 * by directory.
 *
 * Aliases are stable (`n<i>` by node index), so a filtered subset still
 * addresses the same node ids. The returned `aliasOf` map (original id →
 * alias) is what the host uses to link a rendered `data-entity-id` back to the
 * source node — the renderer draws that alias as the entity id.
 */

export interface ArchguardNode {
  id: string;
  label: string;
  distance?: number;
}

export interface ArchguardEdge {
  from: string;
  to: string;
  relationType: string;
}

export interface ArchguardGraph {
  nodes: ArchguardNode[];
  edges: ArchguardEdge[];
}

/**
 * ArchGuard relationType → PlantUML arrow + optional stereotype label.
 *
 * Semantics follow the archguard-aligned decision, NOT the renderer's raw
 * six-way set:
 *   - `dependency` → Dependency (`..>`, `<<uses>>`)
 *   - `call`       → Dependency (`..>`, `<<call>>`) — a call is a use, not a
 *     structural Association
 *   - `composition` → Aggregation (`o--` hollow diamond) — field-held
 *     reference, lifecycle unknown; deliberately NOT Composition `*--`
 *   - `aggregation` → Aggregation (`o--`)
 *   - `inheritance` → Generalization (`--|>`)
 *   - `implementation` → Realization (`..|>`)
 */
export const ARCHGUARD_RELATION_ARROWS: Record<
  string,
  { arrow: string; label?: string }
> = {
  dependency: { arrow: '..>', label: '<<uses>>' },
  call: { arrow: '..>', label: '<<call>>' },
  composition: { arrow: 'o--' },
  aggregation: { arrow: 'o--' },
  inheritance: { arrow: '--|>' },
  implementation: { arrow: '..|>' },
};

/** Strip the leading `<scopeKey>/` so only the relpath remains. */
export function pathName(id: string): string {
  const slash = id.indexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

/**
 * Display name `relpath.EntityName`, optionally truncated to the last
 * `maxDirSegments` directory segments (front-truncated, tail + entity kept).
 * `maxDirSegments = 0` keeps the full path.
 */
export function displayName(id: string, maxDirSegments = 0): string {
  const rel = pathName(id);
  const dot = rel.lastIndexOf('.');
  const dirs = dot === -1 ? '' : rel.slice(0, dot);
  const entity = dot === -1 ? rel : rel.slice(dot + 1);
  const segments = dirs.split('/').filter(Boolean);
  if (maxDirSegments > 0 && segments.length > maxDirSegments) {
    return [...segments.slice(-maxDirSegments), entity].join('/');
  }
  return rel;
}

/** Deterministic alias map: node at index `i` → `n<i>`. */
export function archguardAliasMap(nodes: ArchguardNode[]): Map<string, string> {
  const aliasOf = new Map<string, string>();
  nodes.forEach((node, i) => aliasOf.set(node.id, `n${i}`));
  return aliasOf;
}

export interface ArchguardBridgeOptions {
  /**
   * Stable alias map. Pass the map built over the *full* graph when rendering a
   * filtered subset, so the subset keeps the original node ids. Defaults to a
   * fresh map over `graph.nodes`.
   */
  aliasOf?: Map<string, string>;
  /** Display-name truncation passed to {@link displayName}. */
  maxDirSegments?: number;
}

export interface ArchguardPlantUml {
  /** The generated `@startuml … @enduml` class diagram. */
  puml: string;
  /** original id → alias (`n<i>`); use to map a rendered `data-entity-id` back. */
  aliasOf: Map<string, string>;
}

/** Escape a name for a quoted PlantUML identifier. */
function sanitizeName(name: string): string {
  return name.replace(/["\r\n\t\\]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Assign (and remember) a stable alias for a node. */
function aliasFor(
  node: ArchguardNode,
  index: number,
  aliasOf: Map<string, string>,
): string {
  const existing = aliasOf.get(node.id);
  if (existing !== undefined) return existing;
  let alias = `n${index}`;
  let k = index;
  while ([...aliasOf.values()].includes(alias)) {
    alias = `n${++k}`;
  }
  aliasOf.set(node.id, alias);
  return alias;
}

/** Emit a `@startuml … @enduml` class diagram for a (possibly filtered) graph. */
export function archguardToPlantUml(
  graph: ArchguardGraph,
  options: ArchguardBridgeOptions = {},
): ArchguardPlantUml {
  const aliasOf = options.aliasOf ?? archguardAliasMap(graph.nodes);
  const maxDirSegments = options.maxDirSegments ?? 0;

  const lines = ['@startuml'];
  graph.nodes.forEach((node, i) => {
    const alias = aliasFor(node, i, aliasOf);
    lines.push(`class "${sanitizeName(displayName(node.id, maxDirSegments))}" as ${alias}`);
  });

  for (const edge of graph.edges) {
    const source = aliasOf.get(edge.from);
    const target = aliasOf.get(edge.to);
    if (source === undefined || target === undefined) continue;
    const mapping = ARCHGUARD_RELATION_ARROWS[edge.relationType] ?? { arrow: '-->' };
    const suffix = mapping.label ? ` : ${mapping.label}` : '';
    lines.push(`${source} ${mapping.arrow} ${target}${suffix}`);
  }

  lines.push('@enduml');
  return { puml: lines.join('\n'), aliasOf };
}
