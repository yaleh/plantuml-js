#!/usr/bin/env node
/**
 * gen-class-ladder.mjs — deterministic synthetic class diagrams for the layout
 * scale ladder (10 → 400 entities).
 *
 *   node scripts/gen-class-ladder.mjs --entities 50 --seed 1 [--out file.puml]
 *
 * `generateLadder({ entities, seed })` returns the .puml text: 2–12 packages
 * (some nested), a Tests and an Examples layer of isolated small nodes, member
 * rows, all five relation kinds (inheritance, implementation, composition,
 * association, dependency) and a few isolated nodes. Same seed + entity count →
 * byte-identical output (mulberry32 PRNG, no clocks, no Math.random).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PACKAGE_NAMES = ['Core', 'Model', 'Parser', 'Render', 'Layout', 'Service', 'Plugin', 'Storage', 'Net', 'Util'];
const VISIBILITY = ['+', '-', '#'];
const TYPES = ['string', 'number', 'boolean', 'Item', 'Map<string, Item>'];

/** Number of top-level packages for an entity count: 2 (tiny) … 12 (large). */
export function packageCountFor(entities) {
  return Math.max(2, Math.min(12, Math.round(Math.sqrt(entities) / 1.6) + 1));
}

export function generateLadder({ entities, seed = 1 }) {
  if (!Number.isInteger(entities) || entities < 4) throw new Error('entities must be an integer >= 4');
  const rnd = mulberry32(seed * 7919 + entities);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  // Reserve isolated small layers (Tests / Examples) and a few isolated nodes.
  const isolatedLayer = entities >= 25 ? Math.max(2, Math.round(entities * 0.06)) : 0;
  const loose = entities >= 10 ? 1 + Math.floor(entities / 100) : 0;
  const main = entities - 2 * isolatedLayer - loose;
  const pkgCount = Math.min(packageCountFor(entities), Math.max(2, main));

  // Package skeleton: top-level layers; every third gets one nested sub-package.
  const packages = [];
  for (let i = 0; i < pkgCount; i++) {
    const name = `${PACKAGE_NAMES[i % PACKAGE_NAMES.length]}${i >= PACKAGE_NAMES.length ? i : ''} Layer`;
    packages.push({ id: `P${i}`, name, parent: null, slots: [] });
  }
  const nested = [];
  for (let i = 0; i < pkgCount; i += 3) {
    const sub = { id: `P${i}_sub`, name: `${packages[i].name.replace(' Layer', '')} Internals`, parent: `P${i}`, slots: [] };
    nested.push(sub);
  }
  const homes = [...packages, ...nested];

  // Distribute `main` entities over homes (top-level layers weigh double).
  const weighted = [...packages, ...packages, ...nested];
  const ents = [];
  for (let i = 0; i < main; i++) {
    const home = weighted[i < weighted.length ? i % weighted.length : Math.floor(rnd() * weighted.length)];
    const roll = rnd();
    const kind = roll < 0.12 ? 'interface' : roll < 0.2 ? 'abstract class' : roll < 0.25 ? 'enum' : 'class';
    ents.push({ id: `E${i}`, name: `${home.id.replace(/_sub$/, 'S')}Type${i}`, kind, home, order: i });
    home.slots.push(ents[ents.length - 1]);
  }

  const lines = ['@startuml', `title Synthetic ladder: ${entities} entities, seed ${seed}`];

  const memberLines = (e) => {
    if (e.kind === 'enum') return Array.from({ length: int(2, 4) }, (_, k) => `    VALUE_${k}`);
    const n = int(1, 5);
    return Array.from({ length: n }, (_, k) =>
      rnd() < 0.55
        ? `    ${pick(VISIBILITY)}${pick(['id', 'name', 'items', 'state', 'count'])}${k}: ${pick(TYPES)}`
        : `    ${pick(VISIBILITY)}${pick(['run', 'load', 'apply', 'build', 'visit'])}${k}(${pick(['', 'x: number', 'item: Item'])}): ${pick(['void', 'string', 'boolean'])}`,
    );
  };
  const declare = (e, indent) => {
    lines.push(`${indent}${e.kind} ${e.name} as ${e.id} {`);
    for (const m of memberLines(e)) lines.push(`${indent}${m}`);
    lines.push(`${indent}}`);
  };

  for (const top of packages) {
    lines.push(`package "${top.name}" as ${top.id} {`);
    for (const e of top.slots) declare(e, '  ');
    for (const sub of nested.filter((n) => n.parent === top.id)) {
      lines.push(`  package "${sub.name}" as ${sub.id} {`);
      for (const e of sub.slots) declare(e, '    ');
      lines.push('  }');
    }
    lines.push('}');
  }

  // Isolated small layers with no outgoing structure of their own.
  const smallLayer = (id, label, prefix) => {
    if (isolatedLayer === 0) return [];
    const out = [];
    lines.push(`package "${label} Layer" as ${id} {`);
    for (let i = 0; i < isolatedLayer; i++) {
      const e = { id: `${prefix}${i}`, name: `${label}Case${i}`, kind: 'class' };
      lines.push(`  class ${e.name} as ${e.id} {`, `    +run(): void`, '  }');
      out.push(e);
    }
    lines.push('}');
    return out;
  };
  const tests = smallLayer('PT', 'Tests', 'T');
  const examples = smallLayer('PX', 'Examples', 'X');
  const stray = [];
  for (let i = 0; i < loose; i++) {
    lines.push(`class Stray${i} as S${i}`);
    stray.push({ id: `S${i}` });
  }

  // Relations: forward-only (lower order → higher order) keeps the graph acyclic by construction.
  const seen = new Set();
  const addRel = (a, b, arrow) => {
    if (a === b || seen.has(`${a}|${b}`) || seen.has(`${b}|${a}`)) return;
    seen.add(`${a}|${b}`);
    lines.push(`${a} ${arrow} ${b}`);
  };
  const interfaces = ents.filter((e) => e.kind === 'interface');
  const classes = ents.filter((e) => e.kind === 'class' || e.kind === 'abstract class');
  const target = Math.round(main * 1.25);
  for (let k = 0; k < classes.length; k++) {
    const e = classes[k];
    const roll = rnd();
    if (k > 0 && roll < 0.3) addRel(e.id, pick(classes.slice(0, k)).id, '--|>');
    else if (interfaces.length && roll < 0.45) addRel(e.id, pick(interfaces).id, '..|>');
  }
  const arrows = ['*--', '-->', '..>', '-->', '..>', '*--'];
  let guard = 0;
  while (seen.size < target && guard++ < target * 20) {
    const i = int(0, main - 2);
    const j = Math.min(main - 1, i + 1 + Math.floor(rnd() * rnd() * Math.min(main, 40)));
    if (i === j) continue;
    const arrow = pick(arrows);
    // `*--` reads "i composes j": keep owner → part
    addRel(ents[i].id, ents[j].id, arrow);
  }
  for (const group of [tests, examples]) {
    for (const e of group) if (rnd() < 0.5 && ents.length) addRel(e.id, pick(ents).id, '..>');
  }
  lines.push('@enduml');
  void homes;
  void stray;
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? dflt : args[i + 1];
  };
  const puml = generateLadder({ entities: Number(arg('entities', 50)), seed: Number(arg('seed', 1)) });
  const out = arg('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, puml);
  } else process.stdout.write(puml);
}
