---
id: gap-layout-arbitrary-elk-options
title: layoutOptions 透传任意 elk 选项（递归注入每层容器），不只命名选项
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

Architecture-tab 实测发现：`layoutOptions` 现在只有命名选项（`layerOrder`/`edgeRouting`/`mergeEdges`/`aspectRatio`/`strategies`），每发现一个新 ELK 旋钮都要等发版。有效旋钮示例——`elk.layered.layering.strategy=COFFMAN_GRAHAM` + `elk.layered.layering.coffmanGraham.layerBound=N`：扁平 Overview（22 节点）bound=2 把 1274×676（1.88）变成 507×1100（0.46），竖屏容器第一次拿到竖屏比例画布；这是 `aspectRatio` 单独做不到的。方案：
1. `ElkLayoutOptions` 加 `elk?: Record<string, string>`（原始 ELK 选项，逃生舱）；
2. `ElkLayoutEngine` 把 `options.elk` **递归注入到 root 与每个包容器节点的 `layoutOptions`**（用户值覆盖内置默认）；命名选项与 `elk` 同名键冲突时命名选项优先，并文档标注；
3. `RendererOptions.layoutOptions` 已存在，直接沿用，`core.ts` 无需改。
向后兼容：不传 `elk` 时行为与今天逐字一致。

⚠️ 已知 elkjs 崩溃（Architecture-tab 实测，需在实现时注意或记守卫）：`INCLUDE_CHILDREN` + `COFFMAN_GRAHAM` + `layerBound=2` 且 `aspectRatio=1.6` 时 elkjs 抛 `TypeError: Cannot read properties of undefined (reading 'c')`；bound=2 + ratio 0.53 不崩。执行者注入 layerBound 的测试用例应避开该组合，或把该崩溃作为已知问题记录。

<!-- dedup-ref -->
相关但不合并：`gap-layout-aspect-ratio-option`（done）已加命名 `aspectRatio`，本任务把它推广为任意键透传；`gap-compound-layout-proportion`（done）已把嵌套画布从 16:1 收敛到 ~2:1，本任务的 layerBound 是其补充（按容器比例限制每层并排数）。

## AC

- [x] `tests/layout-arbitrary-elk-options.test.ts`（新增）对合成模型 `new ElkLayoutEngine({ elk: { 'elk.layered.layering.strategy': 'COFFMAN_GRAHAM', 'elk.layered.layering.coffmanGraham.layerBound': '2' } })`：断言这两个键出现在 ELK 收到的 root 与每个子容器节点的 `layoutOptions`（探针注入或布局几何变化），且该合成模型 bound=2 时画布宽高比显著窄于 baseline。`npx vitest run tests/layout-arbitrary-elk-options.test.ts` 退出 0。
- [x] 递归性：≥2 层嵌套模型，`options.elk` 的每个键出现在每个包容器节点的 layoutOptions（单测逐容器断言）。
- [x] 不传 `elk` 时 `createRenderer().render(<既有 fixture>)` 输出与当前逐字一致（bytes 不变）；命名选项与 `elk` 同名键冲突时命名选项胜出；`npm test` 与 `npm run typecheck` 退出 0。

## DoD

Architecture-tab 用 `layoutOptions.elk` 注入 layerBound / Coffman-Graham 等任意 ELK 旋钮而无需发版，删掉其 `elkAspectEngine.ts` 注入点兜底；竖屏 Overview 用 bound 拿到竖屏比例画布；full suite + typecheck 全绿。

## Touches

- src/layout/elk.ts
- src/layout/compound.ts
- src/layout/elk-graph.ts
- tests/layout-arbitrary-elk-options.test.ts
- tasks/gap-layout-arbitrary-elk-options.md