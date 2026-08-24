const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20260821123517_account_deletion_and_flo_rpc_hardening.sql"), "utf8");

test("manager editor and viewer deletion preserves only explicit shared plan ownership columns", () => {
  assert.match(migration, /Shared canonical plan rows belong to the household/);
  assert.match(migration, /\('bills', 'user_id'\)/);
  assert.match(migration, /\('transactions', 'user_id'\)/);
  assert.match(migration, /\('transaction_reconciliations', 'user_id'\)/);
  assert.match(migration, /\('subscription_bill_links', 'user_id'\)/);
  const allowlist = migration.slice(migration.indexOf("select * from (values"), migration.indexOf(") as allowed"));
  assert.doesNotMatch(allowlist, /plaid_items|pending_plan_matches|reviewed_by|created_by/);
  assert.match(migration, /case survivor\.role when 'owner' then 0 when 'manager' then 1 when 'editor' then 2 else 3 end/);
  assert.match(migration, /sharedRowsPreserved/);
});

test("deleting a shared-household purchaser cannot leave orphaned billing Pro access", () => {
  assert.match(migration, /to_regclass\('public\.billing_purchase_bindings'\)/);
  assert.match(migration, /update public\.household_plans plan/);
  assert.match(migration, /plan\.source = 'billing'/);
  assert.match(migration, /departing\.purchaser_user_id = \$1/);
  assert.match(migration, /binding\.purchaser_user_id <> \$1/);
  assert.match(migration, /entitlement\.status in \('active', 'grace', 'cancelled'\)/);
  assert.doesNotMatch(migration, /where plan\.source in \('billing', 'admin', 'grandfathered'\)/);
});

test("service deletion can transfer only the owner field of a shared subscription link", () => {
  const validator = migration.slice(migration.indexOf("create or replace function private.validate_subscription_bill_link"), migration.indexOf("-- Reconciliation remains"));
  assert.match(validator, /\(select auth\.role\(\)\) = 'service_role'/);
  assert.match(validator, /tg_op <> 'UPDATE'/);
  assert.match(validator, /new\.user_id is not distinct from old\.user_id/);
  assert.match(validator, /new\.household_id is distinct from old\.household_id/);
  assert.match(validator, /new\.bill_id is distinct from old\.bill_id/);
  assert.match(validator, /public\.household_members member/);
  assert.match(validator, /member\.household_id = new\.household_id and member\.user_id = new\.user_id/);
  assert.match(validator, /elsif new\.user_id is distinct from \(select auth\.uid\(\)\)/);
  assert.match(validator, /if not v_service_cleanup and not exists \([\s\S]*b\.id = new\.bill_id[\s\S]*b\.household_id = new\.household_id/);
});

test("an ended linked bill cannot block a field-preserving deletion transfer", () => {
  const validator = migration.slice(migration.indexOf("create or replace function private.validate_subscription_bill_link"), migration.indexOf("-- Reconciliation remains"));
  assert.match(validator, /if not v_service_cleanup and not exists/);
  assert.match(validator, /b\.end_date is null or b\.end_date >= current_date::text/);
});

test("shared reconciliation reviewer attribution is anonymized, never reassigned", () => {
  assert.match(migration, /alter column reviewed_by drop not null/);
  assert.match(migration, /foreign key \(reviewed_by\) references auth\.users\(id\) on delete set null/);
});

test("personal rows are deleted only after shared attribution no longer references the departing Auth user", () => {
  const preserve = migration.indexOf("Shared canonical plan rows belong to the household");
  const cleanup = migration.indexOf("Delete account-private and personal-household rows");
  assert.ok(preserve > 0 && cleanup > preserve);
  assert.match(migration.slice(preserve, cleanup), /update public\.%I set %I = \$1 where %I = \$2 and household_id = \$3/);
  assert.match(migration.slice(cleanup), /delete from %I\.%I where %I = \$1/);
  assert.match(migration, /confdeltype in \('c', 'r'\)/);
});
