---
id: gap-layout-packing-viz-metrics-truth
title: 孤立节点网格装箱 + viz 紧凑化/弃用决策 + 度量对 Chrome 实测校验与新增度量
status: done
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-module-grouping-hubs
---
## Proposal

第一轮落地后目视检查的第二批问题：
1. **孤立节点没有换行装箱**：`package-pkg-Tests_Layer` 渲染成 3500×234（宽高比 14.9），12 个互不相连的节点排成一行；`fixture.elk` 的 Src Analysis Layer 也有大块空白。无边/弱连通的节点应按目标宽高比换行成网格（`elk.algorithm: rectpacking` 或 `elk.layered.wrapping`），并对包内容设目标 `aspectRatio`。
2. **viz 引擎仍是二等公民**：`fixture.viz` 3859×2316、`areaUtilization` 0.063，两个包相距很远，边是长斜直线，继承箭头与目标之间有大空隙；`package.viz` 面积利用率 0.012、仍有 6 次边穿过节点。要么让 viz 路径达到 elk 的 80% 面积利用率并改用 `splines=ortho` 或折线，要么在 README 与 `createRenderer` 中明确降级为 experimental，并写入决策依据。
3. **度量有盲区**：`textOverflowCount` 用的是和渲染同一份 `measureTextWidth`，度量与渲染共错时检测不到。需要用 headless Chrome 对 SVG 实测每个 `<text>` 的 `getBBox().width` 与其所在节点宽度比较，作为独立真值；另外新增 `overlappingEdgeLength`（共线重叠的边段总长，正交路由下的"平行线墙"现在不计入交叉数）和 `hubArrowStack`（同一节点同侧终点过密的数量）。

## AC

- [x] `scripts/measure-svg-text.mjs`：用 headless Chrome 加载 SVG，对每个 `<text>` 比较 `getBBox().width + paddingX*2` 与所在 `<rect>` 宽度，输出越界数；`node scripts/render-samples.mjs` 把它写入 `metrics.json` 的 `chromeTextOverflow` 字段，fixture 与 package 的该值为 0
- [x] `computeLayoutMetrics` 新增 `overlappingEdgeLength` 与 `hubArrowStack`，`tests/layout-metrics.test.ts` 用合成布局断言确定值
- [x] `tests/packing.test.ts`：12 个互不相连的节点渲染后宽高比 ≤ 3；`package-pkg-Tests_Layer` 的宽高比 ≤ 3
- [x] viz 决策二选一并落地：(a) `fixture.viz` 的 `areaUtilization` ≥ 0.2 且 `edgeNodeIntersections` === 0；或 (b) README 与 `RendererOptions` 文档标注 `'viz'` 为 experimental，并附 `docs/viz-decision.md` 记录度量对比
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染后 PNG 目视：Tests Layer 视图不再是一条长带，fixture 无大块空白；`metrics.json` 的 Chrome 实测溢出为 0，与内置度量一致或差异已被解释；viz 的去留决策有数据依据并写入文档。

## Touches

- tasks/gap-layout-packing-viz-metrics-truth.md
- src/layout/elk.ts
- src/layout/viz.ts
- src/layout-metrics.ts
- src/index.ts
- src/text-measure.ts
- scripts/render-samples.mjs
- scripts/measure-svg-text.mjs (new)
- README.md
- docs/viz-decision.md (new)
- tests/packing.test.ts (new)
- tests/layout-metrics.test.ts