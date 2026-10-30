# Recent Changes and supported Undo

Status: source candidate; hosted migration and production release pending review.

Settings → Data & security → Recent Changes shows future saved changes to bills/debts, income, goals/buckets and Activity. Each entry includes actor, time, semantic before/after values and a review step before supported Undo. Flo attribution is verified from the existing immutable creation receipt in the same transaction. Existing household activity remains a separate summary; old activity is never given invented snapshots.

The database captures full snapshots only in private RLS-enabled tables with no client or service-role grants. Read APIs return bounded field differences, not those snapshots. A current member can read their active household/default-budget history; Undo additionally requires current edit access. Public functions are invoker wrappers over narrowly granted private implementations with explicit authorization and empty search paths. No user metadata authorizes an action.

Undo supports unused ordinary bill creation, bill/debt name/category edits, unlinked income creation/edits, zero-funded unlinked savings goal creation/target edits, and unallocated manual Activity creation/edits/soft deletion. Null-source manual form entries are supported only when bank/import/link/transfer checks also pass. Creation cancellation for manual Activity uses soft deletion. Debt creation, bank/imported or matched transactions, spending-bucket finances, funded goals, deletions with compound effects and other unsupported actions remain readable with an explanation and their existing destination controls.

The server locks the active selection/membership/default budget, then the entity row and monotonic version in ordinary-writer lock order. Current post-state equality plus an exact latest entity version prevents stale and A→B→A inverse writes. Foreign-key and explicit legacy text/JSON dependencies include bill overrides/date moves, reconciliation bases/targets, pending matches and payment sources. Unused-creation cancellation briefly locks legacy dependency tables while checking. Multi-row transaction groups are history-only. The inverse and idempotency receipt commit atomically; retries recheck scope and access before returning the same receipt. No caller supplies old field values.

Changes to maintenance timestamps or technical ownership alone do not create noise. Background/service work has no fake original-owner attribution. Scope moves never expose the former workspace’s snapshot to a destination household. Deleted households cascade their journal rows; capture avoids reintroducing parent foreign keys during account/household cleanup. Actor removal anonymizes attribution without granting access. No existing financial function is replaced by this migration.

The client uses the existing recoverable financial-mutation lifecycle, validates the scoped inverse receipt and refreshes authoritative bills, income, goals and transactions before success. It never writes a cached prior row back to the database. History loading is lazy, paginated, fail-closed, scope/generation guarded and retryable. Device appearance changes are outside this saved financial-plan journal.

Verification commands:

```
FLOWLEDGER_BUCKET_TEST_CONTAINER=flowledger-personal-features-test node scripts/test-recent-changes.cjs
node /workspace/FlowLedger-Cloud/node_modules/typescript/bin/tsc -p artifacts/mobile/tsconfig.tests.json
node --test artifacts/mobile/.test-dist/recentChanges.test.js artifacts/mobile/.test-dist/settingsHub.test.js
node /workspace/FlowLedger-Cloud/node_modules/typescript/bin/tsc -p artifacts/mobile/tsconfig.json --noEmit
```

The integration runner creates and drops a separate fictional PostgreSQL database, installs the current financial guards captured from metadata, then tests the actual journal/Flo creation migrations. It never connects to hosted financial rows. Hosted migration application, advisor comparison, browser verification and release proof belong to the final release gate.

Rollback is additive: roll the frontend back to its saved deployment first. Keep journal data and immutable creation receipts. If capture itself must be disabled, a reviewed follow-up migration can drop only `recent_changes_capture` on `public.bills`, `public.incomes`, `public.goals`, and `public.transactions`, and revoke authenticated execution of the two new public/private RPC entry points. Do not delete journal history as an emergency rollback.

Source verification passed: 81 actual PostgreSQL assertions with 16 existing financial guard triggers, 14 parser/settings checks, test compilation, mobile typecheck and diff check. No hosted financial test writes. Evidence: release-snapshots/recent-changes-source-20261030/.
