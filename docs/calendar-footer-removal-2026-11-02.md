# Calendar footer removal

The owner requested removal of the closing-balance strip below the Forecast calendar. Standing authorization covers publication after verification.

Status: live and verified. Source, local checks, published runtime and HTTP postflight passed.

Source `f032f4a82c739205e3103ef6f77f9ce84b18a09b` changes only `CalendarView.tsx`: the strip and its fallback hint are removed, along with unused summary-only data, imports, hook and styles. Grid amounts, legend, selected/today outlines and date-tap details remain intact. Financial calculations, persistence, desktop and Simulator are unchanged.

FAST PATH verification passed 40 freshly compiled display/Privacy checks, TSX syntax validation, whitespace and source/config/guide/artifact checks. The final entry is `entry-2609c22cc8f582157317846defa56899.js`, 5,154,598 bytes, SHA-256 `4891e87994541e6d9d4191b63f81e7b679792989f1ee0c7aed71cebc616a8f13`. The clean release checkout has an identical 45-file export.

Local browser checks passed two contexts and eight stages: dark 390px and light 320px Forecast. The row and hint are absent in current/future months; all six legend colors, full-dollar grid values and today styling remain. Tapping a date still opens its exact-cent details, and closing them returns to the calendar. Fictional API interception prevents real financial/provider writes; snapshots are unchanged and runners closed.

Deployment `dpl_7kFY5y5KP2urC5AqkrcfQoEaaZmr` is READY at `flow-ledger-cloud-gjxp027x1-flow-ledger-s-projects.vercel.app`, built from the exact reviewed source. All four production addresses resolve to it; the legacy team alias was aligned after readiness. HTTP postflight passed source/entry provenance, registered routes, cache headers, health, missing-resource behavior and worker/PDF parity. Authenticated MCP inspections substituted for unavailable CLI reads while the repository's HTTP checks remained intact.

Published runtime repeated the two contexts, eight stages and two exact entry loads. Removal, preserved legend/grid/today state, day opening, exact cents and close/return behavior passed. No real financial/provider writes, unknown requests or app errors occurred; snapshots are unchanged and all runners closed. Two classified hosted Cloudflare analytics CSP refusals produced no outbound beacon; these remain in the proof instead of a claim of zero console entries. Safe evidence and selected screenshots are archived under `docs/release-snapshots/calendar-footer-removal-20261102/`.

Rollback tag `rollback/prod-before-calendar-footer-removal-20261102-1241`, object `f5f187f23a5c902a58459aef3acb76a8c6f397e7`, was remotely verified before deployment. It captures source `cf23b38af66944668c5cd7017cd3838e472fad40` and exact READY deployment `dpl_He8SixsXGbDXrWNP6EGRVd1kvH4C`.
