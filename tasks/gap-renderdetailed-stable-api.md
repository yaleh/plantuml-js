---
id: gap-renderdetailed-stable-api
title: renderDetailed 作为公开、带类型、稳定 API 发布
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`renderDetailed()` / `DetailedRender` 已在 HEAD 存在（返回 view/transform/detail 之后真正画的 `model` + `layout` + `svg` + `layoutMs` + `hiddenTransitive`），但尚未作为公开、带类型、稳定的 API 契约交付——npm 0.2.2 的 `RenderResult` 只有 svg/diagramType/warnings。Architecture-tab 的缩略图、搜索跳转、选中框都要读 `layout` 里的 node/package/edge 矩形，现在只能从 SVG 反读 bbox。方案：把 `renderDetailed`/`DetailedRender` 定为公开契约：从 `./` 与 `./elk` 导出、`DetailedRender.layout` 的矩形字段（nodes/edges/packages 的 x/y/width/height）在 README/类型注释里写明是稳定字段、补 API 文档，并随下一版发布。

<!-- dedup-ref -->
为 `gap-plantuml-serializer` 提供稳定输入（`renderDetailed().model` 是其消费对象）。

## AC

- [x] `tests/api.test.ts`（扩展）断言 `renderDetailed` 与 `DetailedRender` 从包入口（`./` 与 `./elk`）导出，且 `renderDetailed(puml)` 返回的 `.model`/`.layout`/`.svg`/`.layoutMs`/`.hiddenTransitive` 字段存在、类型正确；`npx vitest run tests/api.test.ts` 退出 0。
- [x] `README.md` 的 API 表新增 `renderDetailed` 行，写明 `DetailedRender.layout` 的 node/package/edge 矩形字段是稳定契约（含指向 `data-entity-id`/`data-package-id`/`data-edge-*` 的对应关系）。
- [x] `npm test` 与 `npm run typecheck` 退出 0。

## DoD

Architecture-tab 从 `renderDetailed()` 直接读节点/包/边矩形做缩略图与跳转，不再从 SVG 反读 bbox；公开类型与文档就绪，随下一版 npm 发布。

## Touches

- src/core.ts
- tests/api.test.ts
- README.md
- tasks/gap-renderdetailed-stable-api.md