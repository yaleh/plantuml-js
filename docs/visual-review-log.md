# Visual review log

Entries are appended by a human or external reviewer after viewing the rendered
samples (see `visual-review-rubric.md`). The implementer does not write scores.

| Date | Reviewer | Sample | 1 Hier. | 2 Typo. | 3 Colour | 4 Lines | 5 Align | 6 Space | 7 Scale | 8 Consist. | 9 A11y | 10 Overall | Total | Reasons / remaining issues |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Entry template

```
| YYYY-MM-DD | <name> | S / M / L / XL (<file or view>) | _ | _ | _ | _ | _ | _ | _ | _ | _ | _ | _/50 | <why; what is still unsatisfying> |
```

## Entries

| 2026-10-22 | Claude (external reviewer, round 5, develop 4f1aca4) | S (`s-class`, `archguard-class.puml`) | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 3 | 4 | 38/50 | Calm slate palette, bold class names, member rows clear of the border, diamonds/triangles readable. Top-right of the first frame is a large empty block; contrast of the lighter edges on the shaded package fill is unverified. |
| 2026-10-22 | Claude (external reviewer, round 5, develop 4f1aca4) | S (`s-architecture-manual`) | 4 | 4 | 4 | 3 | 3 | 3 | 4 | 3 | 3 | 4 | 35/50 | Package-alias edges now land on the frames and CJK tabs fit. Edge labels (`uses`, `validates`) have no halo, so the connector line strikes through the text; frame left edges and gaps between frames are uneven. |
| 2026-10-22 | Claude (external reviewer, round 5, develop 4f1aca4) | M (`m-architecture`) | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 4 | 3 | 4 | 37/50 | External types sit in their own muted group with badges; layer frames read well. The corridor between Parser Layer and Types/External is crowded with dozens of overlapping `uses`/`returns` labels. |
| 2026-10-22 | Claude (external reviewer, round 5, develop 4f1aca4) | M (`m-package`) | 3 | 4 | 3 | 2 | 3 | 3 | 3 | 3 | 2 | 3 | 29/50 | Much more compact (1644×1276, utilisation 0.23) and the hub rail with badges works. Inside Src Layer every edge is a pale dotted line (overlappingEdgeLength 24936), three line families (grey dotted, blue dotted, dark-red dash-dot) with no visible key, and the dependency flow (cli above types) is lost in the wrapped grid. |
| 2026-10-22 | Claude (external reviewer, round 5, develop 4f1aca4) | XL (`xl-all-classes`, rendered by the harness at full member detail) | 3 | 4 | 3 | 3 | 3 | 2 | 2 | 3 | 3 | 3 | 29/50 | 1:1 tile is crisp and edges keep clear of boxes, but the thumbnail is washed out, the right and bottom-right edge is a ragged empty staircase, and the harness bypasses the public pipeline so the 660-entity graph is drawn with every member row instead of the `names` default. |
