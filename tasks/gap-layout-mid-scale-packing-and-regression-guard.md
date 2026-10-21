---
id: gap-layout-mid-scale-packing-and-regression-guard
title: 中等规模根层包装箱（L 档退化为单列）+ 单包视图 stub 就近排布 + 回退守门（对基线比较）
status: todo
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Proposal

第六轮检查（S/M/L/XL，harness 现已走公开管线、无需补丁即可跑完）里，大部分样例继续变好（`s-architecture-manual` 标签有光晕、重复标签去重为 `uses ×6`；`m-architecture` 用 `compact` 详略；XL 在 `names` 详略下装成 6720×3428 的均衡画面，`overlappingEdgeLength` 95375→18332），但出现了**一次明显的退化，度量门槛却全部通过**：
1. **`l-plugins`（172 实体、约 17 个包）退化成单列竖排**：3877×7967，宽高比 0.49，`areaUtilization` 0.15→0.03，`maxEmptyBlockRatio` 0.14→0.30，`hubArrowStack` 12→37；所有包框堆成一根长柱，包间留着大片空白，大量长边沿右侧外沿绕行。同一管线下 56 个包的 XL 却能装箱成均衡矩形，说明根层装箱对"中等包数"没有生效（可能有包数阈值或只在特定条件下启用）。L 档当前只有宽高比 0.4–3 的阈值，0.49 刚好放行。
2. **单包视图的 stub 不就近**：`m-types-view`（65 实体）里被引用的外部包以两列虚线 stub 排在画布最右侧，到包内节点的边横穿整个包框；与上一轮相比 `edgeCrossings` 42→167，`overlappingEdgeLength` 0→1120。stub 应贴近各自连接的节点所在边界，或排成紧凑轨道并按目标位置排序。
3. **没有回退守门**：`render-samples.mjs` 只对固定阈值判定，不与已提交的 `rendered/metrics.baseline.json` 比较，所以像 L 这样"仍在阈值内的明显退化"（利用率降 5 倍）不会失败。

## AC

- [ ] 根层包装箱对中等包数生效：`tests/root-packing.test.ts` 对合成的 12 个互不相连或弱连通的顶层包断言，渲染宽高比在 0.6–2.5 之间、`maxEmptyBlockRatio` ≤ 0.15；`l-plugins`：`areaUtilization` ≥ 0.12、宽高比 0.6–2.5、`maxEmptyBlockRatio` ≤ 0.15（`scripts/samples.json` 为 L 档增加这三条阈值）
- [ ] 单包视图 stub 就近排布：`tests/stub-placement.test.ts` 断言每个 stub 节点到其所连接的包内节点的平均距离小于「stub 全部排在画布最右列」的同一图的对应值的 60%；`m-types-view` 的 `edgeCrossings` ≤ 80、`overlappingEdgeLength` ≤ 300
- [ ] 回退守门：`render-samples.mjs` 新增 `--compare <baseline.json>`（默认对已提交的 `rendered/metrics.baseline.json`），对每个样例检查 `edgeCrossings` 增幅 ≤ 25%、`areaUtilization` 降幅 ≤ 30%、`maxEmptyBlockRatio` 增幅 ≤ 0.05，超限则退出码非 0 并打印该样例与指标；`--baseline` 刷新基线；`tests/baseline-compare.test.ts` 用合成的两份 metrics 断言通过与失败两种情形
- [ ] 以第六轮结果更新并提交 `rendered/metrics.baseline.json`（只有在本任务的各项阈值满足之后），使后续任务有新的比较基线
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `l-plugins` 与 `m-types-view` 并看缩略图与 1:1 分块：L 的包框装成均衡的矩形而不是单列，`m-types-view` 的外部 stub 贴近各自的目标节点，边不再横穿整个包框；故意把某个样例的利用率人为降到基线的一半时，`--compare` 会让 harness 失败。

## Touches

- tasks/gap-layout-mid-scale-packing-and-regression-guard.md
- src/layout/elk.ts
- src/transform.ts
- scripts/render-samples.mjs
- scripts/samples.json
- rendered/metrics.baseline.json
- tests/root-packing.test.ts (new)
- tests/stub-placement.test.ts (new)
- tests/baseline-compare.test.ts (new)