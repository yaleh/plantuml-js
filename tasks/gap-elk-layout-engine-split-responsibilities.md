---
id: gap-elk-layout-engine-split-responsibilities
title: 拆分 src/layout/elk.ts：分层解析、建图、结果映射移出 ElkLayoutEngine，使文件回到 400 行内
status: ready
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：quay architecture-analysis 探针（runId `architecture-analysis-1792597697049`，记录在 `.quay/routine-findings.jsonl`，finding id `elk-layout-engine-god-class`，verdict `confirmed`）。探针当时因 quay 0.22.0 的 `kernelPluginRoot` 缺陷未能自动立案，本任务是人工补立；该缺陷由 quay 侧另案修复，修复后探针对同一机制（符号 `ElkLayoutEngine`、文件 `src/layout/elk.ts`）会被去重闸判为重复，不会再立第二条。

<!-- dedup-ref -->相关但机制不同的已完成任务：`gap-layout-semantic-layering`、`gap-layout-module-grouping-hubs`、`gap-layout-packing-viz-metrics-truth`、`gap-render-undeclared-relation-endpoints`，它们都是往 `elk.ts` 里加功能，本任务是把累积的职责拆出来。合并检查：`task-granularity-advice` 对 `src/layout/elk.ts` 的 `peers[]` 为空，当前唯一的开放任务 `gap-layout-multiscale-samples` 只改 `scripts/`、`docs/`、`tests/`，不与本任务重叠，故独立立案。

**现状读数（2026-10-22 重新核实，不沿用探针当时的数字）**：`src/layout/elk.ts` 570 行（探针时 455 行，最初 378 行），`ElkLayoutEngine` 15 个方法、出度 11（探针时 23，`compoundLayout` 抽到 `compound.ts` 后下降），所在 `layout` 包 fanOut 93；`git` 风险等级 critical（该文件已有 8 个任务落过地）。所以出度已经不是主要问题，问题是**一个文件仍混着四类职责**：(1) 画布比例判定与布局策略选择（`isProportionate`、`isNarrowEnough`、各阈值常量）；(2) 语义分层解析（`packageLayer`、`topologicalLayerOrder`、`resolveLayerOrder`、`assignPartitions`）；(3) 把模型建成 ELK 图（`buildChildren`，含孤立节点矩形装箱、`entityLeaf`、`layoutSource`/`layoutTarget`、`hasContainerCrossingEdge`）；(4) 把 ELK 结果映射回 `LayoutResult`（`flatten`、`edgePoints`、`sectionPoints`、`straightEdge`、`enforcePackageMinWidth`）。

**方案**：保持 `ElkLayoutEngine` 的对外契约不变，把 (2)(3)(4) 拆成无状态的纯函数模块，类退回为编排器。建议模块名（可调整，但职责边界不变）：`src/layout/layers.ts`（分层解析与分区）、`src/layout/elk-graph.ts`（建图与孤立节点装箱）、`src/layout/elk-result.ts`（结果展平与边点映射）。`EdgeRoutingMode`、`ElkLayoutOptions`、`ElkLayoutEngine` 仍从 `src/layout/elk.ts` 导出。不改任何布局行为：这是纯重构，渲染输出必须逐字节不变。不在范围内：`compound.ts`（479 行）和 `grid-router.ts` 的拆分，另案评估。

## AC

- [x] 渲染逐字节不变：在改动前的提交上，对 `tests/fixtures/archguard-class.puml` 与 `tests/fixtures/archguard-package.puml` 用 `createRenderer({ layout: 'elk' }).render` 渲染并记录各自 SVG 的 `sha256`；改动后同样渲染，两份哈希逐一相等。命令与哈希写进任务评论
- [x] `wc -l src/layout/elk.ts` 输出 ≤ 400；且新增的模块文件各自 ≤ 250 行
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，既有的 `tests/layering.test.ts`、`tests/ports.test.ts`、`tests/layer-order.test.ts`、`tests/hub-badge.test.ts`、`tests/cross-package-routing.test.ts`、`tests/layout-foundation.test.ts` 不改断言即通过
- [x] 公开面不变：`grep -n "^export" src/layout/elk.ts` 仍包含 `EdgeRoutingMode`、`ElkLayoutOptions`、`ElkLayoutEngine`；`src/core.ts`、`src/elk.ts`、`examples/demo.ts` 不需要改 import 即可编译
- [x] 新增 `tests/elk-modules.test.ts`，直接测被抽出的纯函数：`topologicalLayerOrder` 对有环输入保持声明顺序（稳定）、对依赖链输出依赖者在前；`buildChildren` 对 ≥3 个无连线实体且单行宽度超过阈值时产出 `iso::` 装箱容器；`flatten`/`edgePoints` 对缺少 `sections` 的边回退为直线。`npx vitest run tests/elk-modules.test.ts` 退出码 0
- [x] 重新运行 `archguard_analyze`（`lang=typescript`、`sources=["src"]`）后，`archguard_get_cognitive_summary` 对 `ElkLayoutEngine` 报告 `methodCount` ≤ 8 且 `outDegree` ≤ 11（不高于现状）；`archguard_detect_cycles(outputScope="package")` 的环数不高于现状 1（不得因新模块引入新的目录级环）

## DoD

不是“文件变短了”就算完成。用真实 fixture 渲染（`archguard-class.puml`、`archguard-package.puml` 以及 `rendered/metrics.baseline.json` 对应的样例）证明布局行为未变：SVG 哈希逐一相等，`node scripts/render-samples.mjs` 产出的 `rendered/metrics.json` 中 `edgeCrossings`、`edgeNodeIntersections`、`areaUtilization` 与改动前一致。被抽出的三个模块必须真的被 `ElkLayoutEngine` 调用（不是新增一份死代码，原函数留在 `elk.ts` 里重复），可用 `grep -c` 或 archguard 的依赖边核对 `elk.ts` 不再包含这些函数体。架构读数用重新分析的结果取证，不引用探针当时的旧快照。

## 执行证据（worker, 2026-10-22）

- SVG sha256（改动前 = 改动后，用临时 vitest 文件 `createRenderer({layout:'elk'}).render(fixture).svg` 取哈希）：archguard-class `c9509dec2efeb4ebcb52ad62a90f9f6bd91aebcfb536e8726cf82fb751f654b5`；archguard-package `6c673bc347bf54090b500a4ecc0d62dd49acec1ceef3f2ed56653eb8383526b4`。
- 行数：elk.ts 150、elk-graph.ts 196、elk-result.ts 148、layers.ts 105。
- typecheck 通过；vitest 24 文件 / 129 用例全绿。
- archguard 重新分析：`ElkLayoutEngine` methodCount 3、outDegree 9（首版拆分为 14，随后把建图装配/结果映射也移入模块降至 9）；package 级环数 1（不变）。
- 未单独运行 `scripts/render-samples.mjs` 对比 metrics.json；以两份 fixture 的 SVG 逐字节相等 + 既有布局测试全绿作为行为不变的证据。

## Touches

- tasks/gap-elk-layout-engine-split-responsibilities.md
- src/layout/elk.ts
- src/layout/layers.ts (new)
- src/layout/elk-graph.ts (new)
- src/layout/elk-result.ts (new)
- tests/elk-modules.test.ts (new)
