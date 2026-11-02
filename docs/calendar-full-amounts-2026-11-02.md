# Full calendar amounts

The owner requested full amounts after seeing K abbreviations in the calendars. Standing authorization covers publication after verification.

Status: live and verified. Source, settled local runtime, published runtime and HTTP postflight passed.

Calendar cells again use the existing whole-dollar `formatCalendarBalance` display, without K/M/B suffixes. Full signed cents remain in existing day details and summaries. Desktop event chips and the tightest-day value use their existing full currency formatter. No financial calculation or global formatter behavior changes.

A shared presentation label retains readable caller fonts and centers ordinary values. Larger values scroll locally with a visible cue and touch/keyboard access, preserving the seven-day calendar. Labels do not use ellipsis, wrapping or forced shrinking. Privacy masks both text and outer accessibility labels; native scroll labels/hints are generic and the overflow cue is suppressed while amounts are hidden. Existing date and event actions are preserved.

Approved source is `cf23b38af66944668c5cd7017cd3838e472fad40`. The implementation's 80 focused tests, final mobile TypeScript and whitespace checks passed. Independent review passed 50 focused checks, six component-state cases, five-site data/AST parity and 11 formatter samples; 15 shared paths, the global formatter and date/navigation code are unchanged. The review's five source hashes match the exact committed files.

The final export is `entry-f617bbebdc9bb7ca03f64c478a90d09a.js`, 5,156,985 bytes, SHA-256 `084d7d63fd417be9162468d70c2e4e85a89ad695cf67781261c9d04c5c13b861`. A clean release checkout contains an identical 45-file export. Source/config/guide/artifact and rollback checks passed. The in-app guide and PDF now describe full dollar figures and exact cents in day details (authority hash `9675f8341dee`).

Final local browser checks passed four contexts, 25 stages and eight exact entry loads at 320, 390 and 1,200 pixels, including negative, billion, million, zero and large event amounts. All five money sites use unshortened labels. Actual keyboard and touch scrolling reaches the full value without opening its parent day; ordinary amount taps retain the original day action. Exact cents, real Privacy toggling, readable single-line text, day details and Flo clearance remain verified. Financial snapshots are unchanged and there were no actual financial/provider writes, unknown requests or app errors. Fixtures intercept fictional APIs; archived proof excludes auth/header/session/raw storage values.

Hosting metadata identifies the canonical project/team, Node 24 and 13 required Production-only environment names; no secret values were requested. Explicit deployment settings supply the repository build/install/output/root contract because MCP omits those project fields.

A supplementary probe initially sampled two Simulator labels before native overflow measurements settled. The prior artifact was temporarily restored on all four addresses while this was investigated. A direct probe was correct at 250ms, one second and 2.5 seconds; the bounded settled-layout rerun passed all four contexts without changing source. No persistent product or financial defect was confirmed. The same already-built and tested artifact was promoted after that clearance.

Deployment `dpl_He8SixsXGbDXrWNP6EGRVd1kvH4C` is READY at `flow-ledger-cloud-po4dzd7gs-flow-ledger-s-projects.vercel.app`, using the approved source. All four production addresses resolve to it. HTTP postflight passed exact source/entry provenance, registered routes, cache headers, health, missing resources and worker/PDF parity. Authenticated MCP inspections substituted for unavailable CLI reads; the repository's HTTP checks remained intact.

Published runtime repeated four contexts, 25 stages and eight actual deployed entry loads with the exact approved bytes. Full-value display, native touch/keyboard scrolling, ordinary day actions, Privacy, full-cents details and Flo clearance passed. The settled published probe confirmed no persistent overflow-affordance absence. Financial snapshots remained unchanged; no actual financial/provider writes, unknown requests or unexpected app/console errors occurred. Eight classified hosted Cloudflare analytics CSP refusals produced no outbound beacon and are preserved in the proof rather than claimed as zero console entries. All runners closed. Safe summaries, detailed proof, readiness diagnostics and selected actual screenshots are archived under `docs/release-snapshots/calendar-full-amounts-20261102/`.

Rollback: remotely verified annotated tag `rollback/prod-before-calendar-full-amounts-20261102-1204`, object `1f32eb53cd204ab768c9a2908729bbba5bb73436`, captures source `7239fda425c53a2837da80acb79ec3769e1245fd` and exact READY deployment `dpl_9S7CxBzinwPg986t4FGmAE4gtUWe`. It was created before production changed.
