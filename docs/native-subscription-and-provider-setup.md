# Native subscription, Plaid, and push setup

Last code audit: August 21, 2026.

## RevenueCat and store subscriptions

- Entitlement: `pro`
- Apple products: `flowledger_pro_monthly` at $9.99/month and `flowledger_pro_annual` at $89/year
- Google Play subscription/base plans: `flowledger_pro:monthly-autorenewing` at $9.99/month and `flowledger_pro:annual-autorenewing` at $89/year
- Trial: none
- App User ID: authenticated Supabase UUID only; never email or an anonymous RevenueCat ID
- Scope: the household owner must confirm the currently active household by name before purchase or restore
- Authority: signed RevenueCat webhooks are primary. An authenticated server-side RevenueCat customer fetch may also reconcile restore and cached foreground/status lifecycle state against a purchaser/store/environment entitlement binding. Client `CustomerInfo` alone never unlocks the app.

Configure the RevenueCat project’s restore behavior to **Keep with original App User ID**. Configure the matching iOS/Android products and `pro` entitlement, public SDK keys, App Store/Play server credentials, webhook URL for the Supabase `billing-dispatcher`, webhook Authorization value, and webhook HMAC signing secret. The server rejects anonymous/original-identity mismatches, different Supabase UUID aliases, replayed event IDs, and bindings owned by another purchaser or household. A verified transfer revokes only the source binding after deployment-environment allowlisting and stale-event ordering checks; it never grants the destination.

Required public build variables:

- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
- `EXPO_PUBLIC_BILLING_ENVIRONMENT=production` for production builds

Required Edge secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REVENUECAT_WEBHOOK_AUTHORIZATION`
- `REVENUECAT_WEBHOOK_SIGNING_SECRET`
- `REVENUECAT_ENVIRONMENT=production`
- `REVENUECAT_SECRET_API_KEY` (server-side restore/status lifecycle reconciliation and customer erasure during account deletion)

TestFlight and App Review send platform `SANDBOX` events for the production binary. Keep the shipped binary configured with `EXPO_PUBLIC_BILLING_ENVIRONMENT=production`. Create a separate Free reviewer UUID with `app_metadata.flowledger_store_reviewer=true`, run the reviewer seeder, and add that exact UUID to RevenueCat **Sandbox Testing Access → Allowed App User IDs only**. The dispatcher accepts a sandbox webhook in production only for UUIDs in the service-only `billing_sandbox_testers` table; ordinary users' sandbox events fail closed. The matching production intent is accepted for that allowlisted reviewer's sandbox event.

Subscription disclosure shown in-app: payment is charged to the Apple App Store or Google Play account; Pro renews automatically until cancelled through that store; monthly is $9.99, annual is $89, and there is no free trial. A cancellation keeps access through the verified paid-through date; billing issues show grace status; expiry/refund/revocation can downgrade only the matching billing-owned household and never an admin/grandfathered plan.

## Plaid native dashboard setup

- SDK: `react-native-plaid-link-sdk` 13.0.4; requires a development/signed build, not Expo Go.
- Expo Doctor's React Native Directory metadata does not currently mark the official Plaid SDK as New Architecture-tested. The package is explicitly excluded from that metadata-only check because native Plaid is an owner requirement; signed iOS/Android New Architecture tests remain a release blocker.
- Android package: `com.flowledger.app` exactly.
- iOS bundle: `com.flowledger.app`.
- Register the production OAuth redirect/Universal Link `https://flowledger-algo.com/plaid/oauth` and the provider-required iOS/Android identifiers in every Plaid environment.
- Web continues to use Hosted Link. Native uses a non-hosted server-created link token and the official SDK.
- The API validates platform and scopes create/update Link tokens, exchange, sync, rename, and disconnect to the authenticated active editable Pro household.
- Test checking, savings, credit, update/reconnect, OAuth bank-app return, cancel, outage, duplicate connection, and linked-on-web visibility on signed devices.

## Native push setup

- SDK: Expo SDK 54-compatible `expo-notifications` `~0.32.17`.
- EAS project ID: `80ec219d-8a12-43f9-b7cf-0dd6541e60f1`.
- Configure APNs credentials for the iOS bundle and the FCM v1 service-account sender credential for the Android package in EAS. Separately add Firebase's client `google-services.json` as an EAS secret file, set its build-time path in `GOOGLE_SERVICES_JSON`, and verify the production config resolves `expo.android.googleServicesFile`. Never commit either JSON file; the FCM service account is distinct and must remain private.
- Set the production API's `PUSH_APP_ENVIRONMENT=production` (and use `preview`/`development` only on matching deployments); the server rejects and never delivers to cross-environment native registrations.
- The app requests OS permission only when the user enables the device toggle. A previously enabled device re-registers only when permission is already granted.
- Expo tokens are service-only and scoped to user, active household, stable installation UUID, platform, and build environment. Sign-out/deletion detaches them. Household switch and reinstall use distinct audited registration behavior.
- Lock-screen copy must remain generic. Do not add merchant, bill/account name, amount, balance, or Flo content to server push payloads.
- Store the Vercel `CRON_SECRET` value in Supabase Vault as `flowledger_cron_secret`. The migration schedules the free Supabase Cron receipt poll every ten minutes; verify the job and `net` responses after deployment.

External console setup, secrets, signed builds, and physical-device verification remain release blockers; none are completed by this document.
