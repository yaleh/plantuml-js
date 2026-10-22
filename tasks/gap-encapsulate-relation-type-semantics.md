---
id: gap-encapsulate-relation-type-semantics
title: 封装 RelationType 语义到单一来源，修掉 elk/viz 对 implementation 线型不一致的 bug
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
## Proposal

`RelationType`（inheritance / implementation / dependency / association / aggregation / composition，6 个封闭枚举值）的行为语义散落在至少 4 个模块、约 10 处，各自用 if/else / switch 硬编码，没有任何封装：

- **布局方向反转**：`REVERSED_RELATION_TYPES` 定义了两份——`src/layout/elk-graph.ts:21`（export）和 `src/layout/compound.ts:32`（局部）；`elk-result.ts:128` import 前者，`compound.ts:352/463` 用后者。
- **线型 / 弱关系**：`viz.ts edgeAttrs` 一个 switch（implementation→`style="dashed"`、dependency→`style="dashed"`）；`svg.ts` 的 `weak = rel.type === 'dependency'`（bundled 与 single 各一处）。
- **箭头形状与实心/空心**：`viz.ts edgeAttrs` 一个 switch（empty/vee/odiamond/diamond）；`svg.ts` 三个 `if`（renderDiamond / renderTriangle / renderChevron）+ `rel.type === …` 的 trim 三目链。
- **边束 / 自动约简资格**：`svg.ts findEdgeBundles` 与 `transform.ts shouldAutoReduce` 各自判断 `dependency || association`。

这套复制已经造成一个**真实的跨引擎渲染 bug**：viz 引擎把 `implementation` 画成虚线（符合 PlantUML `..|>`），elk 引擎把它画成实线（`weak` 只判 dependency）。同一模型、两种引擎、视觉不一致。

**方案**：把 `RelationType` 的语义**封装**进一个内聚模块 `src/foundation/relation-semantics.ts`——对外只暴露一张 `RelationType → 语义事实` 的映射（`reversed`、`dashed`、`arrowKind`、`filled`、`weak`、`bundlable`）。调用方只问这个模块，不再各自判定语义：svg/viz 负责把语义事实翻译成自己的输出格式（SVG DOM / DOT attrs），elk-graph/elk-result/compound 读 `reversed`，transform 读 `bundlable`。「哪种关系是虚线 / 哪种要反转 / 箭头类别」这类知识从此只定义一次。

这是 OO 封装价值的直接应用：数据（RelationType）和它决定的行为（怎么画、怎么布局）收进同一个内聚单元，而不是让每个消费者各自知道细节。

（落点说明：模块放在 `foundation/`——layout/render/transform 都消费它，而 `src/` 根已经 import 这些子目录；把模块放在 `src/` 根会让 `layout/render → 根 → layout/render` 形成新的目录环，违反最后一条 AC。`foundation/` 是所有人都可以依赖的叶子层。）

## AC

- [x] 改动前红：`grep -rc "REVERSED_RELATION_TYPES = new Set" src --include='*.ts'` 合计为 2（`elk-graph.ts:1` + `compound.ts:1`，证明双定义）；一个断言「elk 与 viz 对同一 fixture 的 implementation 边线型一致」的新测试，改动前红（改动前 viz 的 DOT 已输出 `style="dashed"`，但两引擎的最终 SVG renderer 都画实线 —— 新增测试断言虚线，改动前失败）
- [x] 封装单源：新增 `src/foundation/relation-semantics.ts`，`grep -rc "REVERSED_RELATION_TYPES = new Set" src --include='*.ts'` 降为 1（唯一持有者在 relation-semantics，elk-graph/compound 的局部定义删除）；`reversed`/`dashed`/`arrowKind`/`filled`/`weak`/`bundlable` 每个语义判定只在该模块定义一次，消费者只读事实
- [x] 线型一致：implementation 在 elk 与 viz 两引擎都渲染为虚线（对齐 PlantUML `..|>` 与 viz 现状，svg 从实线改为虚线）；新增 `tests/relation-semantics.test.ts` 断言两个引擎渲染出的 `stroke-dasharray` 都等于 `theme.dash.weak`
- [x] 调用方不再各自判定语义：`src/layout/viz.ts` 的 `edgeAttrs` 与 `src/render/svg.ts` 的 `weak`/dash/箭头/trim 分支改为读 relation-semantics 的语义事实再翻译格式；`src/transform.ts shouldAutoReduce`、`src/render/svg.ts findEdgeBundles` 读 `bundlable`；elk-graph/elk-result/compound 读 `reversed`
- [x] 无行为回归（除 implementation 线型修复）：两个 fixture（内联多关系小型模型 + `tests/fixtures/archguard-architecture.puml`）的 elk SVG——含 implementation 的那个逐字节相同（剥掉 implementation 组新增的 `stroke-dasharray="6,3"` 后 sha 一致），不含 implementation 的 sha 完全一致；viz DOT 两 fixture 逐字节一致；`npm run typecheck` 全绿、相关测试全绿（全量 `npx vitest run` 由 fan-in 执行）。既有测试断言只改了两处：`tests/relations.test.ts` 与 `tests/line-semantics.test.ts` 中「implementation 是实线」的断言——那正是本次修复的 bug 本身；其余断言未动
- [x] 无新目录环：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 为 0 环（与 develop 现状 0 环持平；中途放在 `src/` 根时曾出现 `"" ↔ layout/render` 3 模块环，移入 `foundation/` 后消除）

## DoD

不是「把常量集中成一张表」就完——而是 `RelationType` 的行为语义被封装进一个内聚模块，svg / viz / elk / transform 四个消费者都不再各自知道「哪种关系虚线、哪种反转、箭头是什么」。跨引擎线型不一致的 bug 用测试锁死为一致；除该 bug 修复外渲染输出逐字节不变；「每个关系语义判定」的定义恰 1 处（改动前该计数为多处的证据已记录）。

## Touches

- tasks/gap-encapsulate-relation-type-semantics.md
- src/foundation/relation-semantics.ts (new)
- src/render/svg.ts
- src/render/theme.ts
- src/layout/viz.ts
- src/layout/elk-graph.ts
- src/layout/elk-result.ts
- src/layout/compound.ts
- src/transform.ts
- tests/relation-semantics.test.ts (new)
- tests/relations.test.ts
- tests/line-semantics.test.ts
- tests/viz.test.ts
