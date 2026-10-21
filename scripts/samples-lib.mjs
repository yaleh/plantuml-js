/**
 * samples-lib.mjs — pure helpers shared by render-samples.mjs and
 * tests/samples-manifest.test.ts: manifest loading, source resolution,
 * `packagesMatching` filtering and threshold evaluation.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const manifestPath = join(repoRoot, 'scripts', 'samples.json');
export const fixturesDir = join(repoRoot, 'tests', 'fixtures');

export const TIERS = ['S', 'M', 'L', 'XL'];

export function loadManifest(path = manifestPath) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Directories searched for a sample source: the archguard root plus its class/ and overview/. */
function searchDirs(root) {
  const dirs = [root];
  for (const sub of ['class', 'overview']) {
    const dir = join(root, sub);
    if (existsSync(dir) && statSync(dir).isDirectory()) dirs.push(dir);
  }
  return dirs;
}

/** Absolute path of a sample's .puml: `archguardDir` wins when it holds the file, else tests/fixtures. */
export function resolveSource(sample, archguardDir) {
  if (archguardDir) {
    for (const dir of searchDirs(archguardDir)) {
      const candidate = join(dir, sample.source);
      if (existsSync(candidate)) return candidate;
    }
  }
  return join(fixturesDir, sample.source);
}

/** Keep only packages whose id matches `pattern`, their entities, and relations between kept entities. */
export function filterPackagesMatching(model, pattern) {
  const re = new RegExp(pattern);
  const packages = model.packages.filter((p) => re.test(p.id));
  const keep = new Set(packages.map((p) => p.id));
  const entities = model.entities.filter((e) => e.packageId && keep.has(e.packageId));
  const ids = new Set(entities.map((e) => e.id));
  const relations = model.relations.filter((r) => ids.has(r.source) && ids.has(r.target));
  return { ...model, packages, entities, relations };
}

/** Returns the list of violated thresholds (empty = pass). */
export function evaluateThresholds(metrics, thresholds = {}) {
  const failures = [];
  for (const [field, bound] of Object.entries(thresholds)) {
    const value = metrics[field];
    if (typeof value !== 'number') {
      failures.push(`${field}: missing`);
      continue;
    }
    if (bound.min !== undefined && value < bound.min) failures.push(`${field}=${value} < ${bound.min}`);
    if (bound.max !== undefined && value > bound.max) failures.push(`${field}=${value} > ${bound.max}`);
  }
  return failures;
}
