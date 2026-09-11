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

Candidate browser results and production receipt are recorded after the release gate. No physical Android/iOS device testing is claimed.
