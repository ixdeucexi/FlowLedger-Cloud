# FlowLedger Founding Free release readiness

Last updated: August 25, 2026

## Locked version 1 scope

Public version 1 is **Founding Free**. It includes manual accounts and activity, Bills and Debt, Snowball planning, Forecast, Review Center, spending buckets, reports, Plan Simulator, household sharing, and Flo. It has no public purchase, trial, paywall, or new bank-link control.

Admin-granted Pro remains account-scoped for internal operation and the owner's existing Plaid household. It does not change the public plan or expose checkout. RevenueCat and native Plaid implementation stay dormant for a later reviewed paid release.

Native notifications remain a release-gated feature: they may be shown only in a candidate built with the canonical Firebase client configuration and after registration, persistence, delivery, receipt, and tap routing pass on a signed device. If that gate fails, hide the Settings entry before submission rather than shipping a broken control.

## Cached-data and resume policy

- Backgrounded native screens are hidden from the app switcher.
- A personal household's already-loaded plan is shown immediately when the same authenticated user returns; a stale refresh runs later without replacing it with a loading screen.
- A shared household may show its cache immediately only within five minutes of a successful household verification. A stale shared scope is verified before reveal.
- Shared access revocation clears scoped financial arrays and query caches before another household can be shown.
- Background financial refreshes never turn a previously interactive screen back into a blocking startup screen.
- Offline or unknown connectivity never starts a financial mutation. A failed write must remain visibly failed with a retry or recovery path.

## Production database state

Production already contained the bucket reconciliation, routed remainder, review retry, subscription-link, account-deletion, and native billing/Plaid/push migrations. On August 25, a read-only production preflight proved every pending Plaid row had one exact canonical household link and that policy tightening would remove no current member's legitimate access. The remaining additive migrations were then applied separately and postflighted in this order:

1. `20260825055609_measure_reconciled_flo_response_duration.sql`
2. `20260825055642_backfill_and_lock_plaid_households.sql`
3. `20260825055659_remove_creator_read_after_household_exit.sql`

Postflight found zero null Plaid scope links, all five required columns set `NOT NULL`, all three scope triggers active, all three Plaid reads member-only, all twelve core financial policies tightened, and no security/performance advisor warning or error. Local filenames now match the versions recorded in production so a future CLI migration run will not replay them.

## Completed without a new EAS build

- Founding Free public gating and account-scoped admin Pro.
- Cache-first web/native resume contracts and duplicate foreground-request removal.
- Fictional Founding Free reviewer fixture and capture procedure.
- Store listing, privacy/data-safety worksheet, feature graphic, release script, and operational runbook.
- Static migration/security contracts, configuration assertions, automated tests, typechecks, dependency audit, Expo Doctor, and platform exports are part of the release gate.
- Explicit Founding Free production EAS environment values, Android-only production configuration without a false Apple-provider requirement, and the EAS-preview Android App Links statement.
- Exact successful data-update timestamps across financial screens and Founding Free copy that does not send public users to unavailable purchase controls.

## External evidence still required

- Configure Apple, APNs, Google Play/FCM sender, final Auth redirect, and store-console values without recording secrets in Git. Add the Google Play App Signing certificate fingerprint to `assetlinks.json` after Play creates it.
- Produce one signed release candidate, then test clean install, twenty close/reopen cycles, layouts, Flo, notifications, offline/interrupted writes, account deletion, accessibility, and every core money flow on physical devices.
- Capture fictional signed-device screenshots, create the private reviewer credential, complete console declarations, and finish Google Play testing requirements.

No public release is approved until those external evidence items are recorded in `docs/native-release-runbook.md`.
