# Planned account transfer database contract

Run `./tests/sql/account-planned-transfers/run.sh` from the repository. Docker must have the official `postgres:17-alpine` image cached. The script creates a fresh local container with no network, no host ports and an in-memory data directory, then removes it on exit. It never reads application credentials or connects to Supabase/Plaid.

The fixture reuses the existing fictional account schema, installs the two reviewed account migrations, and supplies the current three hosted authorization/account-resolution function definitions exported as metadata on November 11, 2026. These are fixture-only definitions; the new migration does not replace existing helpers or policies.

The migration adds only forecast metadata:

- `planned_account_transfers`: household/budget-scoped once/monthly templates, active/paused state, soft deletion, monotonically increasing integer revision.
- `planned_account_transfer_occurrences`: stable reviewed date, durable scheduled date and immutable amount/account snapshot, per-leg reflected declarations and balance dates, skip state, independent integer revision. One reviewed date per template/calendar month prevents series-day edits from creating a second occurrence that month.
- Four guarded RPCs: `get_planned_account_transfer_data`, `save_planned_account_transfer`, `delete_planned_account_transfer`, `save_planned_account_transfer_occurrence`.

Current household members can read allowlisted model columns or use the atomic get-data RPC. The internal `last_intent` exact-request receipt is omitted from RPC replies and has no authenticated column grant, so wildcard direct table selection is intentionally unsupported. Editors must write through narrow private, fixed-search-path functions exposed by invoker wrappers. No direct write privilege, bank permission, or existing RLS policy changes are added. Authorization and budget rows are locked only after the household advisory lock; revoked/downgraded members are rechecked after waits.

Create uses a stable client ID and expected revision `null`. Subsequent writes require the last integer revision. An identical request by the same actor retries only while its receipt remains the last mutation. A later different mutation invalidates that receipt. Occurrence retries can return an unchanged reviewed snapshot alongside the newer current template; this does not rewrite the snapshot. All returned model numbers/dates are standard JSON values.

The account resolver canonicalizes explicit valid aliases and rejects foreign, credit, inactive, conflicting, non-USD and same-physical pairs. New plans and resumed/edited active plans require valid endpoints. Pausing, deleting, skipping and clearing existing declarations can cancel plans even when endpoints become unavailable. Existing reviewed dates remain editable after the series is paused, deleted, or its day/end changes. `use_current_plan: true` is a separate explicit reset: it requires an active, undeleted occurrence in the reviewed calendar month, copies the latest amount/endpoints/revision, and clears all skip/reflection/balance-date fields. A moved monthly anchor retains the original reviewed key while `scheduled_date_snapshot` adopts the current actual anchored date; later series edits preserve that dated snapshot. A paused/deleted/ended partial cannot lose its last reflected bit unless the user explicitly skips it. Creator attribution is nullable with `ON DELETE SET NULL`, so deleting an author account preserves shared plans and reviewed states.

No save, read, pause, deletion, skip or reflected declaration creates a real transaction, changes a goal, moves money, matches bank evidence, or alters a balance observation. A reflected flag is a user planning declaration, not verified settlement.

For index-only verification, run `./tests/sql/account-planned-transfers/run.sh --catalog-only`. This installs both additive migrations and checks ten intended indexes, the exact ordered composite parent-scope index and full leading-column coverage for every new foreign key, without rerunning financial behavior tests.

The SQL matrix verifies roles/RLS/grants, scope, numeric/date validation, canonical identity, retries/CAS, monthly clipping/leap years, immutable snapshots and original-date editing, reset, cancellation with inactive endpoints, soft-deleted partial management, and unchanged financial records/observations. Real parallel sessions verify competing creates/edits/states, template-vs-occurrence races, snapshot preservation, atomic reads during an uncommitted combined edit, deletion races, revocation and role downgrade while waiting.

The migration is additive. Rolling back app code does not require dropping these tables or deleting saved planning records; older code simply does not read them.
