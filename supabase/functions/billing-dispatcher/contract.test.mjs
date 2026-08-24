import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_EDIT_ROLES,
  normalizeRevenueCatEvent,
  normalizeRevenueCatSubscriberRestore,
  normalizeRevenueCatTransfer,
  parseSignatureHeader,
  routeForBillingAction,
} from "./contract.ts";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "evt_1",
  type: "INITIAL_PURCHASE",
  app_user_id: userA,
  original_app_user_id: userA,
  aliases: [userA],
  product_id: "flowledger_pro_monthly",
  entitlement_ids: ["pro"],
  store: "APP_STORE",
  environment: "PRODUCTION",
  transaction_id: "tx_1",
  original_transaction_id: "original_1",
  event_timestamp_ms: 1_800_000_000_000,
  purchased_at_ms: 1_800_000_000_000,
  expiration_at_ms: 1_802_678_400_000,
};

test("normalizes an identified RevenueCat lifecycle event", () => {
  const event = normalizeRevenueCatEvent(base);
  assert.equal(event?.appUserId, userA);
  assert.equal(event?.status, "active");
  assert.equal(event?.store, "app_store");
});

test("normalizes only the exact Google Play subscription and base-plan identifiers", () => {
  const google = normalizeRevenueCatEvent({ ...base, store: "PLAY_STORE", product_id: "flowledger_pro:monthly-autorenewing" });
  assert.equal(google?.productId, "flowledger_pro_monthly");
  assert.equal(normalizeRevenueCatEvent({ ...base, store: "PLAY_STORE", product_id: "flowledger_pro_monthly" }), null);
  assert.equal(normalizeRevenueCatEvent({ ...base, store: "PLAY_STORE", product_id: "flowledger_pro:anything" }), null);
});

test("rejects wrong-user aliases and restore transfers", () => {
  assert.equal(normalizeRevenueCatEvent({ ...base, aliases: [userA, userB] }), null);
  assert.equal(normalizeRevenueCatEvent({ ...base, original_app_user_id: userB }), null);
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "TRANSFER", transferred_from: [userA], transferred_to: [userB] }), null);
  assert.deepEqual(normalizeRevenueCatTransfer({ id: "evt_1", type: "TRANSFER", environment: "PRODUCTION", event_timestamp_ms: 1_800_000_000_000, transferred_from: [userA], transferred_to: [userB] }), {
    providerEventId: "evt_1",
    eventType: "TRANSFER",
    transferredFrom: [userA],
    environment: "production",
    eventAt: "2027-01-15T08:00:00.000Z",
  });
  assert.equal(normalizeRevenueCatTransfer({ id: "evt_2", type: "TRANSFER", environment: "SANDBOX", event_timestamp_ms: 1_800_000_000_000, transferred_from: [userA], transferred_to: [userB] })?.environment, "sandbox");
  assert.equal(normalizeRevenueCatTransfer({ id: "evt_3", type: "TRANSFER", event_timestamp_ms: 1_800_000_000_000, transferred_from: [userA], transferred_to: [userB] }), null);
});

test("rejects unknown products, entitlements, and anonymous identities", () => {
  assert.equal(normalizeRevenueCatEvent({ ...base, product_id: "other" }), null);
  assert.equal(normalizeRevenueCatEvent({ ...base, entitlement_ids: ["other"] }), null);
  assert.equal(normalizeRevenueCatEvent({ ...base, app_user_id: "$RCAnonymousID:abc" }), null);
});

test("maps cancellation, grace, expiry and refund without treating cancellation as expiry", () => {
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "CANCELLATION" })?.status, "cancelled");
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "BILLING_ISSUE" })?.status, "grace");
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "EXPIRATION" })?.status, "expired");
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "REFUND" })?.status, "refunded");
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "REFUND_REVERSED" })?.status, "active");
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" })?.status, "refunded");
  assert.equal(normalizeRevenueCatEvent({ ...base, type: "CANCELLATION", cancel_reason: "BILLING_ERROR" })?.status, "grace");
});

test("only owners may create household purchase intents", () => {
  assert.deepEqual([...BILLING_EDIT_ROLES], ["owner"]);
});

test("parses RevenueCat HMAC headers and rejects malformed values", () => {
  assert.deepEqual(parseSignatureHeader(`t=1800000000,v1=${"a".repeat(64)}`), { timestamp: "1800000000", signature: "a".repeat(64) });
  assert.equal(parseSignatureHeader("t=nope,v1=bad"), null);
});

test("billing action router is allowlisted", () => {
  assert.equal(routeForBillingAction("intent"), "intent");
  assert.equal(routeForBillingAction("restore_intent"), "restore_intent");
  assert.equal(routeForBillingAction("restore_reconcile"), "restore_reconcile");
  assert.equal(routeForBillingAction("cancel_intent"), "cancel_intent");
  assert.equal(routeForBillingAction("status"), "status");
  assert.equal(routeForBillingAction("delete_everything"), null);
});

const subscriber = {
  request_date_ms: Date.parse("2027-01-20T08:00:00Z"),
  subscriber: {
    original_app_user_id: userA,
    entitlements: {
      pro: {
        product_identifier: "flowledger_pro:monthly-autorenewing",
        expires_date: "2027-02-15T08:00:00Z",
      },
    },
    subscriptions: {
      "flowledger_pro:monthly-autorenewing": {
        store: "play_store",
        ownership_type: "PURCHASED",
        is_sandbox: false,
        store_transaction_id: "GPA.1234-5678-9012-34567",
        purchase_date: "2027-01-15T08:00:00Z",
        expires_date: "2027-02-15T08:00:00Z",
      },
    },
  },
};

test("normalizes an authoritative RevenueCat subscriber after a missed webhook", () => {
  const restored = normalizeRevenueCatSubscriberRestore(
    subscriber,
    userA,
    "android",
    ["flowledger_pro_monthly", "flowledger_pro_annual"],
    Date.parse("2027-01-20T08:00:00Z"),
  );
  assert.equal(restored.kind, "active");
  if (restored.kind !== "active") assert.fail("expected active restore");
  assert.equal(restored.value.productId, "flowledger_pro_monthly");
  assert.equal(restored.value.store, "play_store");
  assert.equal(restored.value.environment, "production");
  assert.equal(restored.value.status, "active");
});

test("authoritative restore distinguishes invalid data from no active access", () => {
  const args = [userA, "android", ["flowledger_pro_monthly"], Date.parse("2027-01-20T08:00:00Z")];
  assert.equal(normalizeRevenueCatSubscriberRestore({ subscriber: { ...subscriber.subscriber, original_app_user_id: userB } }, ...args).kind, "invalid");
  assert.equal(normalizeRevenueCatSubscriberRestore(subscriber, userA, "ios", ["flowledger_pro_monthly"], args[3]).kind, "invalid");
  assert.equal(normalizeRevenueCatSubscriberRestore(subscriber, userA, "android", ["flowledger_pro_annual"], args[3]).kind, "invalid");
  const ambiguousEnvironment = structuredClone(subscriber);
  delete ambiguousEnvironment.subscriber.subscriptions["flowledger_pro:monthly-autorenewing"].is_sandbox;
  assert.equal(normalizeRevenueCatSubscriberRestore(ambiguousEnvironment, ...args).kind, "invalid");
  assert.equal(normalizeRevenueCatSubscriberRestore(subscriber, userA, "android", ["flowledger_pro_monthly"], Date.parse("2027-03-01T08:00:00Z")).kind, "no_active");
  const missingPro = structuredClone(subscriber);
  delete missingPro.subscriber.entitlements.pro;
  assert.equal(normalizeRevenueCatSubscriberRestore(missingPro, ...args).kind, "no_active");
});

test("restore ordering uses the RevenueCat snapshot time rather than later local completion time", () => {
  const oldSnapshot = structuredClone(subscriber);
  oldSnapshot.request_date_ms = Date.parse("2027-01-19T08:00:00Z");
  const restored = normalizeRevenueCatSubscriberRestore(oldSnapshot, userA, "android", ["flowledger_pro_monthly"], Date.parse("2027-01-20T08:00:00Z"));
  assert.equal(restored.kind, "active");
  if (restored.kind !== "active") assert.fail("expected active snapshot");
  assert.equal(restored.value.eventAt, "2027-01-19T08:00:00.000Z");
  const missingTimestamp = structuredClone(subscriber);
  delete missingTimestamp.request_date_ms;
  assert.equal(normalizeRevenueCatSubscriberRestore(missingTimestamp, userA, "android", ["flowledger_pro_monthly"], Date.parse("2027-01-20T08:00:00Z")).kind, "invalid");
});

test("restore rejects family sharing, missing ownership proof, and malformed lifecycle dates", () => {
  const family = structuredClone(subscriber);
  family.subscriber.subscriptions["flowledger_pro:monthly-autorenewing"].ownership_type = "FAMILY_SHARED";
  assert.equal(normalizeRevenueCatSubscriberRestore(family, userA, "android", ["flowledger_pro_monthly"], subscriber.request_date_ms).kind, "invalid");
  const missingOwnership = structuredClone(subscriber);
  delete missingOwnership.subscriber.subscriptions["flowledger_pro:monthly-autorenewing"].ownership_type;
  assert.equal(normalizeRevenueCatSubscriberRestore(missingOwnership, userA, "android", ["flowledger_pro_monthly"], subscriber.request_date_ms).kind, "invalid");
  for (const field of ["purchase_date", "expires_date", "billing_issues_detected_at", "unsubscribe_detected_at"]) {
    const malformed = structuredClone(subscriber);
    malformed.subscriber.subscriptions["flowledger_pro:monthly-autorenewing"][field] = "not-a-date";
    assert.equal(normalizeRevenueCatSubscriberRestore(malformed, userA, "android", ["flowledger_pro_monthly"], subscriber.request_date_ms).kind, "invalid");
  }
});
