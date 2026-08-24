import assert from "node:assert/strict";
import test from "node:test";

import { billingIdentityAction, requireSupabaseBillingUserId } from "./billingIdentityPolicy";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

test("billing config starts with the signed-in Supabase UUID", () => {
  assert.equal(billingIdentityAction(false, null, userA), "configure");
  assert.equal(requireSupabaseBillingUserId(` ${userA} `), userA);
});

test("the same identified user is reused without creating an anonymous identity", () => {
  assert.equal(billingIdentityAction(true, userA, userA), "reuse");
});

test("an account switch requires RevenueCat login to the next UUID", () => {
  assert.equal(billingIdentityAction(true, userA, userB), "login");
});

test("email and RevenueCat anonymous IDs fail closed", () => {
  assert.throws(() => billingIdentityAction(false, null, "person@example.com"));
  assert.throws(() => billingIdentityAction(false, null, "$RCAnonymousID:abc"));
});
