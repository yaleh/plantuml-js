---
id: gap-build-clean-dist-and-harness-metrics-path
title: 构建前清理 dist（重构后遗留旧产物）+ harness 改走公开导出取度量，不再按文件路径
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

第八轮检查时，`render-samples.mjs --manifest … --tiles --compare` 报 9 条阈值违例，全部是 `parallelBundleCount: missing` 与 `edgeFrameCrossings: missing`（任务 `gap-layout-fanout-trunk-and-frame-gutters` 刚落地，新度量理应已有）。根因是两件事叠加：
1. `gap-sink-shared-core-to-leaf` 把源文件从 `src/layout-metrics.ts` 等移到了 `src/layout/layout-metrics.ts` 与 `src/foundation/*`，但 `npm run build`（`tsc -p tsconfig.json`）只写不删，`dist/` 里仍留着重构前编译的旧文件：`dist/layout-metrics.js`（06:49）、`edge-router.js`、`layout.js`、`model.js`、`text-measure.js`、`render-dot.js` 等，与新的 `dist/layout/`、`dist/foundation/` 并存；
2. `scripts/render-samples.mjs:96` 按**文件路径**导入 `dist/layout-metrics.js`，因此拿到的是不含新度量的旧版本。我手动把路径改成 `dist/layout/layout-metrics.js` 重跑后，全部阈值通过（`parallelBundleCount` 0–1，`edgeFrameCrossings` 0–2）。
同样的风险也影响本地使用者与发布：`package.json` 的 `files` 含 `dist`，若在不干净的工作区执行 `npm publish`，旧产物会被一并打包（CI 在干净检出上构建，所以线上发布暂未受影响，但本地 `prepublishOnly` 没有保护）。

## AC

- [x] `npm run build` 先清理 `dist`（如 `rm -rf dist && tsc -p tsconfig.json`，需跨平台可用，可用 `node -e` 或 `rimraf`），`prepublishOnly` 同样先清理；`tests/build-clean.test.ts` 或 `scripts/check-dist-clean.mjs` 断言：构建后 `dist` 下每个 `.js` 都有对应的 `src` 源文件（无孤儿产物），在手工放入一个孤儿 `dist/ghost.js` 后再构建，该文件被删除
- [x] `render-samples.mjs` 不再按文件路径导入 `dist/layout-metrics.js`，改为从公开入口（`dist/index.js` 的导出，如 `computeLayoutMetrics`）取得；`src/index.ts` 已导出的名字保持不变；`tests/harness-imports.test.ts` 断言脚本源码中不含对 `dist/…layout-metrics` 文件路径的直接引用
- [x] 当 `samples.json` 声明了某个度量阈值而 `metrics.json` 里没有该字段时，harness 打印"度量缺失（可能是 dist 过期）"并提示执行干净构建，退出码非 0（保持现有行为，补充提示信息）
- [x] 在一个仍含旧产物的 `dist` 上直接运行 `npm run build && node scripts/render-samples.mjs --manifest <archguard 输出根目录> --compare`，退出码 0 且 `metrics.json` 含 `parallelBundleCount` 与 `edgeFrameCrossings`
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过

## DoD

在当前这个带着旧产物的工作区里直接执行 `npm run build`，旧文件消失，随后 harness 无需任何手工补丁即可跑完 16 条记录，`metrics.json` 含全部新度量，阈值判定与肉眼观察一致。

## Touches

- tasks/gap-build-clean-dist-and-harness-metrics-path.md
- package.json
- scripts/render-samples.mjs
- scripts/check-dist-clean.mjs (new)
- tests/build-clean.test.ts (new)
- tests/harness-imports.test.ts (new)
