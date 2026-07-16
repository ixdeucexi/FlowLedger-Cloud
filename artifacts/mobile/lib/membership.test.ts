import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAN_CATALOG,
  annualMonthlyEquivalent,
  annualSavings,
  canUseFeature,
  mapHouseholdPlan,
  normalizePlanTier,
  resolvePreviewTier,
} from "./membership";

test("defines the approved Free and Pro catalog", () => {
  assert.deepEqual(Object.keys(PLAN_CATALOG), ["free", "pro"]);
  assert.equal(PLAN_CATALOG.free.monthlyPrice, 0);
  assert.equal(PLAN_CATALOG.pro.monthlyPrice, 9.99);
  assert.equal(PLAN_CATALOG.pro.annualPrice, 89);
});

test("keeps manual budgeting free and Pro automation paid", () => {
  assert.equal(canUseFeature("free", "manual_budgeting"), true);
  assert.equal(canUseFeature("free", "flo_basic"), true);
  assert.equal(canUseFeature("free", "flo_account_chat"), false);
  assert.equal(canUseFeature("pro", "flo_account_chat"), true);
  assert.equal(canUseFeature("free", "debt_payoff"), false);
  assert.equal(canUseFeature("free", "plaid_sync"), false);
  assert.equal(canUseFeature("pro", "connected_insights"), true);
  assert.equal(canUseFeature("pro", "transaction_matching"), true);
});

test("calculates annual Pro pricing", () => {
  assert.equal(annualSavings("pro"), 30.88);
  assert.equal(annualMonthlyEquivalent("pro"), 7.42);
  assert.equal(annualSavings("free"), 0);
});

test("normalizes invalid records safely to Free", () => {
  assert.equal(normalizePlanTier("plus"), "free");
  assert.equal(mapHouseholdPlan({ tier: "unknown" }, "household-1").tier, "free");
  assert.equal(mapHouseholdPlan({ tier: "pro", source: "grandfathered" }, "household-1").source, "grandfathered");
});

test("only resolves stored previews for approved admins", () => {
  assert.equal(resolvePreviewTier(true, "free"), "free");
  assert.equal(resolvePreviewTier(true, "pro"), "pro");
  assert.equal(resolvePreviewTier(false, "free"), null);
  assert.equal(resolvePreviewTier(true, "plus"), null);
});
