import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlantUml, renderDetailed, ElkLayoutEngine } from '../src/index.js';
import { placeEdgeLabels } from '../src/foundation/labels.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const architecture = readFileSync(
  join(testDir, 'fixtures', 'archguard-architecture.puml'),
  'utf8',
);

/** Empty border the SVG contract guarantees between any drawn mark and the viewBox side. */
const MARGIN = 16;
const EPS = 1e-6;

/**
 * The real repro: the 1-hop neighborhood of TypeScriptParser. Dependency edges
 * detour to the left of the outer package, and their "uses" / "returns" labels
 * are hung beside those outer routes — the label placement is what used to fall
 * outside the `0 0 w h` viewBox and get clipped.
 */
async function renderFocus() {
  return renderDetailed(parsePlantUml(architecture), {
    layout: new ElkLayoutEngine(),
    view: { kind: 'neighborhood', entity: 'TypeScriptParser', hops: 1 },
    memberMaxRows: 4,
    memberMaxChars: 48,
  });
}

/** `viewBox` of the emitted SVG plus its extent, parsed from the real output. */
function viewBoxOf(svg: string): { x: number; y: number; width: number; height: number } {
  const match = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  expect(match, 'the SVG must declare a viewBox').not.toBeNull();
  const [x, y, width, height] = match!.slice(1).map(Number);
  return { x, y, width, height };
}

/** Coordinate pairs drawn by every `uml-edge` group (path `d` + arrowhead `points`). */
function edgeCoordinates(svg: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const groupRe = /<g data-edge-source="[^\"]*"[^>]*class="uml-edge[^\"]*">([\s\S]*?)<\/g>/g;
  let group: RegExpExecArray | null;
  while ((group = groupRe.exec(svg)) !== null) {
    const body = group[1];
    for (const attr of body.matchAll(/(?:d|points)="([^"]*)"/g)) {
      const numbers = attr[1].match(/-?\d+(?:\.\d+)?/g) ?? [];
      expect(numbers.length % 2, `odd coordinate count in ${attr[0]}`).toBe(0);
      for (let i = 0; i < numbers.length; i += 2) {
        out.push({ x: Number(numbers[i]), y: Number(numbers[i + 1]) });
      }
    }
  }
  return out;
}

function expectInside(
  x: number,
  y: number,
  box: { x: number; y: number; width: number; height: number },
  what: string,
): void {
  expect(x, `${what} x=${x} is left of the ${MARGIN}px margin`).toBeGreaterThanOrEqual(box.x + MARGIN - EPS);
  expect(y, `${what} y=${y} is above the ${MARGIN}px margin`).toBeGreaterThanOrEqual(box.y + MARGIN - EPS);
  expect(x, `${what} x=${x} is right of the ${MARGIN}px margin`).toBeLessThanOrEqual(box.x + box.width - MARGIN + EPS);
  expect(y, `${what} y=${y} is below the ${MARGIN}px margin`).toBeLessThanOrEqual(box.y + box.height - MARGIN + EPS);
}

describe('gap-render-viewbox-includes-edge-routes', () => {
  it('keeps every edge route point and edge label inside the viewBox with a >=16px margin', async () => {
    const { model, layout, svg } = await renderFocus();
    const box = viewBoxOf(svg);

    // The returned layout is the geometry the SVG draws (stable contract), and
    // its extent is the viewBox extent.
    expect(layout.width).toBeCloseTo(box.width, 1);
    expect(layout.height).toBeCloseTo(box.height, 1);

    // Every routed point, taken from the layout the SVG was drawn from.
    expect(layout.edges.length).toBeGreaterThan(0);
    for (const edge of layout.edges) {
      for (const point of edge.points) {
        expectInside(point.x, point.y, box, `edge ${edge.id} route point`);
      }
    }

    // Every placed edge label box (plain "uses"/"returns" and any xN weight).
    const labels = placeEdgeLabels(model, layout);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expectInside(label.rect.x, label.rect.y, box, `${label.kind} label ${JSON.stringify(label.text)} (top-left)`);
      expectInside(
        label.rect.x + label.rect.width,
        label.rect.y + label.rect.height,
        box,
        `${label.kind} label ${JSON.stringify(label.text)} (bottom-right)`,
      );
    }

    // And the coordinates actually emitted into the edge groups of the SVG.
    const drawn = edgeCoordinates(svg);
    expect(drawn.length).toBeGreaterThan(0);
    for (const point of drawn) expectInside(point.x, point.y, box, 'drawn edge coordinate');
  });

  it('renders the previously clipped "uses" / "returns" labels fully inside the canvas', async () => {
    const { svg } = await renderFocus();
    const box = viewBoxOf(svg);
    expect(svg).toContain('>uses</text>');
    expect(svg).toContain('>returns</text>');
    // No emitted edge coordinate is negative: the outer detours no longer run
    // past the canvas origin.
    for (const point of edgeCoordinates(svg)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(box.width);
      expect(point.y).toBeLessThanOrEqual(box.height);
    }
  });

  it('is byte-identical across two renders of the same input', async () => {
    const a = await renderFocus();
    const b = await renderFocus();
    expect(a.svg).toBe(b.svg);
  });
});
