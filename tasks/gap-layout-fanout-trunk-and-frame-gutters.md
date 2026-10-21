---
id: gap-layout-fanout-trunk-and-frame-gutters
title: 一对多扇出合并为干线+分支（梳状平行线）+ 走廊走框间缝隙不穿越无关包框 + 单包视图 stub 与空白
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

第七轮检查（S/M/L/XL，`--compare` 无回退）里，上一轮的两个问题已修好：`l-plugins` 现在装成均衡的 2746×3006（利用率 0.03→0.12，交叉 677→213），XL 包间边聚合成少数带权走廊（交叉 4024→975，近平行重叠 18332→4130）。这一轮最显眼的剩余问题全是度量没抓住的：
1. **一对多扇出画成阶梯状平行线**：`l-plugins` 的 Java 与 Python 包框里，`TreeSitterBridge_3`/`TreeSitterBridge_5` 向下发出约 12 条粗虚线，到十几个 `Raw*` 类，画成一束嵌套直角阶梯的平行线，占据整个框的中部，既不好看也读不出结构。同样的梳状线在 `m-package` 的 `src/cli/commands` 也能看到。`overlappingEdgeLength` 在 `l-plugins` 只有 1470，因为这些平行线间距约 8–10px，超出现有"近平行"阈值，度量完全看不见。应该按"同源（或同目标）、同种类"合并为共享干线再分叉的树形。
2. **走廊穿越无关包框的内部**：XL 与 L 里粗虚线走廊沿垂直方向直接穿过 Golang Atlas、Java 等无关包框的内部（只是没碰节点，所以 `edgeNodeIntersections` 仍为 0），应该只走包框之间的缝隙（gutter）。没有度量覆盖"边穿过无关包框"。
3. **单包视图 stub 散乱 + 大块空白**：`m-types-view` 的 stub 虽然比上一轮更靠近目标（交叉 167→70），但在包框上方排成几行、左侧还零散放了两个，且仍有长虚线从包框顶部垂入内部；包框内部有大片空白。stub 应沿包框的最近一侧边界排成一条有序的轨道，按其目标节点的位置排序。
4. **`m-package` 的 Tests Layer**：12 个互不相连的节点排成一列两格一行的高柱，旁边是三个很小的单行框，同层不齐。

## AC

- [x] `computeLayoutMetrics` 新增 `parallelBundleCount`（同源或同目标、方向相近、彼此横向间距 ≤ 16px 且平行段长度 ≥ 120px 的边组，组内边数 ≥ 5 计一组）与 `edgeFrameCrossings`（边段穿过与其端点无祖先关系的包框内部的数量）；`tests/layout-metrics.test.ts` 用合成布局断言确定值，含一个"12 条平行线"反例与一个"边穿过无关包框"反例
- [x] `tests/fanout-trunk.test.ts`：一个源节点向同一方向、同一种类发出 ≥ 5 条边时，SVG 中这些边共享一段干线（至少 70% 的路径长度与另一条同组边重合，重合段只画一次），再分叉到各目标；对 `l-plugins` 的 Java 与 Python 包框，`parallelBundleCount` 为 0
- [x] 全部 S/M/L/XL 样例的 `parallelBundleCount` ≤ 1；`m-package` 的 `src/cli/commands` 不再有 ≥ 5 条平行线
- [x] 走廊走缝隙：`l-plugins` 与 `xl-all-classes` 的 `edgeFrameCrossings` 相对本任务落地前（第七轮）降低 ≥ 80%，`l-plugins` 的垂直粗走廊不再穿过 Golang Atlas 与 Java 包框内部（`tests/gutter-routing.test.ts` 对合成的三列包布局断言跨列边只走列间缝隙）
- [x] 单包视图 stub 成轨道：`tests/stub-rail.test.ts` 断言 stub 都贴着包框的同一侧外沿、沿该侧按其目标节点位置排序，相邻 stub 间距一致；`m-types-view` 的 `edgeCrossings` ≤ 40
- [x] `m-package` 的 Tests Layer 按目标宽高比装成网格（宽高比 ≤ 2.5），且与其它小层同行顶对齐（`tests/small-layers.test.ts`）
- [x] `render-samples.mjs --compare` 无回退，`scripts/samples.json` 对 L/XL 增加 `edgeFrameCrossings` 与 `parallelBundleCount` 的阈值；刷新 `rendered/metrics.baseline.json`
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `l-plugins`、`m-package`、`m-types-view`、`xl-all-classes` 并看缩略图与 1:1 分块：Java 与 Python 包框里的扇出是干净的树形而不是阶梯，走廊在框与框之间的缝隙里走，stub 排成有序轨道；把前后度量与自评分追加到 `docs/visual-review-log.md`。

## Touches

- tasks/gap-layout-fanout-trunk-and-frame-gutters.md
- src/layout/elk.ts
- src/layout/fanout-trunk.ts (new)
- src/layout/grid-router.ts
- src/layout/compound.ts
- src/layout/lane-spread.ts
- src/transform.ts
- src/layout-metrics.ts
- src/render/svg.ts
- scripts/samples.json
- scripts/render-samples.mjs
- rendered/metrics.baseline.json
- docs/layout-routing-eval.md
- vitest.config.ts
- tests/fanout-trunk.test.ts (new)
- tests/gutter-routing.test.ts (new)
- tests/stub-rail.test.ts (new)
- tests/small-layers.test.ts (new)
- tests/layout-metrics.test.ts
- tests/stub-placement.test.ts
