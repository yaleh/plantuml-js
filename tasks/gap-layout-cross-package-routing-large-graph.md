---
id: gap-layout-cross-package-routing-large-graph
title: 跨包边走 ELK 正交路由（不再回落直线）+ 大图根层包装箱 + 包视图宽高比约束
status: todo
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Proposal

第二轮落地后，对真实目标（archguard `all-classes.puml`：660 实体 / 950 关系 / 56 包）做了检查，发现 package 级图已大幅改善（`package.elk` 交叉 1446→138、面积利用率 0.026→0.063），但**类级图仍然不可用**：
1. **跨包边全部回落为直线斜线**：对 `Src_Mermaid_Layer` 单包视图（74 条边）诊断得 `cross-pkg: 24 条全为斜线（直线回落，仅 2 个点）`、`same-pkg: 50 条全部正交`。其它包外的 stub 节点在包框上方排成一条带，到包内类的边是穿过整张图的长斜线，这就是 `edgeNodeIntersections` 在 Mermaid/Types/Golang 视图里达到 82/335/113 的原因（`src/layout/elk.ts` 的 `straightEdge` 回落路径，`edgePoints` 在 ELK 没返回 sections 时触发）。需查明 ELK 为何不为这些跨层级边生成 sections（`hierarchyHandling: INCLUDE_CHILDREN` 与 `partitioning`/`INTERACTIVE` 组合、边的归属容器等），修好路由；stub 节点应贴近其连接对象或作为包框边界上的端口，不再是远离的一条带。
2. **完整 all-classes 图尺寸失控**：默认路径渲染为 13455×79369 px（宽高比 0.17），9027 次交叉，面积利用率 0.022；`scripts/render-samples.mjs` 对它截 PNG 时因接近 10 亿像素被 OOM 杀掉（退出码 137）。根层的 56 个顶层包应先按目标宽高比装箱（rectpacking/网格）再各自分层布局。
3. **单包视图宽高比失控**：`Src_Plugins_Golang_Layer` 7562×1653（宽高比 4.58），共 7 个包视图宽高比 >4 或 <0.25。

## AC

- [ ] `tests/cross-package-routing.test.ts`：合成两个包、跨包边的模型，ELK 布局后所有边（含跨包边）均为正交折线（`countNonOrthogonalSegments === 0`），不穿过无关节点；并对 `all-classes.puml` 的 `Src_Mermaid_Layer` 视图断言 `edgeNodeIntersections` ≤ 5
- [ ] `computeLayoutMetrics` 新增 `nonOrthogonalEdgeCount`（`tests/layout-metrics.test.ts` 合成断言）；对 all-classes 全部 56 个包视图，`nonOrthogonalEdgeCount === 0`（ELK 引擎），且 `edgeNodeIntersections` 的总和 ≤ 60（当前最大单个 335）
- [ ] 完整 `all-classes` 默认渲染：宽高比在 0.5–2.5 之间，总像素 ≤ 100 MP，`edgeCrossings` 低于 9027；`textOverflowCount === 0`
- [ ] 全部 56 个包视图宽高比在 0.25–4 之间（当前 7 个越界）
- [ ] `scripts/render-samples.mjs` 对超过 100 MP 的图跳过 PNG（或缩放后截图）并在日志说明，不再 OOM；`npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

用真实 `all-classes.puml` 渲染完整图与 `Src_Mermaid_Layer`、`Src_Plugins_Golang_Layer`、`Src_Types_Layer` 视图，PNG 目视：跨包边是沿包框的正交线，不再有穿过整张图的斜线；完整图是一张可整体浏览的、接近 16:10 的画面；`rendered/metrics.json` 记录数值，对照本任务描述中的数字改善。

## Touches

- tasks/gap-layout-cross-package-routing-large-graph.md
- src/layout/elk.ts
- src/layout-metrics.ts
- src/transform.ts
- scripts/render-samples.mjs
- docs/layout-routing-eval.md
- tests/cross-package-routing.test.ts (new)
- tests/layout-metrics.test.ts