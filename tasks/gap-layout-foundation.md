---
id: gap-layout-foundation
title: layout 地基：等宽文本度量修正 + ELK 层级/版面选项 + Graphviz 尺寸与 cluster
status: done
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-quality-harness
---
## Proposal

视觉检查发现的三类根因，合并为一个地基任务（同一批文件、同一套验收）：
1. `src/text-measure.ts` 对 `i l . , : ( )` 等字符用 4.8px 窄宽度，但 SVG 字体是 monospace，所有字符等宽（约 0.6em），导致成员签名系统性低估而溢出框。改为按字体固定 advance 度量，并让渲染器与度量绑定同一字体族/字号常量（`METRICS`）。
2. `src/layout/elk.ts` 缺少 `elk.hierarchyHandling: INCLUDE_CHILDREN`（跨包的边没有参与包内布局，导致包内节点松散成行）、目标 `elk.aspectRatio`、`elk.separateConnectedComponents`、孤立节点矩形装箱、包标签的 padding/placement（标签与内容重叠）。
3. `src/layout/viz.ts` 的 `modelToDot` 只把 `entity.name` 当 label、不传节点尺寸、忽略 `model.packages`：节点用 `fixedsize=true` 加 `estimateEntitySize` 的 width/height（英寸）、包映射为 `subgraph cluster_*`（返回 `packages`）、设置 `nodesep/ranksep`，并修正 viewBox 以包含负坐标。

## AC

- [x] `tests/text-measure.test.ts`：等宽字体下任意字符等宽；`+kind: FunctionFingerprintKind` 这类行在 `estimateEntitySize` 给出的框内 `textOverflowCount === 0`；`npx vitest run` 通过
- [x] ELK 输出：fixture 渲染的 `textOverflowCount === 0` 且 `labelOverlapCount === 0`（经 `computeLayoutMetrics`），`areaUtilization` 相对 `rendered/metrics.baseline.json` 提升
- [x] viz 输出：fixture 的节点高度等于 `estimateEntitySize` 的高度（成员区被计入），`packages` 非空，`textOverflowCount === 0`
- [x] `node scripts/render-samples.mjs` 退出码 0，且 package 图的 `aspectRatio` 落在 1.2–2.2 内
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，同一输入两次渲染字节一致（确定性）

## DoD

用真实 archguard fixture 与 package 图渲染后，PNG 目视无文字溢出、包标签不再压住内容、viz 图不再是一条横带；`rendered/metrics.json` 相对基线在溢出数、面积利用率上有可量化改善，结果记录在任务评论或提交信息中。

## Touches

- tasks/gap-layout-foundation.md
- src/text-measure.ts
- src/layout.ts
- src/layout/elk.ts
- src/layout/viz.ts
- src/render/svg.ts
- tests/text-measure.test.ts (new)
- tests/layout-foundation.test.ts (new)
- tests/viz.test.ts
- tests/render.test.ts