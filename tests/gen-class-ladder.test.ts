import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { generateLadder } from '../scripts/gen-class-ladder.mjs';
import { parsePlantUml, checkSyntax } from '../src/core.js';

const gen = generateLadder as (o: { entities: number; seed?: number }) => string;

describe('gen-class-ladder', () => {
  it('is byte-identical for the same seed and entity count', () => {
    expect(gen({ entities: 50, seed: 3 })).toBe(gen({ entities: 50, seed: 3 }));
  });

  it('differs for different seeds', () => {
    expect(gen({ entities: 50, seed: 1 })).not.toBe(gen({ entities: 50, seed: 2 }));
  });

  it.each([10, 25, 50, 100, 200, 400])('produces exactly %i valid entities', (entities) => {
    const puml = gen({ entities, seed: 1 });
    expect(checkSyntax(puml).ok).toBe(true);
    const model = parsePlantUml(puml);
    expect(model.entities).toHaveLength(entities);
    expect(model.entities.every((e) => !e.external)).toBe(true);
    const topLevel = model.packages.filter((p) => !p.parentId).length;
    expect(topLevel).toBeGreaterThanOrEqual(2);
    expect(model.packages.length).toBeLessThanOrEqual(30);
  });

  it('mixes all five relation types, nesting and isolated layers at scale', () => {
    const model = parsePlantUml(gen({ entities: 200, seed: 1 }));
    const types = new Set(model.relations.map((r) => r.type));
    for (const t of ['inheritance', 'implementation', 'composition', 'dependency', 'association']) {
      expect(types.has(t as never)).toBe(true);
    }
    expect(model.packages.some((p) => p.parentId)).toBe(true);
    expect(model.packages.some((p) => p.name.startsWith('Tests'))).toBe(true);
    expect(model.packages.some((p) => p.name.startsWith('Examples'))).toBe(true);
  });
});
