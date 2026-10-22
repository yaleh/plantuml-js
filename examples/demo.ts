/**
 * Interactive demo — proves the HTML+JS dynamic-rendering story on a real
 * ArchGuard 1-hop neighbourhood (789 nodes / 1210 edges):
 *
 *   - overview depth=2 (path-prefix collapse → the readable "ladder"),
 *   - click a group to expand its entities,
 *   - click an entity to expand its N-hop neighbourhood (the renderer's built-in
 *     `view: {kind:'neighborhood', entity, hops}`),
 *   - hover a node to highlight it plus its incident edges (via the
 *     `data-entity-id` / `data-edge-source` / `data-edge-target` attributes the
 *     SVG renderer now emits).
 *
 * Query params for deep links / smoke tests:
 *   ?view=group&prefix=<prefix>
 *   ?view=neighborhood&entity=<alias>&hops=<n>
 */

import { parsePlantUml } from '../src/parse/parser';
import { applyView, transformModel } from '../src/transform/transform';
import { ElkLayoutEngine } from '../src/layout/elk';
import { renderSvg } from '../src/render/svg';
import { archguardToPlantUml, pathName, displayName } from '../src/archguard';

interface Node {
  id: string;
  label: string;
  distance?: number;
}
interface Edge {
  from: string;
  to: string;
  relationType: string;
}

const data = (window as unknown as { ARCHGUARD_DATA: { nodes: Node[]; edges: Edge[] } })
  .ARCHGUARD_DATA;

const engine = new ElkLayoutEngine();
const { puml: fullPuml, aliasOf } = archguardToPlantUml(data);
const origOf = new Map<string, string>();
data.nodes.forEach((n, i) => origOf.set(`n${i}`, n.id));

const host = document.getElementById('diagram')!;
const status = document.getElementById('status')!;
const breadcrumb = document.getElementById('breadcrumb')!;

type Mode =
  | { kind: 'overview' }
  | { kind: 'group'; prefix: string }
  | { kind: 'neighborhood'; entity: string; hops: number };

let mode: Mode = { kind: 'overview' };

function bindInteractions(): void {
  host.querySelectorAll<SVGGElement>('.uml-node').forEach((node) => {
    node.addEventListener('mouseenter', () => highlight(node.dataset.entityId));
    node.addEventListener('mouseleave', clearHighlight);
    node.addEventListener('click', () => onNodeClick(node.dataset.entityId!));
  });
}

function highlight(entityId: string | undefined): void {
  clearHighlight();
  if (!entityId) return;
  const keep = new Set<string>([entityId]);
  host.querySelectorAll<SVGGElement>('.uml-edge').forEach((edge) => {
    const source = edge.dataset.edgeSource;
    const target = edge.dataset.edgeTarget;
    if (source === entityId || target === entityId) {
      edge.classList.add('uml-lit');
      if (source) keep.add(source);
      if (target) keep.add(target);
    } else {
      edge.classList.add('uml-dim');
    }
  });
  host.querySelectorAll<SVGGElement>('.uml-node').forEach((node) => {
    if (!keep.has(node.dataset.entityId!)) node.classList.add('uml-dim');
  });
}

function clearHighlight(): void {
  host.querySelectorAll<SVGGElement>('.uml-node, .uml-edge').forEach((el) => {
    el.classList.remove('uml-lit', 'uml-dim');
  });
}

async function render(puml: string, view?: { kind: string; [k: string]: unknown }): Promise<void> {
  const t0 = performance.now();
  const parsed = parsePlantUml(puml);
  const model = view
    ? transformModel(applyView(parsed, view as never), { aggregate: true, cycles: true })
    : transformModel(parsed, {
        aggregate: true,
        cycles: true,
        // Mirror the library's full-graph default: summarise hubs once the
        // graph is large enough (>40 entities, in-degree >6).
        hubThreshold: parsed.entities.length > 40 ? 6 : undefined,
      });
  const layout = await engine.layout(model);
  host.innerHTML = renderSvg(model, layout);
  bindInteractions();
  status.textContent = `${model.entities.length} 节点 · ${model.relations.length} 边 · ${Math.round(performance.now() - t0)}ms`;
}

function prefixOf(name: string, depth: number): string {
  return name.split('/').slice(0, Math.min(depth, name.split('/').length)).join('/');
}

function showOverview(): Promise<void> {
  mode = { kind: 'overview' };
  breadcrumb.textContent = '总览（depth=2 路径折叠）';
  return render(fullPuml, { kind: 'overview', depth: 2 });
}

function showGroup(prefix: string): Promise<void> {
  mode = { kind: 'group', prefix };
  breadcrumb.textContent = `总览 → ${prefix}`;
  const nodes = data.nodes.filter((n) => prefixOf(pathName(n.id), 2) === prefix);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return render(archguardToPlantUml({ nodes, edges }, { aliasOf, maxDirSegments: 2 }).puml);
}

function showNeighborhood(entity: string, hops: number): Promise<void> {
  mode = { kind: 'neighborhood', entity, hops };
  const original = origOf.get(entity) ?? entity;
  breadcrumb.textContent = `邻域：${displayName(original, 2)}（${hops} 跳）`;
  return render(fullPuml, { kind: 'neighborhood', entity, hops });
}

function onNodeClick(id: string): void {
  if (mode.kind === 'overview') {
    if (id.startsWith('grp::')) void showGroup(id.slice('grp::'.length));
    else void showNeighborhood(id, 1);
  } else if (mode.kind === 'group') {
    void showNeighborhood(id, 1);
  } else {
    void showNeighborhood(id, Math.min(mode.hops + 1, 3));
  }
}

(document.getElementById('home') as HTMLButtonElement).addEventListener('click', () => void showOverview());

// Deep-link / smoke-test entry points.
const query = new URLSearchParams(location.search);
const view = query.get('view');
if (view === 'group') {
  void showGroup(query.get('prefix') ?? '');
} else if (view === 'neighborhood') {
  void showNeighborhood(query.get('entity') ?? 'n0', Number(query.get('hops') ?? '1'));
} else {
  void showOverview();
}
