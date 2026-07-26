const assert = require("node:assert/strict");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const migrationsDir = path.join(__dirname, "../../supabase/migrations");

const repairedVersions = {
  bill_date_moves_household_conflict: "20260708053317",
  pro_review_center_reconciliation: "20260715051149",
  reconciliation_advisor_indexes: "20260715051338",
  queue_current_month_posted_plaid_transactions: "20260715053956",
  index_transaction_reviewer: "20260715054400",
  add_planning_mode: "20260715084111",
  flo_basic_pro_chat: "20260715084113",
  flo_chat_advisor_cleanup: "20260715084353",
  collapse_plaid_mirrors_after_review: "20260715113446",
  sync_paid_date_with_bill_move: "20260715173141",
  independent_planning_tools: "20260715223631",
  web_push_notifications: "20260715230411",
  push_notification_event_foreign_key_index: "20260715230459",
  align_snowball_active_targets: "20260717020853",
  add_bill_importance_and_consolidate_household_rls: "20260717171611",
  consolidate_household_core_rls: "20260717171757",
  add_transaction_recycle_bin: "20260720041919",
  add_spending_bucket_closed_state: "20260720051041",
  leave_household: "20260720053952",
  allow_members_leave_personal_household: "20260720054113",
  stabilize_monthly_reconciliation_audit: "20260720065731",
  exclude_single_income_occurrence: "20260723062723",
  reschedule_snowball_plan_across_months: "20260724153744",
};

test("migration versions are unique and repaired names match production history", async () => {
  const files = (await readdir(migrationsDir)).filter(file => file.endsWith(".sql"));
  const versions = files.map(file => file.split("_", 1)[0]);

  assert.equal(new Set(versions).size, versions.length);

  for (const [name, version] of Object.entries(repairedVersions)) {
    assert.ok(
      files.includes(`${version}_${name}.sql`),
      `missing repaired migration ${version}_${name}.sql`,
    );
  }

  assert.ok(files.includes("20260624060442_phase1_accounts.sql"));
  assert.ok(files.includes("20260624063523_phase2_decisions.sql"));
  assert.ok(files.includes("20260624134256_flo_foundation.sql"));
});

test("the production Plaid migrations are present with their security boundary", async () => {
  const foundation = await readFile(
    path.join(migrationsDir, "20260710051331_plaid_live_import_text_links.sql"),
    "utf8",
  );
  const hardening = await readFile(
    path.join(migrationsDir, "20260710173518_secure_plaid_react_link.sql"),
    "utf8",
  );

  assert.match(foundation, /create table if not exists public\.plaid_items/i);
  assert.match(foundation, /create table if not exists public\.plaid_transactions/i);
  assert.match(hardening, /encrypted_access_token text/i);
  assert.match(
    hardening,
    /revoke all on table public\.plaid_items from anon, authenticated/i,
  );
  assert.match(
    hardening,
    /grant select \([\s\S]*\) on public\.plaid_items to authenticated/i,
  );
});

test("advisor hardening keeps exposed RPCs invoker-only and server tables denied", async () => {
  const migration = await readFile(
    path.join(migrationsDir, "20260724124514_harden_advisor_boundaries.sql"),
    "utf8",
  );

  assert.match(migration, /alter function public\.%I\(%s\) set schema private/i);
  assert.match(
    migration,
    /create or replace function public\.reconcile_transaction[\s\S]*security invoker/i,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.[\s\S]*security definer/i,
  );
  assert.match(
    migration,
    /create policy "push subscriptions: deny client access"[\s\S]*using \(false\)[\s\S]*with check \(false\)/i,
  );
  assert.match(
    migration,
    /create policy "push events: deny client access"[\s\S]*using \(false\)[\s\S]*with check \(false\)/i,
  );
  assert.match(
    migration,
    /create policy "notification preferences: deny client access"[\s\S]*using \(false\)[\s\S]*with check \(false\)/i,
  );
  assert.match(
    migration,
    /create index if not exists goals_archived_by_idx[\s\S]*on public\.goals \(archived_by\)/i,
  );
});

test("transfer foundation restores the missing grouping key and lookup index", async () => {
  const migration = await readFile(
    path.join(migrationsDir, "20260630190000_transfer_foundation.sql"),
    "utf8",
  );

  assert.match(
    migration,
    /add column if not exists transfer_group_id text/i,
  );
  assert.match(
    migration,
    /create index if not exists transactions_user_transfer_group_idx[\s\S]*on transactions\(user_id, transfer_group_id\)/i,
  );
});

test("partial scheduled Snowball reconciliation keeps one canonical remainder", async () => {
  const migration = await readFile(
    path.join(migrationsDir, "20260726075743_keep_partial_snowball_plan_exactly_once.sql"),
    "utf8",
  );

  assert.match(
    migration,
    /v_remaining := case[\s\S]*when v_scheduled_plan\.id is not null then v_plan_amount/i,
  );
  assert.match(
    migration,
    /'scheduledPlanOriginalAmount', v_plan_original_amount/i,
  );
  assert.match(
    migration,
    /set amount = -round\(greatest\(0, v_remaining - v_primary\), 2\),[\s\S]*removed_at = null/i,
  );
  assert.match(
    migration,
    /coalesce\(sum\(\(item ->> 'amount'\)::numeric\), 0\)[\s\S]*reconciliation\.transaction_id <> old\.transaction_id/i,
  );
  assert.match(
    migration,
    /set amount = -round\(v_plan_remaining, 2\),[\s\S]*removed_at = null/i,
  );
  assert.match(
    migration,
    /update public\.transactions plan[\s\S]*source = 'snowball_plan'[\s\S]*removed_at is null/i,
  );
  assert.match(
    migration,
    /security definer[\s\S]*set search_path = ''/i,
  );
});
