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
} from './model.js';

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
  | { kind: 'package'; id: string }
  | { kind: 'neighborhood'; entity: string; hops: number };

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
  const { aggregate = true, transitiveReduction = false, hubThreshold, cycles = false } = options;
  let out = cloneModel(model);
  if (aggregate) out = aggregateRelations(out);
  if (transitiveReduction) out = transitiveReduce(out);
  if (hubThreshold !== undefined) out = summarizeHubs(out, hubThreshold);
  if (cycles) out = markCycles(out);
  return out;
}

/** Merge relations sharing (source, target) into one edge with `weight`. */
export function aggregateRelations(model: PlantUmlModel): PlantUmlModel {
  const byKey = new Map<string, PlantUmlRelation>();
  for (const relation of model.relations) {
    const key = `${relation.source}\u0000${relation.target}`;
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
 * Remove a relation A→B when A still reaches B through another path (an edge
 * derivable by transitivity). Only the redundant direct edge is dropped; the
 * shortest-path edges that witness the reachability are always kept.
 */
export function transitiveReduce(model: PlantUmlModel): PlantUmlModel {
  const targets = new Map<string, string[]>();
  for (const relation of model.relations) {
    const list = targets.get(relation.source);
    if (list) list.push(relation.target);
    else targets.set(relation.source, [relation.target]);
  }

  const reachable = (start: string, goal: string, skipTarget: string): boolean => {
    const seen = new Set<string>();
    const queue: string[] = [start];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of targets.get(u) ?? []) {
        if (u === start && v === skipTarget) continue; // ignore the direct edge under test
        if (v === goal) return true;
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    return false;
  };

  const relations = model.relations.filter((relation) => {
    // A self-loop is its own shortest witness; keep it. A single-hop edge with
    // no alternate path is necessary; keep it.
    return !reachable(relation.source, relation.target, relation.target);
  });

  return { ...model, relations };
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
      return packageView(model, view.id);
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
function packageView(model: PlantUmlModel, id: string): PlantUmlModel {
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

  return {
    diagramType: 'class',
    entities,
    relations,
    packages: [{ ...selected, parentId: undefined }],
  };
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
