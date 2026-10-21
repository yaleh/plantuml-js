---
id: gap-layout-module-grouping-hubs
title: 模块目录分组 + 默认枢纽汇总 + 边束合并 + 按依赖方向排 Layer
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

第一轮落地后目视检查（`rendered/package.elk.png`、`package-overview.elk.png`、`package-pkg-Src_Layer.elk.png`）发现：`package.puml` 的"包"实际是 5 个 Layer，真正的架构单元是 64 个形如 `src/cli/query` 的模块节点。overview 只折叠 Layer，得到 5 个节点（299×206），没有信息量；而 Src Layer 单包视图仍是 ~50 个节点、1445 次边交叉的毛球，`src/types` 处依然是一团黑色箭头三角。`package.elk` 的 `areaUtilization` 从基线 0.043 降到 0.026，交叉数只从 1868 降到 1446。本任务：
1. 在 `src/transform.ts` 增加 `groupByPathPrefix`：对路径形名字（`a/b/c`）按前 N 级目录推导层级分组（`src/cli`、`src/analysis`、`src/plugins`、`src/core`…），作为新的 overview 粒度（`view: { kind: 'overview', depth: N }`），组间边聚合并带权重；
2. 枢纽汇总（`summarizeHubs`）在节点数超过阈值的完整图里**默认启用**，不再只在 view 里生效；`src/types`、`src/types/extensions`、`src/core/interfaces` 不再逐条画入边；
3. 边束：对同源/同目标分组的并行边做束合并（共享主干再分叉），虚线仅留给弱关系，边宽编码权重；ELK 路由对 hub 方向启用 `mergeEdges`/端口共享；
4. Layer 顺序按依赖拓扑（被依赖者在下：Tests/Examples 在 Src 之上，Templates 独立），不再按 puml 声明顺序；有环时回边标红并保持顺序稳定。

## AC

- [ ] `tests/grouping.test.ts`：合成路径形模型断言——`src/cli/a`、`src/cli/b`、`src/core/x` 按 depth=2 分成 `src/cli`、`src/core` 两组，组间聚合边 weight 等于原条数；非路径形名字不被分组；`npx vitest run` 通过
- [ ] `tests/hubs-default.test.ts`：对 `tests/fixtures/archguard-package.puml` 默认渲染，`src/types` 节点不再有逐条入边（入边被汇总为徽标，徽标计数等于原入度），而显式关闭汇总时仍逐条绘制
- [ ] `tests/layer-order.test.ts`：Tests Layer 与 Examples Layer 的 y 坐标小于 Src Layer（依赖者在上），Templates Layer 不夹在 Src 与 Tests 之间
- [ ] `node scripts/render-samples.mjs --views` 产出的 `package` 完整图：`edgeCrossings` ≤ 700（上一阶段 1446），`areaUtilization` ≥ 0.06（上一阶段 0.026）；`package-overview`（depth=2）节点数在 8–20 之间
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

用真实 archguard `package.puml` 渲染 depth=2 的 overview 与完整图，PNG 目视可读：overview 能看出 cli→analysis→core→types 的层次，`src/types` 不再是黑色箭头簇，Tests/Examples 在 Src 上方；度量数值达到 AC 阈值，并更新 `docs/layout-routing-eval.md` 记录对比。

## Touches

- tasks/gap-layout-module-grouping-hubs.md
- src/transform.ts
- src/layout/elk.ts
- src/render/svg.ts
- src/model.ts
- src/index.ts
- scripts/render-samples.mjs
- docs/layout-routing-eval.md
- tests/grouping.test.ts (new)
- tests/hubs-default.test.ts (new)
- tests/layer-order.test.ts (new)