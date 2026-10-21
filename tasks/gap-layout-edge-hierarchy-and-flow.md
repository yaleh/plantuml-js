---
id: gap-layout-edge-hierarchy-and-flow
title: 边的层级与依赖流向：强弱边可区分、并行边真正合并、包内保留依赖方向、XL 轮廓补齐
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
  - gap-render-edge-label-halo-and-dedupe
---
## Proposal

第五轮检查里，几何度量全部达标（`m-package` 紧凑到 1644×1276、利用率 0.23；`s-architecture-manual` 宽高比 1.45；XL 交叉 4646、跨包边全正交），但**依赖关系图本身的可读性**仍是最大弱点，度量没抓住：
1. **边没有层级**：`m-package` 的 Src Layer 里所有边都是同一种浅灰点线，`overlappingEdgeLength` 高达 24936（近平行重叠），像一团毛线；另外还有蓝色点线、暗红点划线两种家族，却没有看得见的说明。强依赖（权重大）和单次依赖、循环依赖、跨层依赖无法区分。
2. **并行边没有真正合并**：`src/cli/commands` 等节点仍向外发出一束平行线，`mergeEdges` 与束合并没有把它们并成干线；
3. **包内依赖流向丢失**：包内为了紧凑改用网格式环绕布局后，`m-package` 的 Src Layer 里 `src/cli/*`（上层）与 `src/types`、`src/core/*`（底层）混排，读者看不出"上层依赖下层"的方向，而这正是架构图最重要的信息；
4. **XL 轮廓不齐**：`xl-all-classes` 右下方约三分之一为空白、边缘呈阶梯状；`maxEmptyBlockRatio` 0.11 虽低于 0.2 的阈值，但阈值太松，缩略图一看就偏；`s-cli-utils-view` 利用率 0.233 低于 S 档阈值 0.25（第五轮唯一的阈值违例）；
5. **低对比**：虚线/点线在浅色包填充上的对比度低于 3:1（现有断言只对画布背景，不对包填充色）。

## AC

- [ ] 边按权重与类别分层：`weight ≥ 3` 的边线宽/不透明度高于 `weight = 1` 的边；弱依赖（type-only 或 dependency）与强依赖（继承/组合/实现/关联）线型不同；循环回边仍为单独样式；`tests/edge-hierarchy.test.ts` 对合成模型断言这三层在 SVG 中的 `stroke-width`/`stroke-opacity`/`stroke-dasharray` 互不相同，且全部来自 theme token
- [ ] 并行边合并：`m-package` 的 `overlappingEdgeLength` 相对第五轮（24936）降低 ≥ 60%，`xl-all-classes` 相对（95374.84）降低 ≥ 50%；`tests/bundling.test.ts` 追加断言：同源同方向 ≥ 5 条边渲染为共享干线再分叉
- [ ] 包内依赖流向：`tests/package-flow.test.ts` 对合成的 5 层依赖链断言，包内布局后上游节点的 y（或环绕列序）单调不逆，违反依赖方向的节点对占比 ≤ 10%；`m-package` 的 Src Layer 中 `src/cli/commands` 的位置高于 `src/types`
- [ ] 对比度：主题测试断言各类边（含虚线/点线）与其可能所处的最深包填充色的对比度 ≥ 3:1（`tests/theme-contrast.test.ts` 扩展）
- [ ] 阈值收紧并通过：`maxEmptyBlockRatio` 的 XL 阈值改为 ≤ 0.08、M 档 ≤ 0.1；`s-cli-utils-view` 的 `areaUtilization` ≥ 0.25；`node scripts/render-samples.mjs --manifest <archguard 输出根目录>` 退出码 0
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `m-package`、`xl-all-classes` 与 `m-architecture` 并看分块与缩略图：强弱边一眼可分，并行线束合成干线，Src Layer 里能读出"cli 在上、types/core 在下"的依赖方向，XL 的右下不再有大块空白；把前后度量与自评分记入 `docs/layout-routing-eval.md`。

## Touches

- tasks/gap-layout-edge-hierarchy-and-flow.md
- src/layout/elk.ts
- src/transform.ts
- src/render/svg.ts
- src/render/theme.ts
- src/layout-metrics.ts
- scripts/samples.json
- docs/layout-routing-eval.md
- tests/edge-hierarchy.test.ts (new)
- tests/package-flow.test.ts (new)
- tests/bundling.test.ts
- tests/theme-contrast.test.ts