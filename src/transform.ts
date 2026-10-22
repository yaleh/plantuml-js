/**
 * Model transformation layer — pure functions `PlantUmlModel → PlantUmlModel`
 * applied *before* layout. A 660-class / 950-edge model is unreadable on one
 * canvas whatever the engine does; these transforms collapse it at package
 * granularity and encode structure (weight, feedback arcs, hub badges) so the
 * renderer can draw it legibly.
 *
 * Every function here is a pure, deterministic rewrite: it never mutates its
 * input and produces the same output for the same input, so a transformed
 * render stays byte-for-byte reproducible.
 */

import {
  PlantUmlModel,
  PlantUmlEntity,
  PlantUmlRelation,
  PlantUmlPackage,
} from './foundation/model.js';
import { relationSemantics } from './foundation/relation-semantics.js';

/** Options driving the model-transform pipeline. */
export interface TransformOptions {
  /**
   * Merge relations with the same (source, target) into one edge carrying
   * `weight` = the number of originals. Default true.
   */
  aggregate?: boolean;
  /** Remove edges that can be derived by transitivity (A→B→C hides A→C). Default false. */
  transitiveReduction?: boolean;
  /**
   * In-degree above which a node's incoming edges are summarized into a
   * `usageCount` badge instead of being drawn one by one. `undefined` disables
   * hub summarization. Default undefined.
   */
  hubThreshold?: number;
  /**
   * `'aggregate'` folds all relations between two packages into one
   * box-to-box weighted corridor edge; `'raw'` keeps every edge. Default:
   * `'aggregate'` above [[INTER_PACKAGE_AGGREGATE_ENTITY_THRESHOLD]] entities.
   */
  interPackage?: 'aggregate' | 'raw';
  /** Detect cycles and mark one edge per cycle as a `feedback` arc. Default false. */
  cycles?: boolean;
}

/**
 * A renderer view: collapse packages to nodes, expand one package (external
 * packages become stubs), or expand one entity plus its N-hop neighbourhood.
 *
 * `overview` accepts an optional `depth`: when a positive `depth` is given the
 * collapse is driven by [[groupByPathPrefix]] (group path-form entity names by
 * their first N directory levels) instead of by package boundaries, so the
 * overview's node granularity becomes `src/cli`, `src/core`, … rather than the
 * five declared layers.
 */
export type ViewSpec =
  | { kind: 'overview'; depth?: number }
  | { kind: 'package'; id: string; stubGroupThreshold?: number }
  | { kind: 'neighborhood'; entity: string; hops: number };

/** Entity count above which inter-package edges aggregate into corridors by default. */
export const INTER_PACKAGE_AGGREGATE_ENTITY_THRESHOLD = 150;

/** Stub count above which a single-package view groups stubs by name prefix. */
export const DEFAULT_STUB_GROUP_THRESHOLD = 8;

const ROOT = '__root__';

function cloneModel(model: PlantUmlModel): PlantUmlModel {
  return {
    diagramType: model.diagramType,
    entities: model.entities.map((e) => ({ ...e })),
    relations: model.relations.map((r) => ({ ...r })),
    packages: model.packages.map((p) => ({ ...p })),
  };
}

/**
 * Run the transform pipeline over a model. Order matters: aggregation first
 * (so transitive reduction sees one edge per pair), then reduction, then hub
 * summarization, then cycle marking on the final edge set.
 */
export function transformModel(
  model: PlantUmlModel,
  options: TransformOptions = {},
): PlantUmlModel {
  return transformModelDetailed(model, options).model;
}

/** [[transformModel]] plus the number of edges the transitive reduction hid. */
export function transformModelDetailed(
  model: PlantUmlModel,
  options: TransformOptions = {},
): { model: PlantUmlModel; hiddenTransitive: number } {
  const { aggregate = true, transitiveReduction = false, hubThreshold, cycles = false, interPackage = 'raw' } = options;
  let out = cloneModel(model);
  out = summarizeExternals(out, EXTERNAL_SUMMARY_MIN_IN_EDGES);
  if (aggregate) out = aggregateRelations(out);
  let hiddenTransitive = 0;
  if (transitiveReduction) {
    const before = out.relations.length;
    out = transitiveReduce(out);
    hiddenTransitive = before - out.relations.length;
  }
  if (hubThreshold !== undefined) out = summarizeHubs(out, hubThreshold);
  if (interPackage === 'aggregate') out = aggregateInterPackage(out);
  if (cycles) out = markCycles(out);
  return { model: groupExternals(out), hiddenTransitive };
}

/** Edge count ÷ node count above which `edgeReduction: 'auto'` reduces a pure dependency graph. */
export const AUTO_REDUCTION_EDGE_NODE_RATIO = 3;

/**
 * Whether `edgeReduction: 'auto'` applies: every relation is bundlable
 * (dependency/association) and there are more than
 * [[AUTO_REDUCTION_EDGE_NODE_RATIO]] times as many edges as nodes.
 */
export function shouldAutoReduce(model: PlantUmlModel): boolean {
  if (model.relations.length === 0) return false;
  if (!model.relations.every((r) => relationSemantics(r.type).bundlable)) return false;
  const nodes = model.entities.length;
  const distinct = new Set(model.relations.map((r) => `${r.source}\u0000${r.target}`)).size;
  return distinct > AUTO_REDUCTION_EDGE_NODE_RATIO * nodes;
}

/** Incoming edges at which an external type's edges collapse into a count badge. */
export const EXTERNAL_SUMMARY_MIN_IN_EDGES = 3;
/** Id of the synthetic package that gathers implicit/external types. */
export const EXTERNAL_PACKAGE_ID = '__external__';

/**
 * Implicit/external types (`Error`, `EventEmitter`, …) receive many parallel
 * edges that would fly across the whole canvas. Once one has `minEdges` or more
 * incoming relations they are dropped and replaced by a `usageCount` badge that
 * carries the original incoming-edge count.
 */
export function summarizeExternals(model: PlantUmlModel, minEdges: number): PlantUmlModel {
  const incoming = new Map<string, number>();
  for (const r of model.relations) {
    const e = model.entities.find((x) => x.id === r.target);
    if (e?.external) incoming.set(r.target, (incoming.get(r.target) ?? 0) + (r.weight ?? 1));
  }
  const summarized = new Set([...incoming].filter(([, n]) => n >= minEdges).map(([id]) => id));
  if (summarized.size === 0) return model;
  return {
    ...model,
    entities: model.entities.map((e) =>
      summarized.has(e.id) ? { ...e, usageCount: incoming.get(e.id)! } : e,
    ),
    relations: model.relations.filter((r) => !summarized.has(r.target)),
  };
}

/** Gather top-level external entities into one synthetic External package. */
export function groupExternals(model: PlantUmlModel): PlantUmlModel {
  const externals = model.entities.filter((e) => e.external && e.packageId === undefined);
  if (externals.length < 2 || model.packages.some((p) => p.id === EXTERNAL_PACKAGE_ID)) {
    return model;
  }
  const ids = new Set(externals.map((e) => e.id));
  return {
    ...model,
    entities: model.entities.map((e) => (ids.has(e.id) ? { ...e, packageId: EXTERNAL_PACKAGE_ID } : e)),
    packages: [...model.packages, { id: EXTERNAL_PACKAGE_ID, name: 'External' }],
  };
}

/** Merge relations sharing (source, target) into one edge with `weight`. */
export function aggregateRelations(model: PlantUmlModel): PlantUmlModel {
  const byKey = new Map<string, PlantUmlRelation>();
  for (const relation of model.relations) {
    const key = `${relation.source}\u0000${relation.target}\u0000${relation.sourcePackageId ?? ''}\u0000${relation.targetPackageId ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.weight = (existing.weight ?? 1) + 1;
    } else {
      byKey.set(key, { ...relation });
    }
  }
  return { ...model, relations: [...byKey.values()] };
}

/**
 * Fold every relation between two different packages into one corridor edge
 * per ordered package pair: `weight` = number of originals, `descriptions`
 * keeps each original, and the endpoints are the entities carrying most of the
 * traffic with `sourcePackageId`/`targetPackageId` set so the layout clips the
 * edge to the frame boundaries. Intra-package edges and edges touching
 * package-less entities, or between nested packages, are left as they are.
 */
export function aggregateInterPackage(model: PlantUmlModel): PlantUmlModel {
  const pkgOf = new Map(model.entities.map((e) => [e.id, e.packageId]));
  const parent = new Map(model.packages.map((p) => [p.id, p.parentId]));
  const nested = (a: string, b: string): boolean => {
    for (const [x, y] of [[a, b], [b, a]]) {
      for (let p = parent.get(x); p !== undefined; p = parent.get(p)) if (p === y) return true;
    }
    return false;
  };
  interface Group { src: string; dst: string; items: PlantUmlRelation[]; srcCount: Map<string, number>; dstCount: Map<string, number>; at: number }
  const groups = new Map<string, Group>();
  const relations: (PlantUmlRelation | Group)[] = [];
  for (const rel of model.relations) {
    const a = pkgOf.get(rel.source);
    const b = pkgOf.get(rel.target);
    if (!a || !b || a === b || nested(a, b) || rel.sourcePackageId || rel.targetPackageId) {
      relations.push(rel);
      continue;
    }
    const key = `${a}\u0000${b}`;
    let g = groups.get(key);
    if (!g) {
      g = { src: a, dst: b, items: [], srcCount: new Map(), dstCount: new Map(), at: relations.length };
      groups.set(key, g);
      relations.push(g);
    }
    g.items.push(rel);
    g.srcCount.set(rel.source, (g.srcCount.get(rel.source) ?? 0) + 1);
    g.dstCount.set(rel.target, (g.dstCount.get(rel.target) ?? 0) + 1);
  }
  const top = (m: Map<string, number>): string => {
    let best = '';
    let n = -1;
    for (const [k, v] of m) if (v > n) { best = k; n = v; }
    return best;
  };
  const out = relations.map((r): PlantUmlRelation => {
    if (!('items' in r)) return r;
    const types = new Set(r.items.map((i) => i.type));
    const only = r.items.length === 1 ? r.items[0].type : [...types][0];
    const type = types.size === 1 && relationSemantics(only).bundlable ? only : 'dependency';
    return {
      source: top(r.srcCount),
      target: top(r.dstCount),
      type,
      weight: r.items.reduce((sum, i) => sum + (i.weight ?? 1), 0),
      feedback: r.items.every((i) => i.feedback) || undefined,
      sourcePackageId: r.src,
      targetPackageId: r.dst,
      descriptions: r.items.map((i) => `${i.source} ${ARROWS[i.type]} ${i.target}${i.label ? ` : ${i.label}` : ''}`),
    };
  });
  return { ...model, relations: out.map(dropUndefined) };
}

const ARROWS: Record<PlantUmlRelation['type'], string> = {
  inheritance: '--|>',
  implementation: '..|>',
  dependency: '..>',
  association: '-->',
  aggregation: 'o--',
  composition: '*--',
};

function dropUndefined(r: PlantUmlRelation): PlantUmlRelation {
  const copy = { ...r } as Record<string, unknown>;
  for (const k of Object.keys(copy)) if (copy[k] === undefined) delete copy[k];
  return copy as unknown as PlantUmlRelation;
}

/**
 * Remove a relation A→B when A still reaches B through another path (an edge
 * derivable by transitivity). Only the redundant direct edge is dropped; the
 * shortest-path edges that witness the reachability are always kept.
 */
export function transitiveReduce(model: PlantUmlModel): PlantUmlModel {
  const targets = new Map<string, Map<string, number>>();
  const addEdge = (u: string, v: string): void => {
    const m = targets.get(u) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    targets.set(u, m);
  };
  for (const relation of model.relations) addEdge(relation.source, relation.target);

  const reachable = (start: string, goal: string): boolean => {
    const seen = new Set<string>([start]);
    const stack: string[] = [start];
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const v of targets.get(u)?.keys() ?? []) {
        if (v === goal) return true;
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    return false;
  };

  // Greedy in authored order: an edge is dropped when its end points stay
  // connected through the edges still present, so reachability is preserved
  // exactly (also inside cycles, where dropping every "redundant" edge at once
  // would disconnect the cycle). A self-loop is its own witness and is kept.
  const removed = new Set<number>();
  model.relations.forEach((relation, i) => {
    if (relation.source === relation.target) return;
    const out = targets.get(relation.source)!;
    const count = out.get(relation.target)!;
    if (count > 1) {
      // A parallel duplicate of the same pair is always redundant.
      out.set(relation.target, count - 1);
      removed.add(i);
      return;
    }
    out.delete(relation.target);
    if (reachable(relation.source, relation.target)) removed.add(i);
    else out.set(relation.target, 1);
  });

  return { ...model, relations: model.relations.filter((_, i) => !removed.has(i)) };
}

/**
 * Nodes with an in-degree above `threshold` have their incoming edges dropped
 * and replaced by a `usageCount` badge (the number of distinct sources). The
 * outgoing edges of a hub are untouched.
 */
export function summarizeHubs(model: PlantUmlModel, threshold: number): PlantUmlModel {
  const sources = new Map<string, Set<string>>();
  for (const relation of model.relations) {
    const set = sources.get(relation.target);
    if (set) set.add(relation.source);
    else sources.set(relation.target, new Set([relation.source]));
  }

  const hubs = new Set<string>();
  for (const [target, set] of sources) {
    if (set.size > threshold) hubs.add(target);
  }

  const relations = model.relations.filter((r) => !hubs.has(r.target));
  const entities = model.entities.map((e) =>
    hubs.has(e.id) ? { ...e, usageCount: sources.get(e.id)!.size } : { ...e },
  );
  return { ...model, entities, relations };
}

/**
 * Mark feedback arcs: edges that point back to a DFS ancestor, i.e. the edges
 * whose removal breaks a cycle. Marked edges carry `feedback: true` so the
 * renderer can draw them distinctly.
 */
export function markCycles(model: PlantUmlModel): PlantUmlModel {
  const relations = model.relations.map((r) => ({ ...r }));
  const bySource = new Map<string, number[]>();
  relations.forEach((relation, i) => {
    const list = bySource.get(relation.source);
    if (list) list.push(i);
    else bySource.set(relation.source, [i]);
  });

  const color = new Map<string, 0 | 1 | 2>(); // 0 = unseen, 1 = on stack, 2 = done
  const visit = (u: string): void => {
    color.set(u, 1);
    for (const i of bySource.get(u) ?? []) {
      const v = relations[i].target;
      const state = color.get(v);
      if (state === undefined) {
        visit(v);
      } else if (state === 1) {
        relations[i].feedback = true; // back edge → cycle
      }
    }
    color.set(u, 2);
  };

  const nodeIds = new Set<string>();
  for (const e of model.entities) nodeIds.add(e.id);
  for (const r of relations) {
    nodeIds.add(r.source);
    nodeIds.add(r.target);
  }
  for (const id of nodeIds) {
    if (color.get(id) === undefined) visit(id);
  }

  return { ...model, relations };
}

/**
 * Apply a renderer view, producing a fresh model. `undefined` returns an
 * unchanged copy, so the renderer can call this unconditionally.
 */
export function applyView(model: PlantUmlModel, view?: ViewSpec): PlantUmlModel {
  if (!view) return cloneModel(model);
  switch (view.kind) {
    case 'overview':
      if (view.depth !== undefined && view.depth >= 1) {
        return groupByPathPrefix(model, view.depth);
      }
      return overviewView(model);
    case 'package':
      return packageView(model, view.id, view.stubGroupThreshold ?? DEFAULT_STUB_GROUP_THRESHOLD);
    case 'neighborhood':
      return neighborhoodView(model, view.entity, view.hops);
  }
}

/**
 * Collapse every package into a single node. Relations between two entities in
 * different packages become one package→package edge (intra-package relations
 * are dropped, since they do not span the collapsed boundary).
 */
function overviewView(model: PlantUmlModel): PlantUmlModel {
  const pkgName = new Map(model.packages.map((p) => [p.id, p.name]));
  const packageOf = new Map(model.entities.map((e) => [e.id, e.packageId ?? ROOT]));

  // Node set = every declared package plus a synthetic top-level node for
  // entities that carry no packageId.
  const nodeKeys = new Set<string>(model.packages.map((p) => p.id));
  for (const e of model.entities) nodeKeys.add(e.packageId ?? ROOT);

  const entities: PlantUmlEntity[] = [...nodeKeys].map((key) => ({
    id: overviewId(key),
    name: key === ROOT ? '(top level)' : (pkgName.get(key) ?? key),
    kind: 'class',
    members: [],
    stub: true,
  }));

  const relations: PlantUmlRelation[] = [];
  for (const relation of model.relations) {
    const sourcePkg = packageOf.get(relation.source) ?? ROOT;
    const targetPkg = packageOf.get(relation.target) ?? ROOT;
    if (sourcePkg === targetPkg) continue;
    relations.push({ ...relation, source: overviewId(sourcePkg), target: overviewId(targetPkg) });
  }

  return { diagramType: 'class', entities, relations, packages: [] };
}

function overviewId(key: string): string {
  return key === ROOT ? 'ov::(top)' : `ov::${key}`;
}

const GROUP_PREFIX = 'grp::';

/**
 * Collapse entities by the first `depth` directory levels of their path-form
 * name (`a/b/c`). `src/cli/analyze` and `src/cli/query` both collapse into a
 * single `src/cli` stub node; `src/core/x` collapses into `src/core`. Entities
 * whose name is not path-form (no `/`) are kept as-is, and relations are
 * remapped onto the collapsed nodes then aggregated so each inter-group edge
 * carries `weight` = the number of original edges it stands for. Intra-group
 * edges are dropped (they do not cross the collapsed boundary).
 */
export function groupByPathPrefix(model: PlantUmlModel, depth: number): PlantUmlModel {
  const prefixOf = (name: string): string | undefined => {
    const segments = name.split('/');
    if (segments.length < 2) return undefined;
    return segments.slice(0, Math.min(depth, segments.length)).join('/');
  };

  const entityById = new Map(model.entities.map((e) => [e.id, e]));
  const groupNode = (prefix: string): PlantUmlEntity => ({
    id: GROUP_PREFIX + prefix,
    name: prefix,
    kind: 'class',
    members: [],
    stub: true,
  });

  const entities: PlantUmlEntity[] = [];
  const seen = new Set<string>();
  for (const entity of model.entities) {
    const prefix = prefixOf(entity.name);
    if (prefix === undefined) {
      entities.push({ ...entity });
      continue;
    }
    const node = groupNode(prefix);
    if (!seen.has(node.id)) {
      seen.add(node.id);
      entities.push(node);
    }
  }

  const remap = (id: string): string => {
    const entity = entityById.get(id);
    if (!entity) return id;
    const prefix = prefixOf(entity.name);
    return prefix === undefined ? id : GROUP_PREFIX + prefix;
  };

  const relations: PlantUmlRelation[] = [];
  for (const relation of model.relations) {
    const source = remap(relation.source);
    const target = remap(relation.target);
    if (source === target) continue;
    relations.push({ ...relation, source, target });
  }

  return aggregateRelations({
    diagramType: 'class',
    entities,
    relations,
    packages: [],
  });
}

/**
 * Expand exactly one package. Its entities stay expanded inside the package
 * frame; every *other* package that touches it becomes a stub node, and the
 * relations that cross the boundary are remapped onto those stubs (later
 * merged by aggregation). Entities and relations entirely outside the package
 * are dropped.
 */
function packageView(model: PlantUmlModel, id: string, stubGroupThreshold: number): PlantUmlModel {
  const pkgById = new Map(model.packages.map((p) => [p.id, p]));
  const selected = pkgById.get(id);
  if (!selected) {
    throw new Error(`package view: unknown package ${JSON.stringify(id)}`);
  }

  // Flatten the selected package plus any nested descendants into one frame.
  const descendants = new Set<string>([id]);
  for (const pkg of model.packages) {
    let cur: PlantUmlPackage | undefined = pkg;
    while (cur && cur.parentId !== undefined) {
      if (cur.parentId === id || descendants.has(cur.parentId)) {
        descendants.add(pkg.id);
        break;
      }
      cur = pkgById.get(cur.parentId);
    }
  }

  const entityById = new Map(model.entities.map((e) => [e.id, e]));
  const entities: PlantUmlEntity[] = model.entities
    .filter((e) => e.packageId !== undefined && descendants.has(e.packageId))
    .map((e) => ({ ...e, packageId: id }));

  const stubs = new Map<string, PlantUmlEntity>();
  const stubFor = (externalKey: string): PlantUmlEntity => {
    let stub = stubs.get(externalKey);
    if (!stub) {
      stub = {
        id: `stub::${externalKey}`,
        name: externalKey === ROOT ? '(top level)' : (pkgById.get(externalKey)?.name ?? entityById.get(externalKey)?.name ?? externalKey),
        kind: 'class',
        members: [],
        stub: true,
      };
      stubs.set(externalKey, stub);
      entities.push(stub);
    }
    return stub;
  };

  const relations: PlantUmlRelation[] = [];
  for (const relation of model.relations) {
    const sourceIn = entityById.get(relation.source)?.packageId !== undefined &&
      descendants.has(entityById.get(relation.source)!.packageId!);
    const targetIn = entityById.get(relation.target)?.packageId !== undefined &&
      descendants.has(entityById.get(relation.target)!.packageId!);
    if (sourceIn && targetIn) {
      relations.push({ ...relation });
      continue;
    }
    if (!sourceIn && !targetIn) continue; // unrelated to the selected package

    const externalKey = sourceIn
      ? (entityById.get(relation.target)?.packageId ?? ROOT)
      : (entityById.get(relation.source)?.packageId ?? ROOT);
    const stub = stubFor(externalKey);
    relations.push(sourceIn ? { ...relation, target: stub.id } : { ...relation, source: stub.id });
  }

  const grouped = groupStubs({ entities, relations }, stubGroupThreshold);
  return {
    diagramType: 'class',
    entities: grouped.entities,
    relations: grouped.relations,
    packages: [{ ...selected, parentId: undefined }],
  };
}

/** Name with its last word dropped (`Src Cli Utils` → `Src Cli`); a one-word name stays as is. */
function namePrefix(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(' ') : name;
}

/**
 * Past `threshold` stubs, merge stubs sharing a name prefix into one group stub
 * (`Src Cli … (×6)`), dropping trailing words until the group count fits (or nothing shortens any
 * more). The edges to the members of a group collapse onto
 * the group stub per (entity, direction): `weight` counts the originals and
 * `descriptions` keeps each one for the edge's `<title>`.
 */
export function groupStubs(
  model: Pick<PlantUmlModel, 'entities' | 'relations'>,
  threshold: number,
): Pick<PlantUmlModel, 'entities' | 'relations'> {
  const stubs = model.entities.filter((e) => e.stub);
  if (stubs.length <= threshold) return model;
  let keyOf = new Map(stubs.map((e) => [e.id, e.name]));
  for (;;) {
    if (new Set(keyOf.values()).size <= threshold) break;
    const next = new Map([...keyOf].map(([id, k]) => [id, namePrefix(k)]));
    if ([...next].every(([id, k]) => k === keyOf.get(id))) break;
    keyOf = next;
  }
  const members = new Map<string, PlantUmlEntity[]>();
  for (const stub of stubs) {
    const key = keyOf.get(stub.id)!;
    const list = members.get(key);
    if (list) list.push(stub);
    else members.set(key, [stub]);
  }
  const groupId = new Map<string, string>();
  const entities: PlantUmlEntity[] = [];
  for (const e of model.entities) {
    if (!e.stub) {
      entities.push(e);
      continue;
    }
    const key = keyOf.get(e.id)!;
    const list = members.get(key)!;
    if (list.length === 1) {
      groupId.set(e.id, e.id);
      entities.push(e);
    } else if (list[0] === e) {
      const id = `stub::group::${key}`;
      for (const m of list) groupId.set(m.id, id);
      entities.push({ ...e, id, name: `${list.length} other ${key} packages`, groupMembers: list.map((m) => m.name) });
    }
  }
  const merged = new Map<string, PlantUmlRelation>();
  const out: PlantUmlRelation[] = [];
  const label = (r: PlantUmlRelation): string => `${r.source} ${r.type} ${r.target}`;
  for (const r of model.relations) {
    const source = groupId.get(r.source) ?? r.source;
    const target = groupId.get(r.target) ?? r.target;
    if (source === r.source && target === r.target) {
      out.push(r);
      continue;
    }
    const key = `${source}\u0000${target}`;
    const existing = merged.get(key);
    if (existing) {
      existing.weight = (existing.weight ?? 1) + (r.weight ?? 1);
      existing.descriptions!.push(...(r.descriptions ?? [label(r)]));
    } else {
      const rel = { ...r, source, target, weight: r.weight ?? 1, descriptions: [...(r.descriptions ?? [label(r)])] };
      merged.set(key, rel);
      out.push(rel);
    }
  }
  return { entities, relations: out };
}

/**
 * Expand one entity plus every entity within `hops` undirected hops, together
 * with the package frames that contain the kept entities.
 */
function neighborhoodView(model: PlantUmlModel, entity: string, hops: number): PlantUmlModel {
  const neighbors = new Map<string, Set<string>>();
  for (const relation of model.relations) {
    const out = neighbors.get(relation.source);
    if (out) out.add(relation.target);
    else neighbors.set(relation.source, new Set([relation.target]));
    const back = neighbors.get(relation.target);
    if (back) back.add(relation.source);
    else neighbors.set(relation.target, new Set([relation.source]));
  }

  const keep = new Set<string>([entity]);
  let frontier = new Set<string>([entity]);
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const u of frontier) {
      for (const v of neighbors.get(u) ?? []) {
        if (!keep.has(v)) next.add(v);
      }
    }
    for (const v of next) keep.add(v);
    frontier = next;
  }

  const entities = model.entities.filter((e) => keep.has(e.id)).map((e) => ({ ...e }));
  const relations = model.relations
    .filter((r) => keep.has(r.source) && keep.has(r.target))
    .map((r) => ({ ...r }));

  const keptPackageIds = new Set<string>();
  for (const e of entities) if (e.packageId) keptPackageIds.add(e.packageId);
  const packages = model.packages.filter((p) => keptPackageIds.has(p.id)).map((p) => ({ ...p }));

  return { diagramType: 'class', entities, relations, packages };
}
