# Buckets and navigation review

Baseline: `69a00e1` on `dev`. The owner chose a Dashboard shortcut for bucket lists and requested a broader check of discoverability and navigation. These changes are verified on development; they have not been deployed.

## Changes

- Add a visible **Buckets** shortcut on phone and desktop Dashboards. The existing mobile Spending Buckets action uses the same destination.
- Open a dedicated **Buckets** list using the existing bucket manager and financial handlers. It shows open and closed buckets, archived history, and a clear empty state. It does not open the transaction review queue or trigger its bank refresh.
- Keep standalone bucket creation on the normal goal affordability path. Transaction-linked creation retains its existing separate behavior.
- Allow household viewers to read bucket balances while hiding creation, editing, closing and other mutation controls. Clear editing and remainder prompts when editing permission or household/budget identity changes; stale saves and delayed confirmations check current access.
- Return the goal editor’s scoped Close bucket request to the bucket list. Keep existing close/remainder confirmation, retry, and financial checks.
- Add **Tools & lists** in Settings for Buckets, Savings goals, Review Center, Reports and Subscriptions. Preserve the separate true-settings groups and existing bottom navigation. Reports already had a Dashboard link; this adds a consistent browse path independent of Dashboard widget preferences.
- Route bucket search results to Buckets and savings results to Savings goals. Give buckets their own search label/icon and include them in search prompts.
- Hide both Admin and Update Center from ordinary users’ search results. Their existing authorization checks remain unchanged.
- Count savings goals and non-archived open/closed buckets separately in their browse summaries.
- Give the new shortcut, bucket management actions, archived-list toggle and labeled goal-editor close button at least 44-pixel targets.

## Review scope

The bounded review covered phone ribbon/FAB navigation, desktop sidebar and search, Dashboard entry points, Settings browse/back paths, Accounts and income settings, Bills/Debt, Activity/Review, Forecast/Simulator, savings goals and buckets, Reports, Subscriptions, and Help/data export destinations. It is not a claim that every possible app interaction is bug-free or an accessibility certification.

## Required security maintenance

The final security gate encountered newly published advisories. The required fixes update root Zod to `4.6.6`, advance the existing body-parser override to `2.4.0`, and advance Undici 6/7 overrides to `6.29.1` / `7.30.1`. Only the database-schema and generated API-validation packages additionally pin Zod `4.6.6` directly; the global Zod 3 catalog remains unchanged. Database schema files already imported `zod/v4` through the old package’s bundled v4 implementation. The generated API-validation surface is the health-response object and was checked explicitly before accepting its package transition. No database table definitions or migrations changed.

Actual health-response validation and all ten real Drizzle insert schemas passed credential-free valid/invalid fixture checks, with schema engines reporting `4.6.6`. The Express-resolved JSON body parser passed plain JSON, gzip and parse-error forwarding checks. Both actual resolved Undici versions passed GET/POST checks against an ephemeral localhost server. API-server build, library/API typechecks and the final peer check passed; no database index, connection or financial write was used. The package-release-age rule and all existing advisory exceptions remain unchanged. The production high-threshold audit passes with three existing ignored high findings, two moderate and two low. The final full graph has zero critical, four high, five moderate and four low; one mobile-development Zod 3 high finding remains visible and unignored. See [SECURITY.md](../SECURITY.md) for the scoped assessment and follow-up.

## Verification

- Focused navigation, actual bucket-mode rendering, household/permission changes, search, existing bucket lifecycle and safety-stop regressions: **88 passed**, including the existing Dashboard regressions.
- Mobile TypeScript check and `git diff --check`: **passed**.
- Independent SENTINEL source review and its 60 relevant tests: **passed**, including stale confirmations and editor/viewer behavior.
- Parent browser checks: **15 cases passed** at 320, 390 and 1200 pixels. They covered direct Dashboard access, keyboard/back/repeat/refresh paths, empty and viewer lists, Tools/search destinations, ordinary Review Center collapse, actual standalone creation/edit/Close/keep-available flows, 44-pixel controls and dismissal copy. Fixtures stayed local and fictional; no page errors or non-local writes occurred.
- Broader suites: **1,873 tests passed** (215 API, 403 Edge, 37 release fixtures, 1,213 mobile and 5 performance), plus all workspace typechecks.
- Post-security-update root `pnpm run verify`: **passed**, including the 1,873 tests above, all workspace typechecks, normal web export, artifact checks and the production high-threshold audit gate.
- Final Android Hermes export and Expo Doctor **18/18 passed** after the security updates. A JavaScript/Hermes export is not a signed Android App Bundle, physical-device validation, native accessibility certification or store-submission proof.

No financial calculations, database schema, production records or launch entitlements were changed. The dependency updates above were required by the final security gate. Existing Play Store submission requirements remain separate.
