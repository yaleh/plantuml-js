---
id: gap-renderer-engine-interface
title: 把渲染维度对象化为 RenderEngine 接口 + SvgRenderer（对标 LayoutEngine 的多态对称）
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

布局维度和渲染维度不对称：

- **布局**：`LayoutEngine` 接口（`layout(model): Promise<LayoutResult>`）+ `ElkLayoutEngine` / `VizLayoutEngine` 两个实现 + `RendererOptions.layout` 注入自定义引擎——多态、可替换。
- **渲染**：只有自由函数 `renderSvg(model, layout, options)`，唯一调用点硬编码在 `core.ts:172`（`renderParsed` 里 `renderSvg(model, layout, { legend, theme, hiddenTransitive })`），`RendererOptions` 没有 `renderer` 注入字段。加一个渲染后端（如未来 Mermaid / HTML 输出）= 改 `renderParsed` 的 if/else，没有多态。

**方案**：把渲染维度对象化，对标 `LayoutEngine`：

1. 新增 `RenderEngine` 接口（对标 `LayoutEngine`）：`render(model: PlantUmlModel, layout: LayoutResult): string`（同步，对标 `renderSvg` 是同步拼字符串）。
2. 把 `renderSvg` 的实现封装成 `SvgRenderer` 类，`implements RenderEngine`。**静态配置作为构造属性**（`theme` overrides、`legend` 默认开关），**每帧动态值作为 `render` 参数**（`hiddenTransitive`，来自 `transformForRender`，每帧计算、不是 renderer 的静态状态）——这正是「属性 + 方法」封装时要分清的「构造时状态」与「调用时参数」边界。
3. `RendererOptions` 加 `renderer?: RenderEngine`（可选，默认 `new SvgRenderer(...)`），`renderParsed` 用注入的 renderer 而非硬编码 `renderSvg`。
4. 保留 `renderSvg` 作为向后兼容的便捷函数（`core.ts:447` 仍是 public export），内部委托 `new SvgRenderer(options).render(...)`——不破坏现有 `import { renderSvg }` 的消费者。

## AC

- [x] 改动前红：新增 `tests/render-engine.test.ts`，注入一个返回固定 SVG 字符串的合成 `RenderEngine` 并断言渲染结果来自它；改动前 `RendererOptions` 无 `renderer` 字段、测试红（无法注入），记录输出
- [x] `RenderEngine` 接口 + `SvgRenderer` 实现：`RenderEngine.render(model, layout)` 接口存在；`SvgRenderer implements RenderEngine`，静态配置（theme/legend）为构造属性、每帧动态值（hiddenTransitive）为 `render` 参数
- [x] 注入生效：`createRenderer({ renderer })` 用注入的 renderer 渲染，**不改 `src/core.ts` 的 renderParsed 调用结构之外的任何渲染分支**即生效；负对照：抛错的 renderer 不被静默忽略、错误可诊断地抛出
- [x] `renderSvg` 向后兼容：`renderSvg(model, layout, options)` 仍是 public export 且行为不变（内部委托 `SvgRenderer`），`grep -n "export .*renderSvg" src/core.ts` 仍命中
- [x] 无行为回归：两个 fixture 经 `createRenderer()` 渲染的 SVG 与改动前 sha256 逐一相等（含 `hiddenTransitive` 动态值传递正确）；`npm run typecheck` 与 `npx vitest run` 全绿，`tests/render.test.ts` 不改断言即通过
- [x] 对称性落地：`RendererOptions.layout`（注入 `LayoutEngine`）与 `RendererOptions.renderer`（注入 `RenderEngine`）两个注入点并存；`renderParsed` 不再硬编码 `renderSvg`（`grep -n "renderSvg" src/core.ts` 只剩 import/re-export 与便捷函数，不在 renderParsed 内直接调用）

## DoD

不是「把 renderSvg 包一层类」就完——而是渲染维度与布局维度对称：`RenderEngine` 接口 + `SvgRenderer` 实现 + `RendererOptions.renderer` 注入，加一个渲染后端 = 实现接口并注入，不是改 `renderParsed` 的 if/else。`renderSvg` 公共 API 保持向后兼容；渲染逐字节不变；注入用「合成 renderer 即生效 + 抛错不静默」的可证伪测试证明。

## Touches

- tasks/gap-renderer-engine-interface.md
- src/render/svg.ts
- src/core.ts
- tests/render-engine.test.ts (new)
- tests/render.test.ts