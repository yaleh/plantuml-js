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

**方案**：把 `RelationType` 的语义**封装**进一个内聚模块 `src/relation-semantics.ts`——对外只暴露一张 `RelationType → 语义事实` 的映射（`reversed`、`dashed`、`arrowKind`、`filled`、`weak`、`bundlable`）。调用方只问这个模块，不再各自判定语义：svg/viz 负责把语义事实翻译成自己的输出格式（SVG DOM / DOT attrs），elk-graph/elk-result/compound 读 `reversed`，transform 读 `bundlable`。「哪种关系是虚线 / 哪种要反转 / 箭头类别」这类知识从此只定义一次。

这是 OO 封装价值的直接应用：数据（RelationType）和它决定的行为（怎么画、怎么布局）收进同一个内聚单元，而不是让每个消费者各自知道细节。

## AC

- [ ] 改动前红：`grep -rc "REVERSED_RELATION_TYPES = new Set" src --include='*.ts'` 合计为 2（证明双定义）；一个断言「elk 与 viz 对同一 fixture 的 implementation 边线型一致」的新测试，改动前红（svg 实线 vs viz 虚线）
- [ ] 封装单源：新增 `src/relation-semantics.ts`，`grep -rc "REVERSED_RELATION_TYPES = new Set" src --include='*.ts'` 降为 1（唯一持有者是 relation-semantics 或其语义表，elk-graph/compound 的局部定义删除）；`reversed`/`dashed`/`arrowKind`/`filled`/`weak`/`bundlable` 每个语义判定只在该模块出现一次
- [ ] 线型一致：implementation 在 elk 与 viz 两引擎都渲染为虚线（对齐 PlantUML `..|>` 与 viz 现状，svg 从实线改为虚线）；新增 `tests/relation-semantics.test.ts` 断言两个引擎读到的 `dashed` 映射一致
- [ ] 调用方不再各自判定语义：`src/layout/viz.ts` 的 `edgeAttrs` 与 `src/render/svg.ts` 的 `weak`/dash/箭头分支改为读 relation-semantics 的语义事实再翻译格式；`src/transform.ts shouldAutoReduce`、`src/render/svg.ts findEdgeBundles` 读 `bundlable`
- [ ] 无行为回归（除 implementation 线型修复）：两个 fixture 的 elk SVG 除 implementation 边的 `stroke-dasharray` 外与改动前 sha256 一致；viz DOT 输出与改动前一致；`npm run typecheck` 与 `npx vitest run` 全绿，既有测试不改断言
- [ ] 无新目录环：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 的环数不高于现状

## DoD

不是「把常量集中成一张表」就完——而是 `RelationType` 的行为语义被封装进一个内聚模块，svg / viz / elk / transform 四个消费者都不再各自知道「哪种关系虚线、哪种反转、箭头是什么」。跨引擎线型不一致的 bug 用测试锁死为一致；除该 bug 修复外渲染输出逐字节不变；「每个关系语义判定」的定义恰 1 处（改动前该计数为多处的证据已记录）。

## Touches

- tasks/gap-encapsulate-relation-type-semantics.md
- src/relation-semantics.ts (new)
- src/render/svg.ts
- src/layout/viz.ts
- src/layout/elk-graph.ts
- src/layout/elk-result.ts
- src/layout/compound.ts
- src/transform.ts
- tests/relation-semantics.test.ts (new)
- tests/relations.test.ts
- tests/viz.test.ts
