---
id: gap-layout-interpackage-aggregation-and-line-semantics
title: 大图包间边聚合成走廊 + 线型语义（强边不再用点线）+ 同层框对齐与孤立框并排
status: done
labels:
  - gap
  - layout
  - design
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-mid-scale-packing-and-regression-guard
---
## Proposal

第六轮目视检查（缩略图 + 1:1 分块）里剩下的最大问题已不是几何，而是**大图的信息呈现与线型语义**：
1. **XL 的包间边是一张看不清的淡网**：`xl-all-classes` 的框装得很均衡，但 660 个类之间约 950 条边里，跨包边在缩略图上只是几乎不可见的淡线，读者无法回答"哪个包依赖哪个包、有多强"。大图应把包间边聚合成"框到框"的走廊（每对包一条带权重的粗线，`×N` 标签），包内边保持原样，二者在视觉上分开（包间深、包内浅，或反之，但要有明确的主次）；原始边保留在 `<title>`/`data-*` 里。
2. **线型语义含混**：`m-package` 里权重大的强依赖也是点线（只是更深色），点线在习惯上表示"弱/可选"，与类图里依赖（`..>`）的虚线含义撞车；`m-architecture` 与 XL 的大多数边也都是 `3,3` 点线。线型应只表达关系种类：继承/实现/组合/关联为实线，依赖为虚线；权重只用线宽与不透明度表达；循环回边才用点划线。
3. **同层框不对齐、孤立框浮着**：`s-architecture-manual` 里三个包框左边缘各不相同，`Utils` 框孤立在左侧；`m-package` 的 Tests Layer 是一列 12 个节点的高柱而其它小层是一行。同一行的框应顶对齐、同一列的框应左对齐，孤立框与相邻框并排而不是悬空。
4. **缩略图下边线太淡**：边在 5 倍缩小后几乎消失；主次边需要有可读的最小对比度（含非色彩线索）。

## AC

- [x] `view`/渲染选项 `interPackage: 'aggregate' | 'raw'`，默认对实体数 > 150 的图为 `aggregate`；`tests/interpackage-aggregate.test.ts` 断言：两个包之间的 N 条跨包边渲染为 1 条框到框的边，SVG 属性 `data-weight` 等于 N，带 `×N` 标签，且原始每条边的描述保留在 `<title>` 里
- [x] 线型语义测试 `tests/line-semantics.test.ts`：继承/实现/组合/关联在 SVG 中均为实线（无 `stroke-dasharray`），依赖为虚线，回边为点划线；`weight` 大的边 `stroke-width`/`stroke-opacity` 严格大于 `weight = 1` 的边；全部取自 theme token
- [x] 对 `xl-all-classes`：聚合后可见的包间边数 ≤ 原跨包边数的 40%，`edgeCrossings` 相对第六轮（4024）降低 ≥ 40%，`overlappingEdgeLength` 不高于第六轮（18332）
- [x] 对齐：`tests/frame-alignment.test.ts` 对合成的 6 个包断言，同一行的包框 y 相同、同一列的包框 x 相同（容差 1px）；`s-architecture-manual` 三个包框左边缘 x 相同
- [x] 最小对比度：主、次边与其所处最深包填充的对比度 ≥ 3:1，且次边在 1/4 缩略图下（把 SVG 缩放 0.25 栅格化后）仍有 ≥ 1px 的可见线宽（`tests/theme-contrast.test.ts` 扩展）
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

重新渲染 `xl-all-classes`、`m-package`、`m-architecture`、`s-architecture-manual` 并看缩略图与 1:1 分块：XL 能一眼看出哪些包之间依赖强，强/弱、种类/权重的视觉编码一致且无歧义，框对齐整齐；把前后度量与自评分追加到 `docs/visual-review-log.md` 并更新 `docs/layout-routing-eval.md`。

## Touches

- tasks/gap-layout-interpackage-aggregation-and-line-semantics.md
- src/transform.ts
- src/core.ts
- src/index.ts
- src/layout.ts
- src/model.ts
- src/layout/elk.ts
- src/render/svg.ts
- src/render/theme.ts
- docs/layout-routing-eval.md
- tests/relations.test.ts
- tests/interpackage-aggregate.test.ts (new)
- tests/line-semantics.test.ts (new)
- tests/frame-alignment.test.ts (new)
- tests/theme-contrast.test.ts
