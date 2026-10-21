---
id: gap-render-edge-label-halo-and-dedupe
title: 边标签：白色描边光晕、避让其它边、同束重复标签去重（uses/returns 走廊拥挤）
status: done
labels:
  - gap
  - layout
  - design
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-harness-render-via-public-pipeline
---
## Proposal

第五轮目视检查（设计系统落地后）里最显眼的剩余缺点是**边标签**：
- `s-architecture-manual`：`uses`、`validates`、`analyzes` 等标签直接画在连线上，没有底色或光晕，连线从文字中间穿过，像被划掉；
- `m-architecture`：Parser Layer 与 Types/External 之间的走廊里叠着几十个 `uses`/`returns`，彼此重叠，既不可读也没有信息量（同一动词在同一束边上重复）；
- 部分标签压在另一条边上而不是自己的边上。
`labelNodeOverlap` 已为 0，但没有度量覆盖"标签压线、标签互压"。

本任务：
1. 标签使用主题 token 的光晕（`paint-order: stroke` 加画布/包填充色描边，或底层 `<rect>` 底色），位置取自己那条边上最长的、无其它边穿过的线段中点，偏移到线的一侧而不是压在线上；
2. 同一束（相同源或相同目标、同方向、标签文字相同）的重复标签去重：只在一条代表边上显示，其余保留 `<title>` tooltip；超过 N 条标签的走廊降级为只显示计数徽标；
3. 新增度量 `labelEdgeOverlap`（标签矩形与不属于它自己的边的线段相交的数量）与 `labelLabelOverlap`（标签矩形互相相交的对数）。

## AC

- [x] `computeLayoutMetrics` 新增 `labelEdgeOverlap` 与 `labelLabelOverlap`，`tests/layout-metrics.test.ts` 用合成布局断言确定值（含一个故意压线、一个故意互压的反例）
- [x] `tests/edge-label-halo.test.ts`：渲染含标签的边后，SVG 里该标签文字带光晕（光晕颜色取自 theme token，不是硬编码），且标签位置不在其边的线段上（到自己那条边的距离 ≥ 文字高度的一半）
- [x] `tests/label-dedupe.test.ts`：同一源节点向同一目标分组发出 ≥ 5 条同文字标签的边，SVG 中该文字标签可见数 ≤ 2，其余边含 `<title>` 保留文字
- [x] 对 `s-architecture-manual` 与 `m-architecture`：`labelEdgeOverlap` 为 0，`labelLabelOverlap` 为 0；`xl-all-classes` 的 `labelLabelOverlap` 为 0
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 S/M 并看 1:1 分块：边标签是清楚的、带光晕的、不被线划掉，Parser Layer 到 Types/External 的走廊不再堆满重复的 `uses`/`returns`，度量表里三个样例的两个新度量均为 0。

## Touches

- tasks/gap-render-edge-label-halo-and-dedupe.md
- src/render/svg.ts
- src/render/theme.ts
- src/render/labels.ts
- src/layout/elk.ts
- src/layout-metrics.ts
- tests/layout-metrics.test.ts
- tests/edge-label-halo.test.ts (new)
- tests/label-dedupe.test.ts (new)
