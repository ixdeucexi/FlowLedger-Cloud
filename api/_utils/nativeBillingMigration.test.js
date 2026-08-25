const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "../../supabase/migrations/20260822224633_native_billing_plaid_push.sql",
  ),
  "utf8",
);

test("native billing tables are service-only and replay-safe", () => {
  for (const table of [
    "billing_purchase_intents",
    "billing_purchase_bindings",
    "billing_entitlements",
    "billing_events",
    "billing_sandbox_testers",
    "native_push_devices",
    "native_push_receipts",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on (?:table )?public\\.${table} from public, anon, authenticated`,
        "i",
      ),
    );
  }
  assert.match(migration, /unique \(provider, provider_event_id\)/i);
  assert.match(migration, /unique \(provider, original_transaction_id\)/i);
  assert.match(
    migration,
    /where public\.billing_events\.processing_status = 'retryable'/i,
  );
  assert.match(migration, /set processing_status = 'retryable'/i);
});

test("service wrappers keep privileged billing logic private and transfers revoke without rebinding", () => {
  assert.match(migration, /function private\.apply_revenuecat_billing_event/i);
  assert.match(
    migration,
    /function public\.apply_revenuecat_billing_event[\s\S]*security invoker/i,
  );
  assert.match(migration, /original_transaction_id like 'restore-owner:%'/i);
  assert.doesNotMatch(migration, /restore:\$\{store\}:\$\{transactionId\}/i);
  assert.match(
    migration,
    /function private\.apply_revenuecat_billing_transfer/i,
  );
  assert.match(migration, /set status = 'revoked'/i);
  assert.match(migration, /and environment = p_environment/i);
  assert.match(migration, /Transfer is older than current entitlement state/i);
  assert.match(migration, /entitlement\.last_event_at = p_event_at/i);
  assert.match(migration, /and plan\.source = 'billing'/i);
  assert.doesNotMatch(migration, /transferred_to/);
});

test("billing and device cascade keys have supporting indexes", () => {
  for (const name of [
    "billing_purchase_intents_household_fk_idx",
    "billing_purchase_intents_app_user_fk_idx",
    "billing_purchase_bindings_household_fk_idx",
    "billing_purchase_bindings_app_user_fk_idx",
    "billing_purchase_bindings_intent_fk_idx",
    "billing_entitlements_purchaser_fk_idx",
    "billing_entitlements_app_user_fk_idx",
    "native_push_devices_household_fk_idx",
  ]) {
    assert.match(migration, new RegExp(`create index ${name}`, "i"));
  }
});

test("the atomic event function binds purchaser, product, intent and household", () => {
  assert.match(migration, /where user_id = p_app_user_id/i);
  assert.match(migration, /and app_user_id = p_app_user_id/i);
  assert.match(migration, /and product_id = p_product_id/i);
  assert.match(migration, /v_intent\.household_id/i);
  assert.match(migration, /v_binding\.purchaser_user_id <> p_app_user_id/i);
  assert.match(
    migration,
    /Purchaser identity does not own the original transaction binding/i,
  );
  assert.match(migration, /billing_purchase_intents_one_purchasing_idx/i);
  assert.match(migration, /and status = 'purchasing'/i);
});

test("grace remains Pro while terminal events only downgrade the matching billing household", () => {
  assert.match(migration, /p_status in \('active', 'grace', 'cancelled'\)/i);
  assert.match(migration, /p_status in \('expired', 'refunded', 'revoked'\)/i);
  assert.match(migration, /plan\.source = 'billing'/i);
  assert.match(migration, /plan\.household_id = v_binding\.household_id/i);
  assert.match(migration, /and source in \('default', 'billing'\)/i);
});
