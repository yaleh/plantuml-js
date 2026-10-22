---
id: gap-sink-root-domain-modules
title: 把 parser/serialize/transform 下沉出根包，让根包只剩门面
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

`gap-sink-shared-core-to-leaf` 已把共享核心（model/layout/text-measure/edge-router/relation-semantics/layers）沉到 `foundation/`，目录环清零。但**根包（`src/`）仍混着「门面」和「领域模块」**：

- 门面：`index.ts`（全量）、`core.ts`（viz-free 核心）、`elk.ts`（`./elk` 子路径）、`archguard.ts`（`./archguard` 子路径）。
- 领域模块：`parser.ts`（PlantUML → model）、`serialize.ts`（model → PlantUML，parse 的逆）、`transform.ts`（视图/聚合/约简/环标注的模型变换）。

这三个领域模块不是门面，却和门面躺在同一个目录。`src/` 内它们的消费者只有 `core.ts`（门面），tests 里 12 个文件直接 import。

**方案**：把三个领域模块下沉到各自目录，根包只留门面：

- `src/parser.ts` → `src/parse/parser.ts`，`src/serialize.ts` → `src/parse/serialize.ts`（parse 的正逆对，同域）。
- `src/transform.ts` → `src/transform/transform.ts`。

纯文件移动 + import 路径更新，不改任何行为。下沉后根包 = 纯门面，领域模块各归其位，与 `foundation`/`layout`/`render` 的分层一致。

## AC

- [x] 根包只剩门面：`ls src/*.ts` 只有 `index.ts` / `core.ts` / `elk.ts` / `archguard.ts`（四个门面）；`src/parser.ts`、`src/serialize.ts`、`src/transform.ts` 不再存在于根包
- [x] 领域模块归位：`src/parse/parser.ts`、`src/parse/serialize.ts`、`src/transform/transform.ts` 存在且内容与移动前一致（git 视为 rename）
- [x] 无反向依赖：`src/parse/`、`src/transform/` 只依赖 `foundation/`，不依赖 `layout/`、`render/`；`grep -rn "from '\.\./layout\|from '\.\./render\|from '\.\./core" src/parse src/transform` 无命中
- [x] 目录环保持 0：重新 `archguard_analyze` 后 `archguard_detect_cycles(outputScope="package")` 的环数仍为 0
- [x] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿，所有既有测试不改断言即通过；两个 fixture 渲染 SVG sha256 与改动前相等；`npm run build` 退出码 0

## DoD

不是「文件换个目录」就完——而是根包从「门面 + 领域模块混杂」变成「纯门面」，parser/serialize/transform 各归其位，与 foundation/layout/render 的分层一致；目录环保持 0；公开导出（`core.ts` 的 re-export）不变、测试与构建全绿。

## Touches

- tasks/gap-sink-root-domain-modules.md
- src/parse/parser.ts (new)
- src/parse/serialize.ts (new)
- src/transform/transform.ts (new)
- src/core.ts
- tests/stub-grouping.test.ts
- tests/transform.test.ts
- tests/layer-order.test.ts
- tests/layering.test.ts
- tests/views.test.ts
- tests/layout-aspect-ratio-option.test.ts
- tests/cross-package-routing.test.ts
- tests/detail.test.ts
- tests/grouping.test.ts
- tests/ports.test.ts
- tests/layout-foundation.test.ts
- tests/grid-alignment.test.ts
- examples/demo.ts
