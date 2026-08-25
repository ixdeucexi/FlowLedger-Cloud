const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "push.js"), "utf8");
const { assertDbResult } = require("./push");

test("native lock-screen payloads use generic text and an allowlisted route", () => {
  assert.match(
    source,
    /data: \{ route: allowlistedNativeRoute\(payload\.url\), \.\.\.\(typeof householdId/,
  );
  assert.match(source, /A planned bill is past due and still has money left/);
  assert.match(source, /A posted bank transaction is waiting in Review Center/);
  assert.doesNotMatch(
    source,
    /payload\.(?:merchant|billName|accountName|amount|balance)/,
  );
});

test("the unified queue considers either web or native destinations", () => {
  assert.match(source, /native_push_devices/);
  assert.match(source, /return Boolean\(web \|\| native\)/);
  assert.match(source, /DeviceNotRegistered/);
  assert.match(source, /native_push_receipts/);
  assert.match(
    source,
    /from\("household_members"\)/,
    "delivery must revalidate current household membership",
  );
  assert.match(source, /if \(!membership\) return \{ delivered: 0/);
  assert.match(source, /householdId === null/);
});

test("Expo tickets use a durable receipt ledger with aggregate-safe event reconciliation", () => {
  assert.match(source, /from\("native_push_receipts"\)\.upsert/);
  assert.match(source, /ticket_id: ticket\.id/);
  assert.match(source, /status: "pending"/);
  assert.match(
    source,
    /if \(!receipt\)/,
    "not-ready receipts must remain pending",
  );
  assert.match(source, /DeviceNotRegistered/);
  assert.match(source, /if \(result\.accepted > 0\)/);
  assert.match(source, /rpc\("apply_native_push_receipt"/);
  assert.match(source, /rpc\("claim_push_notification_events"/);
  assert.match(source, /attempts >= 8 \? "abandoned" : "pending"/);
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      "../../supabase/migrations/20260822224633_native_billing_plaid_push.sql",
    ),
    "utf8",
  );
  assert.match(migration, /flowledger-native-push-receipts/);
  assert.match(migration, /'\*\/10 \* \* \* \*'/);
  assert.match(migration, /flowledger_cron_secret/);
  assert.match(migration, /for update skip locked/);
  assert.match(
    migration,
    /create or replace function private\.apply_native_push_receipt/,
  );
  assert.match(
    migration,
    /where id = any\(v_receipt\.event_ids\) and delivered_at is null/,
  );
  assert.match(source, /\.eq\("environment", pushEnvironment\(\)\)/);
});

test("receipt persistence errors fail the worker instead of reporting success", () => {
  assert.throws(
    () =>
      assertDbResult(
        { error: new Error("database unavailable") },
        "Receipt state was not saved.",
      ),
    /Receipt state was not saved/,
  );
  assert.deepEqual(assertDbResult({ data: true, error: null }, "unused"), {
    data: true,
    error: null,
  });
});

test("transaction queues require a household and every sync callsite supplies it", () => {
  const syncSource = fs.readFileSync(path.join(__dirname, "sync.js"), "utf8");
  assert.match(
    source,
    /if \(!householdId\) throw new Error\("PUSH_HOUSEHOLD_REQUIRED"\)/,
  );
  assert.match(
    syncSource,
    /queuePendingTransactionNotifications\(userId, item\.household_id,/,
  );
  assert.match(
    syncSource,
    /queuePostedTransactionNotifications\(userId, item\.household_id,/,
  );
  assert.match(source, /householdId: event\.household_id \|\| null/);
});

test("native registration and delivery are deployment-environment scoped", () => {
  const subscription = fs.readFileSync(
    path.join(__dirname, "notificationRoutes/subscription.js"),
    "utf8",
  );
  assert.match(subscription, /environment !== pushEnvironment\(\)/);
  assert.match(subscription, /PUSH_ENVIRONMENT_MISMATCH/);
  assert.match(
    source,
    /native_push_devices"\)\.select\("id,expo_push_token"\)[\s\S]{0,180}\.eq\("environment", pushEnvironment\(\)\)/,
  );
  assert.match(
    source,
    /native_push_devices"\)\.select\("id"\)[\s\S]{0,180}\.eq\("environment", pushEnvironment\(\)\)/,
  );
});

test("web notification tests preserve the active household and reject missing scope clearly", () => {
  const webAdapter = fs.readFileSync(
    path.join(__dirname, "../../artifacts/mobile/lib/pushNotifications.web.ts"),
    "utf8",
  );
  const testRoute = fs.readFileSync(
    path.join(__dirname, "notificationRoutes/test.js"),
    "utf8",
  );
  const preferencesRoute = fs.readFileSync(
    path.join(__dirname, "notificationRoutes/preferences.js"),
    "utf8",
  );
  const subscriptionRoute = fs.readFileSync(
    path.join(__dirname, "notificationRoutes/subscription.js"),
    "utf8",
  );
  assert.match(webAdapter, /JSON\.stringify\(\{ type, householdId \}\)/);
  assert.match(
    webAdapter,
    /notifications\/preferences[\s\S]{0,160}cache: "no-store"/,
  );
  assert.match(testRoute, /UUID_PATTERN\.test\(householdId\)/);
  assert.match(testRoute, /HOUSEHOLD_REQUIRED/);
  assert.match(testRoute, /Choose a household before testing notifications\./);
  assert.match(preferencesRoute, /Cache-Control", "private, no-store"/);
  assert.match(subscriptionRoute, /Cache-Control", "private, no-store"/);
});
