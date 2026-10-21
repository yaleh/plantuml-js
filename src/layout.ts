/**
 * LayoutEngine — the pluggable layout contract. A LayoutEngine is a pure
 * function from PlantUmlModel to concrete positions; the parser never talks
 * to a layout engine and the renderer never talks to the parser, so swapping
 * engines (elkjs, @viz-js/viz, a custom tuner) is an injection, not a rewrite.
 */

import { PlantUmlModel, PlantUmlEntity } from './model.js';
import { measureTextWidth } from './text-measure.js';

export interface Point {
  x: number;
  y: number;
}

export interface NodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeLayout {
  id: string;
  source: string;
  target: string;
  points: Point[];
}

export interface PackageLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  /** Package frames; engines without container support may omit this. */
  packages?: PackageLayout[];
  width: number;
  height: number;
}

export interface LayoutEngine {
  layout(model: PlantUmlModel): Promise<LayoutResult>;
}

/**
 * Shared drawing metrics. The renderer reads these so entity sizing and the
 * emitted SVG stay in lockstep (M2 replaces M1's naive CHAR_WIDTH estimate
 * with real per-glyph measurement from [[../text-measure]]).
 */
export const METRICS = {
  fontSize: 13,
  lineHeight: 18,
  paddingX: 10,
  paddingY: 8,
  minWidth: 60,
} as const;

/** Reconstruct the name drawn in the title compartment, generics expanded. */
export function displayName(entity: PlantUmlEntity): string {
  const generics = entity.generics;
  if (!generics || generics.length === 0) return entity.name;
  return `${entity.name}<${generics.join(', ')}>`;
}

/**
 * Approximate the on-canvas size of an entity box. The title plus every member
 * line contributes one row; the width is the longest rendered line measured
 * through the text table plus padding, never below MIN_WIDTH.
 */
export function estimateEntitySize(
  entity: PlantUmlEntity,
): { width: number; height: number } {
  const lines = [
    displayName(entity),
    ...entity.members.map((m) => m.raw),
  ];
  const longest = lines.reduce(
    (max, line) => Math.max(max, measureTextWidth(line, METRICS.fontSize)),
    0,
  );
  const width = Math.max(METRICS.minWidth, longest + METRICS.paddingX * 2);
  const height = lines.length * METRICS.lineHeight + METRICS.paddingY * 2;
  return { width, height };
}
