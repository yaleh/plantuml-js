/**
 * RelationType semantics — the single place that knows what each relation kind
 * *means*.
 *
 * `RelationType` is a closed enum, but its behaviour used to be decided
 * independently by every consumer: layout reversal in `elk-graph`/`compound`,
 * line style and arrowheads in `svg`/`viz`, bundling and reduction eligibility
 * in `svg`/`transform`. The copies drifted — the viz DOT said `implementation`
 * was dashed while the SVG renderer drew it solid. Consumers now read this
 * table and only translate the facts into their own output format (SVG DOM,
 * DOT attributes, ELK endpoints).
 *
 * It lives in `foundation/` (the shared lowest layer) because layout/, render/
 * and transform/ all consume it: a module at the `src/` root would be imported
 * by subdirectories that the root itself imports, creating a package cycle.
 */

import type { RelationType } from './model.js';

/** Shape a relation type puts at the arrow end. */
export type RelationArrowKind = 'triangle' | 'chevron' | 'diamond';

/**
 * The behavioural facts of one relation type. Each fact is a decision, not a
 * rendering instruction: `dashed` is "this line is dashed", `svg.ts` decides
 * *which* dash token that maps to.
 */
export interface RelationSemantics {
  /** Layout direction is reversed: the arrow target sits above the source. */
  readonly reversed: boolean;
  /** The connection line is dashed. */
  readonly dashed: boolean;
  /** Shape of the arrowhead. */
  readonly arrowKind: RelationArrowKind;
  /** A diamond head is filled (composition) rather than hollow (aggregation). */
  readonly filled: boolean;
  /** A weak relation, drawn in the lighter edge colour. */
  readonly weak: boolean;
  /** Eligible for edge bundling and automatic transitive reduction. */
  readonly bundlable: boolean;
}

/**
 * Relation types whose layout direction is reversed so the arrow target sits
 * above the source. The one and only definition of this fact.
 */
const REVERSED_RELATION_TYPES = new Set<RelationType>(['inheritance', 'implementation']);

/** Every relation type and the behaviour it implies. */
export const RELATION_SEMANTICS: Readonly<Record<RelationType, RelationSemantics>> = {
  inheritance: {
    reversed: REVERSED_RELATION_TYPES.has('inheritance'),
    dashed: false,
    arrowKind: 'triangle',
    filled: false,
    weak: false,
    bundlable: false,
  },
  implementation: {
    reversed: REVERSED_RELATION_TYPES.has('implementation'),
    // PlantUML `..|>` — dashed, but not a "weak" (lighter) edge.
    dashed: true,
    arrowKind: 'triangle',
    filled: false,
    weak: false,
    bundlable: false,
  },
  dependency: {
    reversed: false,
    dashed: true,
    arrowKind: 'chevron',
    filled: false,
    weak: true,
    bundlable: true,
  },
  association: {
    reversed: false,
    dashed: false,
    arrowKind: 'chevron',
    filled: false,
    weak: false,
    bundlable: true,
  },
  aggregation: {
    reversed: false,
    dashed: false,
    arrowKind: 'diamond',
    filled: false,
    weak: false,
    bundlable: false,
  },
  composition: {
    reversed: false,
    dashed: false,
    arrowKind: 'diamond',
    filled: true,
    weak: false,
    bundlable: false,
  },
};

/** The behavioural facts of one relation type. */
export function relationSemantics(type: RelationType): RelationSemantics {
  return RELATION_SEMANTICS[type];
}

/** Every relation type, in declaration order (for consumers that iterate the closed enum). */
export const RELATION_TYPES: readonly RelationType[] = [
  'inheritance',
  'implementation',
  'dependency',
  'association',
  'aggregation',
  'composition',
];
