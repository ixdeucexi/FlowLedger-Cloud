# FlowLedger Native Release Runbook

Use this record for every preview, TestFlight, Play internal, and production release. Never release from an uncommitted worktree.

## Release record

- Release owner:
- Approval date and time:
- Git commit:
- App version / iOS build / Android version code:
- EAS profile and environment:
- Supabase project and latest migration:
- Flo Edge Function version:
- Web deployment URL:
- Reviewer account confirmed:
- Apple/Google submission IDs:

## Required preflight

- Run native commands from `artifacts/mobile`; its `app.config.js` and `eas.json` are the only Expo/EAS configuration sources. Run `pnpm run check:mobile-config` from the repository root before Expo Doctor or EAS.
- Run `powershell -ExecutionPolicy Bypass -File scripts/test-native-release.ps1` from the repository root. It runs the config contract, API/Edge/mobile tests, typecheck, Expo Doctor, production dependency audit, diff check, and iOS/Android/web export unless `-SkipBundles` is explicitly used.
- Confirm the repository and live Supabase migration histories match exactly.
- Run the full unit suite, workspace typecheck, Expo Doctor, production web/native bundle, dependency audit, and `git diff --check` against the release commit.
- Confirm production EAS variables, public API origin, Supabase public key, OAuth providers, callback allowlist, and Flo secrets without copying their values into this record.
- Smoke login, setup, Dashboard, Bills/Debt, Activity/Review, Forecast, Simulator, Flo, Settings, support/legal pages, export, household switching, and sign-out with fictional data.
- Record physical iOS and Android results, including cold/warm deep links, background privacy, biometric unlock, offline recovery, and software keyboard layouts.
- Confirm privacy, billing, Data Safety, App Privacy, Financial Features, and reviewer notes describe the shipped behavior.

## Provider and build configuration

- Founding Free v1 Android EAS public variables: `EXPO_PUBLIC_LAUNCH_MODE=free`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_ORIGIN=https://flowledger-algo.com`, and `EXPO_PUBLIC_APP_ENVIRONMENT=production`. RevenueCat public keys and production billing mode are not required until the later paid release. Add the Firebase client `google-services.json` as an EAS secret file and expose its build-time path as `GOOGLE_SERVICES_JSON`; never use the FCM service-account JSON here.
- iOS additionally requires the Apple provider and capability to be configured and `EXPO_PUBLIC_APPLE_AUTH_ENABLED=true`. Android production builds must not claim or require that iOS-only provider before it is actually configured.
- RevenueCat: create Apple `flowledger_pro_monthly` / `flowledger_pro_annual` and Google `flowledger_pro:monthly-autorenewing` / `flowledger_pro:annual-autorenewing`, attach all to entitlement `pro`, configure Apple/Google server credentials, set restore behavior to **Keep with original App User ID**, and configure webhook Authorization/HMAC. Set Sandbox Testing Access to **Allowed App User IDs only** and add only the separate store-reviewer UUID.
- Supabase Edge/server secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REVENUECAT_WEBHOOK_AUTHORIZATION`, `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `REVENUECAT_ENVIRONMENT=production`, `REVENUECAT_SECRET_API_KEY`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY`, and a separate 32-byte `APPLE_TOKEN_ENCRYPTION_KEY`. Deploy `billing-dispatcher` only after migration `20260822224633_native_billing_plaid_push.sql` is applied and validated.
- Store the same `CRON_SECRET` used by Vercel in Supabase Vault as `flowledger_cron_secret`; verify the ten-minute `flowledger-native-push-receipts` job and its `net` responses.
- Plaid: register exact Android package `com.flowledger.app`, iOS bundle `com.flowledger.app`, and `https://flowledger-algo.com/plaid/oauth` in each release environment. Confirm existing `PLAID_CLIENT_ID`, environment secret, redirect, webhook, and encryption-key configuration without recording values here.
- Native push: configure APNs and the separate FCM v1 service-account sender credential for the same bundle/package in EAS. Confirm project ID `80ec219d-8a12-43f9-b7cf-0dd6541e60f1`, verify `GOOGLE_SERVICES_JSON` resolves to the Firebase client config during the Android build, and record a signed-device registration/delivery/receipt test. Do not put the service-account credential in Expo public variables or the repository.
- Server push environment: set `PUSH_APP_ENVIRONMENT=production` on the production API (preview/development on those deployments). Registration, status, and delivery reject cross-environment native tokens.

## Verified Founding Free evidence — August 25, 2026

- EAS account `johncollinsii` owns project `80ec219d-8a12-43f9-b7cf-0dd6541e60f1`; CLI authentication was verified without recording credentials.
- The EAS production environment contains the Supabase URL/public key, `EXPO_PUBLIC_API_ORIGIN=https://flowledger-algo.com`, `EXPO_PUBLIC_LAUNCH_MODE=free`, `EXPO_PUBLIC_APP_ENVIRONMENT=production`, and the Firebase client file secret. RevenueCat public keys remain intentionally absent for Founding Free.
- Signed Android preview APK build `5fc02587-b936-4a3a-b423-80a249756bfc` completed successfully. It is an internal preview of commit `e50b4739bc5f67a82270de700b79fd22fbb53b0e`, not the current release candidate.
- The preview signing certificate SHA-256 is published in `/.well-known/assetlinks.json`. Add the separate Google Play App Signing certificate fingerprint before production-track promotion; the upload/preview fingerprint is not a substitute for Play signing.
- Production Supabase migration history includes `measure_reconciled_flo_response_duration`, `backfill_and_lock_plaid_households`, and `remove_creator_read_after_household_exit`. Postflight checks found zero null Plaid household links, all five scope columns locked, all three enforcement triggers present, and all fifteen affected read policies household-member scoped.
- Supabase security and performance advisors contain informational notices only after the migrations; no warning/error blocks this release candidate.
- The deployed Flo function accepts the production origin and rejects an unapproved origin. Production telemetry contains recent completed Flo requests, confirming the configured OpenAI path without exposing secret values.
- Public marketing, Support, Terms, Privacy, and account-deletion routes all return HTTP 200 on `https://flowledger-algo.com`.

## Fictional reviewer fixture

1. Create one fresh Founding Free Auth user through an authorized private channel with `app_metadata.flowledger_reviewer_fixture=true`. Never place its password in the repository, logs, issue tracker, or this runbook.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FLOWLEDGER_REVIEWER_USER_ID`, and `FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM=FICTIONAL_ONLY` only in the operator shell or secret runner, then run `node scripts/seed-reviewer-fixture.mjs`.
3. The seeder fails closed if the account already has elevated access, keeps the household on the public Founding Free plan, completes onboarding, and creates no Plaid Item or token.
4. Use that account in the exact releasable production binary and enter its credentials only in App Store Connect/Play Console reviewer fields. A separate `flowledger_store_reviewer` account is needed only when the later paid release is submitted.

## Deployment order

1. Back up or snapshot the current production database and record the prior function/deployment versions.
2. Apply additive database migrations; run preflight/postflight integrity queries and Supabase security/performance advisors.
3. Deploy compatible APIs and Edge Functions; smoke them before the client references new contracts.
4. Deploy the PWA and verify the canonical domain, public support/legal URLs, console, and authenticated critical path.
5. Build preview binaries from the exact commit and complete internal device testing.
6. Build production binaries, submit to TestFlight and Play internal testing, and promote only after recorded approval.

## Staged release

- Web/Edge: deploy to preview first, smoke authenticated flows, then promote to production.
- iOS: TestFlight internal → optional external group → phased App Store release.
- Android: internal track → closed/open test as required → staged production percentage.
- Monitor authentication, sync, Forecast discrepancies, Flo terminal failures, financial writes, and support requests after each stage before expanding.

## Rollback

- Retain the prior production web deployment, Edge Function source/version, and native store build until the new release is stable.
- Web: immediately promote the last known-good deployment.
- Edge/API: redeploy the recorded compatible prior version. Never roll back code across an incompatible schema.
- Database: prefer forward corrective migrations. Do not delete or rewrite financial history to imitate a rollback.
- Native: halt staged rollout; keep or restore the prior store version where the platform permits; submit a corrected build when native code/config changed.
- Audit any user-created financial records during a faulty release before reconciliation. A code rollback does not undo those records.

## Support procedure for money or sync discrepancies

1. Acknowledge the report and collect household, screen, item name, date, app/build version, and connection status—never passwords or full account numbers.
2. Preserve audit history. Do not delete, recreate, or rematch records until the source, occurrence, settlement, and household scope are verified.
3. Compare canonical Activity, Forecast, bill/debt occurrence, Plaid raw/canonical lineage, and reviewed matches.
4. If money truth is uncertain, tell the customer the answer is being verified and stop automated mutations for that case.
5. Document the finding, correction, affected records, test added, and whether customer reconciliation is required.
6. Escalate security, cross-household, duplicated-payment, or destructive-data concerns immediately and retain evidence according to policy.

## Support procedure for account deletion

1. Ask only for the deletion receipt ID, approximate request time, and account email. Never request a password, bank credential, access token, Social Security number, or full account number.
2. Look up the receipt in `private.account_deletion_receipts` using the service role. Do not expose the stored user hash or database access to support clients.
3. A `completed` receipt confirms application cleanup and Auth deletion. A `data_deleted` receipt means application data was removed but Auth deletion or receipt finalization must be verified and, if needed, completed by an authorized operator.
4. If no receipt exists, confirm whether the user was blocked as the owner of a multi-member household or by an Apple, RevenueCat, or Plaid provider cleanup failure. The app intentionally makes no financial-data deletion in those cases.
5. For an owner block, help the customer remove every other member, then have them restart in-app deletion. Ownership transfer is not currently available; never delete another member's shared household plan as a shortcut.
6. For a Plaid failure, verify provider status and retry the same deletion path; do not clear retained ciphertext without a successful or already-removed provider response.
7. Record the receipt ID, final status, remediation, operator, and completion time. Escalate disputed, security-sensitive, or cross-household cases immediately.

## Final approval

- [ ] Release record complete
- [ ] Automated and physical-device gates passed
- [ ] Store declarations and screenshots match the build
- [ ] Rollback versions retained and tested
- [ ] Owner approved controlled production release
