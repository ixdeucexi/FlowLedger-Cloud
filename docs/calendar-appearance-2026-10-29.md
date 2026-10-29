# Independent Forecast calendar colors

Status: verified candidate; production release pending.

Settings > Appearance & feedback now includes Forecast calendar colors. Income, Bills, Debt, Plan, Spending and Risk each have eight curated color choices plus Follow theme. Custom choices remain independent when changing app presets or Light/Dark/System mode. Follow theme reconnects one category; Reset calendar colors clears only calendar overrides. Reset appearance explicitly restores both app and calendar defaults. Preferences save on the current device.

The preview, phone calendar chips, desktop calendar chips, selected-day category dots and calendar legend share one rendering palette. Colors adapt to light/dark surfaces with readable text. App accent colors now also reach calendar Add/Today/selected-day controls, the active phone navigation item and the center Add button border and glow. The Original + Light desktop calendar scopes its accent variables to the actual current primary color. Category labels, risk rules, event classification, dates, amounts and financial data are unchanged.

Optional bounded calendar overrides extend the existing version-1 local preference JSON without changing legacy default keys. Functional preference updates read the latest state; queued persistence copies nested overrides so rapid edits cannot overwrite another category or mutate a queued snapshot. No backend, schema, authentication, dependency or environment changes are included. Marketing files remain outside this release.

Verification: 61 focused appearance tests and an independent 1,152-case color/contrast/immutability matrix passed. Full repository verification passed 217 API, 563 Edge, 37 release-fixture, 1,393 mobile and five performance checks, workspace types, web export, guide/artifact checks and the existing audit policy. Expo Doctor passed 18/18. The audit baseline remains one low, one moderate and three previously ignored high advisories; no exceptions were added. A final cosmetic correction moved each complete Add-button shadow tuple alongside its dynamic color; subsequent mobile typecheck, export and browser checks cover that correction.

Browser verification uses fictional authentication and financial records with application requests intercepted, and checks both 390- and 1,200-pixel layouts. It exercises all six independent controls, actual preview/chip/legend colors, unchanged date and financial labels, reload, mode/preset persistence, per-category Follow theme, calendar/global reset independence, read-only day selection and Original + Light control colors. Native hardware testing is not claimed.

Rollback: `rollback/prod-before-calendar-appearance-20261029-2151`, remotely verified annotated tag at source `f624ed3de446fd769d2882d4f33f9b870bfabada`, exact prior READY deployment `dpl_GjLc7fLqCcUVSYdzCGV3qxA6dUdx`. The tag records the immutable prior deployment. Canonical project/team and Production-only environment metadata were checked without retrieving secret values.

Evidence: `release-snapshots/calendar-appearance-20261029/`.

Final candidate: `entry-3f0da92b21050e4f9e9c43ffa8470b0a.js`, SHA-256 `6ceba59b2e2332d754d7e7b314ca75cca261f818c2c9194bf958da2219b3eab2`. All 42 browser checks passed (22 phone, 20 desktop) with no application/console errors, unknown requests or financial writes. Final browser evidence asserts both Add-button shadow color and original nonzero geometry. Independent whole-candidate review passed.
