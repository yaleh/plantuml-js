import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../src/index.js';
import { parsePlantUml } from '../src/parser.js';
import { applyDetail, autoDetail, COMPACT_MEMBER_ROWS } from '../src/layout.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f: string): string => readFileSync(join(dir, 'fixtures', f), 'utf8');

const many = `@startuml
class Big {
  +a: number
  +b: number
  +c: number
  +d: number
  +e: number
  +f: number
  +g: number
}
class Small {
  +x: number
}
@enduml`;

const memberRows = (svg: string): number => (svg.match(/text-anchor="start"/g) ?? []).length;

describe('detail levels', () => {
  it('names mode draws no member rows', async () => {
    const { svg } = await createRenderer({ detail: 'names' }).render(many);
    expect(memberRows(svg)).toBe(0);
    expect(svg).toContain('>Big</text>');
  });

  it('compact mode limits member rows and shows a count', async () => {
    const { svg } = await createRenderer({ detail: 'compact' }).render(many);
    // Big: COMPACT_MEMBER_ROWS + 1 count row; Small: its single member.
    expect(memberRows(svg)).toBe(COMPACT_MEMBER_ROWS + 1 + 1);
    expect(svg).toContain('+3 more (7 members)');
  });

  it('full mode draws every member', async () => {
    const { svg } = await createRenderer({ detail: 'full' }).render(many);
    expect(memberRows(svg)).toBe(8);
  });

  it('chooses the level by entity count', () => {
    expect(autoDetail(22)).toBe('full');
    expect(autoDetail(40)).toBe('full');
    expect(autoDetail(41)).toBe('compact');
    expect(autoDetail(150)).toBe('compact');
    expect(autoDetail(151)).toBe('names');
  });

  it('defaults to names for all-classes (660 entities) and full for the 22-entity fixture', () => {
    const all = parsePlantUml(read('all-classes.puml'));
    expect(all.entities.length).toBeGreaterThan(600);
    expect(applyDetail(all).entities.every((e) => e.members.length === 0)).toBe(true);
    const fixture = parsePlantUml(read('archguard-class.puml'));
    expect(fixture.entities.length).toBeLessThanOrEqual(40);
    expect(applyDetail(fixture)).toBe(fixture);
  });
});
