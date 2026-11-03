# Saved debt payment pauses — November 3, 2026

Live source: `d8212d1de5815e03885d61ac5d7b1a40239d8a09`.
Production deployment: `dpl_H2Yh5qTcVq7PTHvemHc8RB72UmXY`.
Immutable deployment: `flow-ledger-cloud-ih5iy8n2q-flow-ledger-s-projects.vercel.app`.

## Behavior

Open Bills → Debt, select a debt, and choose **Pause debt payments**. Set the start and resume dates. **Use this payment for other debts** follows the saved payoff order when Debt Payoff Plan is enabled; pause-only remains available when that plan is off. The default resume date is two calendar months away.

The debt remains open with its balance, original payment, APR, and payoff position intact. The pause covers the start date through the day before the resume date. Payments resume automatically on the saved date. **Resume now** keeps elapsed history; **Cancel scheduled pause** removes an unelapsed future pause.

Available mutable payments can support other eligible debts on their original scheduled dates. Redirects remain temporary and never become a permanent minimum or rollover boost. Recipient balances cap allocations, and unused cash stays available. Recorded, pending, posted, reviewed, and manual payments remain counted once. Paused debts stay in the open-debt totals and ladder but are excluded from the current extra-payment target during the pause.

Forecast, Dashboard, the payoff planner, saved simulator scenarios, and Flo use the shared dated pause rules. Interest continues according to the saved APR. The editor explains that the feature changes the FlowLedger plan only; lender payments and lender autopay must be managed separately, and payoff may be later.

## Verification

- API 218/218, Edge 589/589, release fixtures 37/37, final mobile 1,646/1,646, and performance 5/5: 2,495 passing tests across the final checks. The initial integration command exposed eight legacy mobile harness/DTO expectations; three test files were repaired and the complete mobile suite reran successfully without product changes. This is not represented as one exit-zero full-suite command.
- Workspace typecheck, mobile configuration, guide drift, release artifact copy scan, clean source, exact 45-file export copy, and remote annotated rollback checks passed.
- Independent SENTINEL source/model/SQL review passed, including 182 analytic oracle cases and an isolated PostgreSQL 17 integration matrix. The three later test-only repairs received an independent 48-test review.
- Seven local and seven hosted browser flows passed at 320, 390, and 1,200-pixel widths in light and dark themes: save/rejected-save retry/reload/redirect, exclusive automatic resume, early resume with history, scheduled cancellation, no eligible recipient, plan-off pause-only, and keyboard/nested Back/Cancel/layout.
- Each browser phase used six fictional in-memory pause-only CAS writes and zero actual customer writes or provider calls. No unexpected application errors or unknown requests occurred; all owned browsers closed. Browser persistence was intercepted; database behavior was verified separately using executable PostgreSQL fixtures and owner-safe production probes.
- All four production aliases resolve to the same READY release. Actual HTTP checks passed for startup, routes, health, missing resources, service worker, guide PDF, cache headers, and exact browser-tested JavaScript bytes.

Web entry: `/_expo/static/js/web/entry-e760bc5c241e647359611b6e8eedd83e.js`, 5,204,794 bytes.
SHA256: `fc6903d422b83bfe6b465017487805964e3f0ba75e8128bf6388e4df183d140f`.

## Database and Flo

Applied migration: `20261103134120_saved_debt_payment_pauses.sql`.
SQL SHA256: `15686fa556fdea718853bb462ffb87d1aa53f552abc74380a70d07d1134807c8`.

`bills.debt_payment_pauses` stores validated nonoverlapping intervals with an empty-array default. Existing household permissions, invoker edit RPC authorization, row locking, compare-and-swap behavior, raw journal capture, and minimum-boost triggers remain intact. Pause summaries are bounded and primitive; generic Undo is disabled for this financial edit. No actual customer debt was paused by the release. Transactional pre-apply rollback and post-apply checks passed; no new security-advisor findings appeared.

Flo production functions are ACTIVE with JWT verification retained:

| Function | New version | Runtime bundle SHA256 |
| --- | --- | --- |
| flo-chat | 44 | c32592ac8ce2d0ae41b33c0007059671a47c670322d0fb647c7e6969404d6fc9 |
| flo-chat-v4 | 10 | 60fcaf8a80a57192b19be80c6b02c7a9b5d7f325d072758262bb2b808c167629 |

All 53 deployed runtime source files for each function exactly match the frozen packages. TypeScript-only dependencies were pruned as expected and confirmed through the emitted runtime import graphs. Live OPTIONS returned 200 and unauthenticated GET returned 401 for both functions, with no model/provider calls. Other functions and provider configuration were untouched.

Environment metadata confirmed required credentials target Production only, without exposing values. The authenticated project tool does not expose build/install/output defaults. The deployment request explicitly supplied the required Node 24, Expo export, pnpm install, and `artifacts/mobile/dist` contract; the completed build and exact hosted bytes verified that contract. Original rollback/postflight scripts ran with only CLI inspection replaced by fresh authenticated MCP metadata; remote Git and actual HTTP checks were retained.

## Rollback and evidence

Verified remote annotated tag: **`rollback/prod-before-debt-payment-pause-20261103-1340`**.
It captures prior actual production source `8a320576342dea8d9b8e4c167ab2df618ecdb56f` and deployment `dpl_EomuWmkUJu6UBjhpkP5v99j22PR1` before the release changed production. Restore that deployment and verify all four aliases together if rollback is needed.

Keep the additive database column and saved histories on a web rollback. Previous exact Flo source packages (versions 43 and 9, JWT verification enabled) are retained privately at `/workspace/flowledger-private-rollback/debt-payment-pause-20261103/`; restore them if the backend also needs rollback. These raw packages must not be published or committed.

Sanitized evidence is at `/workspace/artifacts/qa-debt-payment-pause-20261103/`: source hashes, independent review, test logs, database probes, runtime graph/package verification, live HTTP/alias proofs, browser receipts/screenshots, sanitization and cleanup records, and artifact hashes. Fixture code, authentication state, credentials, and private rollback sources are excluded. The public user guide was updated and its rebuilt PDF matches the live release.
