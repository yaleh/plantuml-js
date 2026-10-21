---
id: gap-layout-abstraction-views
title: 多级抽象：包级聚合边、枢纽节点汇总、环标注、单包视图（存根节点）
status: done
labels:
  - gap
  - layout
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-foundation
---
## Proposal

660 个类 / 950 条边 / 56 个包放进一张画布，任何布局引擎都不可读。新增布局前的模型变换层 `src/transform.ts`（纯函数，PlantUmlModel → PlantUmlModel），并通过 `createRenderer` 选项暴露：
- 聚合：重复边合并为单条并携带 `weight`（原始边数），渲染时线宽/标签编码权重；
- 传递约简：包级依赖图去掉可由传递推出的边（可开关）；
- 枢纽汇总：入度超阈值的节点（如 `src/types`、`src/core/interfaces`）的入边不逐条绘制，改为节点上"被 N 个包使用"的徽标，阈值可配；
- 环检测：回边（feedback arcs）标记并以不同颜色/样式渲染；
- 视图：`view: { kind: 'overview' }`（包折叠为节点）、`{ kind: 'package', id }`（只展开一个包，外部相关包以存根节点出现，边聚合到存根）、`{ kind: 'neighborhood', entity, hops }`。
边的虚线仅用于弱关系。

## AC

- [x] `tests/transform.test.ts`：合成模型断言——重复边合并后 weight 等于原条数；传递约简删除冗余边且保留必要边；超阈值枢纽的入边被汇总、徽标计数正确；环被检出且回边标记正确；`npx vitest run` 通过
- [x] `createRenderer({ view: { kind: 'package', id } })` 对 `tests/fixtures/archguard-package.puml` 渲染：存根节点存在、其它包的节点不出现、输出 SVG 解析合法
- [x] `node scripts/render-samples.mjs --views` 生成 overview 与至少两个单包视图的 SVG/PNG；overview 的 `edgeCrossings` 与 `totalEdgeLength` 相对 `rendered/metrics.baseline.json` 下降
- [x] 对外部 archguard 的 `all-classes.puml`（660 实体）以 `view: package` 渲染每个包均成功，且 `textOverflowCount === 0`
- [x] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

真实 archguard `package.puml` 的 overview 与 `all-classes.puml` 的若干单包视图渲染为 PNG 后，目视可读：不再出现枢纽节点处的黑色箭头簇，环依赖可识别，单包视图不再需要缩放才能阅读；度量对比基线有可量化下降。

## Touches

- tasks/gap-layout-abstraction-views.md
- src/transform.ts (new)
- src/index.ts
- src/model.ts
- src/layout/elk.ts
- src/render/svg.ts
- scripts/render-samples.mjs
- tests/transform.test.ts (new)
- tests/views.test.ts (new)