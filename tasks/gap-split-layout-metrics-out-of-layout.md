---
id: gap-split-layout-metrics-out-of-layout
title: 把 layout-metrics 从 layout 拆到独立 metrics 域（产生布局 vs 评价布局分离）
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

`src/layout/` 是最大的包（13 文件、63 实体、fanOut 313），但里面混了两类职责：**产生布局**（elk/compound/grid-router/elk-graph/elk-result/placement-strategy/lane-spread/trunk-lanes/fanout-trunk/package-endpoints/viz）和**评价布局**（`layout-metrics.ts`，25 个度量）。产生与评价是两个方向：前者把 model 变成坐标，后者给坐标打分。

`layout-metrics.ts` 的消费者是 `core.ts`、`layout/elk.ts`、`layout/elk-graph.ts`、`layout/fanout-trunk.ts`、`layout/trunk-lanes.ts`——其中四个是 `layout` 内部的文件，用 `computeLayoutMetrics` 评价自己产出的布局。把评价逻辑留在 `layout/` 里，使「产生」和「评价」两个变化维度挤在同一包。

**方案**：`src/layout/layout-metrics.ts` → `src/metrics/layout-metrics.ts`，成立独立的评价域，与 `foundation`/`layout`/`render` 平级。`metrics` 只依赖 `foundation`（读 model/layout/edge-router 计算度量），不依赖 `layout`——依赖方向变成 `layout → metrics → foundation`，无环且「产生布局」单向依赖「评价布局」。

## AC

- [ ] 评价域独立：`src/metrics/layout-metrics.ts` 存在且内容与移动前一致（git 视为 rename），`src/layout/layout-metrics.ts` 不再存在
- [ ] 无反向依赖：`src/metrics/` 只依赖 `foundation/`，不依赖 `layout/`、`render/`、根包；`grep -rn "from '\.\./layout\|from '\.\./render\|from '\.\./core" src/metrics` 无命中
- [ ] 消费者更新：`core.ts`、`layout/elk.ts`、`layout/elk-graph.ts`、`layout/fanout-trunk.ts`、`layout/trunk-lanes.ts` 的 import 改为新路径；`grep -rn "layout/layout-metrics" src` 无命中
- [ ] 目录环保持 0：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 的环数仍为 0；`layout` 包的 fanOut 因不再含度量依赖而下降或持平
- [ ] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿，`tests/layout-metrics.test.ts`、`tests/metric-registry.test.ts` 不改断言即通过；两个 fixture 渲染 SVG sha256 与改动前相等；`npm run build` 退出码 0

## DoD

「产生布局」和「评价布局」分属两个域：`layout` 单向依赖 `metrics`，`metrics` 只依赖 `foundation`，无环；layout 包不再混着度量职责；度量数值与改动前一致，公开导出（`core.ts` 的 `computeLayoutMetrics`/`LayoutMetrics`）不变。

## Touches

- tasks/gap-split-layout-metrics-out-of-layout.md
- src/metrics/layout-metrics.ts (new)
- src/core.ts
- src/layout/elk.ts
- src/layout/elk-graph.ts
- src/layout/fanout-trunk.ts
- src/layout/trunk-lanes.ts
- tests/layout-metrics.test.ts
- tests/metric-registry.test.ts
