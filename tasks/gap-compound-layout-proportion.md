---
id: gap-compound-layout-proportion
title: compound 布局成比例打包：嵌套容器画布 + flat 大图退化回归
status: todo
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

Architecture-tab 的 C 方案（一次全层级布局 + 缩放档位显隐切换）实测发现：当前 `src/layout/compound.ts` 的 compound 布局对嵌套容器产出不可用画布，且 flat 大图退化成慢路径。实测 789 实体 / 462 边 post-hub（嵌套桥接自 `/tmp/archguard-neighborhood.json`，脱敏）：

- flat（无包）：布局 16.2s、画布 11527×3838、crossings 19495 —— 旧代码约 456ms/545，属回归；
- 嵌套 depth≤4（78 包）：2.11s、画布 87234×5636（宽高比 ~15）；
- 嵌套 full（107 包）：1.06s、画布 55076×6150（宽高比 ~9）、crossings 732、nodeIntersect 0。

机制：`ElkLayoutEngine.layout()` 对大图（`entities.length > COMPOUND_ENTITY_THRESHOLD`）跳过单次 hierarchical 布局，直接走 `compoundLayout`；嵌套容器没有按目标宽高比装箱，退化成横向长条；flat 无包大图也走 compound 退化路径（慢 + 高交叉）。这是 C（几何连续爆炸 + 焦点保持）的 gating 项——55k–87k 宽的画布 fit 后每包只剩几个像素，爆炸体验不成立。

<!-- dedup-ref -->
相关但不合并：`gap-layout-balance-clearance-bundling`（todo）、`gap-render-external-nodes-labels-cjk`（ready）、`gap-render-visual-design-system`（ready）也 Touches `src/layout/elk.ts`，机制不同、仅与该文件调度串行相关；本任务主改 `src/layout/compound.ts`（无开放 peer）。

## AC

- [ ] `tests/layout-compound-proportion.test.ts`（新增）合成 ≥2 层嵌套、跨包边模型：断言 `layout.width/layout.height` ∈ [0.33, 3] 或 `layout.width ≤ 10000`、`computeLayoutMetrics(...).edgeNodeIntersections === 0`，且同一模型两次 `ElkLayoutEngine.layout()` 的 width/height/nodes/edges 深比较相等（确定性）。`npx vitest run tests/layout-compound-proportion.test.ts` 退出 0。
- [ ] `scripts/bench-nested.mjs`（新增）读 `tests/fixtures/archguard-neighborhood.json`（本任务把脱敏的 789 节点邻域固化进 fixture，替换对 `/tmp` 的依赖），输出 flat / nested-full / nested-depth4 的 layoutMs/canvas/crossings/nodeIntersect，并断言 nested-full 满足 `canvas.width ≤ 10000`、`crossings ≤ 800`、`nodeIntersect === 0`、`layoutMs ≤ 5000`，flat 满足 `crossings ≤ 1000`、`layoutMs ≤ 2000`；任一不满足退出 1。`node scripts/bench-nested.mjs` 退出 0。
- [ ] `npm test` 与 `npm run typecheck` 退出 0（既有 suite 不回归）。

## DoD

`node scripts/bench-nested.mjs` 对 789 邻域产出 nested-full SVG 的宽高比 ≤ 3（不再横向长条），包框肉眼可读，Architecture-tab 拿到成比例画布即可接 C 的显隐骨架；bench + 全量 suite + typecheck 全部退出 0。

## Touches

- src/layout/compound.ts
- src/layout/elk.ts
- tests/layout-compound-proportion.test.ts
- scripts/bench-nested.mjs
- tests/fixtures/archguard-neighborhood.json
- tasks/gap-compound-layout-proportion.md