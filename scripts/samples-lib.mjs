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

/** Committed snapshot a later layout change is compared against. */
export const defaultBaselinePath = join(repoRoot, 'rendered', 'metrics.baseline.json');

/** Regression limits of `--compare`, relative to the baseline record of the same sample. */
export const COMPARE_LIMITS = {
  /** edgeCrossings may grow by at most this fraction. */
  edgeCrossingsGrowth: 0.25,
  /** areaUtilization may shrink by at most this fraction. */
  areaUtilizationDrop: 0.3,
  /** maxEmptyBlockRatio may grow by at most this absolute amount. */
  maxEmptyBlockRatioGrowth: 0.05,
};

/**
 * Compare current metric records against baseline records (both in the
 * `rendered/metrics*.json` shape: `{ group, engine, metrics }`). Only the
 * shipping `elk` engine is judged, and only samples present in both. Returns
 * one message per regression: `<group>: <metric> <base> → <current> (limit …)`.
 */
export function compareToBaseline(baselineRecords, currentRecords) {
  const key = (r) => `${r.group}\u0000${r.engine}`;
  const base = new Map(baselineRecords.map((r) => [key(r), r]));
  const regressions = [];
  for (const cur of currentRecords) {
    if (cur.engine !== 'elk') continue;
    const old = base.get(key(cur));
    if (!old) continue;
    const a = old.metrics;
    const b = cur.metrics;
    if (typeof a.edgeCrossings === 'number' && typeof b.edgeCrossings === 'number') {
      const limit = a.edgeCrossings * (1 + COMPARE_LIMITS.edgeCrossingsGrowth);
      if (b.edgeCrossings > limit) {
        regressions.push(`${cur.group}: edgeCrossings ${a.edgeCrossings} → ${b.edgeCrossings} (limit ${limit})`);
      }
    }
    if (typeof a.areaUtilization === 'number' && typeof b.areaUtilization === 'number') {
      const limit = a.areaUtilization * (1 - COMPARE_LIMITS.areaUtilizationDrop);
      if (b.areaUtilization < limit) {
        regressions.push(`${cur.group}: areaUtilization ${a.areaUtilization} → ${b.areaUtilization} (floor ${limit})`);
      }
    }
    if (typeof a.maxEmptyBlockRatio === 'number' && typeof b.maxEmptyBlockRatio === 'number') {
      const limit = a.maxEmptyBlockRatio + COMPARE_LIMITS.maxEmptyBlockRatioGrowth;
      if (b.maxEmptyBlockRatio > limit) {
        regressions.push(`${cur.group}: maxEmptyBlockRatio ${a.maxEmptyBlockRatio} → ${b.maxEmptyBlockRatio} (limit ${limit})`);
      }
    }
  }
  return regressions;
}

/** Baseline records overlaid with the current ones (same group+engine replaced, others kept). */
export function mergeRecords(baselineRecords, currentRecords) {
  const key = (r) => `${r.group}\u0000${r.engine}`;
  const fresh = new Map(currentRecords.map((r) => [key(r), r]));
  const kept = baselineRecords.filter((r) => !fresh.has(key(r)));
  return [...kept, ...currentRecords];
}
