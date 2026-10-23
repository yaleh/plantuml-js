---
id: gap-detail-truncation-lossless-export
title: detail 截断污染 model：标记成员进序列化 + renderDetailed 缺无损 sourceModel
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`renderDetailed` 默认走 autoDetail（>40 实体→compact），`applyDetail` 把 members 截成 `COMPACT_MEMBER_ROWS=4` 并追加合成 `… +N more (M members)` 成员，但**该标记成员没有任何 synthetic 标记**；`serialize` 的 `memberLine`（`src/parse/serialize.ts`）又给它补 `+` 前缀使其成为合法成员行。于是 `toPlantUml(renderDetailed().model)` 输出有损文本（实测 55 实体图：Text 面板 300 行含 26 个标记 vs 无损 562 行）。导出/发给会话的文本必须无损。逐条确认：

- Q1（`detail:'full'` 是否无损）：**是**——`applyDetail` 在 `level==='full' && !hasLimits` 时原样返回（不截、无标记）。
- Q2（`memberMaxChars/memberMaxRows` 是否 model 仍完整 raw、标记只在渲染）：**否**——`memberMaxChars` 只设 `display`、`raw` 完好，但 `memberMaxRows`/compact 的 `… +N more` 标记会作为真实成员进 `model.entities[].members`，且无标记位。

## AC

- [x] `PlantUmlMember` 加 `synthetic?: true`；`applyDetail` 生成的 `… +N more` 标记成员带 `synthetic: true`。
- [x] `toPlantUml` 跳过 `synthetic` 成员（不再输出 `+ … +N more` 行）；`tests/serialize.test.ts` 加用例：compact/limit 后的 model 序列化无标记行、reparse 无 error、实体成员数与原始一致。`npx vitest run tests/serialize.test.ts` 退出 0。
- [x] `renderDetailed` 返回值加 `sourceModel`（view/transform 之后、detail 之前的完整模型）；README/类型注释写明 `model` 是「已 detail 的绘制模型、不适合导出」，导出用 `sourceModel`。`tests/api.test.ts` 断言 `sourceModel` 存在且成员无损。
- [x] `npm test` 与 `npm run typecheck` 退出 0。

## DoD

Architecture-tab 的 Text/复制/下载用 `toPlantUml(sourceModel)`（或 `toPlantUml(model)`）得到无损文本、无 `… +N more` 行；`detail:'full'` + `memberMaxChars/memberMaxRows` 组合下 `model` 里 `raw` 仍完整、标记只进渲染层。

## Touches

- src/foundation/model.ts
- src/foundation/layout.ts
- src/parse/serialize.ts
- src/core.ts
- tests/serialize.test.ts
- tests/api.test.ts
- README.md
- tasks/gap-detail-truncation-lossless-export.md