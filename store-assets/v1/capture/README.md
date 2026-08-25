# Native screenshot capture procedure

Only use the version 1 fictional reviewer fixture. Never capture a personal, customer, Plaid sandbox, or production bank account.

## PWA draft workflow — not store-submission evidence

The local reviewer-only PWA capture mode may be used to choose the screenshot story and review composition before a signed native build exists. Its source is the local-only `createDemoBudgetData()` fixture in `artifacts/mobile/context/BudgetContext.tsx`; the generated draft manifest records that exact provenance. These drafts do **not** prove native safe areas, status bars, permissions, keyboard behavior, or release-build configuration. They must never be labeled final or uploaded to a store as the signed-build evidence.

Capture the seven screens in this exact order and filename sequence:

1. `01-dashboard.png` — Your whole plan, at a glance
2. `02-forecast.png` — Know what is coming every day
3. `03-bills.png` — Finish the month with clarity
4. `04-debt-payoff.png` — Build a Snowball payoff path
5. `05-activity.png` — See what changed, instantly
6. `06-flo.png` — Ask your plan, not a generic chatbot
7. `07-settings.png` — Your data. Your control.

Save unedited PWA captures at:

- Android: `store-assets/v1/screenshots/draft-pwa/android-phone/raw/` at exactly `450x900`
- iOS: `store-assets/v1/screenshots/draft-pwa/ios-6.9/raw/` at exactly `430x932`

Then run:

```powershell
pnpm run build:store-screenshots
```

The controlled Chrome capture transport may return JPEG bytes even when the draft filename uses `.png`. The workflow detects that case, normalizes the same captured pixels to opaque PNG, records the normalization in the generated manifest, and then validates the final color mode and dimensions. It does not add, remove, or replace UI content.

For one platform while capture is still in progress, run `pnpm run build:store-screenshots -- --platform android-phone` or replace the platform with `ios-6.9`.

The workflow validates an exact seven-file set, rejects wrong dimensions or unexpected PNG files, preserves the UI without mock edits, writes opaque 24-bit RGB PNGs at `1350x2700` for Google Play and `1290x2796` for Apple, creates a labeled contact sheet, and records dimensions and SHA-256 values in `store-assets/v1/screenshots/draft-pwa/manifest.json`. Every generated manifest remains explicitly blocked from submission pending signed native recapture.

The screenshot headlines and captions are maintained in `store-assets/v1/screenshots/draft-pwa/copy.json`. Do not change a claim unless the captured Founding Free screen visibly supports it.

Before sharing even a draft, inspect every raw image for fictional-only names and amounts and for the absence of credentials, personal email addresses, notifications, debug overlays, browser chrome, or other apps.

## Final signed native capture

1. An authorized operator creates a fresh Founding Free reviewer Auth user with `app_metadata.flowledger_reviewer_fixture=true`. Store credentials only in the Apple/Google review portals or an approved secret manager.
2. Run `node scripts/seed-reviewer-fixture.mjs` for that UUID with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FLOWLEDGER_REVIEWER_USER_ID`, and `FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM=FICTIONAL_ONLY`. The seeder fails closed if the account already has an elevated plan, keeps it on the public Founding Free plan, and creates no Plaid Item or token. The separate `flowledger_store_reviewer` path is reserved for a later paid release and is not used for version 1.
3. Install the signed release-candidate build on the named iOS/Android simulator or device. Set its date/time zone to the release capture record, sign in to the reviewer fixture, and disable OS overlays, personal notifications, and debug banners.
4. Capture only real shipped Founding Free screens: Dashboard, Bills/Debt, Activity/Review/Buckets, Forecast/Simulator, Flo consent/answer, and Settings/privacy. Do not show hidden admin bank controls, future billing controls, or mock/edit app UI into a screenshot.
5. Save originals beneath `store-assets/v1/screenshots/<platform>/<device>/`; record device model, OS, app version/build, fixture version, locale, display scale, and SHA-256 in the manifest before approval.
6. Inspect every image for fictional-only names and amounts, Founding Free labels, readable disclosure text, status/navigation bars, and absence of credentials, tokens, emails, diagnostic overlays, or other apps.

Physical signed-build captures remain a release blocker until their files and metadata are added. This procedure is not evidence that those captures occurred.
