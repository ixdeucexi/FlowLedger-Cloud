# Posted matching suggestions

Status: live at https://flowledger-algo.com on October 29, 2026. Production postflight passed.

The posted Review Center hid Flo's recommendation until a match type was selected because it derived the recommendation from the filtered list. Posted Activity matching also lacked a recommendation outside its filters. Both now show one qualified Suggested card above the type filters, using the existing eligible ranked targets. Filters continue to control the full lists; changing a filter does not replace the global suggestion or save a match.

Review Center retains its score threshold of 78, and Activity retains its existing suggestion threshold of 48. Using the card invokes the existing bill/debt, manual transaction or bucket handler. Reconciliation, variance handling, matched/undo behavior, scoped selections, ranking, backend functions and database schemas are unchanged.

Verification passed:

- Independent SENTINEL source and focused-test review; 87 focused matching/review/pending checks.
- Full verification: 217 API, 563 Edge, 37 release-fixture, 1,378 mobile functional and five performance checks; workspace types, production web export, guide/artifact checks and 18/18 Expo Doctor checks.
- Dependency audit passed the repository policy; existing audit findings remain one low, one moderate and three previously ignored high advisories. No dependencies changed.
- Seven browser flows: Review Center and Activity at 390/1,200 pixels, plus manual/bucket/debt Review Center suggestions. All four filter changes preserve the card. Each explicit Use invokes exactly one expected canonical reconciliation RPC with the correct target/date/amount/settlement; opening and filtering invoke none. All 260 external application requests were intercepted with fictional authentication and records. No live financial test writes, browser errors, warnings, unknown routes or horizontal overflow. Settled phone and desktop visuals were inspected.

Candidate bundle: `entry-8808afb3c3b33e4c37cd65611e20c635.js`, SHA-256 `45ff71321a0bab9c2716c9b749534d06626d33ebffd31332959222bf64e7e337`.

Rollback: `rollback/prod-before-posted-match-suggestions-20261029-1103`, remotely verified annotated tag at source `799b6cf4b4d4b60c899674f095faa13220f65eda`, exact prior READY production deployment `dpl_4R6mfzrqCFckoV3gvD3tzN9YoV8b`. Production-only environment metadata and canonical project identity were checked through the connected Vercel tools. The Git deployment explicitly used the repository's production export command/output directory. No credentials were retrieved or changed.

Browser evidence is archived in `release-snapshots/posted-match-suggestions-20261029/`.

## Production release

- Clean reviewed source: `637e840ed028fc72568ba10368506a1f98995787`, committed and pushed to `dev`; source guard passed in a clean isolated release checkout. Untracked marketing files were preserved outside the release checkout and Git deployment.
- READY production deployment: `dpl_7cuYo4XL73dGtrhgNxdcdSQPa1Sv`, immutable https://flow-ledger-cloud-bld78cjzi-flow-ledger-s-projects.vercel.app. All four app aliases were freshly inspected and aligned; the legacy project alias required reassignment. Only the duplicate non-production build of this exact commit was canceled.
- Live entry bundle and SHA-256 exactly match the candidate tested above. The complete repository HTTP postflight passed: deployed source identities, registered routes, fresh startup HTML, immutable executable JavaScript, health response, missing-resource behavior, service-worker parity and guide parity. Fresh connected-tool observations supplied the CLI inspection data; the observed GitHub commit field was normalized to the equivalent CLI field and retained in the archive.
- All seven matching browser flows also passed using the actual published static assets, with fictional authentication/records and every financial request intercepted. Explicit target/date/amount/settlement and zero automatic reconciliation were rechecked. No application errors, unknown requests or horizontal overflow. The existing injected Cloudflare Insights beacon CSP block was classified separately; no unexpected console events occurred. Native-device keyboard behavior is outside this viewport test.
- No backend deployment, migration, environment change or customer financial test write occurred. Both local and published-asset browser servers/contexts were closed. Rollback remains the exact annotated tag and prior READY deployment recorded above.
