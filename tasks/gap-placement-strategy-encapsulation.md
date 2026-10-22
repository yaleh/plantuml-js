---
id: gap-placement-strategy-encapsulation
title: 把 compound 的五个放置/装箱算法封装成 PlacementStrategy 接口（加策略 = 注册而非改 if/else）
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

`compound.ts` 里的「块放置」行为有五个可替换的算法——`placeStubsNearTargets`（stub 就近放置）、`stackLayerRows`（按语义层堆叠）、`shelfPackBlocks`（搁架装箱）、`orderedShelfPack`（按依赖流排序的搁架装箱）、`gridPack`（网格装箱）——但它们散落为自由函数，靠 `placeBlocks` 里一串 if/else + `pack` 布尔参数 + `partitions.size` / `blocks.size` 条件选择。加一种放置策略 = 改 `placeBlocks` 的 if/else，没有封装。

这和刚落地的 `LayoutStrategy`（`src/layout/strategy.ts`）是同一族：可替换的布局行为应该封装成接口 + 注入，而不是硬编码选择。区别只在于 `LayoutStrategy` 在 ELK 引擎层，本任务在 compound 的「块放置」层。

**方案**：把「块放置」封装成 `PlacementStrategy` 接口（照 `LayoutStrategy` 形状：`name` + `place(...) → Placement | undefined`，返回 `undefined` 表示 decline 落入下一策略），`placeBlocks` 遍历策略链取第一个非 decline 的结果。现有五个算法各自实现成一个策略对象；`placeStubsNearTargets` 的「先 main 后 stub」这种特殊路径保持为一个策略的职责，不散落在 `placeBlocks` 里。

不在范围：`layoutBlock`（布局单个块，用 ELK，不是「放置」维度）、`routeOrthogonal`（跨块边路由，是 `grid-router.ts` 的职责）。这些是布局阶段，不是可替换的放置策略。

## AC

- [ ] 改动前红：`grep -n "if \|else if \|pack\|partitions.size\|blocks.size" src/layout/compound.ts` 显示 `placeBlocks` 内存在 ≥3 处的策略选择分支，证明放置策略靠 if/else 硬编码
- [ ] `PlacementStrategy` 接口 + 链式选择：新增 `PlacementStrategy` 接口（`name` + `place(...) → Placement | undefined`，decline 返回 `undefined`）；`placeBlocks` 遍历策略链取第一个非 decline 结果
- [ ] 加策略 = 注册（扩展点判据）：新增 `tests/placement-strategy.test.ts`，注入一个合成 `PlacementStrategy` 返回固定 `Placement`，**不改 `src/layout/compound.ts`** 即生效；负对照：一个 decline（返回 `undefined`）的策略落入下一策略、一个抛错的策略不被静默忽略
- [ ] 现有五个算法各自成策略：`placeStubsNearTargets` / `stackLayerRows` / `shelfPackBlocks` / `orderedShelfPack` / `gridPack` 各自封装成一个 `PlacementStrategy`，`placeBlocks` 里不再有按 `pack`/`partitions.size`/`blocks.size` 硬编码的 if/else 分支
- [ ] 无行为回归：两个 fixture 经 `createRenderer({ layout: 'elk' })` 渲染的 SVG 与改动前 sha256 逐一相等；`npm run typecheck` 与 `npx vitest run` 全绿，既有测试不改断言
- [ ] 无新目录环：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 的环数不高于现状

## DoD

不是「把 if/else 拆成函数」就完——而是「块放置」这个行为维度被封成 `PlacementStrategy` 接口，加一种放置策略 = 注册一个策略对象，而不是改 `placeBlocks` 的 if/else。现有五个算法各自成策略；扩展点用「注入合成策略即生效 + decline 落入下一策略 + 抛错不静默」的可证伪测试证明；渲染逐字节不变。

## Touches

- tasks/gap-placement-strategy-encapsulation.md
- src/layout/compound.ts
- src/layout/placement-strategy.ts (new)
- tests/placement-strategy.test.ts (new)
