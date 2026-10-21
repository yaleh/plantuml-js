---
id: gap-layout-legibility-legend-metrics-fixes
title: 可读性：hub 徽标不遮标签 + 图例 + overview 空白/权重标签 + 视图与完整图同管线 + 度量失真修正
status: done
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-cross-package-routing-large-graph
---
## Proposal

第二轮落地后 `package.elk` / `package-overview.elk` / `package-pkg-Src_Layer.elk` 的 PNG 目视检查发现：
1. **hub 徽标遮住节点名**：`renderHubBadge`（`src/render/svg.ts`）把红色圆徽画在节点右上角内侧，盖住了名字末尾，如 `src/util●`、`src/type●`、`src/core/quer●`、`src/core/interface●`（名字被截断，读不出）。徽标应画在节点右上角外侧（半出框），必要时节点加宽。
2. **没有图例**：红色回边、徽标数字、`×N` 权重、虚线/实线节点框（overview 里虚线=分组、实线=单个模块）都没有说明，读图的人无法知道编码含义。需要可选图例（`legend: true`），默认在较大图中开启。
3. **overview 版面浪费**：`package-overview.elk` 左半幅空白，4 个孤立节点（`tests`、`(root)`、`tests/poc`、`templates/...`）排在顶行把连通部分挤向右边；面积利用率仅 0.056；`×N` 权重标签压在线上看不清，需要白底；边绕过整个右侧回到 `src/types`、`src/utils`。孤立节点应收到一条紧凑的侧边/底部区域。
4. **完整图里 Tests Layer 仍是一整排长条**（12 个孤立节点横排，约 3500 px 宽，撑大整张画布），只有单包视图才被换行装箱；顶部 (root)/Examples/Templates 三个小包纵向堆叠留下大片空白；hub 节点被丢成 Src Layer 顶部一行与图脱节。
5. **视图与完整图不同管线**：`package-pkg-Src_Layer` 视图没有应用完整图的默认枢纽汇总，交叉数反而比上一阶段更差（1445→1898），`edgeNodeIntersections` 0→9；`Tests Layer` 视图里 stub 到节点的虚线穿过节点框。视图应走与完整图相同的默认变换。
6. **度量失真**：`overlappingEdgeLength` 要求严格共线（距离 ≤0.01px），所有图都是 0，但图里明显有大量近距平行线；需改为"近平行邻近长度"（横向距离 ≤ 8px 的平行段重叠长度）。另需新增 `badgeLabelOverlap`（徽标压到节点文字）与边标签遮挡度量。
7. **harness 缺口**：`render-samples.mjs` 的外部目录参数只认直接包含 `all-classes.puml` 的目录，传 archguard 输出根目录会静默跳过（"no all-classes.puml … skipping"）；应自动发现 `class/`、`overview/` 子目录。

## AC

- [x] `tests/hub-badge.test.ts`：渲染含 hub 的模型，徽标圆的包围盒与该节点文字包围盒不相交（`badgeLabelOverlap === 0`）；`computeLayoutMetrics` 新增 `badgeLabelOverlap`，合成反例断言确定值
- [x] `tests/legend.test.ts`：`legend: true` 时 SVG 含图例分组，列出回边、徽标、权重、分组框样式；默认对节点数 >30 的图开启
- [x] `overlappingEdgeLength` 改为近平行邻近长度，`tests/layout-metrics.test.ts` 断言：两条相距 3px 的平行线重叠长度为其公共投影长度；对 `package.elk` 的度量值 > 0
- [x] `package-overview`（depth=2）：孤立节点集中在不挤占主图的区域，`areaUtilization` ≥ 0.15；权重标签带白底，`tests/overview-labels.test.ts` 断言标签矩形不与其它标签矩形相交
- [x] 完整 `package` 图：Tests Layer 宽高比 ≤ 3，画布总宽 ≤ 2400 px；`package-pkg-Src_Layer` 视图的 `edgeCrossings` ≤ 完整图中 Src Layer 部分、`edgeNodeIntersections` === 0
- [x] `node scripts/render-samples.mjs --views <archguard 输出根目录>` 能自动发现 `class/all-classes.puml` 与 `overview/package.puml`；`npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `package.elk`、`package-overview.elk`、`package-pkg-Src_Layer.elk`、`package-pkg-Tests_Layer.elk`，PNG 目视：节点名完整可读、有图例、overview 无大片空白、完整图不再有 3500 px 的孤立节点长条；`metrics.json` 的新增/修正度量非零且与目视一致。

## Touches

- tasks/gap-layout-legibility-legend-metrics-fixes.md
- src/render/svg.ts
- src/render/labels.ts (new)
- src/render/legend.ts (new)
- src/layout-metrics.ts
- src/layout/elk.ts
- src/layout/compound.ts
- src/core.ts
- src/transform.ts
- src/index.ts
- scripts/render-samples.mjs
- tests/hub-badge.test.ts (new)
- tests/legend.test.ts (new)
- tests/overview-labels.test.ts (new)
- tests/layout-metrics.test.ts
