---
id: gap-layout-balance-clearance-bundling
title: 版面均衡与边净距：根层空白象限、窄长堆叠小包、边贴节点/包框、枢纽脱节、梳状并行线
status: todo
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-render-external-nodes-labels-cjk
---
## Proposal

同一轮检查里（S/M/L/XL 与 `rendered/tiles/` 的 1:1 分块），几何度量都已通过（跨包边全为正交线、边穿节点为 0、`xl-all-classes` 从 13455×79369 降到 13245×6800、交叉从 9027 降到 4658），但**版面均衡与净距**还有明显问题，这些是肉眼马上看出的"不好看"，现有度量全部测不到：
1. **根层留下大块空白象限**：`xl-all-classes` 的 overview 里，右下方（r2c6 到 r5c7 一带）整片空白，而左上挤满；根层包是按行填的，行高参差。`m-package`（`package.puml`）则把 (root)/Examples/Templates/Tests 四个小层纵向窄窄堆在 Src Layer 上方正中，左右两侧各留近一半画布空白，`areaUtilization` 0.064（门槛 0.12）、宽高比 0.82，两项都未达标。小层应并排放在侧边或按行均衡装箱，且对齐到同一左边界。
2. **边贴着节点与包框走**：XL 的 r2c1 分块里，大量竖线紧贴类框边缘（如 `EntitySummary`、`PackageCycle`、`RuleEngine` 右侧）和包框边界并行重合，读者无法分清是边、框线还是节点轮廓。需要边到节点、边到包框的最小净距（如 ≥ 12px）。
3. **枢纽节点脱节**：`m-package` 的 Src Layer 左上角一排带徽标的 hub（`src/types`、`src/utils`、`src/core/query`…）与图无连线、横排在最上，像被遗忘的零件；应放在包框侧边的"轨道"里并带到被依赖方向的指引（或在边端标注），而不是孤立一行。
4. **梳状并行边**：`src/cli/commands` 向下发出约 10 条几乎平行的虚线，`src/cli/analyze` 也是；这些应合并成一条干线再分叉，或以一条带权重的边表示。
5. **一条穿越全图的长边**：`examples` 到 `src/plugins/golang` 的长虚线沿右侧竖穿整个 Src Layer；应让它沿包框外沿走，或把 Examples 放在靠近其目标的一侧。
6. **S 档超出宽高比阈值**：`s-architecture-manual` 宽高比 2.67（阈值 2.2），三个包框纵向堆叠但各自过宽。

## AC

- [ ] `computeLayoutMetrics` 新增 `maxEmptyBlockRatio`（画布栅格化后最大空白矩形面积 ÷ 画布面积）与 `edgeFlushCount`（边段与非端点节点或包框边界距离 < 6px 且平行的数量）；`tests/layout-metrics.test.ts` 用合成布局断言确定值
- [ ] `xl-all-classes`：`maxEmptyBlockRatio` ≤ 0.2，宽高比保持 0.5–2.5；`m-package`：`areaUtilization` ≥ 0.12 且宽高比 0.5–2.5；`s-architecture-manual`：宽高比 ≤ 2.2（`node scripts/render-samples.mjs --manifest <archguard 输出根目录>` 的阈值判定通过，退出码 0）
- [ ] ELK 配置边到节点、边到包框的最小净距（`elk.spacing.edgeNode` 与 `elk.spacing.edgeEdge`），对 `s-class`、`m-architecture`、`m-mermaid-view` 的 `edgeFlushCount` 为 0；`xl-all-classes` 的 `edgeFlushCount` 相对本任务落地前降低 ≥ 80%
- [ ] `tests/hub-rail.test.ts`：hub 节点与其所属包框同侧成轨道排列，不再占据包内顶部一整行；`m-package` 的 hub 与包内其它节点的最小间距 ≥ 一个网格单位且与包内容不重叠
- [ ] `tests/bundling.test.ts`：同一源节点向同方向发出的 ≥ 5 条边，在 `m-package` 渲染中合并为 ≤ 2 条可见线（或带权重的单线），并保留 `weight` 到 SVG 属性
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 S/M/L/XL 并看 1:1 分块与缩略图：`xl-all-classes` 不再有大块空白象限；`m-package` 小层并排且左对齐、不再窄堆在正中；边不再与节点或包框边缘重合；hub 不再是孤立一行；`src/cli/commands` 的梳状线合并。把 `maxEmptyBlockRatio` 与 `edgeFlushCount` 的前后对比数值记入 `docs/layout-routing-eval.md`。

## Touches

- tasks/gap-layout-balance-clearance-bundling.md
- src/layout/elk.ts
- src/layout-metrics.ts
- src/transform.ts
- src/render/svg.ts
- scripts/render-samples.mjs
- scripts/samples.json
- docs/layout-routing-eval.md
- tests/layout-metrics.test.ts
- tests/hub-rail.test.ts (new)
- tests/bundling.test.ts (new)