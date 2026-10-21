import { describe, it, expect } from 'vitest';
import { parsePlantUml, ElkLayoutEngine, renderSvg } from '../src/index.js';
import { computeLayoutMetrics } from '../src/layout/layout-metrics.js';

const targets = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const puml = `@startuml
class Hub
package Sink {
${targets.map((t) => `  class ${t}`).join('\n')}
}
${targets.map((t) => `Hub --> ${t} : uses`).join('\n')}
@enduml`;

describe('same-bundle label dedupe', () => {
  it('shows a repeated label on at most two edges and keeps the rest as tooltips', async () => {
    const model = parsePlantUml(puml);
    const layout = await new ElkLayoutEngine().layout(model);
    const svg = renderSvg(model, layout);

    const visible = svg.match(/<text [^>]*>uses[^<]*<\/text>/g) ?? [];
    expect(visible.length).toBeGreaterThanOrEqual(1);
    expect(visible.length).toBeLessThanOrEqual(2);

    const titled = svg.match(/<title>uses<\/title>/g) ?? [];
    expect(titled.length).toBe(targets.length - visible.length);

    const m = computeLayoutMetrics(model, layout);
    expect(m.labelLabelOverlap).toBe(0);
  });

  it('shows a count on the representative when the bundle is large', async () => {
    const model = parsePlantUml(puml);
    const layout = await new ElkLayoutEngine().layout(model);
    expect(renderSvg(model, layout)).toContain(`>uses ×${targets.length}</text>`);
  });
});
