import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyView,
  checkSyntax,
  parsePlantUml,
  renderDetailed,
  toPlantUml as toPlantUmlFromIndex,
} from '../src/index.js';
import { toPlantUml as toPlantUmlFromElk } from '../src/elk.js';
import { toPlantUml as toPlantUmlFromCore } from '../src/core.js';
import type { PlantUmlModel, PlantUmlRelation } from '../src/foundation/model.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(testDir, 'fixtures', name), 'utf8');

const classPuml = fixture('archguard-class.puml');
const packagePuml = fixture('archguard-package.puml');

/**
 * Nested packages + every entity kind + generics + members in all four
 * visibility columns + cardinality-bearing relations. Written by hand because
 * the fixtures have flat packages and no generics.
 */
const NESTED_PUML = `@startuml
package "Outer Layer" as Outer_Layer {
  package "Inner Layer" as Inner_Layer {
    class "Thing" as Thing {
      +id: string
      +label?: string
      -secret: number
    }
  }
  enum "Status" as Status {
    +OK: string
  }
}
abstract class "Base"~T~ as Base {
  #{static} registry: Map
  +run(input: T): void
}
interface "Port"~Item~ as Port
class "List"~Item~ as List
Base <|-- Thing : extends
Thing ..|> Port : implements
Thing "1" --> "*" List : uses
Base "0..1" o-- "*" Status : owns
Port *-- List : contains
Port ..> Status : needs
@enduml`;

interface EntityShape {
  id: string;
  name: string;
  kind: string;
  packageId: string | undefined;
  parentId: string | undefined;
  generics: string[];
  members: string[];
}

interface RelationShape {
  source: string;
  target: string;
  type: string;
  label: string | undefined;
}

function entityShapes(model: PlantUmlModel): EntityShape[] {
  const parentOf = new Map(model.packages.map((p) => [p.id, p.parentId]));
  return model.entities
    .map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      packageId: e.packageId,
      parentId: e.packageId === undefined ? undefined : parentOf.get(e.packageId),
      generics: e.generics ?? [],
      members: e.members.map((m) => m.raw),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function relationShapes(relations: PlantUmlRelation[]): RelationShape[] {
  return relations.map((r) => ({
    source: r.source,
    target: r.target,
    type: r.type,
    label: r.label,
  }));
}

function packageShapes(model: PlantUmlModel): Array<{ id: string; name: string; parentId: string | undefined }> {
  return model.packages
    .map((p) => ({ id: p.id, name: p.name, parentId: p.parentId }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The strict round trip: the serialized text is syntactically valid and parsing
 * it back yields the same packages, entities (id/name/kind/packageId/parentId/
 * generics/members) and relations (source/target/type/label).
 */
function expectStrictRoundTrip(source: string): void {
  const model = parsePlantUml(source);
  const text = toPlantUmlFromIndex(model);

  const syntax = checkSyntax(text);
  expect(syntax.errors).toEqual([]);
  expect(syntax.ok).toBe(true);

  const back = parsePlantUml(text);
  expect(packageShapes(back)).toEqual(packageShapes(model));
  expect(entityShapes(back)).toEqual(entityShapes(model));
  expect(relationShapes(back.relations)).toEqual(relationShapes(model.relations));

  // Re-serializing the reparsed model is byte-identical: the text form is a
  // fixed point, which is what makes copying it out and back lossless.
  expect(toPlantUmlFromIndex(back)).toBe(text);
}

/**
 * A model-shape snapshot that survives what PlantUML text cannot spell:
 * view-internal ids (`ov::`, `stub::`, `grp::`) become their display name on
 * reparse, so compare entities by name and edge endpoints by entity name.
 */
function snapshot(model: PlantUmlModel) {
  const nameOf = new Map(model.entities.map((e) => [e.id, e.name]));
  const packageName = new Map(model.packages.map((p) => [p.id, p.name]));
  const entities = model.entities
    .map((e) => ({
      name: e.name,
      kind: e.kind,
      package: e.packageId === undefined ? null : packageName.get(e.packageId) ?? e.packageId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  const packages = model.packages
    .map((p) => ({
      name: p.name,
      parent: p.parentId === undefined ? null : packageName.get(p.parentId) ?? p.parentId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const relations = model.relations
    .map((r) => ({
      source: nameOf.get(r.source) ?? r.source,
      target: nameOf.get(r.target) ?? r.target,
      type: r.type,
      label: r.label ?? null,
      sourceCardinality: r.sourceCardinality ?? null,
      targetCardinality: r.targetCardinality ?? null,
    }))
    .map((r) => JSON.stringify(r))
    .sort();
  return { entities, packages, relations };
}

function expectStableRoundTrip(model: PlantUmlModel): string {
  const text = toPlantUmlFromIndex(model);
  const syntax = checkSyntax(text);
  expect(syntax.errors).toEqual([]);
  expect(syntax.ok).toBe(true);

  const back = parsePlantUml(text);
  expect(snapshot(back)).toEqual(snapshot(model));
  expect(toPlantUmlFromIndex(back)).toBe(text);
  return text;
}

describe('gap-plantuml-serializer: model round trip', () => {
  it('exports toPlantUml from core, ./ and ./elk', () => {
    expect(toPlantUmlFromIndex).toBe(toPlantUmlFromCore);
    expect(toPlantUmlFromElk).toBe(toPlantUmlFromCore);
  });

  it.each([
    ['archguard-class.puml', classPuml],
    ['archguard-package.puml', packagePuml],
    ['nested packages (synthetic)', NESTED_PUML],
    // The DoD's "quay full Entity diagram" scale: 660 entities / 950 relations.
    ['all-classes.puml', fixture('all-classes.puml')],
  ])('round-trips %s', (_name, source) => {
    expectStrictRoundTrip(source);
  });

  it('serializes nested packages inside their parent block', () => {
    const text = toPlantUmlFromIndex(parsePlantUml(NESTED_PUML));
    expect(text).toContain('package "Outer Layer" as Outer_Layer {');
    // Two-space indent is only ever emitted for a package nested in another.
    expect(text).toContain('\n  package "Inner Layer" as Inner_Layer {');
  });

  it('writes all six relation arrows, labels and cardinalities', () => {
    const text = toPlantUmlFromIndex(parsePlantUml(NESTED_PUML));
    for (const arrow of ['--|>', '..|>', '..>', '-->', 'o--', '*--']) {
      expect(text).toContain(arrow);
    }
    expect(text).toContain(' : uses');
    expect(text).toContain('"1" --> "*"');
  });

  it('serializes every entity kind and generics', () => {
    const text = toPlantUmlFromIndex(parsePlantUml(NESTED_PUML));
    expect(text).toMatch(/abstract class "Base"~T~ as Base/);
    expect(text).toMatch(/interface "Port"~Item~ as Port/);
    expect(text).toMatch(/enum "Status" as Status/);
    expect(text).toMatch(/class "Thing" as Thing/);
  });
});

describe('gap-plantuml-serializer: subgraphs stay stable', () => {
  it('round-trips the overview view', () => {
    expectStableRoundTrip(applyView(parsePlantUml(packagePuml), { kind: 'overview' }));
  });

  it('round-trips a single-package view (stubs included)', () => {
    expectStableRoundTrip(
      applyView(parsePlantUml(packagePuml), { kind: 'package', id: 'Src_Layer' }),
    );
  });

  it('round-trips a neighborhood view', () => {
    expectStableRoundTrip(
      applyView(parsePlantUml(packagePuml), { kind: 'neighborhood', entity: 'src_analysis', hops: 1 }),
    );
  });

  it('skips the synthetic truncation rows of a detail-compacted model', async () => {
    const parsed = parsePlantUml(classPuml);
    const { model } = await renderDetailed(parsed, { detail: 'compact' });
    const synthetic = model.entities.flatMap((e) =>
      e.members.filter((m) => m.synthetic === true),
    );
    expect(synthetic.length).toBeGreaterThan(0);

    const text = expectStableRoundTrip(model);
    // The `… +N more (M members)` stand-in is drawing scaffolding, not a
    // member: no marker line may be emitted, and a reparse must not turn one
    // into an authored member.
    expect(text).not.toMatch(/… \+\d+ more \(\d+ members\)/);
    const back = parsePlantUml(text);
    expect(
      back.entities.flatMap((e) => e.members).some((m) => m.raw.includes('more (')),
    ).toBe(false);
    // Every real member the drawn model kept is still exported.
    for (const entity of model.entities) {
      for (const member of entity.members.filter((m) => m.synthetic !== true)) {
        expect(text).toContain(member.raw);
      }
    }
  });

  it('exports sourceModel with the original member count and intact raw text', async () => {
    const parsed = parsePlantUml(classPuml);
    const { sourceModel } = await renderDetailed(parsed, {
      detail: 'compact',
      memberMaxRows: 2,
      memberMaxChars: 12,
    });

    const sourceMembers = sourceModel.entities.flatMap((e) => e.members);
    expect(sourceMembers.length).toBeGreaterThan(0);
    expect(sourceMembers.some((m) => m.synthetic === true)).toBe(false);
    // memberMaxChars only changes `display`; `raw` stays the authored text.
    for (const member of sourceMembers) expect(member.raw).not.toContain('…');

    const text = toPlantUmlFromIndex(sourceModel);
    const syntax = checkSyntax(text);
    expect(syntax.errors).toEqual([]);
    expect(syntax.ok).toBe(true);
    expect(text).not.toMatch(/… \+\d+ more \(\d+ members\)/);

    const memberCounts = (m: PlantUmlModel): Map<string, number> =>
      new Map(m.entities.map((e) => [e.name, e.members.length]));
    expect(memberCounts(parsePlantUml(text))).toEqual(memberCounts(parsed));
  });
});

describe('gap-plantuml-serializer: authored constructs survive verbatim', () => {
  const architectureTabPuml = `@startuml
package "src/modules/architecture" as n_pkg {
  class "<<function>> haltVerdict" as n0
  interface "<<interface>> Viewer" as n1 {
    +render(): string
  }
  class "ViewerImpl" as n2 {
    +render(): string
    + … +N
  }
}
n2 ..> n1 : <<call>>
@enduml`;

  it('keeps a <<function>> stereotype in the entity name', () => {
    const model = parsePlantUml(architectureTabPuml);
    const text = toPlantUmlFromIndex(model);
    expect(text).toContain('class "<<function>> haltVerdict" as n0');
    expect(toPlantUmlFromIndex(parsePlantUml(text))).toBe(text);
  });

  it('keeps member columns and the "… +N" truncation row', () => {
    const model = parsePlantUml(architectureTabPuml);
    const text = toPlantUmlFromIndex(model);
    expect(text).toContain('+render(): string');
    expect(text).toContain('+ … +N');
    expect(toPlantUmlFromIndex(parsePlantUml(text))).toBe(text);
  });

  it('keeps a relation stereotype label', () => {
    const model = parsePlantUml(architectureTabPuml);
    const text = toPlantUmlFromIndex(model);
    expect(text).toContain('n2 ..> n1 : <<call>>');
    expect(parsePlantUml(text).relations[0].label).toBe('<<call>>');
  });
});
