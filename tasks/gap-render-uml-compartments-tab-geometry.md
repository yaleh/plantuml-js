---
id: gap-render-uml-compartments-tab-geometry
title: UML 三格（attr/op）+ 包标签页闭合 + 节点/包几何元数据
status: todo
labels:
  - gap
  - render
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Architecture-tab 的 LOD 语义缩放需要三处 UML SVG 保真（现有 SVG 契约只够近似，不足以做「标题/属性/方法」三格与包标签页的精确映射）：

1. **类框三格**：`renderEntity` 现在只画一条分隔线、属性与方法混在一格。改为按 `member.kind`（`field`/`method`，`src/foundation/model.ts`）分组——标题/属性/方法三格，两条 `<line class="uml-compartment-rule" data-rule="title|ops">`（接口只有方法时一条 `data-rule="title"`）；成员文本加 class `uml-attr`/`uml-op`。`estimateEntitySize`（`src/foundation/layout.ts`）按分格计算高度（标题行 + 成员行 + 规则行），保证框高与边锚点一致、文字隐藏后两条分隔线仍保留。
2. **包标签页闭合**：`renderPackage` 现在的 `<line class="uml-package-tab">` 只有一条底线、右侧不封口。换成闭合 path/polyline（M x,y → H x+tabW → V y+tabH → H x → Z），带不透明填充盖住包边框，右竖线 + 底边封口，class 保持 `uml-package-tab`。
3. **几何元数据**：`uml-node`/`uml-package` 组上加 `data-x/y/w/h`；node 加 `data-title-h`/`data-attrs-h`/`data-ops-h`；package 加 `data-tab-w`/`data-tab-h`。让 LOD 单调映射直接读元数据，不读 rect/line。

<!-- dedup-ref -->
不依赖 `gap-plantuml-serializer`（toPlantUml 反向序列化与本任务无关）；与布局任务正交（本任务纯渲染 + 尺寸一致）。

## AC

- [ ] 分格：含 field+method 成员的合成模型渲染出两条 `uml-compartment-rule`（`data-rule="title"` 与 `data-rule="ops"`），成员文本 class 分别为 `uml-attr`/`uml-op`；仅 method（接口）模型只渲染一条 `data-rule="title"`。`npx vitest run tests/render-compartments.test.ts` 退出 0。
- [ ] 尺寸一致：`estimateEntitySize` 高度 = 标题行 + 成员行 + 规则行，`renderSvg` 输出的框高与 `layout` 的 `node.height` 一致（无文本溢出）；既有 textOverflow 相关测试仍绿。
- [ ] 包标签页：`renderPackage` 输出闭合的 `uml-package-tab` path/polyline（右竖线 + 底边封口），带 `data-tab-w`/`data-tab-h`。
- [ ] 元数据：`uml-node` 组带 `data-x/y/w/h` + `data-title-h/data-attrs-h/data-ops-h`；`uml-package` 组带 `data-x/y/w/h` + `data-tab-w/data-tab-h`；`npm test` 与 `npm run typecheck` 退出 0。

## DoD

Architecture-tab 的 LOD 直接读 `data-*` 做单调映射（不再读 rect/line），类框三格语义正确、文字隐藏后分隔线仍保留、包标签页为闭合 UML 标签矩形；full suite + typecheck 全绿。

## Touches

- src/render/svg.ts
- src/foundation/layout.ts
- tests/render-compartments.test.ts
- tasks/gap-render-uml-compartments-tab-geometry.md