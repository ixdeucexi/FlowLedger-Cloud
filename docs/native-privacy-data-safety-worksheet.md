# Native privacy and data-safety worksheet

Last code audit: August 21, 2026. This is an implementation worksheet, not a completed Apple or Google console declaration. The release owner must reconcile it against the exact signed binary and current console questions.

## Data map

| Data | Purpose | Linked to user | Shared processor | User control |
| --- | --- | --- | --- | --- |
| Email, Auth user ID, session | Account, security, household isolation | Yes | Supabase Auth | Sign out; in-app deletion |
| Household roles and plan | Collaboration, authorization | Yes | Supabase | Owner/member controls; deletion rules |
| Manual balances, bills, debts, income, goals, transactions, Forecast decisions | Core budgeting and forecasting | Yes | Supabase | Edit/export/delete account |
| Optional bank account metadata, balances, transactions, liabilities | Pro sync, review, matching, debt planning | Yes | Plaid, Supabase | Connect/reconnect/rename/disconnect; delete account |
| Flo prompt, allowlisted household facts, conversation history | Requested assistant response | Yes | OpenAI, Supabase | Explicit consent; history/memory controls; deletion |
| Web Push endpoint/keys or Expo push token, installation/platform/environment | Requested notifications | Yes | Browser push services or Expo/Apple/Google | User-toggle permission; per-type preferences; sign-out/deletion detach |
| Purchase identity, product/store/status/expiry, transaction event IDs | Subscription fulfillment, fraud/replay prevention, support | Yes | RevenueCat, Apple/Google, Supabase | Restore/manage/cancel in store; deletion removes user-linked app records |
| Bounded diagnostics (platform, app version, operation/error code, duration) | Reliability and support | Yes | Supabase | No raw balance/name/note/prompt payload; deletion |

FlowLedger does not use advertising SDKs, cross-app tracking, contact lists, precise location, photos, camera, microphone, or sale of personal data in the audited source. `expo-location` and `expo-image-picker` were removed after confirming there were no imports.

## Apple App Privacy draft inputs

- Contact Info: email address — account management; linked; not tracking.
- Identifiers: user ID and device/installation identifier — account, entitlement, notification security; linked; not tracking.
- Financial Info: user-entered and optional connected-account records — app functionality; linked; not tracking.
- User Content: Flo prompts/history and support feedback — requested functionality/support; linked; not tracking.
- Purchases: product, store, entitlement lifecycle and transaction identifiers — app functionality; linked; not tracking.
- Diagnostics: bounded error/performance codes — app functionality; linked; not tracking.

Confirm the generated iOS Privacy Manifest and every SDK privacy manifest in the final archive before entering answers.

## Google Play Data Safety draft inputs

- Collection is encrypted in transit through HTTPS/TLS; confirm database/provider encryption and retention contracts with the release owner.
- Account data, financial information, app activity, user-generated content, identifiers, purchase records, and diagnostics are collected for app functionality, account management, security/fraud prevention, and support.
- Processor transfers to Supabase, Vercel, Plaid, OpenAI, RevenueCat, Expo, Apple, and Google must be declared as applicable under current Play definitions.
- Data is not used for ads or sold. Verify no new SDK changes this before every release.
- Users can request deletion in-app and at `https://flowledger-algo.com/delete-account`; shared-household ownership must be transferred or members removed first.
- Complete Financial Features as budgeting/cash-flow forecasting/debt-planning software. FlowLedger does not hold funds, make payments, lend, invest, or repair credit.

## Release evidence still required

- Final App Privacy and Data Safety console screenshots/exports.
- Signed archive dependency and privacy-manifest inspection.
- Current processor agreements, retention requirements, and public policy comparison.
- Physical verification of permission prompts, notification privacy, Flo consent withdrawal, export, and deletion using sacrificial accounts.
- Native CSV exports are deleted from FlowLedger's cache immediately after the share sheet closes and are purged again during account deletion. A copy the user saves or shares to another app is outside FlowLedger's app-owned storage and must be removed by the user from that destination.
