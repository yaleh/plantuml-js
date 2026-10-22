---
id: gap-layout-flat-large-graph-regression
title: flat 大图回归（65s/15402）+ bench-nested 守卫 import 过时
status: ready
labels:
  - gap
  - layout
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

flat 大图（无包）在 compound 重构后持续退化，且唯一护栏已失效：

- 当前 HEAD 对 789 flat（`tests/fixtures/archguard-neighborhood.json`）实测 **65s / 15402 crossings**（旧代码约 456ms / 545；`gap-compound-layout-proportion` 勾了 flat AC 但未实际达标）。
- 护栏失效：`scripts/bench-nested.mjs` `import dist/layout-metrics.js`，文件已挪到 `dist/layout/layout-metrics.js`，脚本一跑就 ERR_MODULE_NOT_FOUND——flat/nested 预算根本没在执行。
- Architecture-tab 补充（0.2.0/0.2.2 同码实测）：flat 单连通图上 `elk.aspectRatio` 配 `wrapping.strategy="2"` 是空操作（default/1.6/1.0/0.6/0.4 五次逐像素相同 1607×582）；`COFFMAN_GRAHAM`+`layerBound=2` 才折成 578×1006（0.57）。注意：本仓库 compound 用的 wrapping 枚举是字符串 `'MULTI_EDGE'`（`src/layout/compound.ts`），数值字符串 `"2"` 可能不被 ELK 识别——这是对方 wrapping 空操作的可疑根因，但 flat 宽度控制归 `gap-layout-arbitrary-elk-options`（layerBound），本任务只修「慢 + 高交叉」回归与守卫。

<!-- dedup-ref -->
相关但不合并：`gap-compound-layout-proportion`（done）修嵌套成比例但 flat 未达标；`gap-layout-arbitrary-elk-options`（todo）给 flat 提供 layerBound 宽度旋钮；本任务只负责 flat 的性能/交叉回归 + 修 bench 守卫。

## AC

- [ ] `scripts/bench-nested.mjs` 的 import 改为当前文件位置（`dist/layout/layout-metrics.js` 等），`node scripts/bench-nested.mjs` 能跑通（不再 ERR_MODULE_NOT_FOUND），并按预算退出 0/1。
- [ ] flat 789（无包）满足 bench 预算：`crossings ≤ 1000`、`layoutMs ≤ 2000`（当前 65s/15402；恢复到旧代码 456ms/545 量级或至少达标）。
- [ ] 嵌套不回退：nested-full `width ≤ 10000` 或 `aspect ≤ 3`、`crossings ≤ 800`、`nodeIntersect === 0`、`layoutMs ≤ 5000`；`npm test` 与 `npm run typecheck` 退出 0。

## DoD

`node scripts/bench-nested.mjs` 全绿（flat + nested 均达标），flat 大图不再 65s/15402；即便未来 Architecture-tab 展开大组到 flat 也不会撞慢路径。

## Touches

- scripts/bench-nested.mjs
- src/layout/compound.ts
- src/layout/elk.ts
- tests/layout-compound-proportion.test.ts
- tasks/gap-layout-flat-large-graph-regression.md