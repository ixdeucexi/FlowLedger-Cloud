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

- Confirm the repository and live Supabase migration histories match exactly.
- Run the full unit suite, workspace typecheck, Expo Doctor, production web/native bundle, dependency audit, and `git diff --check` against the release commit.
- Confirm production EAS variables, public API origin, Supabase public key, OAuth providers, callback allowlist, and Flo secrets without copying their values into this record.
- Smoke login, setup, Dashboard, Bills/Debt, Activity/Review, Forecast, Simulator, Flo, Settings, support/legal pages, export, household switching, and sign-out with fictional data.
- Record physical iOS and Android results, including cold/warm deep links, background privacy, biometric unlock, offline recovery, and software keyboard layouts.
- Confirm privacy, billing, Data Safety, App Privacy, Financial Features, and reviewer notes describe the shipped behavior.

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

## Final approval

- [ ] Release record complete
- [ ] Automated and physical-device gates passed
- [ ] Store declarations and screenshots match the build
- [ ] Rollback versions retained and tested
- [ ] Owner approved controlled production release
