import { describe, expect, it } from 'vitest';
import { renderDetailed, parsePlantUml } from '../src/core.js';
import { computeLayoutMetrics } from '../src/layout/layout-metrics.js';

/** `count` top-level packages of varied size; only every fourth pair is linked. */
function weaklyConnectedPackages(count: number): string {
  const lines = ['@startuml'];
  for (let p = 0; p < count; p++) {
    lines.push(`package "Pkg${p}" as Pkg${p} {`);
    const size = 2 + (p * 5) % 7;
    for (let c = 0; c < size; c++) lines.push(`  class P${p}C${c}`);
    for (let c = 1; c < size; c++) lines.push(`  P${p}C0 --> P${p}C${c}`);
    lines.push('}');
  }
  for (let p = 0; p + 1 < count; p += 4) lines.push(`P${p}C0 --> P${p + 1}C0`);
  lines.push('@enduml');
  return lines.join('\n');
}

describe('root-level block packing at mid scale', () => {
  it('packs 12 weakly connected top-level packages into a balanced canvas', async () => {
    const { model, layout } = await renderDetailed(parsePlantUml(weaklyConnectedPackages(12)));
    const m = computeLayoutMetrics(model, layout);
    expect(m.aspectRatio).toBeGreaterThanOrEqual(0.6);
    expect(m.aspectRatio).toBeLessThanOrEqual(2.5);
    expect(m.maxEmptyBlockRatio).toBeLessThanOrEqual(0.15);
  }, 60_000);

  it('packs 12 fully disconnected top-level packages into a balanced canvas', async () => {
    const puml = weaklyConnectedPackages(12).replace(/^P\d+C0 --> P\d+C0$/gm, '');
    const { model, layout } = await renderDetailed(parsePlantUml(puml));
    const m = computeLayoutMetrics(model, layout);
    expect(m.aspectRatio).toBeGreaterThanOrEqual(0.6);
    expect(m.aspectRatio).toBeLessThanOrEqual(2.5);
    expect(m.maxEmptyBlockRatio).toBeLessThanOrEqual(0.15);
  }, 60_000);
});
