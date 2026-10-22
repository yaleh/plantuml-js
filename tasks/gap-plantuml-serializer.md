---
id: gap-plantuml-serializer
title: toPlantUml(model) 序列化器：PlantUmlModel → 文本，往返稳定
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Architecture-tab 的「复制当前图的 PlantUML 文本」需要把屏幕上真正画的那份 model（`renderDetailed().model`，即 view/transform/detail 之后）序列化回文本。现在只有 `parsePlantUml`（文本→model），缺反向。方案：新增纯函数 `src/serialize.ts` 的 `toPlantUml(model): string`，覆盖 `@startuml/@enduml`、嵌套 `package "x" as alias { … }`、entity（class/interface/enum/abstract、generics、alias、成员分栏 `+/-/#/~`、`… +N` 截断行、`<<function>>` 构造型）、relation（六种 arrow、label、cardinality、stereotype）。子图范围由调用方组合：`toPlantUml(applyView(model, {kind:'neighborhood', entity, hops}))`，本函数不替调用方选范围。stub 实体按普通 class 序列化（保留 id/name，dashed 框是渲染语义）。

<!-- dedup-ref -->
依赖 `renderDetailed().model` 的稳定形状（见 `gap-renderdetailed-stable-api`）；与 `gap-layout-arbitrary-elk-options` 等布局任务无关，本任务纯序列化。

## AC

- [x] `tests/serialize.test.ts`（新增）对 `archguard-class.puml`、`archguard-package.puml` 与一个嵌套 package 合成 fixture：`checkSyntax(toPlantUml(parsePlantUml(p))).ok === true`，且 `parsePlantUml(toPlantUml(parsePlantUml(p)))` 的 entities（id/name/kind/packageId/parentId）与 relations（source/target/type/label）与原 model 一致。`npx vitest run tests/serialize.test.ts` 退出 0。
- [x] 子图稳定：对 `applyView` 的 overview/package/neighborhood 三种结果、以及 `renderDetailed(...)` 的 `.model`（view/transform/detail 之后）做同一往返断言；成员分栏、`… +N` 截断行、`<<function>>` 构造型在往返后仍保留为原文。
- [x] `npm test` 与 `npm run typecheck` 退出 0；`toPlantUml` 从 `core`（`./` 与 `./elk`）导出。

## DoD

Architecture-tab 用 `toPlantUml(renderDetailed().model)` 复制「当前可见图」，得到与屏幕一致的 PlantUML 文本（嵌套 package/构造型/成员分栏/截断行都在），quay 全 Entity 图（211,243 字符）与 60 节点子图均能序列化且 reparse 无 error。

## Touches

- src/serialize.ts
- src/core.ts
- tests/serialize.test.ts
- tasks/gap-plantuml-serializer.md

## Blocker

**2026-10-22T09:00:39.025Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/3，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：54dda3ba-4032-4c27-a83f-b9be38b07af9
