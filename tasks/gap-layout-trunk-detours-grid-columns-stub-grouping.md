---
id: gap-layout-trunk-detours-grid-columns-stub-grouping
title: 干线不绕簇（同心矩形回路）+ 孤立节点按等宽列网格排（Tests Layer 阶梯）+ stub 过多时按前缀分组
status: ready
labels:
  - gap
  - layout
  - design
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-build-clean-dist-and-harness-metrics-path
---
## Proposal

第八轮检查（用正确的度量模块，S/M/L/XL 全部阈值通过）里，一对多扇出已不再是平行梳状线，走廊也走包框之间的缝隙（`l-plugins` 交叉 213→132，XL 975→621，`m-types-view` 70→29，`m-package` 466→255）。图的整体观感继续变好（评分：`m-types-view` 37、`l-plugins` 37、XL 38、`m-package` 31）。剩下的几个"不够好看"的地方：
1. **干线绕簇形成同心矩形回路**：XL 的 Mermaid、Parser、Golang 等包框、以及 `l-plugins` 的 Python 包框里，干线为了避开节点簇绕出一圈圈嵌套的矩形，整块区域像一团方形的线圈，读不出从哪到哪。干线应该走节点行之间的通道（lane），路径长度不应显著超过曼哈顿距离。
2. **`m-package` 的 Tests Layer 是阶梯形**：12 个互不相连的节点按"每行放得下几个"换行，得到 3-2-2-1-1-1-1-1 的参差阶梯，右边留着三角形空白，旁边还有三个很小的单行框；应按等宽列的网格排列（列宽取最宽节点），行列对齐。
3. **`m-package` 的 Src Layer 仍有深色虚线贴着节点边框走**：多条线紧贴 `src/cli/processors`、`src/plugins/golang` 等节点的上下沿，难以与节点轮廓区分（`edgeFlushCount` 为 0 是因为阈值只看 < 6px 且与非端点节点平行；这些线与端点节点本身贴着）。
4. **单包视图 stub 太多**：`m-types-view` 右侧轨道里有 25 个独立的 stub 框，把画布撑得很高；同一前缀的 stub 应分组合并成"Src Cli …（×6）"这样的组 stub，边聚合到组上（原始每条边保留在 `<title>`）。

## AC

- [x] `computeLayoutMetrics` 新增 `trunkDetourCount`（路径长度 > 2 倍曼哈顿距离的边数）与 `nestedLoopCount`（同一包框内，由 ≥ 3 条边段围成、互相嵌套的闭合矩形回路数，可用"边路径的包围盒互相嵌套且边的端点不在该包围盒内"近似），`tests/layout-metrics.test.ts` 用合成布局断言确定值（含一个绕簇反例）
- [ ] 干线走行间通道（`tests/trunk-lanes.test.ts` 对合成的"一源多目标、中间夹一簇节点"布局断言干线不绕出该簇的包围盒），并且 S/M/L/XL 全部样例的 `trunkDetourCount` ≤ 2；`nestedLoopCount` 在 `m-package`、`l-plugins`、`xl-all-classes` 上不得高于本任务实现后的实测值（当前实测 9 / 4 / 11，写入 `scripts/samples.json` 作为上限阈值，`--compare` 无回退）；进一步把 `nestedLoopCount` 降到 0 另立后续任务，本任务不要求
- [x] `tests/grid-columns.test.ts`：12 个互不相连的节点渲染后，同一列的节点左边缘 x 相同、同一行的节点顶边 y 相同（容差 1px），最后一行之外无空洞；`m-package` 的 Tests Layer 宽高比在 0.8–2.0 之间，且与同层小框顶对齐
- [x] 新增 `edgeNodeFlush`（边段与其端点节点的上/下/左/右边框平行且间距 < 4px、长度 ≥ 40px 的数量），对 `m-package`、`m-architecture`、`s-*` 样例为 0
- [x] 单包视图 stub 分组：`stubGroupThreshold` 选项（默认 8），stub 数超过阈值时按名称前缀（去掉末尾单词）分组，`tests/stub-grouping.test.ts` 断言 25 个 stub 合并后 ≤ 8 个组 stub，组 stub 上的边带 `×N` 与 `<title>`；`m-types-view` 的 stub 数 ≤ 8，画布高度相对第八轮（2068）降低 ≥ 15%
- [x] `scripts/samples.json` 为 M/L/XL 档加入 `trunkDetourCount`、`nestedLoopCount`、`edgeNodeFlush` 阈值，`--compare` 无回退，刷新 `rendered/metrics.baseline.json`
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `xl-all-classes`、`l-plugins`、`m-package`、`m-types-view` 并看缩略图与 1:1 分块：Tests Layer 是整齐的行列网格，stub 轨道简短，`trunkDetourCount` 在全部样例上不超过 2；同心矩形回路的数量（`nestedLoopCount`）被度量并记录为上限，完全消除留给后续任务。前后度量与自评分由外部评审在落地后追加到 `docs/visual-review-log.md`。

## Touches

- tasks/gap-layout-trunk-detours-grid-columns-stub-grouping.md
- src/layout/elk.ts
- src/layout/compound.ts
- src/layout/trunk-lanes.ts (new)
- src/layout/layout-metrics.ts
- src/transform.ts
- scripts/samples.json
- rendered/metrics.baseline.json
- docs/layout-routing-eval.md
- docs/visual-review-log.md
- tests/trunk-lanes.test.ts (new)
- tests/grid-columns.test.ts (new)
- tests/stub-grouping.test.ts (new)
- tests/layout-metrics.test.ts
- tests/stub-rail.test.ts
- tests/stub-placement.test.ts
