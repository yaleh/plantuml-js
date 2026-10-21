---
id: gap-elk-layout-strategy-extension-point
title: 给 ElkLayoutEngine 定布局策略扩展点：新策略经注入加入而非改类，并清除实例草稿状态
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

`gap-elk-layout-engine-split-responsibilities`（已 landed）把 `src/layout/elk.ts` 从 570 行拆到 278 行，但 `ElkLayoutEngine` 仍是中心决策点：archguard 重测 call 出度 26（拆前 23）、methodCount 15。`layout()` / `layoutRaw()` 里是一串硬编码启发式（`isProportionate` → `isGappyMidScale` → `isColumn` → compound fallback → stub 轨道重试），下一种布局策略仍必须改 `ElkLayoutEngine`。这正是「只抽代码、不建扩展点，增量会回流」的形状（对齐 quay DIR-133 ②）。

<!-- dedup-ref -->本任务是上一任务 `gap-elk-layout-engine-split-responsibilities` 漏掉的扩展点判据：那次只写了「文件 ≤400 行、methodCount ≤8、outDegree ≤11」，没有写「新策略加在哪」，结果文件短了、出度反而升到 26。相关但机制不同的已完成任务：`gap-layout-mid-scale-packing-and-regression-guard`、`gap-layout-interpackage-aggregation-and-line-semantics`，它们都在往 `ElkLayoutEngine.layout` 的决策链里加分支，正是本任务要收敛的对象。

**方案**：把策略选择从类内硬编码的 if/else 链，改为可经构造参数/选项注入的策略对象，使新策略经注册/注入加入，而非改 `src/layout/elk.ts`。不预设具体机制（Strategy 接口、注册表、函数注入皆可），验收判据固定（照 quay AC-915 形状：外部注册合成策略 + 负对照）。同时清掉两个私有可变字段 `stubsOrbited` / `orbit`——它们现在是 `layoutRaw()` 写、`layout()` 读的实例草稿状态，让 `layout()` 不重入；改为由 `layoutRaw` 的返回值携带，否则注入策略后该隐患仍在。

## AC

- [x] 改动前红：先写 `tests/elk-strategy.test.ts`（正对照：注入一个返回固定 `LayoutResult` 的合成策略并断言其被采用；负对照：断言一个抛错的策略不被静默忽略），对当前 HEAD 跑 `npx vitest run tests/elk-strategy.test.ts`，确认因扩展点尚不存在而红，记录输出
- [x] 正对照：经 `ElkLayoutEngine` 构造参数或 `createRenderer` 选项注入的合成策略，在**不改 `src/layout/elk.ts`** 的前提下端到端生效（渲染输出来自该合成结果）
- [x] 负对照：抛错的策略不被静默忽略，错误经渲染路径可诊断地抛出；`tests/elk-strategy.test.ts` 断言
- [x] 无实例草稿状态：`grep -n "stubsOrbited\|this.orbit" src/layout/elk.ts` 无命中（私有可变字段改由 `layoutRaw` 返回值携带，`layout()` 不再靠 `this` 在多次 `layoutRaw` 之间传草稿值）
- [x] 无行为回归：`tests/fixtures/archguard-class.puml` 与 `tests/fixtures/archguard-package.puml` 经 `createRenderer({ layout: 'elk' })` 渲染的 SVG 与改动前 sha256 逐一相等；`npm run typecheck` 与 `npx vitest run` 全绿，既有测试不改断言
- [x] archguard 重测：重新 `archguard_analyze`（`lang=typescript`、`sources=["src"]`）后，`ElkLayoutEngine` 的 `methodCount` ≤ 15 且 `outDegree` 不高于现状 26；策略代码落在 `src/layout/elk.ts` 之外

## DoD

新布局策略在**不改 `ElkLayoutEngine`** 的前提下经注册/注入生效（外部合成策略正对照 + 抛错负对照两条测试证明），渲染逐字节不变；两个私有可变字段不再作为实例草稿状态；架构读数证明类不再是新策略的唯一落点。不是「拆文件变短」，而是「策略加入的缝被可证伪地证明存在」。

## Touches

- tasks/gap-elk-layout-strategy-extension-point.md
- src/layout/elk.ts
- src/layout/strategy.ts (new)
- tests/elk-strategy.test.ts (new)
