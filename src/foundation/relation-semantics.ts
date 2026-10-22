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

/** Shape a relation type puts at the arrow end (`none`: no head). */
export type RelationArrowKind = 'triangle' | 'chevron' | 'diamond' | 'none';

/**
 * The behavioural facts of one relation type, exposed as **methods**. Each
 * fact is a decision, not a rendering instruction: `isDashed()` is "this line
 * is dashed", `svg.ts` decides *which* dash token that maps to.
 *
 * The methods are the whole public surface — consumers ask the value object
 * what to do instead of reading how it remembers the answer. That keeps the
 * representation private: a fact that later becomes a computation (rather than
 * a stored boolean) changes only this module, not every call site.
 */
export interface RelationSemantics {
  /** Layout direction is reversed: the arrow target sits above the source. */
  isReversed(): boolean;
  /** The connection line is dashed. */
  isDashed(): boolean;
  /** Shape of the arrowhead. */
  arrowKind(): RelationArrowKind;
  /** A diamond head is filled (composition) rather than hollow (aggregation). */
  isFilled(): boolean;
  /** A weak relation, drawn in the lighter edge colour. */
  isWeak(): boolean;
  /** Eligible for edge bundling and automatic transitive reduction. */
  isBundlable(): boolean;
}

/**
 * The internal representation of one fact set. Private to this module: only
 * [[semantics]] closes over it, and consumers never see these fields.
 */
interface RelationFacts {
  readonly reversed: boolean;
  readonly dashed: boolean;
  readonly arrowKind: RelationArrowKind;
  readonly filled: boolean;
  readonly weak: boolean;
  readonly bundlable: boolean;
}

/** Build the methods-only public view over one private fact set. */
function semantics(facts: RelationFacts): RelationSemantics {
  return Object.freeze({
    isReversed: () => facts.reversed,
    isDashed: () => facts.dashed,
    arrowKind: () => facts.arrowKind,
    isFilled: () => facts.filled,
    isWeak: () => facts.weak,
    isBundlable: () => facts.bundlable,
  });
}

/**
 * Relation types whose layout direction is reversed so the arrow target sits
 * above the source. The one and only definition of this fact.
 */
const REVERSED_RELATION_TYPES = new Set<RelationType>(['inheritance', 'implementation']);

/** Every relation type and the behaviour it implies. */
export const RELATION_SEMANTICS: Readonly<Record<RelationType, RelationSemantics>> = {
  inheritance: semantics({
    reversed: REVERSED_RELATION_TYPES.has('inheritance'),
    dashed: false,
    arrowKind: 'triangle',
    filled: false,
    weak: false,
    bundlable: false,
  }),
  implementation: semantics({
    reversed: REVERSED_RELATION_TYPES.has('implementation'),
    // PlantUML `..|>` — dashed, but not a "weak" (lighter) edge.
    dashed: true,
    arrowKind: 'triangle',
    filled: false,
    weak: false,
    bundlable: false,
  }),
  dependency: semantics({
    reversed: false,
    dashed: true,
    arrowKind: 'chevron',
    filled: false,
    weak: true,
    bundlable: true,
  }),
  association: semantics({
    reversed: false,
    dashed: false,
    arrowKind: 'chevron',
    filled: false,
    weak: false,
    bundlable: true,
  }),
  aggregation: semantics({
    reversed: false,
    dashed: false,
    arrowKind: 'diamond',
    filled: false,
    weak: false,
    bundlable: false,
  }),
  composition: semantics({
    reversed: false,
    dashed: false,
    arrowKind: 'diamond',
    filled: true,
    weak: false,
    bundlable: false,
  }),
};

/**
 * Facts for a relation type outside the closed `RelationType` domain. External
 * input (JSON fixtures, hosts) can carry such a type; every consumer used to
 * treat it as an anonymous line via `Set.has()` / `===` checks — no reversal,
 * no dash, no arrowhead, not weak, not bundlable. Keep exactly that instead of
 * failing the lookup.
 */
const UNKNOWN_RELATION_SEMANTICS: RelationSemantics = semantics({
  reversed: false,
  dashed: false,
  arrowKind: 'none',
  filled: false,
  weak: false,
  bundlable: false,
});

/** The behavioural facts of one relation type. */
export function relationSemantics(type: RelationType): RelationSemantics {
  return RELATION_SEMANTICS[type] ?? UNKNOWN_RELATION_SEMANTICS;
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
