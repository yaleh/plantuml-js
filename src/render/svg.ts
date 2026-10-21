/**
 * SVG renderer — turns a laid-out PlantUmlModel into a standalone SVG string.
 * The renderer consumes only the LayoutResult (positions/sizes) plus the
 * model's display fields; it never reaches back into the parser.
 */

import {
  PlantUmlModel,
  PlantUmlEntity,
  PlantUmlPackage,
  PlantUmlRelation,
} from '../model.js';
import {
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  PackageLayout,
  Point,
  METRICS,
  PACKAGE_LABEL,
  displayName,
} from '../layout.js';
import { measureTextWidth } from '../text-measure.js';

const STROKE = '#333333';

const TRIANGLE_SIZE = 10;
const CHEVRON_SIZE = 9;
const DIAMOND_SIZE = 13;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a coordinate deterministically: 2dp, never `-0`, no exponent. */
function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function renderSvg(model: PlantUmlModel, layout: LayoutResult): string {
  const nodesById = new Map(layout.nodes.map((n) => [n.id, n]));
  const packagesById = new Map((layout.packages ?? []).map((p) => [p.id, p]));
  const edgesById = new Map((layout.edges ?? []).map((e) => [e.id, e]));

  const body: string[] = [];

  for (const pkg of model.packages) {
    const box = packagesById.get(pkg.id);
    if (box) body.push(renderPackage(pkg, box));
  }

  for (let i = 0; i < model.relations.length; i++) {
    const edge = edgesById.get(`rel-${i}`);
    if (edge) body.push(renderEdge(model.relations[i], edge));
  }

  for (const entity of model.entities) {
    const node = nodesById.get(entity.id);
    if (node) body.push(renderEntity(entity, node));
  }

  const width = layout.width;
  const height = layout.height;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}"` +
    ` viewBox="0 0 ${fmt(width)} ${fmt(height)}">${body.join('')}</svg>`
  );
}

function renderEntity(entity: PlantUmlEntity, node: NodeLayout): string {
  const italic = entity.kind === 'interface' || entity.kind === 'abstract';
  const fontStyle = italic ? ' font-style="italic"' : '';
  const stub = entity.stub === true;

  const parts: string[] = [];
  const fill = stub ? '#f6f8fa' : '#ffffff';
  const stubAttrs = stub ? ` class="uml-stub" stroke-dasharray="5,3"` : '';
  parts.push(
    `<rect x="${fmt(node.x)}" y="${fmt(node.y)}" width="${fmt(node.width)}"` +
      ` height="${fmt(node.height)}" rx="2" ry="2" fill="${fill}"` +
      `${stubAttrs} stroke="${STROKE}" stroke-width="1.5"/>`,
  );

  const titleBaseline = node.y + METRICS.paddingY + METRICS.fontSize - 2;
  parts.push(
    `<line x1="${fmt(node.x)}" y1="${fmt(node.y + METRICS.paddingY + METRICS.lineHeight)}"` +
      ` x2="${fmt(node.x + node.width)}" y2="${fmt(node.y + METRICS.paddingY + METRICS.lineHeight)}"` +
      ` stroke="${STROKE}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${fmt(node.x + node.width / 2)}" y="${fmt(titleBaseline)}"` +
      ` text-anchor="middle" font-family="${METRICS.fontFamily}" font-size="${METRICS.fontSize}"` +
      `${fontStyle} fill="#000000">${escapeXml(displayName(entity))}</text>`,
  );

  entity.members.forEach((member, i) => {
    const baseline =
      node.y + METRICS.paddingY + METRICS.lineHeight * (i + 1) + METRICS.fontSize - 2;
    parts.push(
      `<text x="${fmt(node.x + METRICS.paddingX)}" y="${fmt(baseline)}"` +
        ` text-anchor="start" font-family="${METRICS.fontFamily}" font-size="${METRICS.fontSize}"` +
        ` fill="#000000">${escapeXml(member.raw)}</text>`,
    );
  });

  if (entity.usageCount && entity.usageCount > 0) {
    parts.push(renderHubBadge(node, entity.usageCount));
  }

  return parts.join('');
}

/**
 * Hub badge — the "used by N packages" marker drawn at the top-right corner of
 * a node whose incoming edges were summarized away (see [[../transform]]).
 */
function renderHubBadge(node: NodeLayout, count: number): string {
  const cx = node.x + node.width - 12;
  const cy = node.y + 13;
  return (
    `<g class="uml-hub-badge">` +
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="9" fill="#c0392b"/>` +
    `<text x="${fmt(cx)}" y="${fmt(cy + 3.5)}" text-anchor="middle"` +
    ` font-family="${METRICS.fontFamily}" font-size="11" fill="#ffffff">${count}</text>` +
    `</g>`
  );
}

function renderPackage(pkg: PlantUmlPackage, box: PackageLayout): string {
  const tabWidth = Math.min(
    box.width,
    Math.max(
      24,
      measureTextWidth(pkg.name, PACKAGE_LABEL.fontSize) + PACKAGE_LABEL.tabPadding,
    ),
  );
  const parts: string[] = [];
  parts.push(
    `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.width)}"` +
      ` height="${fmt(box.height)}" fill="none" stroke="${STROKE}" stroke-width="1.5"/>`,
  );
  parts.push(
    `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(tabWidth)}"` +
      ` height="${PACKAGE_LABEL.tabHeight}" fill="#ffffff" stroke="${STROKE}" stroke-width="1.5"/>`,
  );
  parts.push(
    `<text x="${fmt(box.x + 6)}" y="${fmt(box.y + 13)}" text-anchor="start"` +
      ` font-family="${METRICS.fontFamily}" font-size="${PACKAGE_LABEL.fontSize}" fill="#000000">${escapeXml(pkg.name)}</text>`,
  );
  return parts.join('');
}

function renderEdge(rel: PlantUmlRelation, edge: EdgeLayout): string {
  if (edge.points.length < 2) return '';
  const points = edge.points;
  const dashed = rel.type === 'implementation' || rel.type === 'dependency';
  const color = rel.feedback ? '#c0392b' : STROKE;

  const sourceTrim =
    rel.type === 'aggregation' || rel.type === 'composition' ? DIAMOND_SIZE : 0;
  const targetTrim =
    rel.type === 'inheritance' || rel.type === 'implementation'
      ? TRIANGLE_SIZE
      : rel.type === 'dependency' || rel.type === 'association'
        ? CHEVRON_SIZE
        : 0;

  const linePoints = trimPolyline(points, sourceTrim, targetTrim);
  const parts: string[] = [];

  // Weight encodes the number of aggregated original edges: a thicker line,
  // plus a `×N` label when more than one relation collapsed into this edge.
  const weight = rel.weight && rel.weight > 1 ? rel.weight : 1;
  const strokeWidth = Math.min(1.2 + (weight - 1) * 0.4, 6);
  const feedbackClass = rel.feedback ? ' class="uml-feedback"' : '';

  parts.push(
    `<polyline points="${pointsAttr(linePoints)}" fill="none" stroke="${color}"` +
      ` stroke-width="${fmt(strokeWidth)}"${dashed ? ' stroke-dasharray="6,4"' : ''}${feedbackClass}/>`,
  );

  if (rel.type === 'aggregation' || rel.type === 'composition') {
    parts.push(renderDiamond(points, rel.type === 'composition', color));
  }
  if (rel.type === 'inheritance' || rel.type === 'implementation') {
    parts.push(renderTriangle(points, rel.type, color));
  }
  if (rel.type === 'dependency' || rel.type === 'association') {
    parts.push(renderChevron(points, rel.type, color));
  }

  parts.push(...renderEdgeTexts(rel, points, color));
  if (weight > 1) {
    const mid = points[Math.floor(points.length / 2)];
    parts.push(textAt(`×${weight}`, mid.x, mid.y - (rel.label ? 20 : 10), 11, color));
  }
  return parts.join('');
}

function renderTriangle(points: Point[], type: PlantUmlRelation['type'], color = STROKE): string {
  const { u, tip } = targetDir(points);
  const base = { x: tip.x - u.x * TRIANGLE_SIZE, y: tip.y - u.y * TRIANGLE_SIZE };
  const px = -u.y;
  const py = u.x;
  const half = TRIANGLE_SIZE / 2;
  const pts: Point[] = [
    tip,
    { x: base.x + px * half, y: base.y + py * half },
    { x: base.x - px * half, y: base.y - py * half },
  ];
  return (
    `<polygon class="uml-arrow uml-arrow-${type}" points="${pointsAttr(pts)}"` +
    ` fill="none" stroke="${color}" stroke-width="1.2"/>`
  );
}

function renderChevron(points: Point[], type: PlantUmlRelation['type'], color = STROKE): string {
  const { u, tip } = targetDir(points);
  const back = { x: tip.x - u.x * CHEVRON_SIZE, y: tip.y - u.y * CHEVRON_SIZE };
  const px = -u.y;
  const py = u.x;
  const half = CHEVRON_SIZE / 2;
  const pts: Point[] = [
    { x: back.x + px * half, y: back.y + py * half },
    tip,
    { x: back.x - px * half, y: back.y - py * half },
  ];
  return (
    `<polyline class="uml-arrow uml-arrow-${type}" points="${pointsAttr(pts)}"` +
    ` fill="none" stroke="${color}" stroke-width="1.2"/>`
  );
}

function renderDiamond(points: Point[], filled: boolean, color = STROKE): string {
  const { u, tip } = sourceDir(points);
  const px = -u.y;
  const py = u.x;
  const half = DIAMOND_SIZE / 2;
  const mid = { x: tip.x + u.x * half, y: tip.y + u.y * half };
  const pts: Point[] = [
    tip,
    { x: mid.x + px * half, y: mid.y + py * half },
    { x: tip.x + u.x * DIAMOND_SIZE, y: tip.y + u.y * DIAMOND_SIZE },
    { x: mid.x - px * half, y: mid.y - py * half },
  ];
  return (
    `<polygon class="uml-arrow uml-arrow-${filled ? 'composition' : 'aggregation'}"` +
    ` points="${pointsAttr(pts)}" fill="${filled ? color : 'none'}"` +
    ` stroke="${color}" stroke-width="1.2"/>`
  );
}

function renderEdgeTexts(rel: PlantUmlRelation, points: Point[], color = '#000000'): string[] {
  const parts: string[] = [];
  if (rel.sourceCardinality) {
    parts.push(textAt(rel.sourceCardinality, points[0].x, points[0].y - 7, 11, color));
  }
  if (rel.targetCardinality) {
    const last = points[points.length - 1];
    parts.push(textAt(rel.targetCardinality, last.x, last.y - 7, 11, color));
  }
  if (rel.label) {
    const mid = points[Math.floor(points.length / 2)];
    parts.push(textAt(rel.label, mid.x, mid.y - 10, 12, color));
  }
  return parts;
}

function textAt(text: string, x: number, y: number, size: number, color = '#000000'): string {
  return (
    `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="middle"` +
    ` font-family="${METRICS.fontFamily}" font-size="${size}" fill="${color}">${escapeXml(text)}</text>`
  );
}

function pointsAttr(points: Point[]): string {
  return points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

function trimPolyline(
  points: Point[],
  sourceTrim: number,
  targetTrim: number,
): Point[] {
  const out = points.map((p) => ({ ...p }));
  if (sourceTrim > 0 && out.length >= 2) {
    const a = out[0];
    const b = out[1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const t = Math.min(sourceTrim, len) / len;
      out[0] = { x: a.x + dx * t, y: a.y + dy * t };
    }
  }
  if (targetTrim > 0 && out.length >= 2) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const t = Math.min(targetTrim, len) / len;
      out[out.length - 1] = { x: b.x - dx * t, y: b.y - dy * t };
    }
  }
  return out;
}

function targetDir(points: Point[]): { u: Point; tip: Point } {
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = tip.x - prev.x;
  const dy = tip.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { u: { x: dx / len, y: dy / len }, tip };
}

function sourceDir(points: Point[]): { u: Point; tip: Point } {
  const tip = points[0];
  const next = points[1];
  const dx = next.x - tip.x;
  const dy = next.y - tip.y;
  const len = Math.hypot(dx, dy) || 1;
  return { u: { x: dx / len, y: dy / len }, tip };
}
