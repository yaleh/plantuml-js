#!/usr/bin/env node
/**
 * build-demo.mjs — regenerate the demo's generated artifacts.
 *
 *   node scripts/build-demo.mjs [path/to/neighborhood.json]
 *
 * Writes `examples/archguard-data.js` (`window.ARCHGUARD_DATA`) from the given
 * ArchGuard neighbourhood JSON (default `/tmp/archguard-neighborhood.json`),
 * then bundles `examples/demo.ts` → `examples/demo.bundle.js` with esbuild.
 * The bare `elkjs` import is aliased to its browser (main-thread) build so the
 * bundle works from `file://` without a worker file.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = process.argv[2] ?? '/tmp/archguard-neighborhood.json';

const graph = JSON.parse(readFileSync(jsonPath, 'utf8'));
writeFileSync(
  join(root, 'examples', 'archguard-data.js'),
  'window.ARCHGUARD_DATA = ' + JSON.stringify(graph) + ';\n',
);

execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [
    'examples/demo.ts',
    '--bundle',
    '--format=iife',
    '--platform=browser',
    '--alias:elkjs=elkjs/lib/elk.bundled.js',
    '--outfile=examples/demo.bundle.js',
  ],
  { cwd: root, stdio: 'inherit' },
);

console.log('built examples/archguard-data.js + examples/demo.bundle.js');
