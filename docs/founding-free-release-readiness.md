# FlowLedger Founding Free release readiness

Last updated: August 24, 2026

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

## Prepared database order

After a verified backup and on a temporary or preview Supabase branch first, apply these pending migrations in timestamp order:

1. `20260820113000_create_spending_bucket_and_reconcile.sql`
2. `20260820143000_route_spending_bucket_remainder.sql`
3. `20260820150000_harden_review_retries.sql`
4. `20260820173000_link_subscription_patterns_to_bills.sql`
5. `20260821123517_account_deletion_and_flo_rpc_hardening.sql`
6. `20260821222611_native_billing_plaid_push.sql`

Then compare migration history, run authenticated owner/manager/editor/viewer smoke checks, inspect security and performance advisors, deploy compatible API/Edge code, and verify Flo, account deletion, subscription links, notifications, and household isolation. Production is not an acceptable first execution target for untested SQL.

## Completed without a new EAS build

- Founding Free public gating and account-scoped admin Pro.
- Cache-first web/native resume contracts and duplicate foreground-request removal.
- Fictional Founding Free reviewer fixture and capture procedure.
- Store listing, privacy/data-safety worksheet, feature graphic, release script, and operational runbook.
- Static migration/security contracts, configuration assertions, automated tests, typechecks, dependency audit, Expo Doctor, and platform exports are part of the release gate.

## External evidence still required

- Apply and execute the migrations on a backed-up Supabase target; local PostgreSQL execution is unavailable on this workstation.
- Configure final EAS, Supabase, Flo, Firebase/APNs, store, redirect, and support values without recording secrets in Git.
- Produce one signed release candidate, then test clean install, twenty close/reopen cycles, layouts, Flo, notifications, offline/interrupted writes, account deletion, accessibility, and every core money flow on physical devices.
- Capture fictional signed-device screenshots, create the private reviewer credential, complete console declarations, and finish Google Play testing requirements.

No public release is approved until those external evidence items are recorded in `docs/native-release-runbook.md`.
