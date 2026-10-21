/**
 * PlantUmlModel — the layout-agnostic intermediate representation produced by
 * the parser and consumed by every LayoutEngine. Keeping this free of any DOT
 * or layout concept is the point: the model is what the engines compete over.
 */

export type EntityKind = 'class' | 'interface' | 'enum' | 'abstract';

export type Visibility = 'public' | 'private' | 'protected' | 'package-private';

export interface PlantUmlMember {
  visibility: Visibility;
  name: string;
  kind: 'field' | 'method';
  /** Return type for methods, or the field's declared type for fields. */
  type?: string;
  /** Raw parameter list for methods (e.g. "(name: String): void"). */
  parameters?: string;
}

export interface PlantUmlEntity {
  /** Stable node identity inside the diagram (alias-aware in M2). */
  id: string;
  /** Display name drawn in the class box. */
  name: string;
  kind: EntityKind;
  members: PlantUmlMember[];
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
  /** Optional multiplicity/label text ("1", "*", ": label"). */
  label?: string;
}

export interface PlantUmlPackage {
  id: string;
  name: string;
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
