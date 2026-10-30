# Dashboard, privacy, buckets and Recent Changes

All four feature phases are live at https://flowledger-algo.com. Final app source: `e77f5e6b48bb62baf097aa0ecece9e9344646996`; READY production: `dpl_3zXzR5XExRZyHhYxeAKw3cEmajej`. All four app aliases point to this exact source.

| Feature | Find it | Available controls |
| --- | --- | --- |
| Dashboard customization | Dashboard → Customize | Simple, Debt Focus and Planning Ahead presets; card order arrows; optional-card visibility; up to four favorite actions. |
| Privacy Mode | Dashboard eye; Settings → Appearance | Hide/show amounts, financial accessibility text, financial forms and Flo conversations. Unfinished Flo form edits survive hide/show. |
| Personal buckets | Personalize on a bucket card or in its details | Selected icons and covers, real photo upload/replace/remove/reset, optional confirmed completion moments. Photos and looks stay on this device; photos hide in Privacy Mode. |
| Recent Changes | Settings → Data & security → Recent Changes | Actor/time and before/after values, supported Undo with review and confirmation, history-only reasons and Open item for linked actions. History begins with this update. |

The in-app swipe guide and downloadable PDF now include an eleventh page explaining these controls. The PDF source/export hashes and rendered page were checked.

Verification passed: 1,472 final mobile tests, five performance checks, strict compilation/typecheck/export, independent source reviews, 98 local PostgreSQL assertions with existing financial guards, 53 live database catalog/fingerprint/permission checks and six read-only no-auth SQL rejections. Real anonymous REST probes confirmed both new RPCs are registered and reject execution before their bodies.

Published-assets browser checks passed separately for every phase: Dashboard 26; Privacy Mode 80; personalized buckets 98; Recent Changes 30 plus four reachable-confirmation layout checks. Actual downloaded entry bytes matched the approved bundles. Photo tests used real FileChooser/File/Blob/IndexedDB behavior. All authenticated financial and AI tests used fictional intercepted APIs or local fictional PostgreSQL records. No hosted customer financial test writes or signed-in customer test sessions were used. Browser viewport checks cover 390/1,200-pixel layouts; native hardware execution is not claimed.

Final entry: `entry-721eaf33822da0afb8ff61705688682c.js`, SHA-256 `3417c3cbc3f124d8cbd283620cd09c8e06ec63dde6a9d848b122b56c90afeb3a`. Live journal migration: `20261030065552_recent_changes_journal`, exact reviewed SQL SHA-256 `6164d30afc55406c61b32f1f05bb0ba555e002612f4b084c98eed73630756fdd`. After the continuation, the live catalog gate passed again before the UI release. Security advisors have no warnings/errors; two new deny-all private-table RLS INFO findings are intentional.

Each phase has a remotely verified rollback point capturing the previously live source:

- Before Dashboard: `rollback/prod-before-dashboard-studio-20261030-0506`.
- Before Privacy Mode: `rollback/prod-before-privacy-mode-20261030-0532`.
- Before bucket personalization: `rollback/prod-before-bucket-personalization-20261030-0615`.
- Before Recent Changes: `rollback/prod-before-recent-changes-20261030-0654`.

The latest rollback restores the bucket release UI. Retain journal data. If capture must stop, revoke both public/private Undo execution rights before disabling the four capture triggers in one transaction. Recovery after a capture gap requires a reviewed epoch/cutoff that permanently rejects pre-gap inverses; the exact procedure is in the Recent Changes notes.

Phase notes and evidence: [Dashboard](dashboard-studio-2026-10-30.md), [Privacy Mode](privacy-mode-2026-10-30.md), [buckets](bucket-personalization-2026-10-30.md), [Recent Changes and backend rollback](recent-changes-2026-10-30.md).

The final combined smoke also passed ten checks on the final production bundle, five at each width: Dashboard presets/required sections, actual section arrows and favorite actions, money hide/reveal, persisted bucket icon/cover plus private personalization, and Settings navigation to correctly masked/revealed Recent Changes. Evidence: `release-snapshots/recent-changes-20261030/final-integration-browser/`.
