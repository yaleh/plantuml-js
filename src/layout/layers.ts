/**
 * Semantic layer resolution for the ELK engine: which layer a package belongs
 * to, how layers are ordered, and which ELK partition each package lands in.
 * Pure functions over the model; no ELK types involved.
 */

import { PlantUmlModel, PlantUmlPackage } from '../model.js';

/** Name convention: `"X Layer"` declares a semantic layer `X`. */
const LAYER_SUFFIX = /^(.*)\s+Layer$/i;

/** Resolve a package's semantic layer from its explicit field or its name. */
export function packageLayer(pkg: PlantUmlPackage): string | undefined {
  if (pkg.layer !== undefined) return pkg.layer;
  const m = LAYER_SUFFIX.exec(pkg.name);
  if (!m) return undefined;
  const core = m[1].trim();
  return core === '' ? undefined : core;
}

/**
 * Order semantic layers by dependency topology instead of puml declaration
 * order: a layer that depends on another (`A ..> B` across layers) sits *above*
 * its dependency, so entry layers (Tests, Examples) stack over the base they
 * consume (Src) and independent layers (Templates) fall out of the sandwich.
 *
 * A Kahn topological sort places in-degree-zero layers (nothing depends on
 * them) first, breaking ties in declaration order for determinism. Layers left
 * over because of a dependency cycle are appended in declaration order, so a
 * cyclic graph still yields a stable (if not strictly topological) order; the
 * renderer marks the offending back-edges as feedback arcs.
 */
export function topologicalLayerOrder(model: PlantUmlModel): string[] {
  const declared: string[] = [];
  for (const pkg of model.packages) {
    const layer = packageLayer(pkg);
    if (layer !== undefined && !declared.includes(layer)) declared.push(layer);
  }
  if (declared.length <= 1) return declared;

  const pkgById = new Map(model.packages.map((p) => [p.id, p]));
  const layerOf = new Map<string, string | undefined>();
  for (const entity of model.entities) {
    const pkg = entity.packageId ? pkgById.get(entity.packageId) : undefined;
    layerOf.set(entity.id, pkg ? packageLayer(pkg) : undefined);
  }

  const dependsOn = new Map<string, Set<string>>();
  const dependents = new Map<string, number>();
  for (const layer of declared) {
    dependsOn.set(layer, new Set());
    dependents.set(layer, 0);
  }

  for (const relation of model.relations) {
    const source = layerOf.get(relation.source);
    const target = layerOf.get(relation.target);
    if (source === undefined || target === undefined || source === target) continue;
    const set = dependsOn.get(source)!;
    if (!set.has(target)) {
      set.add(target);
      dependents.set(target, (dependents.get(target) ?? 0) + 1);
    }
  }

  const order: string[] = [];
  const done = new Set<string>();
  const queue = declared.filter((layer) => (dependents.get(layer) ?? 0) === 0);
  for (let i = 0; i < queue.length; i++) {
    const layer = queue[i];
    order.push(layer);
    done.add(layer);
    for (const dep of dependsOn.get(layer) ?? []) {
      const remaining = (dependents.get(dep) ?? 0) - 1;
      dependents.set(dep, remaining);
      if (remaining === 0 && !done.has(dep)) queue.push(dep);
    }
  }

  // Cyclic remainder: keep declaration order so the output is stable.
  for (const layer of declared) {
    if (!done.has(layer)) order.push(layer);
  }
  return order;
}

/** Ordered, de-duplicated list of semantic layers (dependency topology by default). */
export function resolveLayerOrder(model: PlantUmlModel, layerOrder?: string[]): string[] {
  if (layerOrder) {
    return layerOrder.filter((layer, i, all) => all.indexOf(layer) === i);
  }
  return topologicalLayerOrder(model);
}

/** Map each package to its partition index (layers first, unlayered last). */
export function assignPartitions(model: PlantUmlModel, layers: string[]): Map<string, number> {
  const partitions = new Map<string, number>();
  if (layers.length === 0) return partitions;
  for (const pkg of model.packages) {
    const layer = packageLayer(pkg);
    const index = layer !== undefined ? layers.indexOf(layer) : -1;
    partitions.set(pkg.id, index >= 0 ? index : layers.length);
  }
  return partitions;
}
