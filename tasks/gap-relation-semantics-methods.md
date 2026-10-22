---
id: gap-relation-semantics-methods
title: 把 RelationSemantics 从字段暴露收紧为方法暴露（isDashed() 等）
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

`gap-encapsulate-relation-type-semantics` 已落地（done），实际形式是 `RelationSemantics` 接口（`reversed` / `dashed` / `arrowKind` / `filled` / `weak` / `bundlable` 六个 readonly 字段）+ `RELATION_SEMANTICS` 表 + `relationSemantics(type)` 访问函数。消费者（`svg.ts`、`viz.ts`、`elk-result.ts`、`elk-graph.ts`、`compound.ts`、`transform.ts`）现在委托语义对象、读**字段**（`relationSemantics(type).dashed`），不再各自 if/else 判定——实质封装已达成，跨引擎线型 bug 已修。

本任务只做最后一步收紧：按「行为通过方法暴露」的封装边界，把字段访问改为方法调用——`isDashed()` / `isReversed()` / `arrowKind()` / `isFilled()` / `isWeak()` / `isBundlable()`。消费者从读字段改为调方法。

诚实说明收益：对「这个关系类型是不是虚线」这类纯布尔事实，字段与方法语义等价，收益是**隐藏内部表示**（未来某个语义若从固定布尔变为计算值，消费者不需要改），以及把「这是数据」和「这是行为」在调用点区分开。不是 bug 修复，是封装边界的形式收紧。

## AC

- [ ] 改动前红：`grep -rc "relationSemantics([^)]*)\.\(reversed\|dashed\|weak\|bundlable\|filled\|arrowKind\)" src --include='*.ts'` 合计 ≥6，证明消费者读字段而非调方法
- [ ] 接口改方法：`RelationSemantics` 接口的六个字段改为方法 `isDashed()` / `isReversed()` / `arrowKind()` / `isFilled()` / `isWeak()` / `isBundlable()`；`relationSemantics()` 返回同一值对象
- [ ] 消费者改调用：`svg.ts` / `viz.ts` / `elk-result.ts` / `elk-graph.ts` / `compound.ts` / `transform.ts` 从 `relationSemantics(type).dashed` 改为 `relationSemantics(type).isDashed()`；`grep -rc "relationSemantics([^)]*)\.\(reversed\|dashed\|weak\|bundlable\|filled\)" src --include='*.ts'` 降为 0（只剩方法调用）
- [ ] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿；`tests/relation-semantics.test.ts`、`tests/line-semantics.test.ts` 不改断言即通过；两个 fixture 的 elk/viz 输出与改动前一致
- [ ] 未知类型回退不变：`relationSemantics()` 对域外类型的 `UNKNOWN_RELATION_SEMANTICS` 回退行为不变（仍不抛错，`isDashed()` 等返回与改动前一致的默认值）

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
