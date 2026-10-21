---
id: gap-sink-shared-core-to-leaf
title: 把共享核心（model/layout/text-measure/edge-router）沉到叶子目录，断掉 {根包,layout,render} 目录环
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

archguard `detect_cycles(outputScope="package")` 报 1 个 3 成员目录 SCC `{根包, layout, render}`。桥边（bridges）清晰：根包经 `core.ts → layout/elk.js`、`core.ts → render/svg.js` 依赖子目录；`layout`、`render` 反向依赖根包里的 `model.ts` / `layout.ts` / `text-measure.ts`（以及 `edge-router.ts`）。根因是**根包同时扮演「共享核心」和「门面」两个角色**——这不是子目录回指 index/core 门面（已 grep 确认 `layout/`、`render/` 里没有 `from '../index'` / `'./index'` / `'../core'` / `'./core'`），而是根包把共享核心和门面混在一个目录里。

**方案**：把四个共享核心文件（`model.ts`、`layout.ts`、`text-measure.ts`、`edge-router.ts`）沉到一个不 import 任何兄弟子目录的叶子目录（建议 `src/foundation/`，目录名可改，但必须是「零兄弟子目录依赖」的叶子）。根包只留门面（`index.ts`、`core.ts`）与不被子目录依赖的模块。下沉后 `layout`/`render` 对共享核心的依赖从「指向根包」变为「指向 foundation」，目录环随之消失或缩小。

两条连带跨层边一并处理（它们也参与 SCC）：`src/layout/viz.ts → ../render-dot.js`（layout 依赖根包里的 render 命名模块）与 `src/render/labels.ts → ../edge-router.js`（render 依赖根包）。`render-dot.ts` 是被 layout 依赖的 Graphviz 运行时，不能留在根包；`edge-router.ts` 是共享几何，随四文件下沉。具体落点由实现者定，但必须满足 AC1 的环消失判据。

纯文件移动 + import 路径更新，不改任何布局/渲染行为。注意：`src/core.ts`（门面文件）与新的 `src/foundation/` 叶子目录必须避免 `import './core'` 二义，实现时若撞名则改门面文件名或叶子目录名，以 `npm run typecheck` 通过为准。

## AC

- [ ] 环消失：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 的目录级环从现状 1 个 3 成员 SCC 降为 0（或 SCC 成员不再包含根包）；用 bridges 读数标注每个被消除桥边的 maxSccBefore/After
- [ ] 叶子零回指：`grep -rn "from '\.\./layout\|from '\.\./render" src/foundation/*.ts` 无命中；且 `grep -rn "from '\.\./model\.js\|from '\.\./layout\.js\|from '\.\./text-measure\.js\|from '\.\./edge-router\.js" src/layout src/render` 无命中（共享核心依赖全部改指向 foundation）
- [ ] 跨层边消除：`src/layout/viz.ts` 不再 `from '../render-dot.js'`；`src/render/labels.ts` 不再 `from '../edge-router.js'`（各自落到不反向依赖根包的位置）
- [ ] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿，所有既有测试不改断言即通过；两个 fixture 渲染 SVG sha256 与改动前相等
- [ ] 公开面不变：`src/index.ts`、`src/elk.ts`、`src/archguard.ts`、`src/core.ts` 的导出名不变；`npm run build` 退出码 0

## DoD

目录环用 archguard 的 bridges/detect_cycles 实测为 0（或根包不再处于任何环中）；四个共享核心文件落到叶子目录且该目录零兄弟子目录依赖；跨层边（layout→render-dot、render→edge-router）不再反向依赖根包；全部测试、类型检查、构建绿，公开导出不变。不是「文件换个目录」——必须用 archguard 的 bridge 读数证明环真的断了。

## Touches

- tasks/gap-sink-shared-core-to-leaf.md
- src/foundation/model.ts (new)
- src/foundation/layout.ts (new)
- src/foundation/text-measure.ts (new)
- src/foundation/edge-router.ts (new)
- src/render-dot.ts
- src/core.ts
- src/index.ts
- src/parser.ts
- src/transform.ts
- src/layout-metrics.ts
- src/archguard.ts
- src/layout/compound.ts
- src/layout/elk.ts
- src/layout/elk-graph.ts
- src/layout/elk-result.ts
- src/layout/grid-router.ts
- src/layout/lane-spread.ts
- src/layout/layers.ts
- src/layout/package-endpoints.ts
- src/layout/viz.ts
- src/render/labels.ts
- src/render/svg.ts
- tests/bundling.test.ts
- tests/cross-package-routing.test.ts
- tests/detail.test.ts
- tests/edge-hierarchy.test.ts
- tests/elk-modules.test.ts
- tests/grid-alignment.test.ts
- tests/grouping.test.ts
- tests/hub-badge.test.ts
- tests/hub-rail.test.ts
- tests/layout-compound-proportion.test.ts
- tests/layout-foundation.test.ts
- tests/layout-metrics.test.ts
- tests/legend.test.ts
- tests/line-semantics.test.ts
- tests/members.test.ts
- tests/packing.test.ts
- tests/ports.test.ts
- tests/relations.test.ts
- tests/render.test.ts
- tests/text-measure.test.ts
- tests/transform.test.ts
- tests/viz.test.ts
