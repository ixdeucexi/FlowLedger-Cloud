import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260827121836_atomic_financial_mutations.sql"),
  "utf8",
).toLowerCase();

test("subscription candidates are explicitly exposed behind household RLS", () => {
  assert.match(migration, /create table public\.subscription_candidates/);
  assert.match(migration, /alter table public\.subscription_candidates enable row level security/);
  assert.match(migration, /subscription candidates: household members read[\s\S]+private\.is_household_member\(household_id\)/);
  assert.match(migration, /subscription candidates: household editors (?:insert|update)[\s\S]+private\.is_household_editor\(household_id\)/);
  assert.match(migration, /revoke all on table public\.subscription_candidates from public, anon/);
  assert.match(migration, /grant select, insert, update, delete on table public\.subscription_candidates[\s\S]+authenticated, service_role/);
  assert.match(migration, /subscription_candidates_household_status_idx/);
  assert.match(
    migration,
    /foreign key \(household_id, user_id\)[\s\S]+references public\.household_members\(household_id, user_id\)[\s\S]+on delete set null \(user_id\)[\s\S]+deferrable initially deferred/,
  );
  assert.match(migration, /subscription_candidates_household_user_idx[\s\S]+\(household_id, user_id\)/);
  assert.match(migration, /new\.user_id is distinct from old\.user_id[\s\S]+new\.user_id is not null/);
  assert.match(
    migration,
    /tg_op = 'insert'[\s\S]+new\.source_transaction_ids is distinct from old\.source_transaction_ids[\s\S]+subscription sources must belong to this household/,
  );
  assert.match(
    migration,
    /tg_op = 'insert'[\s\S]+new\.bill_id is distinct from old\.bill_id[\s\S]+subscription bill must belong to this household/,
  );
  assert.match(migration, /auth\.jwt\(\) ->> 'role'[\s\S]+service_role/);
  assert.match(migration, /\\m\(pos\|debit\|card\|purchase\|payment\|inc\|llc\|co\)\\m/i);
  assert.match(migration, /do \$acl_audit\$[\s\S]+has_function_privilege/);
});

test("compound financial actions use private definers and narrow public wrappers", () => {
  for (const name of ["fund_goal", "create_subscription_bill", "create_bill_and_reconcile_transaction", "complete_decision"]) {
    assert.match(migration, new RegExp(`create or replace function private\\.${name}\\([\\s\\S]+security definer[\\s\\S]+set search_path = ''`));
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]+security invoker[\\s\\S]+set search_path = ''`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]+from public, anon`));
  }
  assert.doesNotMatch(migration, /auth\.role\(\)/);
});

test("goal funding is compare-and-set and retry safe", () => {
  const goal = migration.slice(migration.indexOf("create or replace function private.fund_goal"), migration.indexOf("create or replace function public.fund_goal"));
  assert.match(goal, /from public\.goals[\s\S]+for update/);
  assert.match(goal, /where id = p_transaction_id for update/);
  assert.match(goal, /this goal changed\. refresh and try again/);
  assert.match(goal, /contribution exceeds the amount left on this goal/);
  assert.match(goal, /p_date::text, -v_applied/);
  assert.match(goal, /'retry', true/);
  assert.ok(goal.indexOf("update public.goals") < goal.indexOf("insert into public.transactions"));
});

test("subscription and forgotten-bill creation are atomic and idempotent", () => {
  const subscription = migration.slice(migration.indexOf("create or replace function private.create_subscription_bill"), migration.indexOf("create or replace function public.create_subscription_bill"));
  assert.match(subscription, /from public\.subscription_candidates[\s\S]+for update/);
  assert.match(subscription, /pg_advisory_xact_lock/);
  assert.match(subscription, /insert into public\.bills/);
  assert.match(subscription, /insert into public\.subscription_candidates/);
  assert.match(subscription, /insert into public\.subscription_bill_links/);
  assert.match(subscription, /hashtextextended\(p_household_id::text \|\| ':' \|\| v_key, 1\)/);
  assert.match(subscription, /from public\.subscription_bill_links[\s\S]+for update/);
  assert.match(subscription, /already linked to an existing bill/);
  assert.doesNotMatch(subscription, /on conflict \(household_id, merchant_key\) do update/);
  assert.match(subscription, /round\(p_amount, 2\) <= 0/);
  assert.match(subscription, /'retry', true/);

  const forgotten = migration.slice(migration.indexOf("create or replace function private.create_bill_and_reconcile_transaction"), migration.indexOf("create or replace function public.create_bill_and_reconcile_transaction"));
  assert.match(forgotten, /'review-bill-' \|\| md5/);
  assert.match(forgotten, /from public\.transactions[\s\S]+for update/);
  assert.match(forgotten, /private\.reconcile_transaction\(/);
  assert.match(forgotten, /round\(v_amount, 2\) <= 0/);
  assert.match(forgotten, /'retry', true/);
});

test("decision completion locks its decision and stores one applied result", () => {
  const decision = migration.slice(migration.indexOf("create or replace function private.complete_decision"), migration.indexOf("create or replace function public.complete_decision"));
  assert.match(decision, /from public\.decisions[\s\S]+for update/);
  assert.match(decision, /if v_decision\.status = 'completed'/);
  assert.match(decision, /requestfingerprint/);
  assert.match(decision, /savings contribution exceeds the amount left on this goal/);
  assert.match(decision, /round\(p_actual_amount, 2\) <= 0/);
  assert.match(decision, /'retry', true/);
  assert.match(decision, /update public\.decisions set[\s\S]+status = 'completed'/);
  assert.match(decision, /public\.apply_debt_snowball_payment\(/);
});

test("clients call atomic RPCs instead of sequential durable writes", () => {
  const more = readFileSync(resolve(process.cwd(), "app/(tabs)/more.tsx"), "utf8");
  const review = readFileSync(resolve(process.cwd(), "components/ReviewCenter.tsx"), "utf8");
  const due = readFileSync(resolve(process.cwd(), "components/DecisionDueModal.tsx"), "utf8");
  const contracts = readFileSync(resolve(process.cwd(), "lib/atomicFinancialMutations.ts"), "utf8");
  assert.match(contracts, /rpc\("create_subscription_bill"/);
  assert.match(contracts, /rpc\("fund_goal"/);
  assert.match(contracts, /"create_bill_and_reconcile_transaction"/);
  assert.match(contracts, /rpc\("complete_decision"/);
  assert.match(contracts, /function finiteMoney/);
  assert.match(contracts, /function dateOnly/);
  assert.match(contracts, /could not be verified/);
  assert.match(more, /createSubscriptionBillAtomically\(/);
  assert.match(more, /!linkedBillId \? \([\s\S]+Create bill/);
  assert.match(more, /fundGoalAtomically\(/);
  assert.match(review, /createForgottenBillAndReconcile\(/);
  assert.match(review, /adjacentBillMatchCandidates\(/);
  assert.match(review, /assertFinancialMutationOnline\(\)[\s\S]*createForgottenBillAndReconcile/);
  assert.match(due, /completeDecisionAtomically\(/);
  assert.doesNotMatch(review.slice(review.indexOf("const saveForgottenBill"), review.indexOf("const resolveTarget")), /deleteBillMistake|await addBill/);
});
