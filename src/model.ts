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
}

export interface PlantUmlPackage {
  id: string;
  name: string;
  /** id of the enclosing package (undefined = top level). */
  parentId?: string;
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
