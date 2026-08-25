import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(
  process.cwd(),
  "../../supabase/migrations/20260825080222_founding_free_review_center_entitlement.sql",
), "utf8").toLowerCase();

const targetSignatures = [
  "private.reconcile_transaction(text,text,text,date,numeric,text,text)",
  "private.reconcile_transaction_unlocked_v1(text,text,text,date,numeric,text,text)",
  "private.reconcile_snowball_transaction(text,text,date,numeric,text,text)",
  "private.reconcile_manual_transaction(text,text,date,numeric,text)",
  "private.undo_transaction_reconciliation(text)",
  "private.undo_manual_transaction_reconciliation(text)",
  "private.create_spending_bucket_for_transaction(text,text,text,numeric,date)",
  "private.close_spending_bucket_keep_available(text,numeric,numeric)",
  "private.close_spending_bucket_and_route_remainder(text,numeric,numeric,text,integer,integer,date,numeric,jsonb)",
  "private.reopen_spending_bucket_and_unroute_remainder(text,numeric,jsonb)",
] as const;

test("Founding Free Review Center is controlled by one private server-owned release flag", () => {
  assert.match(migration, /create table if not exists private\.release_feature_entitlements/);
  assert.match(migration, /alter table private\.release_feature_entitlements enable row level security/);
  assert.match(
    migration,
    /revoke all on table private\.release_feature_entitlements\s+from public, anon, authenticated, service_role/,
  );
  assert.match(migration, /values \('review_center', true\)\s+on conflict \(feature_key\) do nothing/);
  assert.match(migration, /create or replace function private\.has_review_center_entitlement\(p_household_id uuid\)/);
  assert.match(migration, /plan\.tier = 'pro'/);
  assert.match(migration, /plan\.tier = 'free'[\s\S]+entitlement\.feature_key = 'review_center'[\s\S]+entitlement\.free_enabled/);
  assert.match(
    migration,
    /revoke all on function private\.has_review_center_entitlement\(uuid\)\s+from public, anon, authenticated, service_role/,
  );
});

test("the release entitlement changes only the complete atomic Review Center RPC implementation set", () => {
  for (const signature of targetSignatures) {
    assert.equal(
      migration.split(`('${signature}',`).length - 1,
      1,
      `${signature} must be replaced exactly once`,
    );
  }
  assert.equal(
    (migration.match(/\('private\.[a-z0-9_]+\([^']+\)', 'v_(?:tx|goal)\.household_id'\)/g) ?? []).length,
    targetSignatures.length,
  );

  assert.match(migration, /function_oid := to_regprocedure\(target\.signature\)::oid/);
  assert.match(migration, /if function_oid is null then\s+raise exception 'required review center function is missing/);
  assert.match(migration, /if match_count <> 1 then\s+raise exception 'expected one legacy pro predicate/);
  assert.match(migration, /if helper_count <> 1 or match_count <> 0 then\s+raise exception 'review center entitlement replacement failed/);
});

test("Founding Free Review Center does not widen Plaid, billing, pending-match, or Plan Simulator access", () => {
  assert.doesNotMatch(migration, /update public\.household_plans/);
  assert.doesNotMatch(migration, /create_link_token|plaid_connections|plan_simulations|billing_subscriptions/);
  assert.doesNotMatch(migration, /create policy|alter policy|drop policy/);
  assert.doesNotMatch(migration, /grant execute on function private\.has_review_center_entitlement/);
  assert.match(migration, /pending plaid match policies also intentionally stay pro/);
});
