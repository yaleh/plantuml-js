import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlantUml } from '../src/core.js';
// @ts-expect-error — plain .mjs helper without type declarations
import { evaluateThresholds, filterPackagesMatching, loadManifest, resolveSource, TIERS } from '../scripts/samples-lib.mjs';

interface Sample {
  id: string;
  tier: string;
  source: string;
  view?: { kind: string; id?: string };
  packagesMatching?: string;
  thresholds: Record<string, { min?: number; max?: number }>;
}

const manifest = loadManifest() as { samples: Sample[] };
const samples = manifest.samples;

describe('scripts/samples.json', () => {
  it('has the required tier counts', () => {
    const count = (t: string) => samples.filter((s) => s.tier === t).length;
    expect(count('S')).toBeGreaterThanOrEqual(3);
    expect(count('M')).toBeGreaterThanOrEqual(4);
    expect(count('L')).toBeGreaterThanOrEqual(1);
    expect(count('XL')).toBeGreaterThanOrEqual(1);
  });

  it('every sample declares id, tier, source and thresholds; ids are unique', () => {
    const ids = new Set<string>();
    for (const s of samples) {
      expect(typeof s.id).toBe('string');
      expect(TIERS).toContain(s.tier);
      expect(typeof s.source).toBe('string');
      expect(Object.keys(s.thresholds).length).toBeGreaterThan(0);
      for (const bound of Object.values(s.thresholds)) {
        expect(bound.min !== undefined || bound.max !== undefined).toBe(true);
      }
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  it('every referenced source file exists', () => {
    for (const s of samples) expect(existsSync(resolveSource(s))).toBe(true);
  });

  it('view package ids exist in their source', () => {
    for (const s of samples.filter((x) => x.view?.kind === 'package')) {
      const model = parsePlantUml(readFileSync(resolveSource(s), 'utf8'));
      expect(model.packages.map((p) => p.id)).toContain(s.view!.id);
    }
  });

  it('packagesMatching yields 100-200 entities for the L sample', () => {
    const l = samples.filter((s) => s.tier === 'L');
    expect(l.length).toBeGreaterThan(0);
    for (const s of l) {
      expect(s.packagesMatching).toBeTruthy();
      const model = parsePlantUml(readFileSync(resolveSource(s), 'utf8'));
      const filtered = filterPackagesMatching(model, s.packagesMatching);
      expect(filtered.entities.length).toBeGreaterThanOrEqual(100);
      expect(filtered.entities.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('evaluateThresholds', () => {
  it('reports min/max violations and missing fields', () => {
    const t = { aspectRatio: { min: 0.6, max: 2.2 }, edgeNodeIntersections: { max: 0 } };
    expect(evaluateThresholds({ aspectRatio: 1, edgeNodeIntersections: 0 }, t)).toEqual([]);
    expect(evaluateThresholds({ aspectRatio: 3, edgeNodeIntersections: 1 }, t)).toHaveLength(2);
    expect(evaluateThresholds({}, t)).toHaveLength(2);
  });
});
