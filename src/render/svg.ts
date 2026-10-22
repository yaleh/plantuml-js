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
} from '../foundation/model.js';
import {
  LayoutResult,
  NodeLayout,
  EdgeLayout,
  PackageLayout,
  Point,
  METRICS,
  PACKAGE_LABEL,
  displayName,
} from '../foundation/layout.js';
import { measureTextWidth } from '../foundation/text-measure.js';
import { hubBadgeCircle, placeEdgeLabels, EdgeLabelPlacement, EDGE_LABEL_FONT_SIZE } from '../foundation/labels.js';
import { renderLegend, LEGEND_DEFAULT_NODE_THRESHOLD } from './legend.js';
import { Theme, ThemeOverrides, resolveTheme } from './theme.js';
import { packageLayer } from '../foundation/layers.js';
import { relationSemantics } from '../foundation/relation-semantics.js';

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

export interface RenderSvgOptions {
  /** Draw a legend of the visual encodings. Default: on for models with more than 30 entities. */
  legend?: boolean;
  /** Theme token overrides over `defaultTheme`. */
  theme?: ThemeOverrides;
  /** Edges hidden by transitive reduction; > 0 forces the legend and is reported there and in `data-hidden-transitive`. */
  hiddenTransitive?: number;
}

/**
 * Per-frame values handed to {@link RenderEngine.render}. Only values computed
 * for the frame being rendered belong here; configuration that outlives a
 * frame (theme, legend override) is constructor state of the engine.
 */
export interface RenderFrameOptions {
  /** Edges hidden by transitive reduction in this frame; > 0 forces the legend and is reported there and in `data-hidden-transitive`. */
  hiddenTransitive?: number;
}

/**
 * The rendering counterpart of `LayoutEngine`: draw an already laid-out model.
 * Synchronous because SVG assembly is synchronous, unlike layout. Inject one
 * through `RendererOptions.renderer` to swap the rendering backend.
 */
export interface RenderEngine {
  render(model: PlantUmlModel, layout: LayoutResult, frame?: RenderFrameOptions): string;
}

/** Configuration that outlives a frame — constructor state of {@link SvgRenderer}. */
export interface SvgRendererOptions {
  /** Draw a legend of the visual encodings. Default: on for models with more than 30 entities. */
  legend?: boolean;
  /** Theme token overrides over `defaultTheme`. */
  theme?: ThemeOverrides;
}

/**
 * The built-in {@link RenderEngine}: the SVG backend. Theme and legend
 * configuration are fixed at construction; the per-frame `hiddenTransitive`
 * count is passed to [[SvgRenderer.render]].
 */
export class SvgRenderer implements RenderEngine {
  private readonly legend: boolean | undefined;
  private readonly theme: ThemeOverrides | undefined;

  constructor(options: SvgRendererOptions = {}) {
    this.legend = options.legend;
    this.theme = options.theme;
  }

  render(model: PlantUmlModel, layout: LayoutResult, frame: RenderFrameOptions = {}): string {
    return drawSvg(model, layout, {
      legend: this.legend,
      theme: this.theme,
      hiddenTransitive: frame.hiddenTransitive,
    });
  }
}

/**
 * Convenience wrapper over {@link SvgRenderer}, kept for callers that build the
 * SVG directly from a model + layout (the renderer class is preferred when
 * injecting into `RendererOptions.renderer`).
 */
export function renderSvg(
  model: PlantUmlModel,
  layout: LayoutResult,
  options: RenderSvgOptions = {},
): string {
  return new SvgRenderer(options).render(model, layout, {
    hiddenTransitive: options.hiddenTransitive,
  });
}

function drawSvg(
  model: PlantUmlModel,
  layout: LayoutResult,
  options: RenderSvgOptions,
): string {
  const theme = resolveTheme(options.theme);
  const nodesById = new Map(layout.nodes.map((n) => [n.id, n]));
  const packagesById = new Map((layout.packages ?? []).map((p) => [p.id, p]));
  const edgesById = new Map((layout.edges ?? []).map((e) => [e.id, e]));

  const body: string[] = [];

  const pkgById = new Map(model.packages.map((p) => [p.id, p]));
  const layerNames: string[] = [];
  for (const pkg of model.packages) {
    const layer = packageLayer(pkg);
    if (layer !== undefined && !layerNames.includes(layer)) layerNames.push(layer);
  }
  for (const pkg of model.packages) {
    const box = packagesById.get(pkg.id);
    if (!box) continue;
    let depth = 0;
    for (let p = pkg.parentId ? pkgById.get(pkg.parentId) : undefined; p; p = p.parentId ? pkgById.get(p.parentId) : undefined) depth++;
    const layer = packageLayer(pkg);
    const tone = (layer !== undefined ? layerNames.indexOf(layer) : 0) + depth;
    body.push(renderPackage(pkg, box, theme, tone));
  }

  const weightLabels = new Map<number, EdgeLabelPlacement>();
  const plainLabels = new Map<number, EdgeLabelPlacement>();
  for (const label of placeEdgeLabels(model, layout)) {
    if (label.kind === 'weight') weightLabels.set(label.edge, label);
    else plainLabels.set(label.edge, label);
  }
  const bundles = findEdgeBundles(model, edgesById);
  const bundled = new Set<number>(bundles.flat());
  for (const group of bundles) {
    body.push(
      renderBundle(
        group.map((i) => ({ rel: model.relations[i], edge: edgesById.get(`rel-${i}`)!, weightLabel: weightLabels.get(i) })),
        theme,
      ),
    );
  }
  for (let i = 0; i < model.relations.length; i++) {
    const edge = edgesById.get(`rel-${i}`);
    if (edge && !bundled.has(i)) body.push(renderEdge(model.relations[i], edge, theme, weightLabels.get(i), plainLabels.get(i)));
  }

  for (const entity of model.entities) {
    const node = nodesById.get(entity.id);
    if (node) body.push(renderEntity(entity, node, theme));
  }

  let width = layout.width;
  let height = layout.height;
  const hidden = options.hiddenTransitive ?? 0;
  const showLegend = options.legend ?? (hidden > 0 || model.entities.length > LEGEND_DEFAULT_NODE_THRESHOLD);
  if (showLegend) {
    const legend = renderLegend(12, layout.height + 8, theme);
    body.push(legend.svg);
    width = Math.max(width, legend.width + 24);
    height = layout.height + 8 + legend.height + 12;
    if (hidden > 0) {
      const note = `${hidden} transitive ${hidden === 1 ? 'dependency' : 'dependencies'} hidden (A→B→C implies A→C); set edgeReduction: 'none' to show all`;
      body.push(
        `<g class="uml-legend-note">` +
          textEl(note, 12 + 10, height + 4, 'start', 11, 'normal', theme.color.textMember, theme) +
          `</g>`,
      );
      height += 22;
      width = Math.max(width, 12 + 10 + 7 * note.length * 0.9 + 12);
    }
  }
  const hiddenAttr = hidden > 0 ? ` data-hidden-transitive="${hidden}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}"${hiddenAttr}` +
    ` viewBox="0 0 ${fmt(width)} ${fmt(height)}">` +
    `<rect class="uml-canvas" x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="${theme.color.canvas}"/>` +
    `${body.join('')}</svg>`
  );
}

function textEl(
  text: string,
  x: number,
  y: number,
  anchor: 'start' | 'middle',
  size: number,
  weight: string,
  fill: string,
  theme: Theme,
  extra = '',
): string {
  const w = weight === 'normal' ? '' : ` font-weight="${weight}"`;
  return (
    `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}"` +
    ` font-family="${theme.font.family}" font-size="${size}"${w}${extra}` +
    ` fill="${fill}">${escapeXml(text)}</text>`
  );
}

function renderEntity(entity: PlantUmlEntity, node: NodeLayout, theme: Theme): string {
  const italic = entity.kind === 'interface' || entity.kind === 'abstract';
  const fontStyle = italic ? ' font-style="italic"' : '';
  const stub = entity.stub === true;
  const { color, font } = theme;

  const parts: string[] = [];
  if (entity.groupMembers) parts.push(`<title>${entity.groupMembers.map(escapeXml).join('\n')}</title>`);
  const weak = stub || entity.external === true;
  const stubAttrs = weak
    ? ` class="${stub ? 'uml-stub' : 'uml-external'}" stroke-dasharray="${theme.dash.stub}"`
    : '';
  parts.push(
    `<rect x="${fmt(node.x)}" y="${fmt(node.y)}" width="${fmt(node.width)}"` +
      ` height="${fmt(node.height)}" rx="${theme.shape.nodeRadius}" ry="${theme.shape.nodeRadius}"` +
      ` fill="${weak ? color.stubFill : color.nodeFill}"` +
      `${stubAttrs} stroke="${weak ? color.strokeStub : color.stroke}" stroke-width="${theme.stroke.node}"/>`,
  );

  const headerBottom = node.y + METRICS.paddingY + METRICS.lineHeight;
  const titleBaseline = node.y + METRICS.paddingY + METRICS.fontSize + 1;
  if (entity.members.length > 0) {
    parts.push(
      `<line x1="${fmt(node.x)}" y1="${fmt(headerBottom)}"` +
        ` x2="${fmt(node.x + node.width)}" y2="${fmt(headerBottom)}"` +
        ` stroke="${color.stroke}" stroke-width="${theme.stroke.node}"/>`,
    );
  }
  parts.push(
    textEl(displayName(entity), node.x + node.width / 2, titleBaseline, 'middle',
      font.size.title, font.weight.title, color.textTitle, theme, fontStyle),
  );

  entity.members.forEach((member, i) => {
    const baseline =
      node.y + METRICS.paddingY + METRICS.lineHeight * (i + 1) + METRICS.fontSize + 1;
    parts.push(
      textEl(member.raw, node.x + METRICS.paddingX, baseline, 'start',
        font.size.member, font.weight.member, color.textMember, theme),
    );
  });

  if (entity.usageCount && entity.usageCount > 0) {
    parts.push(renderHubBadge(node, entity.usageCount, theme));
  }

  // Each entity is a single DOM group carrying its stable id and its innermost
  // package, so a browser host can bind hover/click handlers, cross-panel
  // linkage, and package-containment queries without geometric hit-testing.
  const packageAttr =
    entity.packageId !== undefined
      ? ` data-package-id="${escapeXml(entity.packageId)}"`
      : '';
  return (
    `<g data-entity-id="${escapeXml(entity.id)}"${packageAttr} class="uml-node${entity.external ? ' uml-external' : ''}">` +
    parts.join('') +
    `</g>`
  );
}

/**
 * Hub badge — the "used by N packages" marker drawn on the top-right corner of
 * a node whose incoming edges were summarized away (see [[../transform]]). It
 * is centred on the corner, so half of it sits outside the box and never covers
 * the node's name. Neutral accent colour: red is reserved for feedback edges.
 */
function renderHubBadge(node: NodeLayout, count: number, theme: Theme): string {
  const { cx, cy, r } = hubBadgeCircle(node);
  return (
    `<g class="uml-hub-badge">` +
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${r}" fill="${theme.color.accent}"` +
    ` stroke="${theme.color.canvas}" stroke-width="1"/>` +
    textEl(String(count), cx, cy + 3.5, 'middle', theme.font.size.badge, 'normal', theme.color.accentText, theme) +
    `</g>`
  );
}

function renderPackage(pkg: PlantUmlPackage, box: PackageLayout, theme: Theme, tone: number): string {
  const { color } = theme;
  const fills = color.packageFills;
  const fill = fills[((tone % fills.length) + fills.length) % fills.length];
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
      ` height="${fmt(box.height)}" rx="${theme.shape.packageRadius}" ry="${theme.shape.packageRadius}"` +
      ` fill="${fill}" stroke="${color.packageStroke}" stroke-width="${theme.stroke.package}"/>`,
  );
  parts.push(
    `<line class="uml-package-tab" x1="${fmt(box.x)}" y1="${fmt(box.y + PACKAGE_LABEL.tabHeight)}"` +
      ` x2="${fmt(box.x + tabWidth)}" y2="${fmt(box.y + PACKAGE_LABEL.tabHeight)}"` +
      ` stroke="${color.packageStroke}" stroke-width="${theme.stroke.package}"/>`,
  );
  parts.push(
    textEl(pkg.name, box.x + 8, box.y + PACKAGE_LABEL.tabHeight - 8, 'start',
      theme.font.size.packageLabel, theme.font.weight.packageLabel, color.textPackage, theme),
  );
  return (
    `<g data-package-id="${escapeXml(pkg.id)}" class="uml-package">` +
    parts.join('') +
    `</g>`
  );
}

/** Edges sharing a source and exit direction beyond this count are drawn as one bundle. */
export const EDGE_BUNDLE_MIN = 5;

/**
 * Groups of ≥ [[EDGE_BUNDLE_MIN]] unlabelled bundlable edges that leave one
 * source in the same direction — the "comb" of near-parallel lines a hub-like
 * source otherwise draws. Returns relation indexes per group.
 */
function findEdgeBundles(model: PlantUmlModel, edgesById: Map<string, EdgeLayout>): number[][] {
  const groups = new Map<string, number[]>();
  model.relations.forEach((rel, i) => {
    const edge = edgesById.get(`rel-${i}`);
    if (!edge || edge.points.length < 2 || rel.label || rel.feedback || rel.descriptions) return;
    if (!relationSemantics(rel.type).isBundlable()) return;
    const from = edge.points[0];
    const next = edge.points[1];
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : dy >= 0 ? 'S' : 'N';
    const key = `${rel.source}\u0000${rel.type}\u0000${dir}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  return [...groups.values()].filter((g) => g.length >= EDGE_BUNDLE_MIN);
}

/**
 * One visible line for a fan-out: the union of the member polylines with
 * shared segments drawn once, tagged with the summed `data-weight`. Each member
 * keeps its own arrowhead (carrying `data-edge-target`).
 */
function renderBundle(
  members: { rel: PlantUmlRelation; edge: EdgeLayout; weightLabel?: EdgeLabelPlacement }[],
  theme: Theme,
): string {
  const first = members[0].rel;
  const semantics = relationSemantics(first.type);
  const color = semantics.isWeak() ? theme.color.edgeWeak : theme.color.edge;
  const dash = semantics.isDashed() ? theme.dash.weak : undefined;
  const totalWeight = members.reduce((sum, m) => sum + (m.rel.weight && m.rel.weight > 1 ? m.rel.weight : 1), 0);
  const strokeWidth = Math.min(theme.stroke.edge + Math.log2(members.length) * theme.stroke.weightStep, theme.stroke.edgeWidthMax);

  const seen = new Set<string>();
  const segments: string[] = [];
  const heads: string[] = [];
  for (const { rel, edge, weightLabel } of members) {
    if (weightLabel) heads.push(renderWeightLabel(weightLabel, theme));
    const line = trimPolyline(edge.points, 0, theme.arrow.chevron);
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const [p, q] = a.x < b.x || (a.x === b.x && a.y <= b.y) ? [a, b] : [b, a];
      const key = `${fmt(p.x)},${fmt(p.y)}-${fmt(q.x)},${fmt(q.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push(`M${fmt(p.x)} ${fmt(p.y)}L${fmt(q.x)} ${fmt(q.y)}`);
    }
    heads.push(
      `<g data-edge-target="${escapeXml(rel.target)}" class="uml-bundle-head">` +
        renderChevron(edge.points, rel.type, color, theme) +
        `</g>`,
    );
  }
  return (
    `<g data-edge-source="${escapeXml(first.source)}" data-edge-type="${first.type}"` +
    ` data-bundle-size="${members.length}" data-weight="${totalWeight}" class="uml-edge uml-edge-bundle">` +
    `<path d="${segments.join('')}" fill="none" stroke="${color}" stroke-width="${fmt(strokeWidth)}"` +
    ` stroke-opacity="${edgeOpacity(totalWeight, false, theme)}"` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"${nonScaling(theme)}/>` +
    heads.join('') +
    `</g>`
  );
}

function nonScaling(theme: Theme): string {
  return theme.stroke.edgeNonScaling ? ' vector-effect="non-scaling-stroke"' : '';
}

/** Opacity tier of an edge: heavier (more merged relations) edges are more opaque. */
function edgeOpacity(weight: number, feedback: boolean, theme: Theme): number {
  const { opacity, heavyWeight } = theme.stroke;
  if (feedback) return opacity.feedback;
  return weight >= heavyWeight ? opacity.strong : weight > 1 ? opacity.medium : opacity.light;
}

function renderEdge(
  rel: PlantUmlRelation,
  edge: EdgeLayout,
  theme: Theme,
  weightLabel?: EdgeLabelPlacement,
  plainLabel?: EdgeLabelPlacement,
): string {
  if (edge.points.length < 2) return '';
  const points = edge.points;
  const semantics = relationSemantics(rel.type);
  const color = rel.feedback ? theme.color.warn : semantics.isWeak() ? theme.color.edgeWeak : theme.color.edge;
  // Line type carries relation kind only: the dashed fact comes from the
  // relation-semantics table; a cycle feedback edge is dash-dot. Weight is
  // width + opacity, never dashes.
  const dash = rel.feedback ? theme.dash.feedback : semantics.isDashed() ? theme.dash.weak : undefined;
  const { arrow } = theme;

  const arrowKind = semantics.arrowKind();
  const sourceTrim = arrowKind === 'diamond' ? arrow.diamond : 0;
  const targetTrim =
    arrowKind === 'triangle'
      ? arrow.triangle
      : arrowKind === 'chevron'
        ? arrow.chevron
        : 0;

  const linePoints = trimPolyline(points, sourceTrim, targetTrim);
  const parts: string[] = [];

  // Weight encodes the number of aggregated original edges: a thicker,
  // semi-transparent line, plus a `×N` label when more than one relation
  // collapsed into this edge.
  const weight = rel.weight && rel.weight > 1 ? rel.weight : 1;
  const weightWidth = Math.min(theme.stroke.edge + 2 * theme.stroke.weightStep * (Math.log(weight) / Math.log(theme.stroke.heavyWeight)), theme.stroke.edgeWidthMax);
  const strokeWidth = rel.feedback ? Math.max(theme.stroke.feedback, weightWidth) : weightWidth;
  const opacity = ` stroke-opacity="${edgeOpacity(weight, !!rel.feedback, theme)}"`;
  const feedbackClass = rel.feedback ? ' class="uml-feedback"' : '';

  parts.push(
    `<path d="${roundedPath(linePoints, theme.shape.edgeCornerRadius)}" fill="none" stroke="${color}"` +
      ` stroke-width="${fmt(strokeWidth)}"${opacity}${dash ? ` stroke-dasharray="${dash}"` : ''}` +
      ` stroke-linejoin="round"${nonScaling(theme)}${feedbackClass}/>`,
  );

  if (arrowKind === 'diamond') {
    parts.push(renderDiamond(points, semantics.isFilled(), color, theme));
  }
  if (arrowKind === 'triangle') {
    parts.push(renderTriangle(points, rel.type, color, theme));
  }
  if (arrowKind === 'chevron') {
    parts.push(renderChevron(points, rel.type, color, theme));
  }

  parts.push(...renderEdgeTexts(rel, points, theme, plainLabel));
  if (weightLabel) parts.push(renderWeightLabel(weightLabel, theme));
  if (rel.label && !plainLabel) {
    // No label position clear of the nodes: keep the text reachable as a tooltip.
    parts.unshift(`<title>${escapeXml(rel.label)}</title>`);
  }
  // Each edge is one DOM group tagged with its endpoints + type so hosts can
  // highlight an edge and its neighbours via data attributes.
  if (rel.descriptions) {
    parts.unshift(`<title>${rel.descriptions.map(escapeXml).join('\n')}</title>`);
  }
  return (
    `<g data-edge-source="${escapeXml(rel.source)}" data-edge-target="${escapeXml(rel.target)}"` +
    ` data-edge-type="${rel.type}"${rel.weight && rel.weight > 1 ? ` data-weight="${rel.weight}"` : ''} class="uml-edge">` +
    parts.join('') +
    `</g>`
  );
}

/** `×N` weight label on a canvas-coloured backing box so it stays legible over its line. */
function renderWeightLabel(weightLabel: EdgeLabelPlacement, theme: Theme): string {
  const r = weightLabel.rect;
  return (
    `<rect class="uml-edge-label-bg" x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.width)}"` +
    ` height="${fmt(r.height)}" fill="${theme.color.canvas}" fill-opacity="0.92"/>` +
    textEl(weightLabel.text, r.x + r.width / 2, r.y + r.height / 2 + 4, 'middle',
      EDGE_LABEL_FONT_SIZE, 'normal', theme.color.textMember, theme)
  );
}

function renderTriangle(points: Point[], type: PlantUmlRelation['type'], color: string, theme: Theme): string {
  const size = theme.arrow.triangle;
  const { u, tip } = targetDir(points);
  const base = { x: tip.x - u.x * size, y: tip.y - u.y * size };
  const px = -u.y;
  const py = u.x;
  const half = size / 2;
  const pts: Point[] = [
    tip,
    { x: base.x + px * half, y: base.y + py * half },
    { x: base.x - px * half, y: base.y - py * half },
  ];
  return (
    `<polygon class="uml-arrow uml-arrow-${type}" points="${pointsAttr(pts)}"` +
    ` fill="${theme.color.canvas}" stroke="${color}" stroke-width="${theme.stroke.arrow}" stroke-linejoin="round"/>`
  );
}

/** Solid arrowhead for dependency / association (readable beside small text). */
function renderChevron(points: Point[], type: PlantUmlRelation['type'], color: string, theme: Theme): string {
  const size = theme.arrow.chevron;
  const { u, tip } = targetDir(points);
  const back = { x: tip.x - u.x * size, y: tip.y - u.y * size };
  const px = -u.y;
  const py = u.x;
  const half = size * 0.4;
  const pts: Point[] = [
    tip,
    { x: back.x + px * half, y: back.y + py * half },
    { x: back.x - px * half, y: back.y - py * half },
  ];
  return (
    `<polygon class="uml-arrow uml-arrow-${type}" points="${pointsAttr(pts)}"` +
    ` fill="${color}" stroke="${color}" stroke-width="${theme.stroke.arrow}" stroke-linejoin="round"/>`
  );
}

function renderDiamond(points: Point[], filled: boolean, color: string, theme: Theme): string {
  const size = theme.arrow.diamond;
  const { u, tip } = sourceDir(points);
  const px = -u.y;
  const py = u.x;
  const half = size / 2;
  const mid = { x: tip.x + u.x * half, y: tip.y + u.y * half };
  const pts: Point[] = [
    tip,
    { x: mid.x + px * half, y: mid.y + py * half },
    { x: tip.x + u.x * size, y: tip.y + u.y * size },
    { x: mid.x - px * half, y: mid.y - py * half },
  ];
  return (
    `<polygon class="uml-arrow uml-arrow-${filled ? 'composition' : 'aggregation'}"` +
    ` points="${pointsAttr(pts)}" fill="${filled ? color : theme.color.canvas}"` +
    ` stroke="${color}" stroke-width="${theme.stroke.arrow}" stroke-linejoin="round"/>`
  );
}

function renderEdgeTexts(
  rel: PlantUmlRelation,
  points: Point[],
  theme: Theme,
  plainLabel?: EdgeLabelPlacement,
): string[] {
  const parts: string[] = [];
  const t = (text: string, x: number, y: number, size: number): string =>
    textEl(text, x, y, 'middle', size, 'normal', theme.color.textMember, theme);
  if (rel.sourceCardinality) {
    parts.push(t(rel.sourceCardinality, points[0].x, points[0].y - 7, 11));
  }
  if (rel.targetCardinality) {
    const last = points[points.length - 1];
    parts.push(t(rel.targetCardinality, last.x, last.y - 7, 11));
  }
  if (rel.label && plainLabel) {
    const r = plainLabel.rect;
    parts.push(
      textEl(plainLabel.text, r.x + r.width / 2, r.y + 12, 'middle', 12, 'normal', theme.color.textMember, theme,
        ` class="uml-edge-label" stroke="${theme.color.labelHalo}" stroke-width="${theme.stroke.labelHalo}"` +
          ` stroke-linejoin="round" paint-order="stroke"`),
    );
  }
  return parts;
}

/**
 * Polyline as an SVG path whose interior corners are rounded with quadratic
 * curves of radius ≤ `radius` (clamped to half of each adjoining segment). The
 * routing — the vertices — is unchanged.
 */
export function roundedPath(points: Point[], radius: number): string {
  if (points.length < 3 || radius <= 0) return 'M' + pointsAttr(points).replace(/ /g, ' L');
  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r <= 0) {
      d += ` L${fmt(cur.x)},${fmt(cur.y)}`;
      continue;
    }
    const a = { x: cur.x + ((prev.x - cur.x) / l1) * r, y: cur.y + ((prev.y - cur.y) / l1) * r };
    const b = { x: cur.x + ((next.x - cur.x) / l2) * r, y: cur.y + ((next.y - cur.y) / l2) * r };
    d += ` L${fmt(a.x)},${fmt(a.y)} Q${fmt(cur.x)},${fmt(cur.y)} ${fmt(b.x)},${fmt(b.y)}`;
  }
  const last = points[points.length - 1];
  return d + ` L${fmt(last.x)},${fmt(last.y)}`;
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
