---
id: gap-layout-semantic-layering
title: 语义分层：Layer 分区约束、继承/组合方向固定、端口与边束
status: todo
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-abstraction-views
---
## Proposal

让布局携带架构语义，而不只是几何：
- 源 puml 里的 `Src Layer`/`Tests Layer`/`Examples Layer`/`Templates Layer` 是语义分层，通过 ELK `elk.partitioning.activate` 与 `elk.partitioning.partition` 固定层序（依赖方向因此有意义：入口在上、基础类型在下），Layer 顺序可由选项或名称约定配置；
- 类图中继承/实现边内部方向翻转为"父在上"，组合/聚合为"整体在上"，渲染时仍按原箭头方向绘制；
- 为边端点分配 port 并按关系类型/方向分组，同向并行边共用进出侧，避免全部挤在节点边缘同一点；启用 `elk.layered.mergeEdges`，必要时在 `PlantUmlRelation.weight` 上做线宽编码；
- 评估 `elk.edgeRouting` 的 ORTHOGONAL / POLYLINE / SPLINES，以 `computeLayoutMetrics` 的数值选默认值并记录依据。

## AC

- [ ] `tests/layering.test.ts`：合成模型断言——Layer A 的所有节点 y 坐标小于 Layer B（按声明顺序）；继承子类位于父类下方；组合整体位于部件上方；`npx vitest run` 通过
- [ ] `tests/ports.test.ts`：同一节点同方向的并行边端点落在同一 port 侧，端点不重叠
- [ ] `node scripts/render-samples.mjs` 在 fixture 与 package 上 `edgeNodeIntersections === 0`，且 `edgeCrossings` 不高于上一阶段（`rendered/metrics.json` 对比）
- [ ] 记录三种 edgeRouting 的度量对比表于 `docs/layout-routing-eval.md`，默认值与结论一致
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

真实 archguard package 图渲染后，目视上 Layer 自上而下有序、`src/types` 等基础层位于最底、继承树方向正确；PNG 目视检查结论与度量对比一致，评估文档存在并被默认配置引用。

## Touches

- tasks/gap-layout-semantic-layering.md
- src/layout/elk.ts
- src/layout.ts
- src/model.ts
- src/parser.ts
- src/render/svg.ts
- docs/layout-routing-eval.md (new)
- tests/layering.test.ts (new)
- tests/ports.test.ts (new)