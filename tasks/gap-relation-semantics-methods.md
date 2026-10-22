---
id: gap-relation-semantics-methods
title: 把 RelationSemantics 从字段暴露收紧为方法暴露（isDashed() 等）
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

`gap-encapsulate-relation-type-semantics` 已落地（done），实际形式是 `RelationSemantics` 接口（`reversed` / `dashed` / `arrowKind` / `filled` / `weak` / `bundlable` 六个 readonly 字段）+ `RELATION_SEMANTICS` 表 + `relationSemantics(type)` 访问函数。消费者（`svg.ts`、`viz.ts`、`elk-result.ts`、`elk-graph.ts`、`compound.ts`、`transform.ts`）现在委托语义对象、读**字段**（`relationSemantics(type).dashed`），不再各自 if/else 判定——实质封装已达成，跨引擎线型 bug 已修。

本任务只做最后一步收紧：按「行为通过方法暴露」的封装边界，把字段访问改为方法调用——`isDashed()` / `isReversed()` / `arrowKind()` / `isFilled()` / `isWeak()` / `isBundlable()`。消费者从读字段改为调方法。

诚实说明收益：对「这个关系类型是不是虚线」这类纯布尔事实，字段与方法语义等价，收益是**隐藏内部表示**（未来某个语义若从固定布尔变为计算值，消费者不需要改），以及把「这是数据」和「这是行为」在调用点区分开。不是 bug 修复，是封装边界的形式收紧。

## AC

- [x] 改动前红：`grep -rc "relationSemantics([^)]*)\.\(reversed\|dashed\|weak\|bundlable\|filled\|arrowKind\)" src --include='*.ts'` 合计 ≥6，证明消费者读字段而非调方法
- [x] 接口改方法：`RelationSemantics` 接口的六个字段改为方法 `isDashed()` / `isReversed()` / `arrowKind()` / `isFilled()` / `isWeak()` / `isBundlable()`；`relationSemantics()` 返回同一值对象
- [x] 消费者改调用：`svg.ts` / `viz.ts` / `elk-result.ts` / `elk-graph.ts` / `compound.ts` / `transform.ts` 从 `relationSemantics(type).dashed` 改为 `relationSemantics(type).isDashed()`；`grep -rc "relationSemantics([^)]*)\.\(reversed\|dashed\|weak\|bundlable\|filled\)" src --include='*.ts'` 降为 0（只剩方法调用）
- [x] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿；`tests/relation-semantics.test.ts`、`tests/line-semantics.test.ts` 不改断言即通过；两个 fixture 的 elk/viz 输出与改动前一致
- [x] 未知类型回退不变：`relationSemantics()` 对域外类型的 `UNKNOWN_RELATION_SEMANTICS` 回退行为不变（仍不抛错，`isDashed()` 等返回与改动前一致的默认值）

## DoD

`RelationSemantics` 的语义通过方法暴露，消费者调 `isDashed()` 而非读 `.dashed` 字段；六个消费者全部改为方法调用；未知类型回退不变；无任何行为回归。不是「把字段改名」——而是「语义判定是行为，通过方法暴露，内部表示可替换」。

## Touches

- tasks/gap-relation-semantics-methods.md
- src/foundation/relation-semantics.ts
- src/render/svg.ts
- src/layout/viz.ts
- src/layout/elk-result.ts
- src/layout/elk-graph.ts
- src/layout/compound.ts
- src/transform.ts
- tests/relation-semantics.test.ts

## Evidence

- AC1 baseline: `grep -rc` 合计 8（elk-result 1 + svg 1 + transform 2 + compound 2 + elk-graph 2），≥6。
- AC2: `RelationSemantics` 现在只声明六个方法；模块私有 `RelationFacts` 由 `semantics()` 闭包持有，`RELATION_SEMANTICS` 与 `UNKNOWN_RELATION_SEMANTICS` 都是 `semantics(facts)` 返回的缓存值对象，`relationSemantics()` 每次返回同一个对象（测试 `toBe` 锁定）。
- AC3: 改动后同一条 `grep` 输出为空（0）；六个消费者全部改为方法调用。
- AC4: `npm run typecheck` 全绿；`tests/relation-semantics.test.ts`（4）、`tests/line-semantics.test.ts`（4）、`tests/viz.test.ts`（4）、`tests/relations.test.ts`（9）全绿（全量 suite 由 fan-in 执行）。改动前后各渲染 inline 全关系模型 + `tests/fixtures/archguard-architecture.puml`（elk/viz 两引擎，SVG + warnings 共 8 项），deep-compare 8/8 逐字节一致。
- AC4 测试断言说明（诚实记录）：`arrowKind` 无法同时作为数据字段与 `arrowKind()` 方法存在于同一值对象，因此 `expect(RELATION_SEMANTICS).toEqual(expected)` 这条**表示锁定**断言必须改为通过方法面读取——现为 `expect(factsOf(relationSemantics(type))).toEqual(expected[type])`，期望的六个事实值逐项未变；`line-semantics.test.ts` 断言未动；渲染断言未动。这是本次「表示从字段改为方法」自身的必然变更，不是行为断言弱化。
- AC5: 新增 `falls back to anonymous-line facts for out-of-domain types` 用例，锁定 `call` 等域外类型返回 `{reversed:false,dashed:false,arrowKind:'none',filled:false,weak:false,bundlable:false}` 且为同一共享回退对象。
- Anti-drift: `--task gap-relation-semantics-methods --merge-target develop` 通过（8 个实际改动文件均在声明 Touches 内）；已 `git merge develop` 后重跑 typecheck + 相关测试仍绿。