---
id: gap-move-render-dot-out-of-foundation
title: 把 render-dot 从 foundation 移到 layout，恢复 foundation 零外部渲染依赖
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

`gap-sink-shared-core-to-leaf` 把 `render-dot.ts` 连同共享核心一起沉进了 `foundation/`，但这是一个误归类：`foundation/render-dot.ts` 里 `import { instance } from '@viz-js/viz'`，它是 **Graphviz 运行时适配器**（`getViz()` 缓存 + `renderDot(dot, engine)`），不是共享核心。

后果：`foundation` 这个「共享核心叶子」因此依赖了外部渲染运行时 `@viz-js/viz`——纯数据/契约层（model/layout/text-measure/relation-semantics）不该拖一个 WASM 渲染后端进来。架构图里 `foundation → @viz-js/viz` 这条外部边正是它造成的。

`render-dot.ts` 的真实消费者只有两个：`src/layout/viz.ts`（`VizLayoutEngine` 复用 `getViz()` 渲染 DOT）和 `src/index.ts`（门面 re-export `renderDot`）。它是 Graphviz 后端的运行时，和 `viz.ts` 同域。

**方案**：`src/foundation/render-dot.ts` → `src/layout/render-dot.ts`，更新两个消费者的 import。移动后 `foundation` 零外部渲染依赖，`@viz-js/viz` 的依赖随 render-dot 归到 `layout`（Graphviz 布局后端所在）。

## AC

- [x] `foundation` 零外部渲染依赖：`grep -rn "@viz-js/viz" src/foundation` 无命中；重新 `archguard_analyze` 后 package 图里 `foundation` 不再有指向 `@viz-js/viz` 的边
- [x] render-dot 归位：`src/layout/render-dot.ts` 存在且内容与移动前一致（git 视为 rename），`src/foundation/render-dot.ts` 不再存在
- [x] 消费者更新：`src/layout/viz.ts` 与 `src/index.ts` 的 `render-dot` import 改为新路径；`grep -rn "foundation/render-dot" src` 无命中
- [x] 目录环保持 0：`archguard_detect_cycles(outputScope="package")` 的环数仍为 0
- [x] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿，`tests/viz.test.ts` 不改断言即通过；`renderDot` 的公开导出不变（`src/index.ts` 仍 re-export）；`npm run build` 退出码 0

## DoD

`foundation` 恢复为纯共享核心（零外部渲染运行时依赖，架构图上不再有 `foundation → @viz-js/viz` 边）；`render-dot.ts` 归到 `layout`（Graphviz 后端所在域），消费者 import 更新，目录环保持 0，公开导出与行为不变。

## Touches

- tasks/gap-move-render-dot-out-of-foundation.md
- src/foundation/layout.ts
- src/layout/render-dot.ts (new)
- src/layout/viz.ts
- src/index.ts
- tests/viz.test.ts