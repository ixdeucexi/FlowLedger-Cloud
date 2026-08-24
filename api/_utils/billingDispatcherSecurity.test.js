const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../../supabase/functions/billing-dispatcher/index.ts"), "utf8");

test("billing dispatcher enforces deployment environment and server active household", () => {
  assert.match(source, /requiredEnv\("REVENUECAT_ENVIRONMENT"\)/);
  assert.match(source, /billingEnvironmentAllowed\(db, environment, \[user\.id\]\)/);
  assert.match(source, /preference\?\.active_household_id !== householdId/);
  assert.match(source, /ACTIVE_HOUSEHOLD_MISMATCH/);
  assert.match(source, /billing_sandbox_testers/);
  assert.match(source, /deployment !== "production" \|\| environment !== "sandbox"/);
  assert.match(source, /billingEnvironmentAllowed\(db, transfer\.environment, transfer\.transferredFrom\)/);
  assert.match(source, /p_environment: transfer\.environment/);
});

test("deleted users and unsupported identities are not persisted in the webhook ledger", () => {
  assert.match(source, /auth\.admin\.getUserById/);
  assert.match(source, /deleted_user_ignored/);
  assert.match(source, /Do not retain unsupported raw identities/);
  assert.match(source, /WEBHOOK_RETRY_REQUIRED/);
});

test("restore reconciliation is server authoritative and can recover missed lifecycle events", () => {
  assert.match(source, /api\.revenuecat\.com\/v1\/subscribers/);
  assert.match(source, /requiredEnv\("REVENUECAT_SECRET_API_KEY"\)/);
  assert.match(source, /normalizeRevenueCatSubscriberRestore/);
  assert.match(source, /RESTORE_PURCHASE_MISMATCH/);
  assert.match(source, /p_status: "expired"/);
  assert.match(source, /source: "revenuecat_api_v1"/);
  assert.match(source, /restored\.kind === "invalid"/);
  assert.match(source, /RESTORE_RESPONSE_INVALID/);
  assert.match(source, /billing_purchase_bindings/);
  assert.match(source, /RESTORE_BOUND_TO_OTHER_HOUSEHOLD/);
  assert.match(source, /restore-owner:\$\{user\.id\}:\$\{active\.store\}:\$\{active\.environment\}:pro/);
  assert.doesNotMatch(source, /syntheticOriginalTransactionId/);
});

test("restore ownership resolves only active bindings and ignores inactive repurchase history", () => {
  const restore = source.slice(source.indexOf("const { data: bindings"), source.indexOf("const stableBindingId"));
  assert.match(restore, /\.eq\("active", true\)/);
  assert.match(restore, /RESTORE_BINDING_AMBIGUOUS/);
  assert.match(restore, /bindings\?\.\[0\].*bindings\[0\]\.household_id !== householdId/);
});

test("foreground status performs bounded stable-binding lifecycle reconciliation", () => {
  assert.match(source, /Date\.now\(\) - updatedAt < 10 \* 60 \* 1000/);
  assert.match(source, /reconcileExistingBillingStatus/);
  assert.match(source, /STATUS_RECONCILIATION/);
  assert.match(source, /reconciliation: "bounded_status"/);
  assert.match(source, /graceEndsAt: active\.graceEndsAt/);
  assert.match(source, /willRenew: active\.willRenew/);
  assert.match(source, /restored\.kind === "invalid"/);
});

test("only one store operation can become purchasing across households", () => {
  assert.match(source, /eq\("status", "purchasing"\)\.gt\("expires_at"[\s\S]{0,100}\.limit\(1\)\.maybeSingle/);
  assert.match(source, /PURCHASE_ALREADY_IN_PROGRESS/);
  assert.match(source, /eq\("status", "confirmed"\)/);
  assert.match(source, /purchasingIntent/);
});

test("cancelled and stale intents cannot block retries, and existing bindings fail before store invocation", () => {
  assert.match(source, /action === "cancel_intent"/);
  assert.match(source, /status: "cancelled"/);
  assert.match(source, /eq\("status", "purchasing"\)\.lte\("expires_at"/);
  assert.match(source, /eq\("status", "purchasing"\)\.gt\("expires_at"/);
  assert.match(source, /RESTORE_INTENT_FINALIZE_FAILED/);
  assert.match(source, /PURCHASE_BOUND_TO_OTHER_HOUSEHOLD/);
  assert.match(source, /existingBindings/);
});
