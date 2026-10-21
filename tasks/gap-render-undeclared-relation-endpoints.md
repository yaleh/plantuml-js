---
id: gap-render-undeclared-relation-endpoints
title: 关系端点未声明（隐式类 / 包别名）时不再让 ELK 抛 JsonImportException
status: ready
labels:
  - gap
  - defect
  - layout
parent: null
children: []
extra:
  schema: execution
---
## Finding

补充中小规模真实样例时发现渲染崩溃：`/data/home/yale/work/archguard/docs/archive/diagrams/archguard-architecture-manual.puml`（18 实体 / 17 关系 / 4 包）与 `archguard-architecture.puml`（52 实体 / 71 关系 / 4 包）都通过 `checkSyntax`（`ok === true`），`parsePlantUml` 也成功，但 `ElkLayoutEngine.layout` 抛出 `org.eclipse.elk.graph.json.JsonImportException: Referenced shape does not exist: CLI_Layer`（后者是 `Error`）。原因是关系的端点既不是已声明的 entity 也不是 package 就进入了 ELK 边：(a) 关系引用了**包别名**（`CLI_Layer`，PlantUML 允许包作为关系端点）；(b) 关系引用了**从未声明的类名**（`Error`，PlantUML 会隐式创建该类）。这类输入在手写 puml 与文档里很常见，中小规模图一旦遇到就整张渲染失败，比布局质量问题严重得多。`createRenderer().render` 对这两个文件直接抛错，用户拿不到任何输出。

## AC

- [ ] `tests/undeclared-endpoints.test.ts`：对 `@startuml\nclass A\nA --> B\n@enduml`（`B` 未声明）渲染成功，输出 SVG 含 `B` 的类框与 A→B 的边；`parsePlantUml` 产出的 `model.entities` 含隐式创建的 `B`（成员为空）
- [ ] 同文件：关系端点为包别名时（`package "X Layer" as X { class A }` 加 `X --> A` 与 `A --> X`），渲染不抛异常；包端点按设计处理（把边挂到包内代表节点，或以包框边界为端点），并在 `RenderResult.warnings` 记录一条说明
- [ ] 两个真实文件 `archguard-architecture-manual.puml` 与 `archguard-architecture.puml` 复制到 `tests/fixtures/`，`createRenderer().render` 都成功，输出 SVG 合法且 `textOverflowCount === 0`
- [ ] `checkSyntax` 对隐式声明的端点返回 `warning`（不是 `error`），`tests/api.test.ts` 断言
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

用 `/data/home/yale/work/archguard/docs/archive/diagrams/` 下两个真实文档图端到端渲染出 SVG（不是合成 toy 输入），PNG 目视：隐式类以普通类框出现，包端点的边落在包框上或包内节点上，无空白图、无异常；`RenderResult.warnings` 与 `checkSyntax` 对隐式声明给出可诊断的说明。

## Touches

- tasks/gap-render-undeclared-relation-endpoints.md
- src/parser.ts
- src/layout/elk.ts
- src/index.ts
- tests/undeclared-endpoints.test.ts (new)
- tests/api.test.ts
- tests/fixtures/archguard-architecture-manual.puml (new)
- tests/fixtures/archguard-architecture.puml (new)