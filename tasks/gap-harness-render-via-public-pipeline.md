---
id: gap-harness-render-via-public-pipeline
title: harness 走公开渲染管线（detail/变换/视图一致）+ 修 Chrome 实测 ENOBUFS 崩溃 + metrics 含
  chromeTextOverflow
status: done
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

第五轮检查（S/M/L/XL，`render-samples.mjs --manifest … --tiles`）暴露 harness 的两个缺陷：
1. **崩溃**：对 `xl-all-classes` 做 Chrome 文字实测时 `measure-svg-text.mjs` 用 `execFileSync(chrome, [..., '--dump-dom', url])` 取输出，Chrome 把整个 DOM（含 14568×6980 的 SVG，远超 1 MB）打到 stdout，默认 `maxBuffer` 1 MB 触发 `spawnSync google-chrome ENOBUFS`，整个脚本退出，`metrics.json` 来不及写出，PNG/分块虽已写但度量全丢。我用 `node -r` 预加载把 `maxBuffer` 调到 1 GB 才绕过。
2. **度量对象与用户实际得到的不一致**：`render-samples.mjs` 直接调用 `ElkLayoutEngine` + `renderSvg`，绕过了 `src/core.ts` 的公开管线（`transformForRender` + `applyDetail` 等）。因此 660 实体的 `xl-all-classes` 在 harness 里以 `full`（逐个画全部成员行）渲染，而公开 API 默认会选 `names`（`autoDetail`）；`tests/detail.test.ts` 绿，但肉眼检查与度量评的是一张用户永远拿不到的图。`metrics.json` 的记录里也没有 `chromeTextOverflow` 字段。

## AC

- [x] `measure-svg-text.mjs` 不再依赖 `--dump-dom` 输出整个 DOM：页面脚本算完溢出数后清空 `document.body`（或仅把结果写进 `document.title`），使 stdout 体积与 SVG 大小无关；对 14568×6980 的 `xl-all-classes` SVG 在默认 `maxBuffer` 下退出码 0（`tests/measure-svg-text.test.ts` 用合成大 SVG 断言不抛 ENOBUFS）
- [x] `render-samples.mjs` 经由 `src/core.ts` 的同一渲染管线得到 model、layout、svg（必要时由 core 导出 `renderDetailed()` 返回 `{ model, layout, svg }`），不再自行拼装 `ElkLayoutEngine + renderSvg`；`tests/harness-pipeline.test.ts` 断言：对 660 实体的输入，harness 渲染的 SVG 不含成员行文本（`names`），对 22 实体的输入含成员行
- [x] `metrics.json` 每条记录含 `chromeTextOverflow`（数值），`node scripts/render-samples.mjs --manifest <archguard 输出根目录> --tiles` 在不打补丁的情况下对 S/M/L/XL 全部样例退出码仅由阈值判定，且 `metrics.json` 被写出
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

在干净环境用 archguard 真实目录执行 `render-samples.mjs --manifest … --tiles`，一次跑完 16 条记录并写出 `metrics.json`，其中 `xl-all-classes` 以 `names` 详略渲染（分块图里没有成员行），`chromeTextOverflow` 全部有值。

## Touches

- tasks/gap-harness-render-via-public-pipeline.md
- scripts/render-samples.mjs
- scripts/measure-svg-text.mjs
- src/core.ts
- src/index.ts
- tests/measure-svg-text.test.ts (new)
- tests/harness-pipeline.test.ts (new)
