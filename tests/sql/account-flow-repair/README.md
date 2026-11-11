# Account flow metadata database tests

Run from the repository root:

```sh
tests/sql/account-flow-repair/run.sh
```

The runner uses the cached official `postgres:17-alpine` image, a new disposable
container with `--network none`, no listening port, and fake records only. It
removes only its own container. It does not use Supabase credentials, call Plaid,
or reset another agent's database. The local Docker daemon must be available.

The test setup reuses the previous account-forecast schema fixture, applies its
base migration, then loads the current read-only function/trigger definitions
captured for this repair. `current-helpers.sql` contains trusted metadata, not
customer records. `expand-fixture.py` resolves relative psql includes locally
before streaming SQL into the container.

The runner verifies three distinct sets:

- **100 new SQL checks** cover no backfill, unchanged RLS/grants, current-member
  editor access, anonymous/viewer/foreign/revoked denial, effective-name CAS and
  retries, input bounds/reset, exact physical aliases, manual bridge fallback,
  provider refresh preservation, and atomic batch validation/rollback.
- **Eight two-session cases** in `concurrency.py` exercise manual and bank CAS,
  both row/advisory lock orders, same-observation stale refresh after a reset,
  reconnect inheritance, membership revocation while waiting, and concurrent
  reviewed batch conflicts. These use real PostgreSQL sessions and locks.
- **177 prior financial checks** run in a separate database, after applying the
  new migration as well as the base migration. This guards existing financial
  RPCs against the new provider-name triggers. The prior fixture files are not
  edited, and their mutations cannot affect the new test setup.

## Naming and lock boundaries

`rename_forecast_account` changes only `accounts.name` and/or
`plaid_accounts.display_name`. A valid explicit manual-bank bridge also receives
the effective name, so fallback after disconnection remains consistent. A
manual fallback can synchronize one provable inactive physical lineage;
ambiguous/type/currency/link conflicts are rejected. Balances, observation
`updated_at`, IDs, masks, types and household starting balances are never part of
the name update.

A household-scoped name advisory lock is acquired **before** the existing
identity helper takes any manual `FOR SHARE` lock. Bank aliases are row-locked
in stable order and revalidated after a wait. `BEFORE INSERT` takes the same
household lock before peer inheritance/`ON CONFLICT` row locking. Provider
`UPDATE` uses its existing row lock and **never** takes that advisory lock.
The production sync callsite currently submits one row per upsert, with one
fixed household per request; it does not issue multi-household SQL inserts.

The provider `UPDATE OF` trigger preserves `OLD.display_name` even when
observation values are unchanged, so a stale API index cannot undo a rename or
resurrect a reset. Name-only RPC updates do not fire that trigger. Inserted bank
rows inherit only a current same-household, exact-persistent, compatible cash
peer override, including explicit NULL. For a truly new physical account the
API's stale index echo is cleared; no nickname is inferred by name or mask.

## Batch boundary

The new invoker batch wrapper accepts 1–100 distinct plan rows and exactly one
compatible routing field per row. Actual transactions, paired Savings
contribution decisions, finished decisions, closed buckets and Savings progress
milestones are rejected. It validates closed payload keys/types, then calls the
existing scoped row CAS helper in stable order within one transaction. Any
conflict rejects the entire batch; no amount/history field is accepted. Future
eligibility comes from the app's canonical cash-event coverage, not a guessed
server recurrence or an automatic assignment.
