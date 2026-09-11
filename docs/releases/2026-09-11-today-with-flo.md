# Today with Flo — September 11, 2026

## Scope

Optional, device-local daily overlay with a separate Settings switch. Uses the already-prepared Dashboard snapshot, without fetching data, calling Flo, or building another forecast. Presents only after authenticated, same-household/budget/day data is ready. Daily claims are household-scoped across budget switches. Recent ordinary topics rotate; unresolved actionable items may recur. X, Got it, back/Escape and the relevant action dismiss it.

Authored topics cover review items, upcoming/pending bills, payday, category spending, cushion settings, goal funding/progress and debt planning. The reserved forecast-risk template is not currently reachable because Dashboard filters its source decision; it is not counted as a live capability. No tip declares scheduled income or goal earmarks to be spendable money.

## Verification before candidate

- Full verify passed: API/Edge/release fixture/mobile suites, typechecks, web export and artifact/guide checks. Mobile suite: 977 tests plus 5 isolated performance tests before the final persistence repair.
- Final repair: 28 targeted tests including 15 Today with Flo cases passed; mobile typecheck passed. Independent Sentinel repeated all 15 daily-tip tests and approved the static changes.
- Expo Doctor: 18/18 passed.
- Guarded stale-read/write races, corrupt preferences, cross-tab locks, scope/logout changes, native touch and web interaction cancellation, modal/editing checks and bounded presentation window.
- Guide page 8 regenerated and visually checked. Guide consistency hash: 8aa0bc89387a.
- Dependency audit gate passes with existing policy exclusions; summary reports one moderate and two ignored high advisories. No dependency changes in this release. Node module-type/color diagnostics are existing tooling warnings, not failed tests.
- Local configuration-free export rendered navigation and suppressed tips while details were unavailable. Local authenticated verification is unavailable because sensitive production variables are redacted when pulled. Authenticated interaction testing must use the staged production-environment candidate before promotion.

## Release guard

Rollback tag: `rollback/prod-before-today-with-flo-20260911-1216` (pushed and verified).
Previous frontend: `8ccc754582c51b6e888e82900e0c49784ad159fa`.
Previous deployment: `dpl_A47YjxTFxh1eqTd4vZm5WFTH54sR`.
Recovery: `vercel rollback dpl_A47YjxTFxh1eqTd4vZm5WFTH54sR --yes`.
Flo Edge function remains version 36; no schema, financial records or backend deployment changes.

## Deploy Result

- URL: https://flowledger-algo.com
- Candidate: https://flow-ledger-cloud-grafsp3w0-flow-ledger-s-projects.vercel.app
- Deployment: `dpl_4q6yRD2UxYsuQbLdM1EA2q14caa1`
- Target: production
- Status: READY; tested artifact promoted without rebuilding
- Commit: `326073110617898c44898908b3ae11a5bcfc8624`
- Framework: Expo Router web export (Vercel custom/static configuration)
- Build duration: 143 seconds from buildingAt to ready
- Entrypoint: `entry-ad8018ca92a6a7337549d4e6b1cbbf5d.js`

## Final verification and release gate

- Final full preflight at `90aa839`: 980 mobile tests and 5 isolated performance checks, all API/Edge/release-fixture suites, all typechecks, web export, guide/artifact scans, audit policy and Expo Doctor 18/18 passed.
- One subsequent style-only correction (`flexGrow: 0`) keeps the scrollable card content-sized. Mobile typecheck and independent review passed for exact deployed commit `3260731`.
- Authenticated synthetic QA account only; no customer account or financial-record writes. Existing Vercel automation access used for protected candidates; deployment protection was not disabled.
- Exact final candidate: live-data scheduled-rent tip, compact card at 390x844 and 320x568, desktop card geometry at 1440x1000, Got it and reload suppression, independent desktop Settings OFF persistence with Flo shortcut still ON, then ON restored. Completed desktop Settings navigation verified separately from the responsive-transition screenshot.
- Same functional source on first candidate: X, Escape, Back (stayed on Dashboard), action opened Bills, phone Settings OFF/reload/ON, and zero Flo-chat resource requests. Final artifact retains this behavior; only one layout style differed.
- SENTINEL final release PASS before promotion. Rollback guard rechecked unchanged old production immediately before promotion.
- Production postflight passed across all four production aliases at the exact clean deployed commit. Startup shell, executable assets, PWA/release contracts and guide passed.
- Live canonical-origin QA: correct compact tip appeared after Dashboard readiness; Got it dismissed; reload did not repeat; new entrypoint confirmed and no Flo-chat request triggered.

## Post-Deploy Observability

- Error scan: no error logs returned for this deployment, last hour, before and after promotion. Browser error list empty.
- Drains: not inspected; no monitoring configuration changed.
- Monitoring: bounded deployment and browser checks completed; no ongoing monitoring created.
- Limitations: no physical Android/iOS device test or multi-device preference sync is claimed. Preferences are per device and household. User interaction or unavailable data suppresses the optional overlay for that opening instead of interrupting late.

The Supabase/account-isolation, React/browser verification, deployment/environment and PDF workflows informed the scoped preferences, independent quality gate, protected-candidate testing and rendered guide verification.
