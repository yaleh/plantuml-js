---
id: gap-layout-scale-ladder-and-dense-overview-reduction
title: 合成规模阶梯样例（10→400 实体）+ 布局耗时度量 + 稠密依赖图的传递约简（可选，带图例说明）
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

第十轮检查（`gap-layout-grid-density-stub-labels-nested-loops` 落地后，测试 57 文件 252 个通过，`--compare` 无回退，全部阈值通过）里，上一轮点名的问题基本解决：`nestedLoopCount` 9→2（`m-package`）、4→1（`l-plugins`）、11→2（XL）；`m-types-view` 交叉 78→35，组 stub 的标签变成 `19 other Src packages`、`2 other Src Analysis packages`；`m-package` 的 Tests Layer 变成紧凑的 2 列网格，画布 1644×1512；`edgeCanvasMargin` 在所有样例 ≥ 16。剩下的不足已经从几何问题变成"覆盖面"与"信息密度"：
1. **真实样例只有少数几个规模点**：现在 S 档 3 个、M 档 4 个、L 档 1 个、XL 档 1 个，都来自同一个项目。规模之间一旦出现不连续的退化（上一次 L 档单列就是这样），只有恰好落在这些点上才能发现。需要一组**可复现的合成规模阶梯**，覆盖 10、25、50、100、200、400 个实体，含包嵌套、继承/实现/组合/关联/依赖混合，以及带 Tests/Examples 这类孤立小层。
2. **没有耗时度量**：XL 一次整体渲染约 36 秒（含 Chrome 截图），但布局本身耗时没有记录，也没有阈值；大图的性能退化现在不会被发现。
3. **稠密依赖图仍然很满**：`m-package`（64 个模块、约 217 条依赖边）的 Src Layer 虽已按层排布，仍有 244–287 次交叉，一堆深色虚线平行走过；这类纯依赖图里大量边是传递的（A→B→C 已蕴含 A→C）。提供可选的传递约简（默认 `auto`：仅当全部关系为依赖/关联类且边数 > 3 倍节点数时启用），并在图例与 `data-*` 里明确说明"已隐藏 N 条传递依赖"，用户可设 `edgeReduction: 'none'` 恢复全部边。

## AC

- [x] `scripts/gen-class-ladder.mjs`：给定种子与实体数，确定性地生成 `.puml`（含 2–12 个包、嵌套包、5 种关系类型、成员行、少量孤立节点），同一种子两次输出字节一致；`tests/gen-class-ladder.test.ts` 断言同种子一致、不同种子不同、实体数与参数相符
- [x] `scripts/samples.json` 新增 `g-10`、`g-25`、`g-50`、`g-100`、`g-200`、`g-400` 六个阶梯样例（生成到 `rendered/generated/`，不提交产物），各自带档位与阈值：宽高比 0.6–2.5、`areaUtilization` ≥ 0.08、`edgeNodeIntersections` 0、`nonOrthogonalEdgeCount` 0、`textOverflowCount` 0、`nestedLoopCount` ≤ 3；`node scripts/render-samples.mjs --manifest <archguard 输出根目录> --compare` 渲染它们并按阈值判定，退出码 0
- [x] 新增度量 `layoutMs`（仅布局引擎耗时，不含 Chrome），写入 `metrics.json`；`samples.json` 为 XL 与 `g-400` 设阈值 ≤ 20000ms；`--compare` 对 `layoutMs` 增幅 > 50% 时失败（允许 `--ignore-timing` 在慢机器上跳过）
- [x] 传递约简：`RendererOptions.edgeReduction: 'auto' | 'transitive' | 'none'`，默认 `auto`；`tests/edge-reduction.test.ts` 断言：纯依赖的合成图（A→B、B→C、A→C）在 `auto` 下 A→C 被隐藏，SVG 含 `data-hidden-transitive="1"` 汇总信息，图例里出现隐藏条数；含继承/组合边的图在 `auto` 下不约简；`none` 恢复全部边
- [x] `m-package` 在 `auto` 下可见边数 ≤ 原边数的 70%，`edgeCrossings` 相对第十轮（287）降低 ≥ 25%；`m-architecture` 与所有 S 档样例（含类关系）不受影响（边数不变）
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

执行 `render-samples.mjs --manifest … --tiles --compare`，得到 S/M/L/XL 加 6 个合成阶梯共 ≥ 15 个样例的度量表（含 `layoutMs`）；抽查 `g-50`、`g-200` 与 `m-package` 的缩略图与 1:1 分块，确认规模阶梯上没有不连续的退化、`m-package` 在约简后更清楚且图例说明了被隐藏的边数；评分由外部评审在落地后追加到 `docs/visual-review-log.md`。

## Touches

- tasks/gap-layout-scale-ladder-and-dense-overview-reduction.md
- scripts/gen-class-ladder.mjs (new)
- scripts/samples.json
- scripts/samples-lib.mjs
- scripts/render-samples.mjs
- src/transform.ts
- src/core.ts
- src/index.ts
- src/layout/layout-metrics.ts
- src/render/svg.ts
- rendered/metrics.baseline.json
- docs/layout-routing-eval.md
- tests/gen-class-ladder.test.ts (new)
- tests/edge-reduction.test.ts (new)
- tests/layout-metrics.test.ts
- tests/small-layers.test.ts
