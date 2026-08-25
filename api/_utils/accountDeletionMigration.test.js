const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const retentionMigration = fs.readFileSync(
  path.join(
    __dirname,
    "../../supabase/migrations/20260825094550_preserve_shared_plan_after_member_exit.sql",
  ),
  "utf8",
);
const migration = retentionMigration;

test("manager editor and viewer deletion preserves only explicit shared plan ownership columns", () => {
  assert.match(migration, /Shared financial rows belong to the household/);
  assert.match(migration, /\('bills', 'user_id'\)/);
  assert.match(migration, /\('transactions', 'user_id'\)/);
  assert.match(migration, /\('transaction_reconciliations', 'user_id'\)/);
  assert.match(migration, /\('subscription_bill_links', 'user_id'\)/);
  const allowlist = migration.slice(
    migration.indexOf("select * from (values"),
    migration.indexOf(") as allowed"),
  );
  assert.doesNotMatch(
    allowlist,
    /plaid_items|pending_plan_matches|reviewed_by|created_by/,
  );
  assert.match(
    migration,
    /case survivor\.role when 'owner' then 0 when 'manager' then 1 when 'editor' then 2 else 3 end/,
  );
  assert.match(migration, /sharedRowsPreserved/);
});

test("deleting a shared-household purchaser cannot leave orphaned billing Pro access", () => {
  assert.match(migration, /to_regclass\('public\.billing_purchase_bindings'\)/);
  assert.match(migration, /update public\.household_plans plan/);
  assert.match(migration, /plan\.source = 'billing'/);
  assert.match(migration, /departing\.purchaser_user_id = \$1/);
  assert.match(migration, /binding\.purchaser_user_id <> \$1/);
  assert.match(
    migration,
    /entitlement\.status in \('active', 'grace', 'cancelled'\)/,
  );
  assert.doesNotMatch(
    migration,
    /where plan\.source in \('billing', 'admin', 'grandfathered'\)/,
  );
});

test("trusted lifecycle transfer can change only the owner field of a shared subscription link", () => {
  const validator = migration.slice(
    migration.indexOf(
      "create or replace function private.validate_subscription_bill_link",
    ),
    migration.indexOf("-- Reviewer attribution"),
  );
  assert.match(validator, /v_owner_transfer := current_user = 'postgres'/);
  assert.match(
    validator,
    /current_setting\('flowledger\.shared_plan_owner_transfer', true\) = 'on'/,
  );
  assert.match(validator, /tg_op = 'UPDATE'/);
  assert.match(validator, /new\.user_id is distinct from old\.user_id/);
  assert.match(
    validator,
    /new\.household_id is not distinct from old\.household_id/,
  );
  assert.match(validator, /new\.bill_id is not distinct from old\.bill_id/);
  assert.match(validator, /public\.household_members member/);
  assert.match(
    validator,
    /member\.household_id = new\.household_id[\s\S]*member\.user_id = new\.user_id/,
  );
  assert.match(
    validator,
    /if not v_owner_transfer and new\.user_id is distinct from \(select auth\.uid\(\)\)/,
  );
  assert.match(
    validator,
    /if not v_owner_transfer and not exists \([\s\S]*bill\.id = new\.bill_id[\s\S]*bill\.household_id = new\.household_id/,
  );
});

test("an ended linked bill cannot block a field-preserving deletion transfer", () => {
  const validator = migration.slice(
    migration.indexOf(
      "create or replace function private.validate_subscription_bill_link",
    ),
    migration.indexOf("-- Reviewer attribution"),
  );
  assert.match(validator, /if not v_owner_transfer and not exists/);
  assert.match(
    validator,
    /bill\.end_date is null or bill\.end_date >= current_date::text/,
  );
});

test("shared reconciliation reviewer attribution is anonymized, never reassigned", () => {
  assert.match(migration, /alter column reviewed_by drop not null/);
  assert.match(
    migration,
    /foreign key \(reviewed_by\) references auth\.users\(id\) on delete set null/,
  );
});

test("personal rows are deleted only after shared attribution no longer references the departing Auth user", () => {
  const prepare = migration.slice(
    migration.indexOf(
      "create or replace function private.prepare_account_deletion",
    ),
  );
  const preserve = prepare.indexOf("private.reassign_shared_plan_ownership");
  const cleanup = prepare.indexOf("for v_fk in");
  assert.ok(preserve > 0 && cleanup > preserve);
  assert.match(
    migration,
    /update public\.%I set %I = \$1 where %I = \$2 and household_id = \$3/,
  );
  assert.match(prepare.slice(cleanup), /delete from %I\.%I where %I = \$1/);
  assert.match(prepare, /confdeltype in \('c', 'r'\)/);
});

test("leaving and member removal transfer shared plan ownership before membership deletion", () => {
  assert.match(
    retentionMigration,
    /drop policy if exists "members: owners delete" on public\.household_members/,
  );
  assert.match(
    retentionMigration,
    /revoke delete on table public\.household_members from anon, authenticated/,
  );
  assert.match(
    retentionMigration,
    /create or replace function private\.reassign_shared_plan_ownership/,
  );
  for (const functionName of ["leave_household", "remove_household_member"]) {
    const start = retentionMigration.indexOf(
      `create or replace function private.${functionName}`,
    );
    assert.ok(start >= 0, `missing ${functionName}`);
    const body = retentionMigration.slice(
      start,
      retentionMigration.indexOf("$$;", start) + 3,
    );
    assert.ok(
      body.indexOf("private.reassign_shared_plan_ownership") <
        body.indexOf("delete from public.household_members"),
      `${functionName} must transfer before membership deletion`,
    );
  }
});

test("account deletion preserves former-member household rows without changing audit identities", () => {
  const prepare = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.prepare_account_deletion",
    ),
  );
  assert.match(
    prepare,
    /select household_id from public\.bills where user_id = p_user_id/,
  );
  assert.match(
    prepare,
    /select household_id from public\.categories where user_id = p_user_id/,
  );
  assert.match(prepare, /private\.reassign_shared_plan_ownership/);
  const allowlist = retentionMigration.slice(
    retentionMigration.indexOf("select * from (values"),
    retentionMigration.indexOf(") as allowed"),
  );
  assert.doesNotMatch(
    allowlist,
    /plaid_items|pending_plan_matches|reviewed_by|created_by/,
  );
  assert.match(
    retentionMigration,
    /foreign key \(reviewed_by\) references auth\.users\(id\) on delete set null/,
  );
});

test("technical owner transfer bypasses only field-preserving protected-row updates", () => {
  assert.match(
    retentionMigration,
    /v_owner_transfer := current_user = 'postgres'/,
  );
  assert.match(
    retentionMigration,
    /new\.bill_id is not distinct from old\.bill_id/,
  );
  assert.match(retentionMigration, /not v_owner_transfer and not exists/);
  assert.match(
    retentionMigration,
    /new\.user_id is distinct from old\.user_id[\s\S]+row\([\s\S]+\) is not distinct from row\(/,
  );
  assert.match(
    retentionMigration,
    /member\.household_id = old\.household_id[\s\S]+member\.user_id = new\.user_id/,
  );
  const routedGuard = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.guard_routed_bucket_progress",
    ),
    retentionMigration.indexOf("-- Reviewer attribution"),
  );
  assert.match(
    routedGuard,
    /current_setting\('flowledger\.shared_plan_owner_transfer', true\) = 'on'/,
  );
  assert.match(
    routedGuard,
    /new\.id[\s\S]*new\.created_at[\s\S]*old\.id[\s\S]*old\.created_at/,
  );
});

test("shared ownership uses household-scoped uniqueness before technical transfer", () => {
  assert.match(
    retentionMigration,
    /extra payment ownership uniqueness preflight failed/,
  );
  assert.match(
    retentionMigration,
    /transaction import ownership uniqueness preflight failed/,
  );
  assert.match(
    retentionMigration,
    /extra_payments_household_budget_month_year_idx/,
  );
  assert.match(
    retentionMigration,
    /extra_payments_user_month_year_idx[\s\S]+where household_id is null/,
  );
  assert.match(retentionMigration, /transactions_household_import_hash_unique/);
  assert.match(
    retentionMigration,
    /transactions_user_import_hash_unique[\s\S]+where household_id is null and import_hash is not null/,
  );
});

test("member exit is fail-closed for connected Plaid items and concurrent shared writes", () => {
  assert.match(
    retentionMigration,
    /create or replace function private\.prepare_member_exit_dependencies/,
  );
  assert.match(
    retentionMigration,
    /household_member_plaid_disconnect_required/,
  );
  for (const functionName of ["leave_household", "remove_household_member"]) {
    const start = retentionMigration.indexOf(
      `create or replace function private.${functionName}`,
    );
    const body = retentionMigration.slice(
      start,
      retentionMigration.indexOf("$$;", start) + 3,
    );
    assert.ok(
      body.indexOf("private.prepare_member_exit_dependencies") <
        body.indexOf("delete from public.household_members"),
      `${functionName} must block connected Plaid before deleting membership`,
    );
  }
  assert.match(
    retentionMigration,
    /foreign key \(household_id, user_id\)[\s\S]*references public\.household_members\(household_id, user_id\)[\s\S]*deferrable initially deferred/,
  );
  assert.match(retentionMigration, /shared_plan_orphan_without_survivor/);
  assert.match(
    retentionMigration,
    /plaid_items_household_member_owner_fkey[\s\S]*foreign key \(household_id, user_id\)[\s\S]*references public\.household_members/,
  );
  assert.match(
    retentionMigration,
    /item\.status = 'removed'[\s\S]*item\.encrypted_access_token is null[\s\S]*item\.access_token_ciphertext is null/,
  );
});

test("active purchaser exit and concurrent billing completion fail closed", () => {
  assert.match(
    retentionMigration,
    /household_member_billing_management_required/,
  );
  assert.match(
    retentionMigration,
    /binding\.purchaser_user_id = p_user_id[\s\S]*and binding\.active/,
  );
  assert.match(
    retentionMigration,
    /intent\.status in \('confirmed', 'purchasing'\)[\s\S]*intent\.expires_at > now\(\)/,
  );
  const intentGuard = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.guard_billing_intent_membership",
    ),
    retentionMigration.indexOf(
      "create or replace function private.guard_billing_binding_membership",
    ),
  );
  assert.match(intentGuard, /pg_advisory_xact_lock/);
  assert.match(intentGuard, /billing_intent_membership_required/);
  assert.match(
    intentGuard,
    /before insert or update\s+on public\.billing_purchase_intents/,
  );
  const guard = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.guard_billing_binding_membership",
    ),
    retentionMigration.indexOf(
      "create or replace function private.prepare_member_exit_dependencies",
    ),
  );
  assert.match(guard, /pg_advisory_xact_lock/);
  assert.match(guard, /billing_purchaser_membership_required/);
  assert.match(guard, /if new\.active is true and not exists/);
  assert.match(guard, /old\.household_id is distinct from new\.household_id/);
  assert.match(guard, /order by household_id/);
  assert.match(
    guard,
    /before insert or update\s+on public\.billing_purchase_bindings/,
  );
});

test("technical ownership maintenance does not flood member activity", () => {
  assert.match(
    retentionMigration,
    /current_setting\('flowledger\.shared_plan_owner_transfer', true\) = 'on'/,
  );
  assert.match(
    retentionMigration,
    /set_config\('flowledger\.shared_plan_owner_transfer', 'on', true\)/,
  );
  assert.match(retentionMigration, /coalesce\(v_prior_transfer_flag, ''\)/);
  assert.match(
    retentionMigration,
    /perform public\.log_household_activity\([\s\S]*?'left'[\s\S]*?v_actor[\s\S]*?\)/,
  );
  assert.match(
    retentionMigration,
    /v_target_label[\s\S]*?perform public\.log_household_activity\([\s\S]*?'removed'[\s\S]*?v_target_label/,
  );
});

test("an absent household creator with one survivor must transfer ownership before Auth deletion", () => {
  const inspect = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.inspect_account_deletion",
    ),
    retentionMigration.indexOf("-- Replace the older deletion implementation"),
  );
  const prepare = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.prepare_account_deletion",
    ),
  );
  for (const body of [inspect, prepare]) {
    assert.match(body, /household\.created_by = p_user_id/);
    assert.match(body, /survivor\.user_id <> p_user_id/);
    assert.doesNotMatch(body, /having count\([^)]*\) > 1/);
  }
  assert.match(prepare, /account_deletion_owner_transfer_required/);
  assert.match(prepare, /order by owned\.household_id/);
});

test("a pending Auth deletion reruns cleanup without creating a second receipt", () => {
  const prepare = retentionMigration.slice(
    retentionMigration.indexOf(
      "create or replace function private.prepare_account_deletion",
    ),
    retentionMigration.indexOf(
      "revoke all on function private.prepare_account_deletion",
    ),
  );
  assert.match(prepare, /where user_id_hash = v_hash\s+for update/);
  assert.match(
    prepare,
    /if found and v_receipt\.auth_deleted_at is not null then/,
  );
  assert.doesNotMatch(prepare, /if found then\s+return jsonb_build_object/);
  assert.match(prepare, /if v_receipt\.receipt_id is null then\s+insert into/);
  assert.match(
    prepare,
    /else\s+update private\.account_deletion_receipts receipt/,
  );
  assert.match(
    prepare,
    /memberships_removed = receipt\.memberships_removed \+ v_membership_count/,
  );
  assert.match(
    prepare,
    /plaid_items_revoked =\s*receipt\.plaid_items_revoked \+ coalesce\(p_plaid_items_revoked, 0\)/,
  );
  assert.equal(
    (prepare.match(/insert into private\.account_deletion_receipts/g) ?? [])
      .length,
    1,
  );
});
