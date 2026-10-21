---
id: gap-render-external-nodes-labels-cjk
title: 外部/隐式节点归位与梳状边合并 + 边标签不被节点遮挡 + CJK 字宽（包标签溢出）
status: ready
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Proposal

第四轮（多规模样例 S/M/L/XL，含 1:1 分块）目视检查发现，`gap-render-undeclared-relation-endpoints` 修好崩溃后，中小规模真实文档图的**语义呈现**仍有问题：
1. **包别名端点被画成孤立类框**：`s-architecture-manual`（`archguard-architecture-manual.puml`）左上角出现 `CLI_Layer`、`CLI_Integration_Layer`、`Parser_Layer` 三个普通类框，用虚线连成一串，与同图里真正的 `CLI Layer`/`CLI Integration Layer`/`Parser Layer` 包框毫无关联。应当把关系连到对应的包框（边的端点落在包框边界上），而不是凭空造出同名节点。
2. **隐式外部类型散落成梳状边**：`m-architecture` 里 `Error`、`T`、`z.infer<any>`、`Anthropic`、`EventEmitter`、`TemplateCache`、`SourceFile`、`ClassDeclaration`、`MethodDeclaration` 等从未声明的类型被画成画布顶部/底部的小框，十来条继承/依赖边贴着顶边平行飞过整张图（`Error` 一个节点就有约 10 条入线）。这类"外部/隐式"节点应有独立的视觉身份（弱化样式，不与项目内类混淆），集中放到图的一侧或底部的 External 分组里，对同一外部目标的并行边做合并或汇总（徽标，如 `extends ×9`）。
3. **边标签被节点遮住**：`uses`、`returns`、`validates` 标签落在两个节点之间很窄的缝里，被节点框截断成 `us`、`valida`、`use`，在 S 与 M 图里都可见。标签位置必须避开所有节点框；放不下时降级（缩短、只在长段上放、或省略并保留 tooltip `<title>`）。
4. **CJK 字宽低估**：`Utils (工具层)`、`CLI Layer (命令层)`、`Parser Layer (解析层)` 的包标签文字超出标签块右边（括号内汉字溢出）。`measureTextWidth` 把全角字符按 1 个单元计，应按 2 个单元；同时 Chrome 实测 `chromeTextOverflow` 目前只覆盖类框，没有覆盖包标签，因此漏检。

## AC

- [x] `tests/package-alias-endpoint.test.ts`：`package "X Layer" as X { class A }`、`X --> B`、`B --> X` 渲染后 SVG 里**没有** id 为 `X` 的类框，且这两条边的端点落在 X 包框的边界上（端点到包框矩形边的距离 ≤ 1px）；对 `archguard-architecture-manual.puml` 渲染后 `model.entities` 不含 `CLI_Layer`、`CLI_Integration_Layer`、`Parser_Layer`
- [x] 隐式外部类型有独立样式（`external` 标志进入 SVG 的 `class` 属性，与项目类可区分），渲染在同一个 External 分组里；`tests/external-nodes.test.ts` 断言：`archguard-architecture.puml` 中 `Error` 的入边被汇总/合并后，到 `Error` 的可见边数 ≤ 2，且汇总徽标计数等于原入边数
- [x] `computeLayoutMetrics` 新增 `labelNodeOverlap`（边标签矩形与任一节点矩形相交的数量）；对 S 与 M 样例（`s-architecture-manual`、`m-architecture`）该值为 0，`tests/layout-metrics.test.ts` 用合成反例断言
- [x] `measureTextWidth` 对 CJK/全角字符按 2 个字符宽度计；`tests/text-measure.test.ts` 断言 `'(命令层)'` 的宽度等于 `'(' + 3 个全角 + ')'` 的 2×3+2 个单元；包标签块宽度据此计算
- [x] `scripts/measure-svg-text.mjs` 同时检查包标签（标签文字宽度 ≤ 标签块宽度），`metrics.json` 的 `chromeTextOverflow` 对 `s-architecture-manual` 为 0
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

用 `archguard-architecture-manual.puml`（S）与 `archguard-architecture.puml`（M）真实文档图以默认主题渲染并看 1:1 分块 PNG：左上角不再有三个冒名顶替的 `*_Layer` 类框，`Error`/`T` 等外部类型集中且边不再成梳；边标签完整可读、不被节点框截断；中文包标签完整落在标签块里。度量表里这两个样例的 `labelNodeOverlap` 与 `chromeTextOverflow` 为 0。

## Touches

- tasks/gap-render-external-nodes-labels-cjk.md
- src/parser.ts
- src/model.ts
- src/transform.ts
- src/layout/elk.ts
- src/layout/package-endpoints.ts (new)
- src/render/labels.ts
- src/layout-metrics.ts
- src/text-measure.ts
- src/render/svg.ts
- scripts/measure-svg-text.mjs
- tests/package-alias-endpoint.test.ts (new)
- tests/external-nodes.test.ts (new)
- tests/layout-metrics.test.ts
- tests/text-measure.test.ts
