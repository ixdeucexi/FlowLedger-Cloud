# Native screenshot capture procedure

Only use the version 1 fictional reviewer fixture. Never capture a personal, customer, Plaid sandbox, or production bank account.

1. An authorized operator creates a fresh Founding Free reviewer Auth user with `app_metadata.flowledger_reviewer_fixture=true`. Store credentials only in the Apple/Google review portals or an approved secret manager.
2. Run `node scripts/seed-reviewer-fixture.mjs` for that UUID with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FLOWLEDGER_REVIEWER_USER_ID`, and `FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM=FICTIONAL_ONLY`. The seeder fails closed if the account already has an elevated plan, keeps it on the public Founding Free plan, and creates no Plaid Item or token. The separate `flowledger_store_reviewer` path is reserved for a later paid release and is not used for version 1.
3. Install the signed release-candidate build on the named iOS/Android simulator or device. Set its date/time zone to the release capture record, sign in to the reviewer fixture, and disable OS overlays, personal notifications, and debug banners.
4. Capture only real shipped Founding Free screens: Dashboard, Bills/Debt, Activity/Review/Buckets, Forecast/Simulator, Flo consent/answer, and Settings/privacy. Do not show hidden admin bank controls, future billing controls, or mock/edit app UI into a screenshot.
5. Save originals beneath `store-assets/v1/screenshots/<platform>/<device>/`; record device model, OS, app version/build, fixture version, locale, display scale, and SHA-256 in the manifest before approval.
6. Inspect every image for fictional-only names and amounts, Founding Free labels, readable disclosure text, status/navigation bars, and absence of credentials, tokens, emails, diagnostic overlays, or other apps.

Physical signed-build captures remain a release blocker until their files and metadata are added. This procedure is not evidence that those captures occurred.
