import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');

describe('npm run build cleans dist', () => {
  it('removes orphan artifacts and leaves no dist file without a src source', () => {
    const ghost = join(root, 'dist', 'ghost.js');
    execSync('mkdir -p dist', { cwd: root });
    writeFileSync(ghost, '// stale\n');
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
    expect(existsSync(ghost)).toBe(false);
    execSync('node scripts/check-dist-clean.mjs', { cwd: root, stdio: 'pipe' });
  }, 120_000);
});
