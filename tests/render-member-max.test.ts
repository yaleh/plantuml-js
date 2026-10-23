import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createRenderer, renderDetailed } from '../src/index.js';
import {
  GRID,
  METRICS,
  displayName,
  snapUp,
} from '../src/foundation/layout.js';
import type { PlantUmlEntity } from '../src/foundation/model.js';
import { measureTextWidth } from '../src/foundation/text-measure.js';

const MEMBER_MAX_CHARS = 48;
const MEMBER_MAX_ROWS = 6;
const ENTITY_ID = 'VoiceFrameProcessor';
const LONG_MEMBER =
  '+processFrame(frame: AudioFrame, context: ProcessingContext): ProcessedFrame';

// One entity with eight members: the first is longer than MEMBER_MAX_CHARS and
// there are more members than MEMBER_MAX_ROWS.
const fixture = `@startuml
class ${ENTITY_ID} {
  ${LONG_MEMBER}
  +startCapture(device: AudioDevice, channel: CaptureChannel): void
  +stopCapture(): void
  +flush(buffer: FrameBuffer, deadline: number): void
  +reset(): void
  +diagnostics(): string
  +configure(options: ProcessingOptions): void
  +isRunning(): boolean
}
@enduml`;

/**
 * SHA-256 of the default (`createRenderer().render(fixture)`) SVG, captured
 * from the implementation *before* memberMaxChars/memberMaxRows existed. It
 * pins the "no options ⇒ byte-for-byte unchanged" guarantee (AC3).
 */
const DEFAULT_RENDER_SHA256 =
  'a34364812a1e32dec9123d5b55fc6434e565711bdbab51cfe07c17c21cf120af';

/** Pull one numeric data-* attribute off the entity's `<g>` element. */
const entityAttr = (svg: string, attr: 'data-w' | 'data-h'): number => {
  const match = new RegExp(`data-entity-id="${ENTITY_ID}"[^>]*${attr}="([^"]+)"`).exec(svg);
  if (!match) throw new Error(`no ${attr} for ${ENTITY_ID}`);
  return Number(match[1]);
};

const longestDrawnLine = (entity: PlantUmlEntity): number =>
  [displayName(entity), ...entity.members.map((m) => m.display ?? m.raw)].reduce(
    (max, line) => Math.max(max, measureTextWidth(line, METRICS.fontSize)),
    0,
  );

const expectedWidth = (entity: PlantUmlEntity): number =>
  snapUp(Math.max(METRICS.minWidth, longestDrawnLine(entity) + METRICS.paddingX * 2));

describe('memberMaxChars / memberMaxRows', () => {
  it('sizes the box for the drawn (truncated, row-capped) content', async () => {
    const { svg, model } = await renderDetailed(fixture, {
      memberMaxChars: MEMBER_MAX_CHARS,
      memberMaxRows: MEMBER_MAX_ROWS,
    });
    const entity = model.entities.find((e) => e.id === ENTITY_ID)!;

    // createRenderer (the public entry point named by the AC) renders the
    // exact same SVG as the detailed pipeline.
    const viaRenderer = await createRenderer({
      memberMaxChars: MEMBER_MAX_CHARS,
      memberMaxRows: MEMBER_MAX_ROWS,
    }).render(fixture);
    expect(viaRenderer.svg).toBe(svg);

    // Row cap: MEMBER_MAX_ROWS kept + the synthesized count row.
    expect(entity.members).toHaveLength(MEMBER_MAX_ROWS + 1);
    expect(entity.members.at(-1)!.raw).toBe('… +2 more (8 members)');
    expect(svg).toContain('… +2 more (8 members)');
    // Members beyond the cap are not drawn at all.
    expect(svg).not.toContain('isRunning');
    expect(svg).not.toContain('configure(');

    // Width cap: the long member is drawn cut to MEMBER_MAX_CHARS incl. `…`.
    const long = entity.members.find((m) => m.raw === LONG_MEMBER)!;
    expect(long.display).toBe(`${LONG_MEMBER.slice(0, MEMBER_MAX_CHARS - 1)}…`);
    expect(long.display!.endsWith('…')).toBe(true);
    expect(svg).toContain(long.display!);
    expect(svg).not.toContain(LONG_MEMBER);

    // Geometry equals what the drawn lines need (grid-snapped), and is far
    // narrower than the same box would be with the full raw declaration.
    const width = entityAttr(svg, 'data-w');
    expect(width).toBe(expectedWidth(entity));
    expect(width - (longestDrawnLine(entity) + METRICS.paddingX * 2)).toBeLessThan(GRID);
    const rawWidth = snapUp(
      Math.max(
        METRICS.minWidth,
        measureTextWidth(LONG_MEMBER, METRICS.fontSize) + METRICS.paddingX * 2,
      ),
    );
    expect(width).toBeLessThan(rawWidth);

    // Height counts only the kept rows + count row (+ title), never all 8.
    const drawnRows = MEMBER_MAX_ROWS + 1;
    expect(entityAttr(svg, 'data-h')).toBe(
      snapUp(METRICS.lineHeight * (drawnRows + 1) + METRICS.paddingY * 2),
    );
    expect(entityAttr(svg, 'data-h')).toBeLessThan(
      snapUp(METRICS.lineHeight * (8 + 1) + METRICS.paddingY * 2),
    );
  });

  it('keeps raw intact (only display is truncated)', async () => {
    const { model } = await renderDetailed(fixture, {
      memberMaxChars: MEMBER_MAX_CHARS,
      memberMaxRows: MEMBER_MAX_ROWS,
    });
    const long = model.entities
      .find((e) => e.id === ENTITY_ID)!
      .members.find((m) => m.name === 'processFrame')!;
    expect(long.raw).toBe(LONG_MEMBER);
    expect(long.display).toBe(`${LONG_MEMBER.slice(0, MEMBER_MAX_CHARS - 1)}…`);
  });

  it('applies each cap independently', async () => {
    const rowsOnly = await renderDetailed(fixture, { memberMaxRows: 3 });
    const longKept = rowsOnly.model.entities[0].members.find((m) => m.name === 'processFrame')!;
    expect(rowsOnly.model.entities[0].members).toHaveLength(4);
    expect(longKept.display).toBeUndefined();
    expect(rowsOnly.svg).toContain(LONG_MEMBER);

    const charsOnly = await renderDetailed(fixture, { memberMaxChars: 20 });
    const members = charsOnly.model.entities[0].members;
    expect(members).toHaveLength(8); // no row cap, no count row
    expect(charsOnly.svg).not.toContain('more (8 members)');
    for (const member of members) {
      expect((member.display ?? member.raw).length).toBeLessThanOrEqual(20);
    }
  });

  it('leaves the default render byte-for-byte unchanged', async () => {
    const { svg } = await createRenderer().render(fixture);
    expect(createHash('sha256').update(svg).digest('hex')).toBe(DEFAULT_RENDER_SHA256);
    expect(svg).toContain(LONG_MEMBER);
    expect(svg).toContain('isRunning');
  });
});
