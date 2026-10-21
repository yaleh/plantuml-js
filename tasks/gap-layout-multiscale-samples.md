---
id: gap-layout-multiscale-samples
title: 多规模样例集（S/M/L/XL）+ 分档度量表 + 原尺寸分块截图用于看细节
status: done
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-legibility-legend-metrics-fixes
  - gap-render-undeclared-relation-endpoints
---
## Proposal

目前 `scripts/render-samples.mjs` 只覆盖 fixture(22 实体)、package(64)、少数视图与 all-classes(660)，缺中小规模样例，看不出"不同规模下渲染细节是否都合理"。同时大图的 PNG 缩放后看不清细节（箭头、标签、徽标、边与节点的间隙），需要原尺寸分块。本任务：
1. 新增样例清单 `scripts/samples.json`，按规模分档：**S**（≤25 实体：`archguard-class.puml`、`archguard-architecture-manual.puml`、`Src_Cli_Utils_Layer` 视图）、**M**（25–70：`archguard-architecture.puml`、`archguard-package.puml`、`Src_Mermaid_Layer` 与 `Src_Types_Layer` 视图）、**L**（100–200：由 all-classes 中名称匹配 `Src_Plugins_*` 的若干包合并出的子集，支持清单里的 `packagesMatching` 过滤）、**XL**（660：all-classes 完整图）。每个样例声明 id、来源、过滤条件、档位、期望阈值（见 AC）。
2. `render-samples.mjs` 读取清单，同时用 elk 与 viz（viz 仅对 S/M）渲染，`metrics.json` 记录档位，并在终端输出按档位分组的对照表（实体数、宽×高、交叉、穿节点、非正交边、面积利用率、宽高比、溢出）。
3. 新增 `--tiles`：对每张图按原尺寸（1:1）切成 ≤1800×1200 的分块 PNG（`rendered/tiles/<id>/r<行>c<列>.png`），并输出一张缩略总览 PNG 标出分块位置，使人和视觉检查能逐块看细节；超大图（>100 MP）只做分块、不做整图截图。
4. 各档位阈值（`samples.json` 内声明，harness 退出码依据）：S 的 `edgeNodeIntersections === 0`、宽高比 0.6–2.2、`areaUtilization` ≥ 0.25；M 的宽高比 0.5–2.5、`areaUtilization` ≥ 0.12；L/XL 的宽高比 0.4–3，且不得出现非正交边与文字溢出。

## AC

- [x] `scripts/samples.json` 含至少 3 个 S、4 个 M、1 个 L、1 个 XL 样例，每个有 `tier`、`source`、阈值；`tests/samples-manifest.test.ts` 校验清单 schema 与所引用的文件均存在
- [x] `node scripts/render-samples.mjs --manifest <archguard 输出根目录>` 退出码按阈值判定；终端打印按档位分组的对照表；`rendered/metrics.json` 每条记录含 `tier`
- [x] `node scripts/render-samples.mjs --tiles` 为每个样例写出 `rendered/tiles/<id>/` 分块（每块 ≤1800×1200，1:1 像素）与 `overview.png`；对 XL 不整图截图（无 OOM，退出码 0）
- [x] 对 `Src_Plugins_*` 合并出的 L 样例，`packagesMatching` 过滤结果实体数在 100–200 之间（`tests/samples-manifest.test.ts` 断言）
- [x] 不满足阈值的 S/M 档样例逐个在 `docs/layout-routing-eval.md` 列出原因（本任务不要求修好，只要求暴露；当前 S `s-architecture-manual` 宽高比 2.67>2.2、M `m-package` areaUtilization 0.064<0.12，均已列出）
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过

## DoD

执行一次 `render-samples.mjs --manifest … --tiles` 得到 S/M/L/XL 四档共 ≥9 个真实样例的度量表与分块图；至少抽查一个 S、一个 M、一个 L 档样例的分块 PNG，目视确认箭头、徽标、标签、边间距细节可检查，并把观察写入 `docs/layout-routing-eval.md`。

## Touches

- tasks/gap-layout-multiscale-samples.md
- scripts/render-samples.mjs
- scripts/samples.json (new)
- scripts/samples-lib.mjs (new)
- scripts/tile-png.mjs (new)
- docs/layout-routing-eval.md
- tests/samples-manifest.test.ts (new)
