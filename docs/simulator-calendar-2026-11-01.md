# Simulator calendar

The owner requested a calendar inside the simulation section. Standing authorization covers publication after verification.

Release status: live and verified. Source, local browser, published runtime and HTTP postflight passed.

## Behavior

Calendar is a visible view in Plan Simulator. It shows the current working scenario by month, with projected balances and payment/event markers. Selecting a day opens its full amounts and compares the working scenario with the current plan. Month navigation stays within the working draft's forecast range.

The calendar uses the existing simulator results directly. It does not calculate a separate forecast or use the saved-comparison panel's separate horizon. Missing data and incomplete scenarios remain visible. Free access, saved-scenario permissions, existing themes, custom calendar colors and Privacy behavior are preserved.

Financial calculations, Forecast components, database schema, authentication and scenario persistence are unchanged. The in-app guide and exported PDF describe the new Calendar view.

## Verification and release

Approved source is `d6209eafda2c099b1adead5570eeed3efa647e38`. SENTINEL passed 94 focused checks and an independent real projection → simulator → calendar oracle across 15 variants, including partial months, year changes and leap February, in UTC, Los Angeles and Sydney. The oracle preserves 1,155 exact day pairs and 149 event rows. All 19 existing controller callbacks and ten finance/Forecast/persistence paths remain unchanged.

The full mobile suite passed 1,569 tests and five performance checks. Final mobile TypeScript, the 80-test focused set, configuration, guide freshness, clean release and artifact-copy guards passed. The final export is `entry-414105de47e0ef8974671d3683ce749e.js`, 5,151,002 bytes, SHA-256 `109d40ca184ec43033f444a45b3a8c6bbd6d4a13f5291f10c0411afd3acd7a61`. The clean release checkout has an identical 45-file exported artifact inventory.

The exact final bytes passed four primary browser contexts and 20 stages at 320, 390 and 1,200 pixels, using both themes. Checks include full day amounts/differences, debt edits and pauses, saved reload/switch, working versus saved-comparison horizons, bounded months, missing dates, incomplete warnings, Free access, saved transaction names, keyboard activation and actual Privacy hide/reveal behavior. A separate real-compositor check confirms tapping a date scrolls to and focuses the selected day heading. All financial snapshots remained unchanged, and no real financial/provider requests were made. All local runners closed.

Small-screen QA caught and fixed balance clipping. Selection now uses a decorative border without shrinking the content area, while narrow cells use compact labels and responsive type. Full amounts remain available in day details. A separate actual-font measurement supports 28 signed and rounding-boundary labels; this support measurement is distinct from the functional app journeys.

Browser fixtures use fictional intercepted APIs; archived proof contains no auth/session/header or raw storage values. Read-only hosting inspection confirmed the canonical project/team, Node 24 and 13 required Production-only environment names without inspecting secret values. MCP does not expose all project build settings, so the deployment explicitly supplies the repository's build/install/output/root contract.

Deployment `dpl_FC4PUn65fZzCRU9bv6vG1gVKceQj` is READY at `flow-ledger-cloud-palgwwn6f-flow-ledger-s-projects.vercel.app`, built from the exact approved source. All four production addresses resolve to it; the legacy team alias was aligned after readiness. HTTP postflight passed exact source/entry provenance, registered SPA routes, cache headers, health, missing-resource responses and worker/PDF parity. Authenticated MCP inspections replaced unavailable local CLI reads, while the repository's HTTP assertions remained intact.

Published runtime replay passed the same four contexts, 20 stages and five actual entry loads on the canonical origin. The supplementary focus/smooth-scroll check also passed. Financial snapshots remained unchanged, with no real financial/provider writes, unknown requests or unexpected app/console errors. Hosted pages logged CSP refusals for Cloudflare analytics in the main and supplementary runs; no outbound beacon request occurred. These classified hosting diagnostics are preserved rather than claimed as zero console entries. All runners closed. Sanitized proof and selected screenshots are archived under `docs/release-snapshots/simulator-calendar-20261101/`.

## Rollback

The remotely verified annotated tag `rollback/prod-before-simulator-calendar-20261101-2144` captures source `513a26071133a0379c213dd8809d13c1488d3254` and exact READY deployment `dpl_7sMtM5zxUFvf5HgZGubmb6JBYBxi`. Its tag object is `d46e1114dfa87c698732dcccf4ecd7acebd0c272`. It was created before production changed.
