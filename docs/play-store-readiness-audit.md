# Google Play readiness audit — January 2027

Audit date: October 21, 2026. Baseline: `fe290a37a1ef9768b70fad9bd8b42071d74a4186` on `dev`. CORE divided the work between ATLAS (financial/UI investigation), FORGE (implementation and native configuration), and SENTINEL (independent security and correctness review).

**Status: confirmed fixes verified on `dev`; not ready for store submission.** This audit does not publish a web release, upload a binary, or submit a store listing. The planned release remains **Founding Free** under the existing [release scope](founding-free-release-readiness.md). Public paid purchase/trial/paywall and new bank-link flows are outside this work.

## Confirmed defects and verification

The following defects were reproduced and fixed. SENTINEL independently reviewed the final source and ran the focused regression tests successfully.

| Issue | Effect | Verified change |
| --- | --- | --- |
| Expense edits checked only an increase in amount | Moving the same or a smaller expense before payday could skip the below-floor warning | Preview the exact replacement through the canonical financial projection, preserving account anchors and matching semantics |
| Saved money fields used permissive prefix parsing | `1,200.50` could become `1`; `25oops` could become `25` | Validate the entire field before persistence; accept correctly grouped thousands and supported precision or show an error |
| Calendar default used device date | Initial month/year could differ from the household date near midnight/year boundaries | Use the existing household date; preserve saved navigation and explicit requested dates |
| Desktop Calendar replaced a requested date with today | A link to a specific date selected the wrong day | Preserve explicit queued selections when initializing the desktop month |
| Web validation used React Native's empty web Alert implementation | A rejected money entry could give no visible explanation | Show the validation error through a narrow platform-aware helper |
| OAuth deletion verification could leave the screen busy | Storage/provider/session failures could prevent a retry | Guard the full operation, clear pending verification on failure, and keep identity matching fail-closed |
| Android inherited unnecessary permissions | CSV cache sharing did not need broad external-storage access; Expo also added an unused overlay permission | Block legacy storage and `SYSTEM_ALERT_WINDOW` permissions and inspect generated native configuration |
| Android backup excluded credentials but included financial cache | Backup or device transfer could retain raw local plan/account/activity data | Disable backup and explicitly exclude internal data from cloud backup and device transfer |

Baseline `pnpm run verify` passed before changes, including financial/API/Edge regression suites, typechecks, web export, artifact checks, and the configured dependency audit gate. A passing audit gate is not a statement that all advisories are resolved. No real financial records were changed for test fixtures.

### Final verification

- `pnpm run verify`: **PASS**, including 1,828 tests (215 API, 403 Edge, 37 release fixtures, 1,168 mobile and 5 performance), workspace typechecks, normal web export and artifact checks.
- `expo export --platform android`: **PASS** for the final source, including Hermes bundle and assets. This is an export, not a signed AAB.
- Expo Doctor: **18/18 PASS** with the session's required proxy path (`NODE_USE_ENV_PROXY=1`). The initial attempt could not reach two remote metadata checks; it was rerun through the proxy successfully, without disabling checks or TLS verification.
- Focused tests: **17 PASS**, independently rerun by SENTINEL, covering strict money parsing, actual save-handler rejection/grouped amounts, OAuth storage/provider/session/mismatch errors, expense replacement forecasts, desktop requested-date selection and backup rules. These are included in the full test count, not additional tests.
- Local browser: **PASS** at desktop 1200 px and phone 390 px. With fictional balance 250, floor 200, payday 500 on December 15 and expense 200 on December 20, moving the expense to December 10 warns at 50. Invalid `25oops` visibly alerts; Keep editing retains the draft; Schedule anyway saves and updates the displayed forecast. The desktop requested-date link opens the intended expense. No page errors or non-local financial writes occurred.
- Household-date boundaries: **4 browser scenarios PASS**, using a device ahead of UTC at December 31 / January 1 and a device behind UTC at January 1 / December 31, in both layouts. The initial month/year follows the UTC household, not the device.
- Isolated native prebuild: **PASS**, with inspected generated manifest and well-formed XML. `allowBackup=false`, custom backup/extraction references, explicit exclusions in legacy/cloud/device-transfer rules, and `tools:node="remove"` entries for storage/overlay permissions are present. The final config-only overlay exclusion was followed by a successful config check, regenerated prebuild, backup regression and diff check. The final merged signed manifest and signed-device backup/transfer behavior still need verification; no absolute OEM guarantee is claimed.
- `git diff --check`: **PASS**. No schema migrations, new Plaid behavior, entitlement changes, production data writes, deployments or store uploads.

The dependency gate reports **one visible moderate advisory and four existing ignored high advisories**. An attempted `image-size` 2.0.4 fix broke actual web and Android asset exports because Metro still calls its removed filename API; that override was reverted and the working exports rerun. No new ignores were added. The current reachability assessment and follow-up obligations are in [SECURITY.md](../SECURITY.md). A compatible tooling update remains follow-up work before launch, rather than a claim of zero vulnerabilities.

The bounded server review found no new confirmed authorization or cross-household exposure defect in the inspected paths. Production Supabase security advisors returned 12 informational notices for RLS-enabled server-managed tables with no client policies, with no warnings or errors. Those tables intentionally deny client access; the audit did not add policies or change production configuration. Flo model calls inspected were reached through the consent-gated chat flow; consent is a local per-user opt-in, not a server-stored consent receipt. This is a scoped review, not a security certification.

## Store submission blockers

| Work | Evidence needed before submission | Owner |
| --- | --- | --- |
| Approved privacy policy | An accurate public policy and in-app link, with verified operator/contact, actual processors, retention and deletion terms. The withdrawn placeholder policy must not be restored | Release owner; engineering adds approved links |
| Play App Signing association | Real SHA-256 fingerprint from Play Console in the published Android App Links association; `release:native-android-check` passes with that fingerprint | Release owner supplies verified fingerprint; engineering validates |
| Final signed Android App Bundle | Exact candidate commit/build ID, unique version code, production configuration, inspected manifest/permissions, API target and native libraries | Engineering/release owner |
| Native device validation | Results for the exact signed candidate on clean install, repeated reopen, auth and deep links, offline/interrupted saves, household isolation, forecast/debt/bill flows, export/deletion, privacy/biometrics, accessibility and Flo consent | Engineering and beta testers |
| Notifications | Real Firebase configuration plus signed-device registration/delivery/receipt/tap evidence; otherwise keep notification entry points hidden | Engineering/release owner |
| Play declarations and review access | Accurate Data Safety and Financial Features declarations, content rating, app-access instructions with a fictional reviewer account, native screenshots and listing | Release owner with engineering evidence |
| Production account eligibility | Verified developer account and any applicable closed-test/production-access requirements | Release owner |

The owner confirmed that neither a Play developer account nor a registered business is set up yet. Recommended path: establish the business that will own and operate FlowLedger, obtain its free D-U-N-S number (allow up to 30 days), then create an organization Play Console account with matching verified details. Google's [account-type guidance](https://support.google.com/googleplay/android-developer/answer/13634885) directs financial products/services developers to organization accounts; its examples do not explicitly resolve every budgeting-only product. Do not assume a personal account qualifies without resolving that classification. See Google's [required account information](https://support.google.com/googleplay/android-developer/answer/13628312). This audit has not created a business, purchased anything, or opened an account.

The old preview APK and PWA screenshot drafts are not proof for this candidate. A JavaScript export does not demonstrate a signed build, native permission behavior, Android 16 KB library compatibility, or successful device flows. See the [native runbook](native-release-runbook.md) and [privacy worksheet](native-privacy-data-safety-worksheet.md) for the existing release procedure.

`pnpm run release:native-android-check` remains **blocked as expected**: no verified `FLOWLEDGER_PLAY_APP_SIGNING_SHA256` has been supplied. The audit did not invent a fingerprint or weaken that gate. The published preview certificate is not a substitute for the eventual Play App Signing certificate.

## Google requirements checked for this launch

- **API target:** Google's current [target API requirements](https://developer.android.com/google/play/requirements/target-sdk) require Android 16 / API 36 for new phone apps and updates from August 31, 2026. The installed Expo SDK catalog targets API 36; verify the final signed manifest and recheck policy close to January.
- **Native libraries:** Verify the final bundle's native libraries and run on a 16 KB environment using Google's [page-size guidance](https://developer.android.com/guide/practices/page-sizes). Framework version and a successful JS bundle alone do not prove compliance.
- **Privacy and deletion:** Google's [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311) requires accurate Data Safety disclosures, an accessible public privacy policy linked in-app and in Console, and in-app plus external account-deletion access where users create accounts. Confirm that the submitted candidate and its live services match all statements.
- **Financial declaration:** Complete the [Financial Features declaration](https://support.google.com/googleplay/android-developer/answer/13849271) accurately for budgeting/cash-flow/debt planning. FlowLedger does not hold funds, make payments, lend, invest, or repair credit.
- **Conditional closed test:** [Personal developer accounts created after November 13, 2023](https://support.google.com/googleplay/android-developer/answer/14151465) need at least 12 opted-in testers continuously for 14 days before applying for production access. This is not a universal requirement for all account types. Confirm the account type/date in Play Console and allow time for production-access review.

## Suggested launch sequence

1. **October–November:** Finish the confirmed fixes, independent review, privacy-policy inputs, account verification and signing setup. Preserve the manual-first launch scope.
2. **December:** Build the exact signed candidate; inspect manifest/native libraries; test on devices and the applicable Play testing track. Complete declarations, native screenshots and reviewer access. If the personal-account closed test applies, allow more than the minimum 14 days for feedback and review.
3. **January 2027:** Submit only after all required evidence is attached and blockers are closed. Use a staged production rollout and monitor crashes, authentication, save failures and financial discrepancies. Store approval timing remains Google's decision.
