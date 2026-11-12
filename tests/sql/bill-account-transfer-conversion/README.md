# Bill to account-transfer database tests

Run `tests/sql/bill-account-transfer-conversion/run.sh` with the already available
`postgres:17-alpine` image and managed local Docker daemon. It creates a fresh
network-isolated PostgreSQL container with fictional records and removes it on
success or failure. No Supabase credentials, hosted writes, or provider calls.

The fixture reuses the existing account/transfer schema and actual function DDL.
`delete-bill-current.sql` and `lifecycle-current.sql` are catalog-only copies of
current production functions. Account-deletion receipt/empty dependency tables
are minimal schema-only fixtures; the journal logger records a fake local row.
No authentication or production deletion function is rewritten by the migration.

Checks cover:

- Source Bill semantic CAS with the app's normalized NULL weekday/defaults,
  stale values, exact retry, durable one-to-one association and partial rollback.
- Physical account validation, supported recurrence and future cutover; existing
  unpaid, overridden, moved, pending or future-matched commitments remain intact.
- Preconversion evidence uses the app's household scope at any budget, plus
  current personal-household owners' legacy rows. Foreign-household facts cannot
  block a conversion or falsely settle an unpaid source. Ambiguous payment
  records fail safely. Postconversion guards look up globally unique Bill IDs;
  metadata scope hops and restored future bindings cannot revive the source.
  Goal/income ID namespaces remain separate.
- Future source schedules cannot resume or reappear through ordinary Bill edits,
  override/date moves, pending matching, actual allocations or reconciliation.
  Historical corrections and Undo, and bank metadata/observed amount refreshes,
  remain available. The cutoff stays fixed when a transfer is edited or deleted.
- Deferred source FK protects ordinary deletion, including the actual Bill-delete
  RPC's earlier cleanup and an actual failing COMMIT. A Bill insert guard closes
  the DELETE/recreate-same-ID route. Partial outstanding transfer metadata survives.
- Actual service-only account preparation plus Auth-user deletion preserves a
  shared converted Bill/plan and clears creator attribution; owned-account
  cleanup and direct unfunded/banked household/budget cleanup commit and roll back.
- Existing planned-transfer SQL tests and ten concurrent-session regressions run
  against the new migration, plus seven conversion/cleanup concurrency proofs.
- C2 probes explicitly enable RLS and load thirteen current captured policies on
  overrides, date moves, transactions and reconciliations. Authenticated actors
  prove permitted own-household writes and rejected foreign reads/writes, legacy
  owner scope, future scope hops, and removed/deleted/pending restorations.
  Reconciliation writes without authenticated write policy are seeded as the
  fixture owner. A labeled nullable legacy override compatibility case relaxes
  only the isolated fixture's current NOT NULL column.

`--catalog-only` checks the six additive schema/security contracts. Full runs
also produce `parent-baseline-proof.json`, comparing a separate database without
this migration to a converted source with it. Raw direct household deletion of a
funded legacy Bill already fails in the existing account-routing trigger; this
is unchanged, and the actual funded account-deletion API path is separately
verified. The migration does not broaden that unrelated authorization code.

Migration safety: one nullable `source_bill_id` column, one partial unique index,
one deferred NO ACTION source FK, six narrow functions and seven triggers.
There is no financial backfill and no existing RLS, grants or auth-function change.
If live conversions exist, rollback must retain the association, fixed cutoffs
and protective additive schema; never discard transfer plans or rewrite financial
history merely to revert the frontend. Prior frontend can still manage plans
through the existing Activity planner.
