---
id: gap-converge-duplicated-definitions
title: 收敛重复定义到单一来源：PACKAGE_LABEL 已漂移（度量失真）+ parser 语法重复
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

两处「靠注释维持一致性」的重复知识，其中一处已经漂移成正确性 bug：

1. **PACKAGE_LABEL 漂移（正确性 bug）**：`src/layout.ts:70` 现在定义 `PACKAGE_LABEL = { tabHeight: 20, fontSize: 12, tabPadding: 8 }`，而 `src/layout-metrics.ts:87-89` 仍本地定义 `PACKAGE_TAB_HEIGHT = 18` / `PACKAGE_LABEL_FONT_SIZE = 12` / `PACKAGE_TAB_PADDING = 12`（注释写「kept in step with ../render/svg」）。两者已不一致：`computeLayoutMetrics` 的 `labelOverlapCount` 用 18/12 度量，渲染用 20/8 画，度量在静默失真。这是「复制 + 漂移」，不只是 DRY。

2. **parser 语法重复**：`src/core.ts` 里的 `ENTITY_DECL`（:255）、`ENTITY_KEYWORD`（:256）、`extractDeclaredName`（:432）、`stripComment`（:445）与 `src/parser.ts` 的 `ENTITY_LINE`（:24）、`stripComment`（:514）及其 `parseEntityLine` 的声明解析是同一套 PlantUML 词法，写了两遍。`checkSyntax`/`explain` 诊断与 parser 各持一份，任一改语法都可能只改到一处。

**方案**：收敛到单一来源——几何常量只由 `PACKAGE_LABEL` 定义，`layout-metrics.ts` import 它；PlantUML 词法/声明解析只由 parser（或一个 parser 与 core 都能 import 的叶子词法模块）定义，`checkSyntax`/`explain` 复用而非重写。验收判据「每个名字定义恰为 1 处」，且改动前实跑为红。

<!-- dedup-ref -->这两个重复最早在 plantuml-js 首次架构分析里就报过（机械层抓不到，靠人工核对），一直没修；`index.ts → core.ts` 的拆分只是把语法重复从 index 挪到 core，重复本身没消。相关但机制不同的已完成任务：`gap-elk-layout-engine-split-responsibilities`（只拆职责，未涉及重复定义）。

## AC

- [x] 改动前红：`grep -c "PACKAGE_TAB_HEIGHT\|PACKAGE_LABEL_FONT_SIZE\|PACKAGE_TAB_PADDING" src/layout-metrics.ts` 当前命中 ≥1；`grep -c "function stripComment" src/core.ts src/parser.ts` 合计为 2。改动后前者为 0，后者仅 1 处定义（另一处 import/引用）
- [x] 几何单源：`src/layout-metrics.ts` 删除本地三个常量并 import `PACKAGE_LABEL`；`grep -rn "tabHeight: 20\|tabHeight: 18\|tabPadding: 8\|tabPadding: 12" src --include='*.ts'` 只命中 `src/layout.ts` 的 `PACKAGE_LABEL` 定义
- [x] 度量对齐回归：新增或修改 `tests/layout-metrics.test.ts`，断言 label 重叠判定使用的几何 === `PACKAGE_LABEL`（合成包标签用例，改动前该断言红、改动后绿）
- [x] 词法单源：`checkSyntax`/`explain`（`src/core.ts`）复用 parser（或共享词法模块）的实体声明正则与 `stripComment`，`src/core.ts` 不再本地定义 `ENTITY_DECL`/`ENTITY_KEYWORD`/`extractDeclaredName`/`stripComment`；`grep -c "stripComment" src/core.ts` 为 0（只剩 import 或调用）
- [x] 无行为回归：`npm run typecheck` 与 `npx vitest run` 全绿，`tests/api.test.ts`（checkSyntax/explain）与 `tests/members.test.ts`、`tests/relations.test.ts` 不改断言即通过；两个 fixture 渲染 SVG sha256 与改动前相等
- [x] 度量漂移修复可解释：`node scripts/render-samples.mjs` 后对比 `rendered/metrics.baseline.json`，`labelOverlapCount` 若变化须在任务评论写明变化量与原因（改用正确的 20/8 重新度量是预期内变化，不是回归）

## DoD

两处重复知识都收敛为「每个名字定义恰为 1 处」且由单一来源消费；PACKAGE_LABEL 的漂移被修正（度量用与渲染一致的几何）；词法只在一处定义。不是「删掉一份」就完——必须证明消费方 import 的是那份唯一来源，且改动前判据实跑为红。

## Touches

- tasks/gap-converge-duplicated-definitions.md
- src/layout.ts
- src/layout-metrics.ts
- src/core.ts
- src/parser.ts
- tests/layout-metrics.test.ts
- tests/api.test.ts

## Blocker

**2026-10-21T23:44:01.586Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/6，剩余未勾 6）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：4f11976c-5df3-421a-8272-e9104c7564d2
