import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('render-samples harness imports', () => {
  it('does not import layout-metrics by dist file path', () => {
    const src = readFileSync(join(__dirname, '..', 'scripts', 'render-samples.mjs'), 'utf8');
    expect(src).not.toMatch(/dist['"`,\s)]*[^\n]*layout-metrics/);
    expect(src).toMatch(/computeLayoutMetrics/);
  });
});
