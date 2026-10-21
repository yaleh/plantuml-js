import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations
import { measureSvgTextOverflow } from '../scripts/measure-svg-text.mjs';

function hasChrome(): boolean {
  for (const c of [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    if (!c) continue;
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      // next
    }
  }
  return false;
}

describe('measureSvgTextOverflow', () => {
  it.skipIf(!hasChrome())('does not hit ENOBUFS on an SVG far larger than 1 MB', async () => {
    const rows: string[] = [];
    for (let i = 0; i < 14000; i++) {
      const x = (i % 100) * 140;
      const y = Math.floor(i / 100) * 60;
      rows.push(
        `<rect x="${x}" y="${y}" width="130" height="40" rx="4"/>` +
          `<text x="${x + 10}" y="${y + 20}">E${i}</text>`,
      );
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14568" height="7200">${rows.join('')}</svg>`;
    expect(svg.length).toBeGreaterThan(1_000_000);
    const dir = mkdtempSync(join(tmpdir(), 'measure-test-'));
    const path = join(dir, 'big.svg');
    writeFileSync(path, svg);
    try {
      const n = await measureSvgTextOverflow(path);
      expect(typeof n).toBe('number');
      expect(n).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
