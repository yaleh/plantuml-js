---
id: gap-metrics-registry-encapsulation
title: 把 layout-metrics 的 25 个度量封装成 Metric 接口 + 注册表（加度量 = 注册而非改返回字面量）
status: done
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`computeLayoutMetrics` 的返回字面量里**硬编码了 25 个度量**（`edgeCrossings` / `edgeNodeIntersections` / `nonOrthogonalEdgeCount` / `totalEdgeLength` / `areaUtilization` / `aspectRatio` / `textOverflowCount` / `labelOverlapCount` / `overlappingEdgeLength` / `badgeLabelOverlap` / `edgeLabelOverlap` / `labelNodeOverlap` / `labelEdgeOverlap` / `labelLabelOverlap` / `hubArrowStack` / `maxEmptyBlockRatio` / `edgeFlushCount` / `parallelBundleCount` / `edgeFrameCrossings` / `trunkDetourCount` / `nestedLoopCount` / `edgeNodeFlush` / `frameFillRatio` / `edgeCanvasMargin`，外加后加的 `layoutMs`）。每个度量是一个纯行为 `compute(model, layout) → number`，现在实现为 `count*` 自由函数 + 返回字面量里逐字段调用。加一个度量 = 改返回字面量 + 加一个 `count*` 函数，度量清单没有任何封装。

**方案**：把度量封装成 `Metric` 接口（`name + compute(model, layout) → number`）+ 注册表，`computeLayoutMetrics` 遍历注册表组装返回对象。加度量 = 注册一个 `Metric` + 给 `LayoutMetrics` 加一个字段（一次性、有类型），而不是改返回字面量的每一个调用点。

约束：`LayoutMetrics` 是强类型接口，被 `scripts/render-samples.mjs`、`rendered/metrics.json`、`docs/layout-routing-eval.md` 依赖，不能动态化成 `Record<string, number>`。所以保持强类型返回，但度量实现从「自由函数 + 硬编码清单」改为「`Metric` 对象 + 注册表遍历」。

<!-- dedup-ref -->相关但机制不同的已完成任务：`gap-layout-quality-harness`（建立度量基线）、`gap-layout-packing-viz-metrics-truth`（新增度量）、`gap-layout-legibility-legend-metrics-fixes`、`gap-layout-trunk-detours-grid-columns-stub-grouping`（这些都在往 `computeLayoutMetrics` 加度量，正是本任务要收敛的扩展方式）。`gap-encapsulate-relation-type-semantics` 刚把关系语义封装成单一来源，本任务是对「度量」这个行为维度做同等的封装。

## AC

- [x] 改动前红：`grep -c "count[A-Z]\|compute[A-Z]" src/layout/layout-metrics.ts` 的返回值与 `computeLayoutMetrics` 返回字面量里的逐字段调用数一致（≥20），证明度量清单硬编码在返回体里
- [x] `Metric` 接口 + 注册表：新增 `Metric` 接口（`name` + `compute(model, layout): number`）；`computeLayoutMetrics` 遍历注册表组装强类型 `LayoutMetrics`，返回体里不再逐字段调用 `count*` 函数
- [x] 加度量 = 注册（扩展点判据）：新增 `tests/metric-registry.test.ts`，注册一个合成度量后它出现在 `computeLayoutMetrics` 的结果里；不改 `computeLayoutMetrics` 的返回体即生效
- [x] 无行为回归：`node scripts/render-samples.mjs` 产出的 `rendered/metrics.json` 每个度量数值与改动前一致；`npm run typecheck` 与 `npx vitest run` 全绿，`tests/layout-metrics.test.ts` 不改断言即通过
- [x] 类型不退化：`LayoutMetrics` 仍是强类型接口（`grep -c "export interface LayoutMetrics" src/layout/layout-metrics.ts` 为 1），未被动态化成 `Record<string, number>`

## DoD

不是「把 count* 函数换个写法」就完——而是「度量」这个行为维度被封装成 `Metric` 接口 + 注册表，加一个新度量 = 注册一个对象，而不是改 `computeLayoutMetrics` 返回字面量。强类型 `LayoutMetrics` 保持不退化；全部度量数值与改动前一致；扩展点用「注册合成度量即生效」的可证伪测试证明。

## Touches

- tasks/gap-metrics-registry-encapsulation.md
- src/layout/layout-metrics.ts
- tests/metric-registry.test.ts (new)
- tests/layout-metrics.test.ts
