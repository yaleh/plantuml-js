---
id: gap-layout-aspect-ratio-option
title: createRenderer 暴露 layoutOptions.aspectRatio 透传 ELK（运行时容器比例）
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

Architecture-tab 请求把容器比例作为运行时入参暴露：`createRenderer({ layout: 'elk', layoutOptions: { aspectRatio } })`。现状 `RendererOptions` 只有 `layout`/`view`/`transform`，`elk.aspectRatio` 硬编码 `'1.6'`（`src/layout/compound.ts` 5 处），静态打包无法适配运行时容器比例（桌面 16:9 vs 移动 375px 竖屏 9:16，fit 后每包只剩几个像素，爆炸图在移动端不成立）。方案：
1. `ElkLayoutOptions`（`src/layout/elk.ts`）加 `aspectRatio?: number`（将来 `maxWidth`/`nodeSpacing` 走同一机制）；
2. `ElkLayoutEngine` 把 `options.aspectRatio` 透传给 `compoundLayout`（以及 hierarchical 路径），覆盖硬编码 `'1.6'`；
3. `RendererOptions`（`src/core.ts`）加 `layoutOptions?: ElkLayoutOptions`，`resolveEngine` 对 `'elk'` 走 `new ElkLayoutEngine(options.layoutOptions)`；viz 引擎忽略该字段（文档标注仅 elk 生效）。
向后兼容：不传 `layoutOptions` 时行为与今天逐字一致。

<!-- dedup-ref -->
相关但不合并：`gap-compound-layout-proportion`（ready）修 compound 静态打包成比例，本任务加运行时入参，两者互补（同 Touches 串行、机制不同）；`gap-layout-balance-clearance-bundling`（todo）、`gap-render-external-nodes-labels-cjk`（ready）、`gap-render-visual-design-system`（ready）亦 Touches `src/layout/elk.ts`，仅调度串行相关。

## AC

- [ ] `tests/layout-aspect-ratio-option.test.ts`（新增）同一合成模型 `aspectRatio` ∈ {0.5, 1, 2}：`layout.width/layout.height` 随档位单调递增，且每档与请求值偏差 ≤ ±30%（如 2 → 比值 ∈ [1.4, 2.6]）。`npx vitest run tests/layout-aspect-ratio-option.test.ts` 退出 0。
- [ ] 不传 `layoutOptions` 时 `createRenderer().render(<既有 fixture>)` 输出与当前逐字一致（断言 bytes 不变），既有 `tests/layout-foundation.test.ts` determinism 用例仍绿。
- [ ] 同参数两次 `ElkLayoutEngine.layout()` 深比较相等（确定性不与现有 AC 冲突）；`npm test` 与 `npm run typecheck` 退出 0。

## DoD

Architecture-tab 用 `createRenderer({ layout: 'elk', layoutOptions: { aspectRatio: 目标 } })` 拿到成比例画布并删掉其薄封装 engine 兜底；375px 竖屏面板 fit 后包框可读；full suite + typecheck 全绿。

## Touches

- src/core.ts
- src/layout/elk.ts
- src/layout/compound.ts
- tests/layout-aspect-ratio-option.test.ts
- tasks/gap-layout-aspect-ratio-option.md