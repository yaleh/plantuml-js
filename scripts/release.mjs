#!/usr/bin/env node
/**
 * release.mjs — bump, verify, tag and (optionally) push a release.
 *
 *   node scripts/release.mjs <patch|minor|major|X.Y.Z> [--push]
 *
 *   - runs `typecheck` + `test`
 *   - bumps package.json + package-lock.json (no git tag, so we craft both)
 *   - commits `release: vX.Y.Z` and tags `vX.Y.Z`
 *   - `--push` pushes the commit and tag to `origin`; the tag triggers the CI
 *     publish workflow (`.github/workflows/publish.yml`)
 *
 * Refuses to run on a dirty tree (a release must start clean) and never commits
 * on `develop` — releases land on `author` (quay syncs author↔develop).
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function out(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
}

const args = process.argv.slice(2);
const bump = args.find((a) => !a.startsWith('--'));
const push = args.includes('--push');

if (!bump) {
  console.error('usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--push]');
  process.exit(1);
}

const branch = out('git branch --show-current');
if (branch === 'develop') {
  console.error(
    'refusing to release from "develop" — release on "author" (quay syncs author↔develop)',
  );
  process.exit(1);
}
if (branch !== 'author') {
  console.warn(`note: releasing from branch "${branch}" (not "author")`);
}

const dirty = out('git status --porcelain');
if (dirty !== '') {
  console.error('working tree is not clean — commit or stash first:\n' + dirty);
  process.exit(1);
}

run('npm run typecheck');
run('npm test');

// Bump without tagging; we create the commit + tag below so the message carries
// the attribution line and the tag is annotated.
execSync(`npm version ${bump} --no-git-tag-version`, { cwd: root, stdio: 'inherit' });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

run('git add package.json package-lock.json');
run(`git commit -m "release: v${version}" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"`);
run(`git tag -a v${version} -m "v${version}"`);

if (push) {
  const remotes = out('git remote');
  if (remotes === '') {
    console.error('--push given but no git remote is configured; add a remote first.');
    process.exit(1);
  }
  run(`git push origin ${branch}`);
  run(`git push origin v${version}`);
  console.log(`pushed v${version} — the tag should trigger the CI publish workflow.`);
} else {
  console.log(`tagged v${version} locally. To publish: git push origin ${branch} v${version}`);
}
