import { describe, it, expect } from 'vitest';
import { measureTextWidth } from '../src/foundation/text-measure.js';
import { estimateEntitySize } from '../src/foundation/layout.js';
import { computeLayoutMetrics } from '../src/layout-metrics.js';
import { PlantUmlModel, PlantUmlEntity } from '../src/foundation/model.js';

describe('text-measure (monospace)', () => {
  it('measures every glyph with the same advance', () => {
    const glyphs = ['i', 'l', '.', ',', ':', '(', ')', 'm', 'w', 'W', '@', ' '];
    const widths = glyphs.map((ch) => measureTextWidth(ch));
    for (const w of widths) {
      expect(w).toBe(widths[0]);
    }
  });

  it('counts CJK / fullwidth characters as two cells', () => {
    expect(measureTextWidth('(命令层)')).toBe(measureTextWidth('x'.repeat(2 * 3 + 2)));
    expect(measureTextWidth('Ａ')).toBe(measureTextWidth('xx'));
  });

  it('scales linearly with the font size', () => {
    expect(measureTextWidth('abcdef', 26)).toBeCloseTo(
      measureTextWidth('abcdef', 13) * 2,
      2,
    );
  });

  it('keeps FunctionFingerprintKind-style member lines inside their estimated box', () => {
    const entity: PlantUmlEntity = {
      id: 'DuplicateMember',
      name: 'DuplicateMember',
      kind: 'class',
      members: [
        {
          visibility: 'public',
          name: 'kind',
          kind: 'field',
          type: 'FunctionFingerprintKind',
          modifiers: [],
          raw: '+kind: FunctionFingerprintKind',
        },
      ],
    };
    const model: PlantUmlModel = {
      diagramType: 'class',
      entities: [entity],
      relations: [],
      packages: [],
    };
    const { width, height } = estimateEntitySize(entity);
    const m = computeLayoutMetrics(model, {
      nodes: [{ id: entity.id, x: 0, y: 0, width, height }],
      edges: [],
      width,
      height,
    });
    expect(m.textOverflowCount).toBe(0);
  });
});
