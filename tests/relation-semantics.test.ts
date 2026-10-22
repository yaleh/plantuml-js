import { describe, it, expect } from 'vitest';
import { createRenderer } from '../src/index.js';
import {
  RELATION_SEMANTICS,
  RELATION_TYPES,
  relationSemantics,
  type RelationSemantics,
} from '../src/foundation/relation-semantics.js';
import { defaultTheme } from '../src/render/theme.js';
import type { RelationType } from '../src/foundation/model.js';

const IMPLEMENTATION_PUML = [
  '@startuml',
  'interface Service',
  'class ServiceImpl',
  'ServiceImpl ..|> Service',
  '@enduml',
].join('\n');

/** `stroke-dasharray` of the one implementation edge in a rendered SVG. */
function implementationDash(svg: string): string | undefined {
  const group = /<g [^>]*data-edge-type="implementation"[^>]*>(.*?)<\/g>/s.exec(svg);
  expect(group).not.toBeNull();
  return / stroke-dasharray="([^"]+)"/.exec(group![1])?.[1];
}

describe('relation semantics', () => {
  it('holds exactly one fact set per RelationType', () => {
    expect(Object.keys(RELATION_SEMANTICS).sort()).toEqual([...RELATION_TYPES].sort());
    for (const type of RELATION_TYPES) {
      expect(relationSemantics(type)).toBe(RELATION_SEMANTICS[type]);
    }
  });

  it('locks the semantic fact of each relation type', () => {
    const expected: Record<RelationType, RelationSemantics> = {
      inheritance: { reversed: true, dashed: false, arrowKind: 'triangle', filled: false, weak: false, bundlable: false },
      implementation: { reversed: true, dashed: true, arrowKind: 'triangle', filled: false, weak: false, bundlable: false },
      dependency: { reversed: false, dashed: true, arrowKind: 'chevron', filled: false, weak: true, bundlable: true },
      association: { reversed: false, dashed: false, arrowKind: 'chevron', filled: false, weak: false, bundlable: true },
      aggregation: { reversed: false, dashed: false, arrowKind: 'diamond', filled: false, weak: false, bundlable: false },
      composition: { reversed: false, dashed: false, arrowKind: 'diamond', filled: true, weak: false, bundlable: false },
    };
    expect(RELATION_SEMANTICS).toEqual(expected);
  });

  it('renders the implementation edge dashed in BOTH the elk and viz engines', async () => {
    const dashes: Partial<Record<'elk' | 'viz', string | undefined>> = {};
    for (const layout of ['elk', 'viz'] as const) {
      const { svg } = await createRenderer({ layout }).render(IMPLEMENTATION_PUML);
      dashes[layout] = implementationDash(svg);
    }
    // The dashed fact is one definition, so the two engines cannot disagree.
    expect(dashes.elk).toBe(defaultTheme.dash.weak);
    expect(dashes.viz).toBe(dashes.elk);
  });
});
