---
id: gap-render-visual-design-system
title: 视觉设计系统：主题 token、排版层级、克制配色、边与箭头样式、节点对齐，附审美评审量表
status: ready
labels:
  - gap
  - layout
  - design
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layout-legibility-legend-metrics-fixes
---
## Proposal

对 `fixture.elk.png`（S）、`package-overview.elk.png`（M）、`Src_Mermaid_Layer` 视图做设计评审，结论是：几何上基本正确，但**风格像调试输出而不是设计过的图**。当前 `src/render/svg.ts` 的样式全是硬编码常量：所有元素都是 `#333333` 的 1.5px 黑描边、白底、`rx=2`（近乎直角）；所有文字同一个 13px monospace，标题仅靠居中与斜体区分；边全是黑色 1.2px，依赖/实现用虚线；包框无填充、锐角、18px 标签块；唯一的颜色是饱和红 `#c0392b`，既用于回边（警示）又用于 hub 徽标（仅信息），语义混用。具体问题：
1. **层级缺失**：包框、类框、边的墨量相同，眼睛没有落脚点；overview 里 4–6px 的黑色虚线粗边像"带刺铁丝"，压过节点。
2. **排版**：标题与成员同字号同色，成员行贴近右边框（如 `+kind: FunctionFingerprintKind`），标题区上下 padding 过紧；包标签 12px 与类名 13px 混用无章法。
3. **色彩**：纯黑描边过硬；红色同时表达"循环依赖"与"被依赖次数"；回边仅靠色相区分（对色觉障碍不友好）。
4. **边与箭头**：虚线泛滥使"弱关系"失去意义；`vee` 箭头在 13px 字体旁几乎看不见；正交折线 90° 尖角生硬；边与节点描边同色同粗，互相争抢。
5. **节奏与对齐**：同一层的节点顶/中线参差（fixture 的 Src Analysis Layer 各行），框宽没有对齐到网格，包内边距上下左右不一致，包嵌套深度不可辨。
6. **规模自适应**：XL 图仍逐个画全部成员行，细节淹没结构；小图与大图应有不同的详略（S 显示成员，L/XL 仅类名加成员计数）。

本任务：
- 新增 `src/render/theme.ts`：以 token 描述全部样式（字体栈与字号阶梯、描边/填充/文字/边/强调/警示的颜色、圆角、线宽阶梯、内边距、间距网格 8px），导出 `defaultTheme` 与 `RendererOptions.theme`；`svg.ts` 全部取 token，不再有散落字面量。
- 默认主题设计准则：描边用 slate 灰（非纯黑）、文字用深灰；类名加粗稍大，成员常规稍小且次级灰；包框使用极低饱和的分层着色填充（按 Layer 区分，圆角）；类框圆角 4–6、线宽 1；普通边中灰 1px 实线，弱关系（依赖）细虚线而非所有边虚线；箭头改实心/加大；正交折线拐角做圆角（半径 ≤6，不改变路由）；权重粗边用半透明实线；hub 徽标改中性色（蓝灰），红色只留给回边，且回边同时加非色彩线索（更长的点划线或标记）。
- 节点尺寸吸附到 8px 网格，同层节点顶对齐或统一居中；包内边距统一。
- 规模自适应详略：`detail: 'full' | 'compact' | 'names'`，默认按实体数自动（≤40 full，≤150 compact 仅成员计数与前 N 行，其余 names）。
- 字体决策：优先保持 monospace 以保证纯 JS 度量可靠，用字重/字号/颜色建立层级；如改用无衬线标题字体，必须附带该字体的字宽表并在 `docs/visual-design.md` 记录取舍与回落字体下的溢出余量。
- 新增 `docs/visual-review-rubric.md`：审美评审量表，10 项各 1–5 分——层级、排版、配色与语义、线条与箭头、间距节奏与对齐、留白与密度、规模适配、一致性、可访问性（对比度/非色彩线索）、整体气质；并新增 `docs/visual-review-log.md`（含表头与条目模板，评分条目由外部评审在本任务落地后追加）。

## AC

- [ ] `src/render/theme.ts` 导出 `Theme` 类型与 `defaultTheme`；`tests/theme.test.ts` 断言：`svg.ts` 输出的 SVG 中不含 `#000000`、`#333333` 作为描边（仅文字允许深灰 token），所有颜色值都来自 theme token（遍历 SVG 的 fill/stroke 属性取集合 ⊆ token 值集合）
- [ ] 可访问性断言（`tests/theme-contrast.test.ts`）：正文文字与其背景对比度 ≥ 4.5:1，节点描边与画布背景 ≥ 3:1，回边与普通边对比度 ≥ 3:1，且回边含非色彩线索（线型或标记），徽标文字对比度 ≥ 4.5:1
- [ ] `tests/theme-tokens.test.ts`：自定义 `theme: { ... }` 覆盖部分 token 后渲染成功，未覆盖的 token 回落默认值；同一输入同一主题两次渲染字节一致
- [ ] 节点宽高均为 8 的倍数；同一 ELK 层内的节点顶边对齐（`tests/grid-alignment.test.ts` 对 fixture 断言同层节点 y 相同或中线相同）
- [ ] `detail` 选项：`names` 模式不输出成员行，`compact` 模式限制成员行数并显示计数；默认对 660 实体的 `all-classes` 自动选 `names`，对 22 实体 fixture 选 `full`（`tests/detail.test.ts`）
- [ ] `docs/visual-review-rubric.md` 存在且含 10 个评分项（`grep -c '^| *[0-9]' docs/visual-review-rubric.md` ≥ 10 或等价的结构化断言）；`docs/visual-review-log.md` 存在并含表头与条目模板
- [ ] `docs/visual-review-log.md` 含本任务落地后对 S/M/L/XL 各一个样例的评分与理由，该行只能由人或外部评审在落地后目视评分并写入，执行者不得代写（待外部）
- [ ] `npm run typecheck` 与 `npx vitest run` 全部通过，渲染确定性

## DoD

用 archguard 真实样例（S：`archguard-class.puml`；M：`package-overview`；L/XL：`all-classes` 包视图与完整图）以默认主题渲染：没有纯黑硬描边、弱关系与强关系视觉可分、回边不依赖红色也可辨认、同层节点对齐整齐，且主题 token、对比度、网格对齐、`detail` 各条机械断言全部通过。目视评分与"仍不满意的项"由外部评审在落地后写入 `docs/visual-review-log.md`，作为下一轮任务输入。

## Touches

- tasks/gap-render-visual-design-system.md
- src/render/theme.ts (new)
- src/render/svg.ts
- src/layout.ts
- src/layout/elk.ts
- src/index.ts
- docs/visual-review-rubric.md (new)
- docs/visual-review-log.md (new)
- docs/visual-design.md (new)
- tests/theme.test.ts (new)
- tests/theme-contrast.test.ts (new)
- tests/theme-tokens.test.ts (new)
- tests/grid-alignment.test.ts (new)
- tests/detail.test.ts (new)
