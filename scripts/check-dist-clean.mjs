#!/usr/bin/env node
/** Asserts every dist/**\/*.js has a matching src/**\/*.ts source (no orphan build output). */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

export function findOrphans(distDir = join(root, 'dist'), srcDir = join(root, 'src')) {
  if (!existsSync(distDir)) return [];
  return walk(distDir)
    .map((f) => relative(distDir, f))
    .filter((rel) => !existsSync(join(srcDir, rel.replace(/\.js$/, '.ts'))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const orphans = findOrphans();
  if (orphans.length) {
    console.error(`orphan dist files without src source:\n${orphans.map((o) => `  ${o}`).join('\n')}`);
    process.exit(1);
  }
  console.log('dist is clean');
}
