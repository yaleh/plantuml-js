import { describe, it, expect, vi } from 'vitest';
import {
  createRenderer,
  renderSvg,
  parsePlantUml,
  SvgRenderer,
  RenderEngine,
} from '../src/index.js';
import { LayoutEngine, LayoutResult } from '../src/foundation/layout.js';
import { PlantUmlModel } from '../src/foundation/model.js';

/**
 * Deterministic layout stub: the point of these tests is the render engine, so
 * the geometry must not depend on ELK.
 */
const fixedLayout: LayoutEngine = {
  async layout(_model: PlantUmlModel): Promise<LayoutResult> {
    return {
      nodes: [{ id: 'A', x: 5, y: 7, width: 40, height: 30 }],
      edges: [],
      width: 40,
      height: 30,
    };
  },
};

const SYNTHETIC_SVG = '<svg data-render-engine="synthetic"></svg>';

describe('RenderEngine injection', () => {
  it('uses the injected renderer and hands it the model and layout', async () => {
    const seen: { model: PlantUmlModel; layout: LayoutResult; frame: unknown }[] = [];
    const synthetic: RenderEngine = {
      render(model, layout, frame) {
        seen.push({ model, layout, frame });
        return SYNTHETIC_SVG;
      },
    };
    const renderer = createRenderer({ layout: fixedLayout, renderer: synthetic });

    const { svg } = await renderer.render('@startuml\nclass A\n@enduml');

    expect(svg).toBe(SYNTHETIC_SVG);
    expect(seen).toHaveLength(1);
    expect(seen[0].model.entities.map((e) => e.id)).toEqual(['A']);
    expect(seen[0].layout.nodes.map((n) => n.id)).toEqual(['A']);
  });

  it('passes the per-frame hiddenTransitive value as a render argument', async () => {
    const render = vi.fn(() => SYNTHETIC_SVG);
    const renderer = createRenderer({
      layout: fixedLayout,
      renderer: { render },
      edgeReduction: 'transitive',
    });

    await renderer.render(
      '@startuml\nclass A\nclass B\nclass C\nA --> B\nB --> C\nA --> C\n@enduml',
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      hiddenTransitive: 1,
    });
  });

  it('does not swallow an error thrown by the injected renderer', async () => {
    const boom = new Error('render engine exploded');
    const renderer = createRenderer({
      layout: fixedLayout,
      renderer: {
        render() {
          throw boom;
        },
      },
    });

    await expect(renderer.render('@startuml\nclass A\n@enduml')).rejects.toBe(boom);
  });

  it('fails closed on an object that is not a RenderEngine', () => {
    expect(() => createRenderer({ renderer: { render: 42 } as never })).toThrow(
      /RenderEngine/,
    );
  });
});

describe('SvgRenderer', () => {
  it('takes static config (theme, legend) as constructor properties', async () => {
    const model = parsePlantUml('@startuml\nclass A\n@enduml');
    const layout = await fixedLayout.layout(model);

    expect(new SvgRenderer({ legend: false }).render(model, layout, { hiddenTransitive: 3 }))
      .not.toContain('uml-legend');
    expect(new SvgRenderer({ legend: true }).render(model, layout)).toContain('uml-legend');
  });

  it('produces the same SVG as the renderSvg convenience function', async () => {
    const model = parsePlantUml('@startuml\nclass A\nclass B\nA --> B\n@enduml');
    const layout = await fixedLayout.layout(model);

    expect(new SvgRenderer().render(model, layout)).toBe(renderSvg(model, layout));
    expect(new SvgRenderer({ legend: false }).render(model, layout)).toBe(
      renderSvg(model, layout, { legend: false }),
    );
  });

  it('is the default engine used by createRenderer', async () => {
    const puml = '@startuml\nclass A\n@enduml';
    const { svg } = await createRenderer({ layout: fixedLayout }).render(puml);
    const model = parsePlantUml(puml);
    const layout = await fixedLayout.layout(model);

    expect(svg).toBe(new SvgRenderer().render(model, layout));
  });
});
