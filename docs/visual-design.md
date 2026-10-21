# Visual design system

All SVG styling comes from a `Theme` (`src/render/theme.ts`). `defaultTheme` is
used unless `createRenderer({ theme })` overrides tokens; overrides deep-merge
over the defaults, so a partial theme is always valid. `svg.ts` and `legend.ts`
contain no colour, size or dash literals.

## Tokens

| Group | Tokens |
| --- | --- |
| `font` | `family`, `size` ladder (title 13, member 12, package label 12, edge label 11, badge 11), `weight` |
| `color` | `canvas`, `stroke`, `strokeStub`, `nodeFill`, `stubFill`, `textTitle/Member/Package`, `edge`, `edgeWeak`, `warn`, `accent`, `accentText`, `packageFills[]`, `packageStroke`, `legendStroke` |
| `shape` | `nodeRadius` 6, `packageRadius` 8, `edgeCornerRadius` 6 |
| `stroke` | node/package/edge/arrow widths (1px), weight step and cap, weight opacity |
| `dash` | `weak` (dependency / implementation), `stub`, `feedback` (dash-dot) |
| `arrow` | triangle 12, chevron 10, diamond 14 |
| `grid` | 8 |

## Decisions

- **Hierarchy.** Slate outlines instead of black, 1px everywhere; the class
  name is bold 13px dark slate, members regular 12px mid slate. Packages carry
  a very low-saturation fill, cycled by layer index plus nesting depth, so
  nesting is visible without ink.
- **Edges.** Plain relations are solid 1px mid-grey; only weak relations
  (dependency, implementation) are dashed. Arrowheads for dependency /
  association are solid and larger. Orthogonal corners are rounded with
  quadratic curves (radius ≤ 6, clamped to half a segment) — vertices, i.e. the
  routing, are unchanged. Aggregated weight is a wider semi-transparent line.
- **Colour semantics.** Red-brown (`warn`) is used only for cycle feedback edges,
  which additionally use a dash-dot pattern, so they are recognisable without
  colour. The hub badge is neutral slate (`accent`).
- **Contrast** (checked in `tests/theme-contrast.test.ts`): text ≥ 4.5:1 on all
  fills; node outlines, edges and feedback edges ≥ 3:1 against the canvas, and
  feedback vs. plain edges ≥ 3:1 against each other; badge text ≥ 4.5:1.
- **Grid and alignment.** Entity box width/height snap up to a multiple of 8
  (`estimateEntitySize`). After layout, `alignRows` top-aligns nodes of the same
  row within a package; a move is refused when it would hit another node or a
  foreign edge, or turn an orthogonal edge diagonal, so some rows stay ragged
  (the test requires ≥ 80% of nodes in multi-node rows to sit on their row top).
  Because snapping costs the fixture a little area utilisation, the
  `layout-foundation` baseline test allows a 0.01 tolerance.
- **Detail.** `detail: 'full' | 'compact' | 'names'`. Default by entity count:
  ≤ 40 full, ≤ 150 compact (first 4 member rows plus `… +N more (M members)`),
  otherwise names only. Applied to the model before layout so boxes are sized
  for what is drawn.

## Font decision

Kept `monospace` for every text. The layout measures text in pure JS with a
fixed advance (`src/text-measure.ts`, 0.61em), which is only exact for a
monospace face. Hierarchy comes from weight (bold titles / package labels),
size (13 / 12 / 11) and colour instead. Members are drawn at 12px but still
measured at 13px, so each member line has ≈ 8% horizontal slack — this is the
overflow margin if the browser falls back to a wider monospace. A proportional
sans-serif title font would need its own width table and was not adopted.
