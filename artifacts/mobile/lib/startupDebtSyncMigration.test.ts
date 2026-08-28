import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260827235209_optimize_startup_debt_sync.sql"),
  "utf8",
).toLowerCase();
const plaidScopeMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260825055642_backfill_and_lock_plaid_households.sql"),
  "utf8",
).toLowerCase();

const recalculate = migration.slice(
  migration.indexOf("create or replace function public.recalculate_debt_minimum_boosts"),
  migration.indexOf("do $sync_dependency_audit$"),
);
const sync = migration.slice(
  migration.indexOf("create function public.sync_due_debt_transactions"),
  migration.indexOf("do $startup_debt_acl_audit$"),
);

test("startup pending Plaid reads use one reachable partial household index", () => {
  assert.match(
    migration,
    /create index if not exists plaid_transactions_household_active_pending_date_idx[\s\S]+on public\.plaid_transactions \(household_id, transaction_date desc\)[\s\S]+where pending is true and removed_at is null/,
  );
  assert.match(
    plaidScopeMigration,
    /alter table public\.plaid_transactions[\s\S]+alter column household_id set not null/,
  );
  assert.doesNotMatch(
    migration,
    /create index[^;]+on public\.plaid_transactions \(user_id, transaction_date desc\)[^;]+pending/,
  );
});

test("debt boost recalculation performs one desired-value update and skips no-ops", () => {
  assert.equal((recalculate.match(/update public\.bills/g) ?? []).length, 1);
  assert.match(
    recalculate,
    /set snowball_minimum_boost = case[\s\S]+id = v_target_id and v_freed_minimum > 0[\s\S]+else 0[\s\S]+snowball_minimum_boost is distinct from case/,
  );
  assert.match(recalculate, /order by[\s\S]+avalanche[\s\S]+balance asc[\s\S]+snowball[\s\S]+id asc/);
  assert.match(recalculate, /security invoker[\s\S]+set search_path = ''/);
});

test("debt sync preserves financial eligibility and skips unchanged transaction writes", () => {
  assert.match(sync, /deleted_at is null[\s\S]+removed_at is null[\s\S]+not coalesce\(transaction_row\.pending, false\)/);
  assert.match(sync, /jsonb_array_elements[\s\S]+review_allocations[\s\S]+extra_principal/);
  assert.match(sync, /coalesce\(v_tx\.source, ''\) <> 'snowball_plan'/);
  assert.match(sync, /for update/);
  assert.match(
    sync,
    /set debt_applied_amount = v_desired,[\s\S]+debt_applied_bill_id = v_target_bill_id[\s\S]+debt_applied_amount is distinct from v_desired[\s\S]+debt_applied_bill_id is distinct from v_target_bill_id/,
  );
  assert.match(sync, /perform public\.recalculate_debt_minimum_boosts\(p_household_id\)/);
});

test("debt sync reports every durable relink, stale-link, and boost-only effect", () => {
  assert.match(
    sync,
    /debt_applied_bill_id is distinct from v_tx\.linked_bill_id[\s\S]+set balance = balance \+ v_tx\.debt_applied_amount[\s\S]+returning id into v_changed_id[\s\S]+v_changed_bill_ids := pg_catalog\.array_append/,
  );
  assert.equal(
    (sync.match(/set linked_bill_id = null,[\s\S]{0,180}debt_applied_bill_id = null/g) ?? []).length,
    2,
  );
  assert.match(
    sync,
    /v_boosts_before jsonb[\s\S]+jsonb_object_agg\(bill\.id, bill\.snowball_minimum_boost\)[\s\S]+is distinct from bill\.snowball_minimum_boost/,
  );
  assert.match(
    sync,
    /v_changed_bill_ids := v_changed_bill_ids \|\| v_boost_changed_bill_ids/,
  );
});

test("debt sync returns exact changed ids while old callers can ignore the response", () => {
  assert.match(migration, /drop function if exists public\.sync_due_debt_transactions\(date, uuid\)/);
  assert.match(sync, /returns jsonb[\s\S]+security invoker[\s\S]+set search_path = ''/);
  assert.match(sync, /v_changed_transaction_ids text\[\][\s\S]+v_changed_bill_ids text\[\]/);
  assert.match(sync, /array_agg\(distinct changed_id order by changed_id\)/);
  assert.match(
    sync,
    /jsonb_build_object\([\s\S]+'changed'[\s\S]+'changed_transaction_ids'[\s\S]+'changed_bill_ids'/,
  );
  assert.match(migration, /sync_dependency_audit[\s\S]+pg_catalog\.pg_depend[\s\S]+to_regprocedure/);
});

test("debt sync is authenticated-only and self-audits its role boundary", () => {
  assert.match(
    migration,
    /revoke all on function public\.sync_due_debt_transactions\(date, uuid\)[\s\S]+from public, anon, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.sync_due_debt_transactions\(date, uuid\)[\s\S]+to authenticated/,
  );
  assert.match(
    migration,
    /do \$startup_debt_acl_audit\$[\s\S]+has_function_privilege[\s\S]+sync_due_debt_transactions role grants are invalid/,
  );
  assert.doesNotMatch(sync, /security definer/);
});
