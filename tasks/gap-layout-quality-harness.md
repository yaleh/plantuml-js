---
id: gap-layout-quality-harness
title: 布局质量度量 + 渲染/截图脚本（后续所有 layout 任务的度量基线）
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

当前 layout 没有质量目标：`src/edge-router.ts` 只能断言"边不穿过无关节点/边是正交的"，无法量化布局好坏，改 ELK/Graphviz 选项全凭肉眼。本任务建立度量基线：新增 `src/layout-metrics.ts`，对 `LayoutResult`（加上 `PlantUmlModel`）计算边交叉数、边穿过无关节点数、总边长、画布面积利用率（节点+包框面积 / 画布面积）、宽高比、文本溢出数（节点内最长行的 `measureTextWidth` 超过节点宽度的行数）、包标签与内容重叠数。再新增 `scripts/render-samples.mjs`：用同一输入（`tests/fixtures/archguard-class.puml`、新增的 `tests/fixtures/archguard-package.puml`，以及可选的外部 archguard 输出目录）分别以 elk/viz 渲染 SVG 到 `rendered/`，用 headless Chrome 转 PNG，并输出 `rendered/metrics.json`，使每个阶段结束后可复现地"渲染 + 度量 + 目视检查"。

## AC

- [ ] `src/layout-metrics.ts` 导出 `computeLayoutMetrics(model, layout)`，返回 edgeCrossings、edgeNodeIntersections、totalEdgeLength、areaUtilization、aspectRatio、textOverflowCount、labelOverlapCount；`npx vitest run tests/layout-metrics.test.ts` 退出码 0，用合成布局断言每个度量的确定值（含一个故意溢出/交叉的反例）
- [ ] `node scripts/render-samples.mjs` 退出码 0，在 `rendered/` 生成 fixture/package 两组图各 elk、viz 两个 SVG 与对应 PNG，以及 `rendered/metrics.json`（每个图一条记录）
- [ ] `tests/fixtures/archguard-package.puml` 存在且能被 `createRenderer` 解析无错
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过
- [ ] 当前基线数值写入 `rendered/metrics.baseline.json` 并提交（`rendered/` 其余产物仍被 gitignore）

## DoD

以真实 archguard 产出的 fixture 与 package 图（不是手写 toy）端到端跑通 `render-samples.mjs`，metrics.json 里每个图都有非空度量，并且基线文件反映当前（较差）布局的真实数值，后续任务据此对比改进。

## Touches

- tasks/gap-layout-quality-harness.md
- src/layout-metrics.ts (new)
- scripts/render-samples.mjs (new)
- tests/layout-metrics.test.ts (new)
- tests/fixtures/archguard-package.puml (new)
- rendered/metrics.baseline.json (new)
- .gitignore
- package.json