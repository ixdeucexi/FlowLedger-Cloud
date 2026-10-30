# Recent Changes and supported Undo

Status: source candidate; hosted migration and production release pending review.

Settings → Data & security → Recent Changes shows future saved changes to bills/debts, income, goals/buckets and Activity. Each entry includes actor, time, semantic before/after values and a review step before supported Undo. Flo attribution is verified from the existing immutable creation receipt in the same transaction. Existing household activity remains a separate summary; old activity is never given invented snapshots.

The database captures full snapshots only in private RLS-enabled tables with no client or service-role grants. Read APIs return bounded field differences, not those snapshots. A current member can read their active household/default-budget history; Undo additionally requires current edit access. Public functions are invoker wrappers over narrowly granted private implementations with explicit authorization and empty search paths. No user metadata authorizes an action.

Undo supports unused ordinary bill creation, bill/debt name/category edits, unlinked income creation and scalar edits, zero-funded unlinked savings goal creation/target edits, and unallocated manual Activity creation/edits/soft deletion. Income amount-history or skipped-date edits are history-only until they have a complete semantic preview, including when an amount edit also changes its history; their card explains that income settings’ dedicated controls are required. Null-source manual form entries are supported only when bank/import/link/transfer checks also pass. Creation cancellation for manual Activity uses soft deletion. Debt creation, bank/imported or matched transactions, spending-bucket finances, funded goals, deletions with compound effects and other unsupported actions remain readable with an explanation and their existing destination controls.

The server locks the active selection/membership/default budget, then the entity row and monotonic version in ordinary-writer lock order. Current post-state equality plus an exact latest entity version prevents stale and A→B→A inverse writes. Foreign-key and explicit legacy text/JSON dependencies include bill overrides/date moves, reconciliation bases/targets, pending matches and payment sources. Unused-creation cancellation takes dependency-table locks only after the entity lock and only with NOWAIT; a busy plan returns a retryable conflict without blocking ordinary writers behind global locks. Multi-row transaction groups are history-only. The inverse and idempotency receipt commit atomically; retries recheck scope and access before returning the same receipt. No caller supplies old field values.

Changes to maintenance timestamps or technical ownership alone do not create noise. Background/service work has no fake original-owner attribution. Scope moves never expose the former workspace’s snapshot to a destination household. Deleted households cascade their journal rows; capture avoids reintroducing parent foreign keys during account/household cleanup. Actor removal anonymizes attribution without granting access. No existing financial function is replaced by this migration.

The client uses the existing recoverable financial-mutation lifecycle, verifies the SDK session belongs to the captured user after awaiting session lookup, and binds the Undo RPC’s Authorization header to that exact token. It validates the scoped inverse receipt and refreshes authoritative bills, income, goals and transactions before success, with scope and disposal guards. It never writes a cached prior row back to the database. History loading is lazy, paginated, fail-closed, scope/generation guarded and retryable. Device appearance changes are outside this saved financial-plan journal.

Verification commands:

```
FLOWLEDGER_BUCKET_TEST_CONTAINER=flowledger-personal-features-test node scripts/test-recent-changes.cjs
node /workspace/FlowLedger-Cloud/node_modules/typescript/bin/tsc -p artifacts/mobile/tsconfig.tests.json
(cd artifacts/mobile && node --test .test-dist/recentChanges.test.js .test-dist/recentChangesUndo.test.js .test-dist/settingsHub.test.js .test-dist/financialDeepFixes.test.js)
node /workspace/FlowLedger-Cloud/node_modules/typescript/bin/tsc -p artifacts/mobile/tsconfig.json --noEmit
```

The integration runner creates and drops a separate fictional PostgreSQL database, installs the current financial guards captured from metadata, then tests the actual journal/Flo creation migrations. It never connects to hosted financial rows. Hosted migration application, advisor comparison, browser verification and release proof belong to the final release gate.

Rollback is additive: roll the frontend back to its saved deployment first. Keep journal data and immutable creation receipts. If capture itself must stop, use one reviewed transaction that revokes Undo execution on both entry points from PUBLIC and authenticated before disabling the four capture triggers. This ordering prevents a callable inverse from trusting stale versions after capture stops. For example, after review against the deployed schema:

```sql
begin;
revoke all on function public.undo_recent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.undo_recent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;
alter table public.bills disable trigger recent_changes_capture;
alter table public.incomes disable trigger recent_changes_capture;
alter table public.goals disable trigger recent_changes_capture;
alter table public.transactions disable trigger recent_changes_capture;
commit;
notify pgrst, 'reload schema';
```

Retain read-only history and all journal data. Keep Undo revoked until a reviewed recovery migration establishes a capture epoch/cutoff that permanently rejects pre-gap inverses (or makes all pre-gap entries history-only), restarts capture and passes verification. Merely re-enabling capture and restoring grants cannot detect edits made while it was stopped, including A→B→A changes, and is unsafe.

Source verification passed: 98 actual PostgreSQL assertions with 16 existing financial guard triggers, 33 focused client checks (parser, settings, Undo identity/lifecycle, income confirmation eligibility and debt-refresh regressions), test compilation, mobile typecheck and diff check. Independent SENTINEL reran the final SQL integration and reviewed all follow-up fixes with no source blockers. No hosted financial test writes. Evidence: release-snapshots/recent-changes-source-20261030/.
