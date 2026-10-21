/**
 * SVG renderer — turns a laid-out PlantUmlModel into a standalone SVG string.
 * The renderer consumes only the LayoutResult (positions/sizes) plus the
 * model's display fields; it never reaches back into the parser.
 */

import { PlantUmlModel, PlantUmlEntity } from '../model.js';
import { LayoutResult, NodeLayout } from '../layout.js';

const TITLE_COMPARTMENT = 18;
const PADDING = 8;
const FONT_FAMILY = 'monospace';
const FONT_SIZE = 13;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSvg(model: PlantUmlModel, layout: LayoutResult): string {
  const nodesById = new Map(layout.nodes.map((n) => [n.id, n]));
  const body: string[] = [];

  for (const entity of model.entities) {
    const node = nodesById.get(entity.id);
    if (node) body.push(renderEntity(entity, node));
  }

  const width = layout.width;
  const height = layout.height;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}">${body.join('')}</svg>`
  );
}

function renderEntity(entity: PlantUmlEntity, node: NodeLayout): string {
  const italic = entity.kind === 'interface' || entity.kind === 'abstract';
  const fontStyle = italic ? ' font-style="italic"' : '';
  const name = escapeXml(entity.name);

  const parts: string[] = [];
  parts.push(
    `<rect x="${node.x}" y="${node.y}" width="${node.width}"` +
      ` height="${node.height}" rx="2" ry="2" fill="#ffffff"` +
      ` stroke="#333333" stroke-width="1.5"/>`,
  );
  parts.push(
    `<line x1="${node.x}" y1="${node.y + TITLE_COMPARTMENT}"` +
      ` x2="${node.x + node.width}" y2="${node.y + TITLE_COMPARTMENT}"` +
      ` stroke="#333333" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${node.x + node.width / 2}" y="${node.y + TITLE_COMPARTMENT - 5}"` +
      ` text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}"` +
      `${fontStyle} fill="#000000">${name}</text>`,
  );

  return parts.join('');
}
