/**
 * PlantUmlModel — the layout-agnostic intermediate representation produced by
 * the parser and consumed by every LayoutEngine. Keeping this free of any DOT
 * or layout concept is the point: the model is what the engines compete over.
 */

export type EntityKind = 'class' | 'interface' | 'enum' | 'abstract';

export type Visibility = 'public' | 'private' | 'protected' | 'package-private';

export interface PlantUmlMember {
  visibility: Visibility;
  /** Member name without visibility/modifier/type decoration. */
  name: string;
  kind: 'field' | 'method';
  /** Return type for methods, or the field's declared type for fields. */
  type?: string;
  /** Raw parameter list for methods (e.g. "(name: String): void"). */
  parameters?: string;
  /** Modifier tokens as authored, e.g. ['{static}'] or ['async']. */
  modifiers: string[];
  /** True when a field name carries a `?` optional marker. */
  optional?: boolean;
  /** Full authored declaration incl. visibility symbol, for faithful display. */
  raw: string;
  /**
   * Text actually drawn for this member, when it differs from `raw` (e.g. cut
   * to a display width by `applyDetail`). Layout and rendering read
   * `display ?? raw`; `raw` itself is never modified, so serialization and
   * inspector views keep the full declaration.
   */
  display?: string;
}

export interface PlantUmlEntity {
  /** Stable node identity inside the diagram (the alias when `as` is used). */
  id: string;
  /** Display name drawn in the class box (without generic parameters). */
  name: string;
  /** Generic type parameters, e.g. ['Item'] for `List~Item~` / `List<Item>`. */
  generics?: string[];
  kind: EntityKind;
  members: PlantUmlMember[];
  /** id of the package containing this entity (undefined = top level). */
  packageId?: string;
  /**
   * Number of distinct sources whose incoming edges were summarized away by
   * hub summarization (see [[../transform]]). Drawn as a "used by N" badge.
   */
  usageCount?: number;
  /**
   * True when the entity is a collapsed stand-in node (an overview package
   * node, or an external package stub in a single-package view). Stubs carry
   * no members and are drawn with a distinct frame.
   */
  stub?: boolean;
  /** Names of the stubs merged into a group stub; listed in its `<title>`. */
  groupMembers?: string[];
  /**
   * True when the entity was never declared and only exists because a relation
   * named it (an implicit/external type such as `Error`). Drawn with a weaker
   * style and grouped under a synthetic External package.
   */
  external?: boolean;
}

export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'dependency'
  | 'association'
  | 'aggregation'
  | 'composition';

export interface PlantUmlRelation {
  source: string;
  target: string;
  type: RelationType;
  /** Optional label text ("label" after a `: label` suffix). */
  label?: string;
  /** Optional cardinality on the source side ("1", "*"). */
  sourceCardinality?: string;
  /** Optional cardinality on the target side ("1", "*"). */
  targetCardinality?: string;
  /**
   * Number of original relations this aggregated edge represents. Absent (or
   * 1) means a single, un-aggregated relation; the renderer encodes weight as
   * line width plus a `×N` label.
   */
  weight?: number;
  /** True when this edge is a cycle feedback arc, drawn in a distinct color. */
  feedback?: boolean;
  /**
   * One line per original relation folded into an inter-package corridor edge
   * (`A --> B`); rendered as the edge's `<title>`.
   */
  descriptions?: string[];
  /**
   * Set when the authored endpoint named a package rather than an entity: the
   * edge is laid out against a representative entity inside it, and the
   * layout clips its end to the package frame boundary.
   */
  sourcePackageId?: string;
  targetPackageId?: string;
}

export interface PlantUmlPackage {
  id: string;
  name: string;
  /** id of the enclosing package (undefined = top level). */
  parentId?: string;
  /**
   * Semantic layer this package belongs to, derived from the `"X Layer"` name
   * convention (e.g. `"Src Layer"` → `"Src"`). The layout engine uses this to
   * stack layers in a fixed vertical order so dependency direction is readable.
   */
  layer?: string;
}

export interface PlantUmlModel {
  diagramType: 'class';
  entities: PlantUmlEntity[];
  relations: PlantUmlRelation[];
  packages: PlantUmlPackage[];
}

export function emptyModel(): PlantUmlModel {
  return { diagramType: 'class', entities: [], relations: [], packages: [] };
}
