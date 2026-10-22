---
id: gap-layout-nested-large-graph-superlinear
title: 嵌套大图布局超线性：2000 节点 ~282s，按节点数自动降级
status: ready
labels:
  - gap
  - layout
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

0.3.0 对**嵌套 package 的大 Entity 图**布局时间随节点数超线性增长（Architecture-tab 在真实 quay 图上实测 + 我这边复现）：

| 节点 | 边 | 0.2.x | 0.3.0 |
|---|---|---|---|
| 150 | 75 | 303ms | 607ms |
| 300 | 119 | 119ms | 1.2s |
| 500 | 202 | 155ms | 1.4s |
| 800 | 339 | 280ms | 4.1s（我复现）/ 6.8s（对方） |
| 2000 | 3186 | 988ms（画布坏 252895×15677） | **~282s（4.7 分钟）**，画布 18230×11088（1.64 正常） |

主线程跑 ELK，2000 节点会冻页面数分钟。0.2.x 快是因为走了更便宜但画布坏掉的路径；0.3.0 修好比例的同时把耗时推成超线性。`gap-layout-flat-large-graph-regression` 只守 flat 789 ≤2s，不覆盖嵌套大图。

**根因线索**（`src/layout/compound.ts`）：`layoutBlock` 里 (a) 嵌套块过宽时走 `splitNestedBlock` 递归拆分重排（约 line 373，每次拆分再 `elk.layout` 子块，递归可能爆炸）；(b) 每个 block 最多跑 3 次 `elk.layout`（初始 INCLUDE_CHILDREN + wrapping 重试 + rectpacking 重试）。二者叠加在 2000 节点/37 包时放大成分钟级。

<!-- dedup-ref -->
相关但不合并：`gap-layout-flat-large-graph-regression`（done，只守 flat）；`gap-compound-layout-proportion`（done，修比例引入本超线性）。本任务只修「嵌套大图耗时」+ 加节点数降级。

## AC

- [ ] 复现与预算：把 `graph.entity`（2000 节点/3186 边）或等价合成嵌套固化进 fixture，`node scripts/bench-nested.mjs`（或新增 scale bench）断言 2000 节点嵌套布局 `layoutMs ≤ 30000`（当前 ~282s），且 800 节点 ≤ 10s、500 ≤ 5s（当前 800≈4-7s、500≈1.4s）。`node scripts/bench-nested.mjs` 退出 0。
- [ ] 降级不塌质量：2000 节点在预算内时画布 `width/height ≤ 3`、`crossings` 不超合理上限、`edgeNodeIntersections === 0`。
- [ ] 实现「超过 N 节点自动降级到更便宜布局策略」（或直接修掉 `splitNestedBlock` 的递归放大）：N 可配（默认值建议 ~800，依据上面 800→2000 的拐点）。`npm test` 与 `npm run typecheck` 退出 0；既有 789 nested 预算不回退。

## DoD

2000 节点嵌套 Entity 图布局 ≤ 30s（不再分钟级冻结主线程），Architecture-tab 的 600 节点前端预算可放宽或移除；full suite + typecheck + bench 全绿。

## Touches

- src/layout/compound.ts
- src/layout/elk.ts
- scripts/bench-nested.mjs
- tests/layout-compound-proportion.test.ts
- tasks/gap-layout-nested-large-graph-superlinear.md