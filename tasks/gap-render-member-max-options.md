---
id: gap-render-member-max-options
title: memberMaxChars/memberMaxRows：成员尺寸按绘制内容量，不改 raw
status: ready
labels:
  - gap
  - render
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现象（Architecture-tab 实测）：VoiceFrameProcessor 7 个成员、`detail='full'` 时 `applyDetail` 不裁，105 字符的长成员把框撑到 `data-w=856`，而屏幕实际最长文字约 241px——布局按全部成员量尺寸、绘制只画一部分，`data-w/data-h` 与绘制内容不一致。方案（默认不改变现有行为）：

1. `PlantUmlMember` 加 `display?: string`（绘制用文本，缺省用 `raw`）。
2. `applyDetail(model, detail, { memberMaxChars?, memberMaxRows? })`：`memberMaxRows` 限制每实体成员行数，超出部分合成现有 `… +N more (M members)` 标记行（参数化现在硬编码的 `COMPACT_MEMBER_ROWS=4`）；`memberMaxChars` 对每个保留成员设 `display = truncate(raw, maxChars)`（末尾 `…`）。
3. `estimateEntitySize`（`src/foundation/layout.ts`）与渲染（`src/render/svg.ts`）都读 `m.display ?? m.raw` 量宽/画字；`raw` 永不被改。
4. 两个选项挂在 `RendererOptions`（render 选项，与 `detail` 同族、布局前 transform），**不进 ElkLayoutOptions**（这是成员显示裁剪，不是 ELK 几何旋钮）。

向后兼容：不传两选项时行为与今天逐字一致。

<!-- dedup-ref -->
与 `gap-render-uml-compartments-tab-geometry`（done，分格/元数据）互补：本任务解决「量尺寸用全文、绘制用裁剪」的不一致；`gap-plantuml-serializer` 的 raw 完整性不受影响（raw 不改）。

## AC

- [x] 合成模型（含一个 >`memberMaxChars` 的长成员 + >`memberMaxRows` 的多个成员），`createRenderer({ memberMaxChars: 48, memberMaxRows: 6 })` 渲染：`data-w` ≤ 截断后最宽行 + padding，`data-h` 只算 `memberMaxRows`（+标记）行；SVG 里长成员以 `…` 结尾、超出行数成员不出现、`… +N more (M members)` 标记行存在。`npx vitest run tests/render-member-max.test.ts` 退出 0。
- [x] `renderDetailed(...).model` 里该长成员的 `raw` 仍为完整原文（未被改），仅 `display` 被截断。
- [x] 不传两选项时 `createRenderer().render(<fixture>)` 输出与当前逐字一致；`npm test` 与 `npm run typecheck` 退出 0。

## DoD

Architecture-tab 传 `memberMaxChars`/`memberMaxRows` 后 `data-w/data-h` 与绘制内容一致，竖屏不再被长成员撑大（VoiceFrameProcessor 场景回归 ≤ 合理宽）；Inspector/导出读 `raw` 仍是全文。

## Touches

- src/foundation/model.ts
- src/foundation/layout.ts
- src/render/svg.ts
- src/core.ts
- tests/render-member-max.test.ts
- tasks/gap-render-member-max-options.md