---
id: gap-placement-strategy-encapsulation
title: 把 compound 的五个放置/装箱算法封装成 PlacementStrategy 接口（加策略 = 注册而非改 if/else）
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

`compound.ts` 里的「块放置」行为有五个可替换的算法——`placeStubsNearTargets`（stub 就近放置）、`stackLayerRows`（按语义层堆叠）、`shelfPackBlocks`（搁架装箱）、`orderedShelfPack`（按依赖流排序的搁架装箱）、`gridPack`（网格装箱）——但它们散落为自由函数，靠 `placeBlocks` 里一串 if/else + `pack` 布尔参数 + `partitions.size` / `blocks.size` 条件选择。加一种放置策略 = 改 `placeBlocks` 的 if/else，没有封装。

这和刚落地的 `LayoutStrategy`（`src/layout/strategy.ts`）是同一族：可替换的布局行为应该封装成接口 + 注入，而不是硬编码选择。区别只在于 `LayoutStrategy` 在 ELK 引擎层，本任务在 compound 的「块放置」层。

**方案**：把「块放置」封装成 `PlacementStrategy` 接口（照 `LayoutStrategy` 形状：`name` + `place(...) → Placement | undefined`，返回 `undefined` 表示 decline 落入下一策略），`placeBlocks` 遍历策略链取第一个非 decline 的结果。现有五个算法各自实现成一个策略对象；`placeStubsNearTargets` 的「先 main 后 stub」这种特殊路径保持为一个策略的职责，不散落在 `placeBlocks` 里。

不在范围：`layoutBlock`（布局单个块，用 ELK，不是「放置」维度）、`routeOrthogonal`（跨块边路由，是 `grid-router.ts` 的职责）。这些是布局阶段，不是可替换的放置策略。

## AC

- [x] 改动前红：`grep -n "if \|else if \|pack\|partitions.size\|blocks.size" src/layout/compound.ts` 显示 `placeBlocks` 内存在 ≥3 处的策略选择分支，证明放置策略靠 if/else 硬编码
- [x] `PlacementStrategy` 接口 + 链式选择：新增 `PlacementStrategy` 接口（`name` + `place(...) → Placement | undefined`，decline 返回 `undefined`）；`placeBlocks` 遍历策略链取第一个非 decline 结果
- [x] 加策略 = 注册（扩展点判据）：新增 `tests/placement-strategy.test.ts`，注入一个合成 `PlacementStrategy` 返回固定 `Placement`，**不改 `src/layout/compound.ts`** 即生效；负对照：一个 decline（返回 `undefined`）的策略落入下一策略、一个抛错的策略不被静默忽略
- [x] 现有五个算法各自成策略：`placeStubsNearTargets` / `stackLayerRows` / `shelfPackBlocks` / `orderedShelfPack` / `gridPack` 各自封装成一个 `PlacementStrategy`，`placeBlocks` 里不再有按 `pack`/`partitions.size`/`blocks.size` 硬编码的 if/else 分支
- [x] 无行为回归：两个 fixture 经 `createRenderer({ layout: 'elk' })` 渲染的 SVG 与改动前 sha256 逐一相等；`npm run typecheck` 与 `npx vitest run` 全绿，既有测试不改断言
- [x] 无新目录环：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 的环数不高于现状

## DoD

不是「把 if/else 拆成函数」就完——而是「块放置」这个行为维度被封成 `PlacementStrategy` 接口，加一种放置策略 = 注册一个策略对象，而不是改 `placeBlocks` 的 if/else。现有五个算法各自成策略；扩展点用「注入合成策略即生效 + decline 落入下一策略 + 抛错不静默」的可证伪测试证明；渲染逐字节不变。

## Touches

- tasks/gap-placement-strategy-encapsulation.md
- src/layout/compound.ts
- src/layout/placement-strategy.ts (new)
- tests/placement-strategy.test.ts (new)

## Evidence

- 2026-10-22 续做验证（reuse 既有 worktree + ea58ae2 实现，未重做代码）：
  - AC1 改动前红：`git show develop:src/layout/compound.ts` 的 `placeBlocks` 内有 ≥3 处选择分支——`if (stubKeys.size > 0 && stubKeys.size < blocks.size)`、`const pack = blocks.size > PACK_BLOCK_THRESHOLD || sparseMid`、`if (!pack && options.partitions.size > 0) return stackLayerRows(blocks, options)`、`if (!pack && partition !== undefined && options.partitions.size > 0)`。
  - AC2/AC3/AC4：`src/layout/placement-strategy.ts` 新增 `PlacementStrategy` + `runPlacementStrategies`（首个非 decline 获胜）；`placeBlocks` 现在只剩 `requirePlacement(await runPlacementStrategies(strategies, ctx), 'block placement')`，无 `pack`/`partitions.size`/`blocks.size` 分支；五个策略对象 `stubOrbitPlacementStrategy` / `layerRowsPlacementStrategy` / `shelfPackBlocksPlacementStrategy` / `orderedShelfPackPlacementStrategy` / `gridPackPlacementStrategy` 与 `DEFAULT_PLACEMENT_STRATEGIES` 均在 `compound.ts` 导出；`tests/placement-strategy.test.ts` 覆盖「注入合成策略即生效」「decline 落入下一策略」「抛错不被静默忽略」。
  - AC5：同一份临时渲染脚本分别跑本分支与 `git archive develop` 的代码（同一 node_modules），`createRenderer({ layout: 'elk' })` 的 SVG sha256 逐一相等——`archguard-class.puml` = `8cf07f47f23bb9ab1185885de9a625769101ed1feb76f40da258bf60fe6646cb`（25664 B），`archguard-package.puml` = `a6003c4e4381beb0a527503a9b552fe835151fbf236283ea8cc303cd50ae4426`（67570 B）。`npm run typecheck` 通过；`npx vitest run` 291 passed，exit 0。
  - AC6：对本分支 `archguard_analyze`（src, typescript）后 `archguard_detect_cycles(outputScope="package")` 为 `cycles: []`（maxScc 1），develop 基线同为 `cycles: []`（maxScc 1），无新增目录环。
