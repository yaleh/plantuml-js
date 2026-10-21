import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations
import { compareToBaseline, mergeRecords } from '../scripts/samples-lib.mjs';

interface Rec {
  group: string;
  engine: string;
  metrics: { edgeCrossings: number; areaUtilization: number; maxEmptyBlockRatio: number };
}

const rec = (group: string, m: Partial<Rec['metrics']> = {}, engine = 'elk'): Rec => ({
  group,
  engine,
  metrics: { edgeCrossings: 100, areaUtilization: 0.2, maxEmptyBlockRatio: 0.1, ...m },
});

describe('compareToBaseline', () => {
  it('passes when every metric stays within its limit', () => {
    const base = [rec('a'), rec('b')];
    const cur = [
      rec('a', { edgeCrossings: 125, areaUtilization: 0.14, maxEmptyBlockRatio: 0.15 }),
      rec('b', { edgeCrossings: 10, areaUtilization: 0.4, maxEmptyBlockRatio: 0.0 }),
    ];
    expect(compareToBaseline(base, cur)).toEqual([]);
  });

  it('names the sample and metric for each regression', () => {
    const base = [rec('a'), rec('b'), rec('c')];
    const cur = [
      rec('a', { edgeCrossings: 126 }),
      rec('b', { areaUtilization: 0.1 }),
      rec('c', { maxEmptyBlockRatio: 0.16 }),
    ];
    const out = compareToBaseline(base, cur) as string[];
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^a: edgeCrossings 100 → 126/);
    expect(out[1]).toMatch(/^b: areaUtilization 0.2 → 0.1/);
    expect(out[2]).toMatch(/^c: maxEmptyBlockRatio 0.1 → 0.16/);
  });

  it('ignores the viz engine and samples absent from the baseline', () => {
    const base = [rec('a', {}, 'viz')];
    const cur = [rec('a', { edgeCrossings: 9999 }, 'viz'), rec('new', { edgeCrossings: 9999 })];
    expect(compareToBaseline(base, cur)).toEqual([]);
  });

  it('merges fresh records over the baseline, keeping untouched ones', () => {
    const merged = mergeRecords([rec('a'), rec('keep')], [rec('a', { edgeCrossings: 1 }), rec('z')]) as Rec[];
    expect(merged.map((r) => r.group)).toEqual(['keep', 'a', 'z']);
    expect(merged[1].metrics.edgeCrossings).toBe(1);
  });
});
