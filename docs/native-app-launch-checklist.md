# FlowLedger Native App Launch Checklist

Last audited: August 25, 2026

Maintenance rule: Update this checklist automatically whenever related work is completed or verified. Check an item only when evidence confirms it is done, keep incomplete or unverified work unchecked, and update the audit date with each material checklist change. This maintenance is part of the related task and does not require a separate request from the owner.

Current verified progress is evidence-counted below. Public version 1 is intentionally **Founding Free**: no purchase controls, no paywall, and no new public bank-link control are exposed. The repository preserves future billing and Plaid implementations for a later reviewed Pro release. Production database hardening and the safe Android EAS environment are complete; release still requires store-account setup, current signed store binaries, sacrificial-account and physical-device testing, accessibility testing, screenshots, declarations, and final reviewer credentials.

## Goal

Release FlowLedger as a signed iOS and Android app while keeping the existing PWA and shared Expo/React Native codebase. FlowLedger does not need to be rebuilt as a separate native product; the remaining work is native configuration, native service parity, store compliance, device testing, and release operations.

## Status key

- `[x]` Complete or already present in the repository
- `[ ]` Still required or not yet verified
- **BLOCKER** must be complete before a public store release
- **BETA** must be complete before useful TestFlight/Play internal testing
- **FOLLOW-UP** can follow the first store release if the related UI is hidden or clearly marked unavailable

## Existing foundation

- [x] Expo/React Native application with shared web, iOS, and Android UI
- [x] Expo Router navigation and typed routes
- [x] Android package name: `com.flowledger.app`
- [x] EAS project ID configured
- [x] App icon at 1024×1024
- [x] Splash screen and dark launch background
- [x] Safe-area handling and Android hardware-back handling
- [x] Responsive phone, tablet, and desktop layouts
- [x] Setup walkthrough and demo mode
- [x] Interactive app-style user guide linked from Settings with mobile/PWA slide navigation and the full desktop PDF
- [x] Plan Simulator uses the shared app calendar and can test paying off a selected open debt without changing live data
- [x] Debt Payoff Planner extra-payment field stays within its card on phone layouts
- [x] Debt Payoff Planner removes the browser's internal money-field focus outline while keeping the normal editing cursor and dollar sign aligned
- [x] Debt Payoff Planner shows the projected payoff date as a compact line while removing the comparison and scheduled/extra/total cards
- [x] PWA resume restores the locally selected household without blocking plan load on a temporary preference-sync failure
- [x] Forecast closes its selected-day modal before opening the planned debt-payment editor
- [x] Forecast debt cards edit the remaining scheduled payment inline while preserving any payment already made
- [x] Pending and posted Plaid charges can match manual Activity entries, including debt-applied entries, without double-counting cash or applying debt twice
- [x] Flo under-budget bill routing can merge the leftover into the next planned debt payment or use a chosen date, with one combined same-day Forecast item
- [x] Dashboard no longer presents automatic low-balance warnings or low-balance decision comments
- [x] Flow Score, Forecast, Flo, setup, guides, and desktop views use encouraging breathing-room language instead of low- or negative-balance wording
- [x] Flo shows live account-check progress, keeps its Edge stream active, and ends stalled requests with a clear Retry instead of spinning indefinitely
- [x] Flo finishes paid account answers in a bounded foreground request, falls back to verified multi-source guidance, atomically records completion/usage/audit, reconciles stale replies, and never reloads an empty response bubble
- [x] Keep the large 200dp branded “Loading Plan...” screen visible without shrinking, resizing, or swapping until the signed-in household plan finishes loading
- [x] Use a real browser opacity transition to fade in the complete fixed-size startup brand over 1.2 seconds, hold it briefly, and fade it out over 700ms without replaying or blinking; reduced motion remains immediate
- [x] Route navigation, save, confirmation, and picker haptics through one device-level preference with an on-by-default Settings toggle
- [x] Settings uses one responsive mobile/PWA structure organized by Money & household, App preferences, Data & privacy, and Account & support; full app tools stay in their primary screens instead of duplicating the Settings hub
- [x] In-app Terms of Service and Privacy Policy screens
- [x] Financial calculation and regression test coverage
- [x] Flow Score uses three understandable measures: plan coverage through payday, Must Pay dollars due through today, and Protected Days; Forecast confidence is shown separately
- [x] Expo Doctor passes all 18 checks
- [x] Expo SDK 54 / React Native 0.81 targets Android 16, API level 36
- [ ] Verify an actual signed `.ipa` build exists in EAS
- [ ] Verify an actual signed `.aab` build exists in EAS
- [ ] Verify current App Store Connect and Play Console records

## 1. Native application identity and routing

### BETA — configuration

- [x] Add a permanent iOS bundle identifier: `com.flowledger.app`
- [x] Keep the Android package name permanently at `com.flowledger.app`
- [x] Replace the generic `mobile` URL scheme with `flowledger`
- [x] Replace the Expo Router origin with `https://flowledger-algo.com/`
- [x] Add iOS Associated Domains for `flowledger-algo.com`
- [x] Add Android intent filters/App Links for `flowledger-algo.com`
- [ ] Host and verify Apple `apple-app-site-association`
- [x] Host and verify Android `assetlinks.json` for the EAS preview signing certificate
- [ ] Add and verify the separate Google Play App Signing certificate fingerprint before production-track promotion
- [x] Add native routes for sign-in, password recovery, and email-verification callbacks
- [ ] Add and physically test Plaid return, notification-tap, and record deep links
- [ ] Add every native callback URL to the Supabase Auth redirect allowlist
- [ ] Test cold-start and warm-start deep links on physical iOS and Android devices

Current configuration evidence: `artifacts/mobile/app.config.js`

Official reference: [Expo iOS submission requirements](https://docs.expo.dev/submit/ios/)

## 2. Native authentication

### BETA — login and recovery

- [x] Implement a native Google OAuth flow with `expo-web-browser` and a native redirect URI
- [x] Exchange the OAuth callback for a Supabase session on native
- [x] Implement native password-reset callback handling
- [x] Implement native email-confirmation callback handling
- [x] Preserve legal acceptance through native OAuth completion
- [x] Implement the native Sign in with Apple code path, capability, and App Store-compliant system button
- [ ] Enable/configure the Apple provider in Supabase and the Apple Developer account, then set `EXPO_PUBLIC_APPLE_AUTH_ENABLED=true` in EAS
- [ ] Test login cancellation, expired links, duplicate callbacks, background return, sign-out, and account switching
- [ ] Provide a dedicated App Review account with realistic fictional data
- [x] Provide a service-only, idempotent fictional reviewer fixture seeder with stable identifiers, no Plaid tokens, and no repository credentials

Current code evidence: `artifacts/mobile/context/AuthContext.tsx`

Official reference: [Apple Login Services guideline](https://developer.apple.com/app-store/review/guidelines/#login-services)

## 3. Native API and environment configuration

### BETA — application connectivity

- [x] Create one shared API URL helper
- [x] Use `https://flowledger-algo.com` as the production API origin in native builds
- [x] Replace native-reachable relative requests such as `/api/feedback`, `/api/plaid/sync`, and `/api/plaid/account-nickname`
- [x] Keep browser requests same-origin where appropriate
- [x] Configure `EXPO_PUBLIC_SUPABASE_URL` in the EAS production environment
- [x] Configure `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the EAS production environment
- [x] Configure an explicit production API origin in EAS
- [x] Remove development/Replit fallbacks from release builds
- [x] Add a release-time validation that rejects missing or development environment values
- [x] Verify the deployed Flo path completes requests, accepts the production origin, and rejects an unapproved origin without exposing secret values
- [x] Apply and postflight the three pending production hardening migrations for Flo duration telemetry, Plaid household scope, and post-membership financial reads
- [ ] Test all API calls on an installed build, not only Expo Web or Expo Go

Current code evidence:

- `artifacts/mobile/lib/feedbackApi.ts`
- `artifacts/mobile/context/BudgetContext.tsx`
- `artifacts/mobile/lib/supabase.ts`

## 4. Signed builds and store accounts

### BLOCKER — developer and signing setup

- [ ] Enroll FlowLedger's legal entity in the Apple Developer Program
- [ ] Create or verify the App Store Connect organization and app record
- [ ] Create or verify the Google Play organization account
- [ ] Obtain and verify the organization D-U-N-S number
- [ ] Verify public developer email, phone, address, support URL, and website
- [x] Authenticate EAS CLI with the correct Expo organization
- [x] Confirm ownership of EAS project `80ec219d-8a12-43f9-b7cf-0dd6541e60f1`
- [ ] Configure iOS distribution certificate and provisioning profile
- [ ] Configure App Store Connect API credentials for submission
- [ ] Configure Android upload/signing key and protect its recovery material
- [ ] Configure a Google Play service account for automated submission
- [ ] Add App Store Connect app ID to `eas.json`
- [ ] Add Google Play track/submission settings to `eas.json`
- [x] Pin the tested EAS CLI version (`20.0.0`) rather than using an open-ended minimum
- [ ] Produce an iOS preview build
- [x] Produce an Android preview APK (signed internal build exists; it predates the current UI release candidate)
- [ ] Produce a production iOS IPA
- [ ] Produce a production Android App Bundle
- [ ] Upload the first build to TestFlight
- [ ] Upload the first build to Play internal testing

Official references:

- [Apple submission requirements](https://docs.expo.dev/submit/ios/)
- [Google developer account type](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en-EN)
- [Apple SDK submission requirements](https://developer.apple.com/news/upcoming-requirements/)

## 5. Account deletion and privacy controls

### BLOCKER — required by both stores

- [x] Add `Delete my account` under Data & Privacy
- [x] Require recent authentication before destructive deletion
- [x] Explain what is deleted, what may be legally retained, and what happens to shared household data
- [x] Handle household owner transfer or household deletion explicitly
- [x] Delete or anonymize user-owned financial records as promised
- [x] Delete Flo conversations and household memory in scope
- [x] Remove push-notification subscriptions
- [x] Revoke/disconnect Plaid Items and remove retained Plaid access tokens
- [x] Clear simulations, preferences, app-owned temporary export files, and device-local storage; copies the user already saved or shared outside FlowLedger remain under the user's control
- [x] Delete the Supabase Auth user only after application cleanup succeeds
- [x] Make retries idempotent and create an auditable deletion receipt
- [x] Add a public unauthenticated account-deletion request page on `flowledger-algo.com`
- [ ] Add the public deletion URL to the Google Play Data Safety form
- [x] Add an account-deletion support procedure for failed or disputed requests
- [ ] Test owner, manager, editor, viewer, single-user, and multi-member households

Official references:

- [Apple account-deletion requirement](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
- [Google account-deletion requirement](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

Current implementation evidence: `artifacts/mobile/app/delete-account.tsx`, the `/api/account/delete` rewrite through `api/feedback.js`, `api/_utils/accountDeletion.js`, `api/_utils/appleProvider.js`, `supabase/migrations/20260821184159_account_deletion_and_flo_rpc_hardening.sql`, `supabase/migrations/20260825094550_preserve_shared_plan_after_member_exit.sql`, `supabase/migrations/20260825095801_accumulate_account_deletion_plaid_receipt.sql`, and `docs/native-release-runbook.md`. End-to-end persona/device testing remains separately unchecked below.

## 6. Privacy, financial, and AI disclosures

### BLOCKER — store declarations

- [x] Publish a stable public Privacy Policy URL (`https://flowledger-algo.com/legal?doc=privacy`, verified HTTP 200 on 2026-08-15)
- [x] Publish a stable public Terms of Service URL (`https://flowledger-algo.com/legal?doc=terms`, verified HTTP 200 on 2026-08-15)
- [x] Add a stable public `/support` route with working contact information and safe recovery guidance
- [x] Keep support, Terms, and Privacy routes available without signing in
- [x] Ensure the policy lists Supabase, Vercel, Plaid, OpenAI/Flo, Apple/Google notification services, and any crash/analytics provider that is actually enabled
- [x] Explain collection, use, sharing, protection, retention, deletion, and consent withdrawal
- [x] Add explicit Flo/third-party AI disclosure and consent before financial data is sent for AI processing, with a Settings control that withdraws access and requires consent again
- [ ] Complete Apple App Privacy answers for email, user ID, financial information, user content, diagnostics, and other collected data
- [ ] Generate and inspect the iOS Privacy Manifest in the final archive
- [ ] Declare every required-reason API used by the app or included SDKs
- [ ] Complete Google Play Data Safety
- [ ] Complete Google Play Financial Features declaration
- [ ] Confirm the Finance category and any required disclaimers
- [ ] Complete the current Apple age-rating questionnaire, including Flo/chatbot functionality
- [ ] Confirm the app is positioned as budgeting/forecasting software and not a bank, lender, investment adviser, or payment processor

Official references:

- [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple privacy policy requirements](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
- [Google Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Financial Features declaration](https://support.google.com/googleplay/android-developer/answer/13849271?hl=en-419)

## 7. Pro billing and entitlements

### DEFERRED — later Pro release

- [x] Version 1 launches as Founding Free with purchase controls and native billing initialization disabled
- [ ] If selling Pro in-app, configure Apple auto-renewable subscriptions
- [ ] If selling Pro in-app, configure Google Play subscriptions
- [x] Implement purchase, restore, cancellation-status, grace-period, refund, and expiration handling
- [x] Verify store lifecycle server-side through an authenticated, HMAC-verified and replay-safe RevenueCat webhook
- [x] Synchronize store entitlements to the confirmed active household without trusting the client
- [x] Make server-authoritative Pro access available across web, iOS, and Android without duplicate entitlement grants
- [x] Add Manage Subscription links to the correct platform subscription settings
- [x] Add subscription terms, renewal period, price, no-trial disclosure, and cancellation instructions
- [x] Bind purchases and restores to the authenticated Supabase UUID and reject another purchaser/household, while preserving admin and grandfathered Pro
- [ ] Configure RevenueCat to keep restores with the original App User ID and add its products, entitlement, public keys, store credentials, and webhook secrets
- [ ] Exercise purchase, replay, wrong-account restore, cancellation, grace, expiry, refund, and renewal in store sandboxes on signed devices
- [ ] Give App Review access to every paid feature

Current implementation evidence: `artifacts/mobile/components/MembershipPanel.tsx`, `artifacts/mobile/lib/nativeBilling.native.ts`, `supabase/functions/billing-dispatcher`, `supabase/migrations/20260822224633_native_billing_plaid_push.sql`, and `docs/native-subscription-and-provider-setup.md`.

Official reference: [Apple In-App Purchase guideline](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)

## 8. Native Plaid support

### DEFERRED — later Pro release

- [x] Version 1 clearly labels bank sync as planned and keeps manual accounts/activity available
- [x] Replace the native “available in the web app” placeholder
- [x] Integrate official native Plaid Link while retaining Hosted Link on web
- [ ] Configure iOS and Android redirect URIs in Plaid
- [x] Implement native OAuth return handling through the Plaid SDK and app/universal-link configuration
- [x] Preserve the authenticated active household and intended connection type in the server-created Link token flow
- [ ] Test checking, savings, credit-card, reconnect, update mode, institution OAuth, cancellation, and failure
- [x] Keep credit-card purchase imports excluded from cash Forecast as currently designed
- [ ] Test linked-on-web accounts inside the native app
- [x] Support native connect, reconnect/update, refresh, savings rename, and disconnect with owner/editor Pro authorization

Current code evidence: `artifacts/mobile/components/PlaidLinkButton.tsx`, `api/plaid/create-link-token.js`, and `api/_utils/plaidLink.test.js`. Plaid dashboard identifiers and signed-device OAuth testing remain unchecked.

## 9. Native notifications

### Native parity

- [x] Install and configure SDK 54-compatible `expo-notifications`
- [ ] Configure Apple Push Notification service credentials
- [ ] Configure Firebase Cloud Messaging for Android
- [x] Add notification permission copy and request permission only after user intent
- [x] Store native Expo device tokens separately from Web Push subscriptions in a service-only RLS table
- [x] Scope tokens by user, household, installation, platform, and environment
- [x] Detach tokens on sign-out and remove them during account deletion
- [x] Route cold, warm, and killed notification taps only to allowlisted app destinations
- [x] Keep lock-screen titles and bodies generic without merchant, bill/account name, amount, balance, or Flo content
- [x] Support per-notification-type preferences across web and native delivery
- [x] Process Expo tickets/receipts, invalidate DeviceNotRegistered tokens, and retain transient failures for retry
- [ ] Test token rotation, reinstall, multiple devices, household switching, revoked permission, and expired tokens

Current implementation evidence: `artifacts/mobile/lib/pushNotifications.native.ts`, `artifacts/mobile/app/_layout.tsx`, `api/_utils/push.js`, and `supabase/migrations/20260822224633_native_billing_plaid_push.sql`. APNs/FCM/EAS credentials and physical delivery tests remain unchecked.

## 10. Native biometric lock and secure storage

### Native parity and security

- [x] Install and configure `expo-local-authentication`
- [x] Implement Face ID/Touch ID on iOS
- [x] Implement Android biometric/device-credential authentication
- [x] Add the required Face ID usage description
- [x] Preserve a passcode/password fallback
- [x] Keep biometric settings device-specific
- [ ] Test lock on background, timeout, process restart, biometric change, and failed attempts
- [x] Move native sessions from plain AsyncStorage to an encrypted, large-session-safe SecureStore adapter
- [x] Clear encrypted credentials on sign-out
- [x] Clear encrypted credentials after the account-deletion flow is implemented
- [x] Add an app-switcher privacy screen that obscures financial balances while backgrounded
- [x] Verify no service keys, Plaid tokens, access tokens, or raw financial exports are bundled into the application

Current implementation uses browser passkeys on the PWA and native device authentication on iOS/Android: `artifacts/mobile/context/BiometricLockContext.tsx`.

## 11. Offline, synchronization, and recovery behavior

### BETA — reliability

- [x] Add native connectivity detection using `@react-native-community/netinfo`
- [x] Keep native connectivity unknown until NetInfo reports instead of assuming the device is online
- [x] Define which data is safe to show from a last-known cache
- [x] Show the exact successful data/sync timestamp when displaying cached financial information across mobile and desktop financial workspaces
- [x] Block or clearly queue mutations while offline
- [x] Never display an unconfirmed offline mutation as saved
- [x] Refresh auth and household data safely when the app returns to the foreground
- [ ] Test airplane mode, captive portal, weak connection, API timeout, Supabase outage, Plaid outage, and interrupted saves
- [ ] Ensure all failed writes have a visible retry or recovery route
- [ ] Verify duplicated retries remain idempotent

Current native network-status hook uses NetInfo and exposes offline/reconnected UI: `artifacts/mobile/hooks/useNetworkStatus.ts`.

## 12. App icon, launch assets, and store listing

### BLOCKER — store package

- [x] 1024×1024 source icon exists
- [x] Splash artwork exists
- [x] Verify the 1024×1024 iOS source icon has no unsupported transparency
- [x] Create a dedicated Android adaptive foreground asset with safe padding
- [x] Add an Android monochrome/themed icon
- [ ] Verify splash behavior on light/dark system settings and slower devices
- [ ] Capture App Store screenshots using fictional data only
- [ ] Capture Play Store phone screenshots using fictional data only
- [x] Create and deterministically verify the Google Play 1024×500 feature graphic from fictional brand-only assets
- [x] Draft app name, subtitle/short description, long description, keywords, Finance category positioning, and version 1 release notes
- [x] Add and live-verify public support email, support URL, privacy URL, deletion URL, and marketing URL
- [ ] Ensure screenshots represent the current app and identify Pro-only features accurately
- [x] Prepare review notes explaining Flo, Forecast calculations, Plaid, Pro gating, simulator, and demo/reviewer access

## 13. Physical-device quality assurance

### BLOCKER — release validation

- [ ] Test at least one recent and one older supported iPhone
- [ ] Test at least one small and one large Android phone
- [ ] Test Samsung navigation buttons and gesture navigation
- [ ] Test Android predictive back behavior
- [ ] Test edge-to-edge layouts on Android 16/API 36
- [ ] Test display scaling, large text, screen reader, keyboard navigation where applicable, and 200% web zoom
- [ ] Verify all tap targets are at least 44×44 points where required
- [x] Add a shared 44×44 accessible press/icon primitive plus static modal focus and live-error contracts for critical destructive/notification flows
- [ ] Test notches, Dynamic Island, status bars, bottom gesture areas, and landscape rejection/orientation behavior
- [ ] Test every modal with the software keyboard open
- [ ] Test app background/foreground and process termination on every money-editing flow
- [ ] Test document import, export, Files integration, and sharing
- [ ] Test Flo streaming interruption, retry, history-off cleanup, and household switching
- [ ] Test setup and demo from a completely clean install
- [ ] Test account deletion end to end
- [ ] Test upgrade/restore/cancel flows if billing is enabled
- [ ] Run the full automated suite against the exact release commit
- [ ] Run an authenticated iOS and Android smoke test against production-like backend configuration

## 14. Monitoring, updates, and release operations

### BETA — operations

- [ ] Add privacy-conscious native crash reporting
- [x] Show app version and native build identifier on the public support screen
- [ ] Avoid sending raw balances, account names, transaction notes, or Flo content to crash/analytics systems
- [ ] Add backend and Edge Function alerting for authentication, Plaid, Flo, notification, and financial-write failures
- [x] Keep EAS Update disabled for version 1 so every native dependency/configuration change uses a reviewed store build
- [x] Record that a runtime-version policy is required before EAS Update can be enabled later
- [ ] Separate preview and production update channels
- [x] Record that native dependency/configuration changes require a new store build
- [x] Create staged rollout and rollback procedures for both stores
- [x] Require retaining the prior production build for emergency rollback
- [x] Create a release record for commit, migration, environment, build, tests, reviewer credentials, and approval
- [x] Define customer-support handling for sync discrepancies and incorrect financial calculations

Release evidence: `docs/native-release-runbook.md`

Official reference: [EAS Update and runtime compatibility](https://docs.expo.dev/eas-update/introduction/)

## 15. Store testing and submission

### BLOCKER — final launch

- [ ] Run TestFlight internal testing
- [ ] Run TestFlight external testing if needed
- [ ] Run Google Play internal testing
- [ ] Determine whether the Play account is subject to the 12-testers/14-days closed-test requirement
- [ ] If required, enroll at least 12 testers continuously for 14 days
- [ ] Collect structured feedback and record fixes
- [ ] Complete Apple App Privacy and age rating
- [ ] Complete Google Data Safety, Financial Features, content rating, target audience, ads, and deletion declarations
- [ ] Verify the final iOS build was produced using Xcode 26/iOS 26 SDK or later
- [ ] Verify the final Android build targets API level 36 or later
- [ ] Confirm production backend, legal URLs, review credentials, and all dependencies remain available during review
- [ ] Submit iOS for App Review
- [ ] Submit Android for Play review
- [ ] Use a controlled/manual public release after approval
- [ ] Monitor authentication, crashes, sync, Forecast discrepancies, and account deletion immediately after launch

Official references:

- [Google closed-testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Google Android 16/API 36 requirement](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-GB_ALL)
- [Apple current SDK requirements](https://developer.apple.com/news/upcoming-requirements/)

## Recommended release phases

### Phase 1 — installable internal beta

- [x] Finish in-repository native identity, deep links, OAuth, API origin, and EAS configuration
- [ ] Produce signed iOS and Android preview builds
- [ ] Test login, setup, dashboard, bills/debt, Forecast, simulator, Flo, editing, import/export, and logout on physical devices

### Phase 2 — store-compliant version 1

- [ ] Complete signed-device account-deletion and provider-erasure testing with sacrificial Apple, Google, email, Plaid, and billing accounts
- [ ] Complete organization/store verification and declarations
- [x] Implement the selected native Pro billing strategy; external store/provider configuration remains required
- [x] Implement native Plaid connection management; external Plaid dashboard configuration and device tests remain required
- [ ] Finish native authentication, secure storage, offline detection, crash monitoring, and review account
- [ ] Complete store assets, closed testing, and review notes

### Phase 3 — full native parity and growth

- [x] Native push notification registration, delivery, receipt handling, preferences, and tap routing are implemented; provider credentials/device tests remain required
- [x] Native biometric lock
- [ ] Improved offline/read-only cache
- [ ] EAS Update with controlled release channels
- [ ] Optional widgets, shortcuts, and platform-specific conveniences after the core financial experience is stable

## Final launch gate

Do not release publicly until every item marked **BLOCKER** is complete, a signed production build has passed authenticated physical-device testing, account deletion works, the billing decision is implemented consistently, and store declarations match actual FlowLedger behavior.

## Completed reliability fixes

- [x] Keep household activity concise, collapse duplicate item saves, and never attribute background database updates to the record creator
- [x] Keep recurring bill payments occurrence-specific so a paid or matched week never marks future weekly, biweekly, monthly, or quarterly dates as paid
- [x] Label planned Forecast items by money type—Bill, Debt, Snowball, Income, Goal, or Plan—while preserving real payment statuses
- [x] Keep each remaining debt occurrence authoritative in one Forecast source so partial payments and edited plans never duplicate a creditor or outflow
- [x] Explain retained debt payments in Forecast with the amount already paid, minimum still remaining, and extra principal preserved by the user’s choice
- [x] Show the full amount already planned on a debt payment date before routing bill surplus to that next payment
