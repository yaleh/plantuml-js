/**
 * LayoutEngine — the pluggable layout contract. A LayoutEngine is a pure
 * function from PlantUmlModel to concrete positions; the parser never talks
 * to a layout engine and the renderer never talks to the parser, so swapping
 * engines (elkjs, @viz-js/viz, a custom tuner) is an injection, not a rewrite.
 */

import { PlantUmlModel, PlantUmlEntity } from './model.js';

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

export interface LayoutResult {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  width: number;
  height: number;
}

export interface LayoutEngine {
  layout(model: PlantUmlModel): Promise<LayoutResult>;
}

// Naive monospace estimate used until M2 lands real font metrics (opentype.js
// or a width table). Every engine shares this so an entity is sized once.
const CHAR_WIDTH = 8;
const LINE_HEIGHT = 18;
const PADDING = 8;
const MIN_WIDTH = 60;

export function estimateEntitySize(
  entity: PlantUmlEntity,
): { width: number; height: number } {
  const lines = [entity.name, ...entity.members.map((m) => m.name)];
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = Math.max(MIN_WIDTH, longest * CHAR_WIDTH + PADDING * 2);
  const height = lines.length * LINE_HEIGHT + PADDING * 2;
  return { width, height };
}
