---
id: gap-layout-grid-density-stub-labels-nested-loops
title: 网格列距收紧（Tests Layer 过稀）+ 组 stub 命名与粗线上限 + 同心回路降到近 0 + 边不贴画布边缘
status: ready
labels:
  - gap
  - layout
  - design
parent: null
children: []
extra:
  schema: execution
---
## Proposal

第九轮检查（`gap-layout-trunk-detours-grid-columns-stub-grouping` 落地后，S/M/L/XL 全部阈值通过、`--compare` 无回退、测试 57 文件 246 个通过）里，上一轮的目标基本达成：`trunkDetourCount` 全样例 ≤ 2、`m-types-view` stub 65→46 个实体、画布 2900×2068→2188×1700、`m-package` 的 Tests Layer 变成行列网格。但看图又发现这几处新问题，度量没覆盖：
1. **Tests Layer 网格列距过大、过稀**：`m-package` 里 12 个节点排成 6 行 2 列，但两列相距约 520px（节点宽度约 200–380px），包框撑到约 1020×525，节点只占框面积的约 25%，右半边大片空白，画布从 1644 宽涨到 1876 宽。列宽应取该列最宽节点加固定间距（如 24px），包框随内容收紧，而不是被拉伸。
2. **组 stub 的标签没有意义**：`m-types-view` 里 19 个 stub 被合并成名为 `Src … (×19)` 的框，另一个是 `Src Analysis … (×2)`，读者看不出里面是什么。标签应写出人能理解的内容，如 `19 other Src packages`，并在 `<title>` 里列出全部成员名；多个组 stub 之间用同一命名规则。
3. **粗线没有上限**：聚合后的边权重 `×51`、`×20`、`×11` 画成 5–6px 的粗虚线，压过节点；权重应对数缩放并设线宽上限（如 ≤ 4px），线上的 `×N` 保持。
4. **同心矩形回路只被度量、尚未消除**：`nestedLoopCount` 目前 `m-package` 9、`l-plugins` 4、`xl-all-classes` 11。
5. **边贴着画布边缘走**：`m-types-view` 左侧最外沿有竖线贴着画布左边（x≈5–30px）绕行，既容易被裁切，也不好看。

## AC

- [ ] `computeLayoutMetrics` 新增 `frameFillRatio`（每个包框内节点总面积 ÷ 该框面积，取所有含 ≥ 6 个节点的包框的最小值）与 `edgeCanvasMargin`（所有边点到画布四边的最小距离）；`tests/layout-metrics.test.ts` 用合成布局断言确定值
- [ ] 网格列距收紧：`tests/grid-columns.test.ts` 追加断言——相邻两列左边缘之差 ≤ 该列最宽节点宽度 + 32px，包框宽度 ≤ 各列宽度之和 + 内边距；`m-package` 的 Tests Layer 的 `frameFillRatio` ≥ 0.4，且 `m-package` 画布宽度 ≤ 1700px
- [ ] 组 stub 命名：`tests/stub-grouping.test.ts` 追加断言——组 stub 的可见标签含成员数量与"其它包/other packages"的含义（不得为 `Src … (×N)` 形式），`<title>` 列出全部成员名；`m-types-view` 渲染结果里不含字面量 `…（×` 或 `… (×` 形式的组名
- [ ] 线宽上限：`tests/line-semantics.test.ts` 追加断言——任意权重下边的 `stroke-width` ≤ 4（来自 theme token `edgeWidthMax`），权重 ×51 与 ×20 的线宽不相等且前者更粗
- [ ] 回路降低：`nestedLoopCount` 在 `m-package` ≤ 3、`l-plugins` ≤ 1、`xl-all-classes` ≤ 4（均写入 `scripts/samples.json` 作为新的上限），`trunkDetourCount` 保持 ≤ 2
- [ ] 画布边距：全部样例 `edgeCanvasMargin` ≥ 12px（`scripts/samples.json` 阈值）
- [ ] `render-samples.mjs --compare` 无回退，刷新 `rendered/metrics.baseline.json`；`npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `m-package`、`m-types-view`、`l-plugins`、`xl-all-classes` 并看缩略图与 1:1 分块：Tests Layer 是紧凑的 2 列网格，组 stub 的名字能读懂，粗线不压过节点，包框里的方形线圈显著减少，没有线贴着画布边缘；评分由外部评审在落地后追加到 `docs/visual-review-log.md`。

## Touches

- tasks/gap-layout-grid-density-stub-labels-nested-loops.md
- src/layout/elk.ts
- src/layout/compound.ts
- src/layout/trunk-lanes.ts
- src/layout/layout-metrics.ts
- src/transform.ts
- src/render/svg.ts
- src/render/theme.ts
- scripts/samples.json
- rendered/metrics.baseline.json
- docs/layout-routing-eval.md
- tests/layout-metrics.test.ts
- tests/grid-columns.test.ts
- tests/stub-grouping.test.ts
- tests/line-semantics.test.ts