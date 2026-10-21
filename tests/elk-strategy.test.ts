import { describe, it, expect } from 'vitest';
import { createRenderer } from '../src/index.js';
import type { LayoutStrategy } from '../src/layout/strategy.js';
import type { LayoutResult } from '../src/layout.js';

const puml = '@startuml\nclass A\nclass B\nA --> B\n@enduml\n';

const fixed: LayoutResult = {
  nodes: [
    { id: 'A', x: 0, y: 0, width: 120, height: 48 },
    { id: 'B', x: 0, y: 200, width: 120, height: 48 },
  ],
  edges: [],
  width: 1234,
  height: 567,
};

describe('ElkLayoutEngine strategy extension point', () => {
  it('uses an injected synthetic strategy without touching elk.ts', async () => {
    let calls = 0;
    const strategy: LayoutStrategy = {
      name: 'synthetic',
      async layout() {
        calls++;
        return fixed;
      },
    };
    const r = createRenderer({ layout: 'elk', layoutOptions: { strategies: [strategy] } });
    const { svg } = await r.render(puml);
    expect(calls).toBeGreaterThan(0);
    expect(svg).toContain('1234');
    expect(svg).toContain('567');
  });

  it('a declining strategy falls through to the built-in layout', async () => {
    const strategy: LayoutStrategy = { name: 'decline', layout: async () => undefined };
    const r = createRenderer({ layout: 'elk', layoutOptions: { strategies: [strategy] } });
    const { svg } = await r.render(puml);
    expect(svg).not.toContain('1234');
    expect(svg).toContain('<svg');
  });

  it('a throwing strategy is not silently ignored', async () => {
    const strategy: LayoutStrategy = {
      name: 'boom',
      async layout() {
        throw new Error('strategy boom failed');
      },
    };
    const r = createRenderer({ layout: 'elk', layoutOptions: { strategies: [strategy] } });
    await expect(r.render(puml)).rejects.toThrow('strategy boom failed');
  });
});
