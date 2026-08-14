# FlowLedger Native App Launch Checklist

Last audited: August 13, 2026

Maintenance rule: Update this checklist automatically whenever related work is completed or verified. Check an item only when evidence confirms it is done, keep incomplete or unverified work unchecked, and update the audit date with each material checklist change. This maintenance is part of the related task and does not require a separate request from the owner.

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
- [x] Expo Doctor passes all 18 checks
- [x] Expo SDK 54 / React Native 0.81 targets Android 16, API level 36
- [ ] Verify an actual signed `.ipa` build exists in EAS
- [ ] Verify an actual signed `.aab` build exists in EAS
- [ ] Verify current App Store Connect and Play Console records

## 1. Native application identity and routing

### BETA — configuration

- [ ] Add a permanent iOS bundle identifier, recommended: `com.flowledger.app`
- [ ] Confirm the Android package name will remain `com.flowledger.app` permanently
- [ ] Replace the generic `mobile` URL scheme with `flowledger`
- [ ] Replace the Expo Router origin `https://replit.com/` with `https://flowledger-algo.com/`
- [ ] Add iOS Associated Domains for `flowledger-algo.com`
- [ ] Add Android intent filters/App Links for `flowledger-algo.com`
- [ ] Host and verify Apple `apple-app-site-association`
- [ ] Host and verify Android `assetlinks.json`
- [ ] Add native routes for sign-in callbacks, password recovery, email verification, Plaid return, notification taps, and record deep links
- [ ] Add every native callback URL to the Supabase Auth redirect allowlist
- [ ] Test cold-start and warm-start deep links on physical iOS and Android devices

Current configuration evidence: `artifacts/mobile/app.config.js`

Official reference: [Expo iOS submission requirements](https://docs.expo.dev/submit/ios/)

## 2. Native authentication

### BETA — login and recovery

- [ ] Implement a native Google OAuth flow with `expo-web-browser` and a native redirect URI
- [ ] Exchange the OAuth callback for a Supabase session on native
- [ ] Implement native password-reset callback handling
- [ ] Implement native email-confirmation callback handling
- [ ] Preserve legal acceptance through native OAuth completion
- [ ] Add Sign in with Apple for iOS, or remove Google login from iOS and use only FlowLedger email/password authentication
- [ ] Test login cancellation, expired links, duplicate callbacks, background return, sign-out, and account switching
- [ ] Provide a dedicated App Review account with realistic fictional data

Current code evidence: `artifacts/mobile/context/AuthContext.tsx`

Official reference: [Apple Login Services guideline](https://developer.apple.com/app-store/review/guidelines/#login-services)

## 3. Native API and environment configuration

### BETA — application connectivity

- [ ] Create one shared API URL helper
- [ ] Use `https://flowledger-algo.com` as the production API origin in native builds
- [ ] Replace native-reachable relative requests such as `/api/feedback`, `/api/plaid/sync`, and `/api/plaid/account-nickname`
- [ ] Keep browser requests same-origin where appropriate
- [ ] Configure `EXPO_PUBLIC_SUPABASE_URL` in the EAS production environment
- [ ] Configure `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the EAS production environment
- [ ] Configure an explicit production API origin in EAS
- [ ] Remove development/Replit fallbacks from release builds
- [ ] Add a release-time validation that rejects missing or development environment values
- [ ] Verify Flo Edge Function secrets and allowed production origins
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
- [ ] Authenticate EAS CLI with the correct Expo organization
- [ ] Confirm ownership of EAS project `80ec219d-8a12-43f9-b7cf-0dd6541e60f1`
- [ ] Configure iOS distribution certificate and provisioning profile
- [ ] Configure App Store Connect API credentials for submission
- [ ] Configure Android upload/signing key and protect its recovery material
- [ ] Configure a Google Play service account for automated submission
- [ ] Add App Store Connect app ID to `eas.json`
- [ ] Add Google Play track/submission settings to `eas.json`
- [ ] Pin a tested EAS CLI version rather than using an open-ended minimum
- [ ] Produce an iOS preview build
- [ ] Produce an Android preview APK
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

- [ ] Add `Delete my account` under Data & Privacy
- [ ] Require recent authentication before destructive deletion
- [ ] Explain what is deleted, what may be legally retained, and what happens to shared household data
- [ ] Handle household owner transfer or household deletion explicitly
- [ ] Delete or anonymize user-owned financial records as promised
- [ ] Delete Flo conversations and household memory in scope
- [ ] Remove push-notification subscriptions
- [ ] Revoke/disconnect Plaid Items and remove retained Plaid access tokens
- [ ] Clear simulations, preferences, exports, and device-local storage
- [ ] Delete the Supabase Auth user only after application cleanup succeeds
- [ ] Make retries idempotent and create an auditable deletion receipt
- [ ] Add a public unauthenticated account-deletion request page on `flowledger-algo.com`
- [ ] Add the public deletion URL to the Google Play Data Safety form
- [ ] Add an account-deletion support procedure for failed or disputed requests
- [ ] Test owner, manager, editor, viewer, single-user, and multi-member households

Official references:

- [Apple account-deletion requirement](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
- [Google account-deletion requirement](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

## 6. Privacy, financial, and AI disclosures

### BLOCKER — store declarations

- [ ] Publish a stable public Privacy Policy URL
- [ ] Publish a stable public Terms of Service URL
- [ ] Publish a stable public Support URL with working contact information
- [ ] Verify legal pages work without signing in
- [ ] Ensure the policy lists Supabase, Vercel, Plaid, OpenAI/Flo, Apple/Google notification services, and any crash/analytics provider
- [ ] Explain collection, use, sharing, protection, retention, deletion, and consent withdrawal
- [ ] Add explicit Flo/third-party AI disclosure and consent before financial data is sent for AI processing
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

### BLOCKER — owner decision before submission

- [ ] Decide whether version 1 will sell FlowLedger Pro inside the mobile app
- [ ] Decide whether version 1 will be a free companion app for existing web customers with no mobile purchase calls to action
- [ ] If selling Pro in-app, configure Apple auto-renewable subscriptions
- [ ] If selling Pro in-app, configure Google Play subscriptions
- [ ] Implement purchase, restore, cancellation-status, grace-period, refund, and expiration handling
- [ ] Verify receipts server-side
- [ ] Synchronize store entitlements to household membership without trusting the client
- [ ] Make Pro access work across web, iOS, and Android without duplicate entitlement grants
- [ ] Add Manage Subscription links to the correct platform subscription settings
- [ ] Add subscription terms, renewal period, price, trial details, and cancellation instructions
- [ ] Give App Review access to every paid feature
- [ ] Remove or hide unfinished upgrade controls if billing is deferred

Current code states that paid upgrades are coming soon and does not include native billing.

Official reference: [Apple In-App Purchase guideline](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)

## 8. Native Plaid support

### Native parity

- [ ] Decide whether native bank linking is required for version 1
- [ ] Replace the current native “available in the web app” placeholder if native parity is required
- [ ] Integrate Plaid Link for Expo/React Native or Plaid Hosted Link in a secure browser session
- [ ] Configure iOS and Android redirect URIs in Plaid
- [ ] Resume OAuth after bank-app/browser return
- [ ] Preserve active household and intended connection type through the return
- [ ] Test checking, savings, credit-card, reconnect, update mode, institution OAuth, cancellation, and failure
- [ ] Keep credit-card purchase imports excluded from cash Forecast as currently designed
- [ ] Test linked-on-web accounts inside the native app
- [ ] Add a safe native pathway to disconnect a financial institution

Current code evidence: `artifacts/mobile/components/PlaidLinkButton.tsx`

## 9. Native notifications

### Native parity

- [ ] Install and configure `expo-notifications`
- [ ] Configure Apple Push Notification service credentials
- [ ] Configure Firebase Cloud Messaging for Android
- [ ] Add notification permission copy and request permission only after user intent
- [ ] Store native device tokens separately from Web Push subscriptions
- [ ] Scope tokens by user, household, device, platform, and environment
- [ ] Remove or disable tokens on sign-out and account deletion
- [ ] Route notification taps to the correct bill, debt, review item, feedback item, or Forecast date
- [ ] Avoid placing confidential financial amounts in lock-screen notification text by default
- [ ] Support per-notification-type preferences
- [ ] Test token rotation, reinstall, multiple devices, household switching, revoked permission, and expired tokens

Current implementation is browser Service Worker/Web Push only: `artifacts/mobile/lib/pushNotifications.ts`.

## 10. Native biometric lock and secure storage

### Native parity and security

- [ ] Install and configure `expo-local-authentication`
- [ ] Implement Face ID/Touch ID on iOS
- [ ] Implement Android biometric/device-credential authentication
- [ ] Add the required Face ID usage description
- [ ] Preserve a passcode/password fallback
- [ ] Keep biometric settings device-specific
- [ ] Test lock on background, timeout, process restart, biometric change, and failed attempts
- [ ] Move sensitive session storage from plain AsyncStorage to an encrypted SecureStore-backed adapter
- [ ] Clear secure credentials on sign-out and account deletion
- [ ] Add an app-switcher privacy screen that obscures financial balances while backgrounded
- [ ] Verify no service keys, Plaid tokens, access tokens, or raw financial exports are bundled into the application

Current biometric implementation uses browser passkeys only: `artifacts/mobile/context/BiometricLockContext.tsx`.

## 11. Offline, synchronization, and recovery behavior

### BETA — reliability

- [ ] Add native connectivity detection using a React Native network-information library
- [ ] Stop reporting native devices as online unconditionally
- [ ] Define which data is safe to show from a last-known cache
- [ ] Show the exact data/sync timestamp when displaying cached financial information
- [ ] Block or clearly queue mutations while offline
- [ ] Never display an unconfirmed offline mutation as saved
- [ ] Refresh safely when the app returns to the foreground
- [ ] Test airplane mode, captive portal, weak connection, API timeout, Supabase outage, Plaid outage, and interrupted saves
- [ ] Ensure all failed writes have a visible retry or recovery route
- [ ] Verify duplicated retries remain idempotent

Current native network-status hook assumes the device is online: `artifacts/mobile/hooks/useNetworkStatus.ts`.

## 12. App icon, launch assets, and store listing

### BLOCKER — store package

- [x] 1024×1024 source icon exists
- [x] Splash artwork exists
- [ ] Verify the iOS icon contains no unsupported transparency and remains legible at small sizes
- [ ] Create a dedicated Android adaptive foreground asset with safe padding
- [ ] Add an Android monochrome/themed icon
- [ ] Verify splash behavior on light/dark system settings and slower devices
- [ ] Capture App Store screenshots using fictional data only
- [ ] Capture Play Store phone screenshots using fictional data only
- [ ] Create required feature graphic and promotional artwork
- [ ] Write app name, subtitle/short description, long description, keywords, category, and release notes
- [ ] Add public support email, support URL, privacy URL, deletion URL, and marketing URL
- [ ] Ensure screenshots represent the current app and identify Pro-only features accurately
- [ ] Prepare review notes explaining Flo, Forecast calculations, Plaid, Pro gating, simulator, and demo/reviewer access

## 13. Physical-device quality assurance

### BLOCKER — release validation

- [ ] Test at least one recent and one older supported iPhone
- [ ] Test at least one small and one large Android phone
- [ ] Test Samsung navigation buttons and gesture navigation
- [ ] Test Android predictive back behavior
- [ ] Test edge-to-edge layouts on Android 16/API 36
- [ ] Test display scaling, large text, screen reader, keyboard navigation where applicable, and 200% web zoom
- [ ] Verify all tap targets are at least 44×44 points where required
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
- [ ] Add release/build identifiers to support diagnostics
- [ ] Avoid sending raw balances, account names, transaction notes, or Flo content to crash/analytics systems
- [ ] Add backend and Edge Function alerting for authentication, Plaid, Flo, notification, and financial-write failures
- [ ] Decide whether to enable EAS Update
- [ ] If enabling EAS Update, configure an explicit runtime-version policy
- [ ] Separate preview and production update channels
- [ ] Remember that native dependency/configuration changes require a new store build
- [ ] Create staged rollout and rollback procedures for both stores
- [ ] Retain the prior production build for emergency rollback
- [ ] Create a release checklist that records commit, migration version, environment, build number, tests, reviewer credentials, and approval
- [ ] Define customer-support handling for sync discrepancies and incorrect financial calculations

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

- [ ] Finish native identity, deep links, OAuth, API origin, and EAS configuration
- [ ] Produce signed iOS and Android preview builds
- [ ] Test login, setup, dashboard, bills/debt, Forecast, simulator, Flo, editing, import/export, and logout on physical devices

### Phase 2 — store-compliant version 1

- [ ] Finish account deletion and privacy controls
- [ ] Complete organization/store verification and declarations
- [ ] Decide Pro billing strategy
- [ ] Finish native Plaid if bank connection is promised in version 1; otherwise hide the unavailable control and document web-only connection clearly
- [ ] Finish native authentication, secure storage, offline detection, crash monitoring, and review account
- [ ] Complete store assets, closed testing, and review notes

### Phase 3 — full native parity and growth

- [ ] Native push notifications
- [ ] Native biometric lock
- [ ] Improved offline/read-only cache
- [ ] EAS Update with controlled release channels
- [ ] Optional widgets, shortcuts, and platform-specific conveniences after the core financial experience is stable

## Final launch gate

Do not release publicly until every item marked **BLOCKER** is complete, a signed production build has passed authenticated physical-device testing, account deletion works, the billing decision is implemented consistently, and store declarations match actual FlowLedger behavior.

## Completed reliability fixes

- [x] Keep household activity concise, collapse duplicate item saves, and never attribute background database updates to the record creator
- [x] Keep recurring bill payments occurrence-specific so a paid or matched week never marks future weekly, biweekly, monthly, or quarterly dates as paid
