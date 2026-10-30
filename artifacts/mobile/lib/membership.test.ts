import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  FREE_CORE_FEATURES,
  FOUNDING_PLANNING_FEATURES,
  PLAN_CATALOG,
  PLAN_FEATURES,
  annualMonthlyEquivalent,
  annualSavings,
  canUseFeature,
  mapHouseholdPlan,
  normalizePlanTier,
  parseHouseholdFeatureAccess,
  resolvePreviewTier,
} from "./membership";
import {
  requestHouseholdFeatureAccess,
  type FeatureAccessClient,
} from "./membershipAccess";
import {
  billingQuoteDisclosure,
  verifiedBillingQuote,
} from "./billingProductPolicy";

const userA = "11111111-1111-4111-8111-111111111111",
  userB = "22222222-2222-4222-8222-222222222222",
  householdId = "33333333-3333-4333-8333-333333333333";
function access(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    householdId,
    plan: { tier: "free", source: "default" },
    foundingPlanning: false,
    features: [...PLAN_CATALOG.free.features],
    flo: {
      period: "month",
      limit: 10,
      used: 2,
      remaining: 8,
      resetsAt: "2026-11-01T00:00:00Z",
      canCreate: false,
    },
    ...overrides,
  };
}

test("defines the approved household Free and Pro prices", () => {
  assert.deepEqual(Object.keys(PLAN_CATALOG), ["free", "pro"]);
  assert.equal(PLAN_CATALOG.free.name, "Free");
  assert.equal(PLAN_CATALOG.free.monthlyPrice, 0);
  assert.equal(PLAN_CATALOG.pro.monthlyPrice, 9.99);
  assert.equal(PLAN_CATALOG.pro.annualPrice, 79.99);
  assert.equal(annualSavings("pro"), 39.89);
  assert.equal(annualMonthlyEquivalent("pro"), 6.67);
  assert.equal(annualSavings("free"), 0);
});
test("Free keeps core planning while advanced capabilities are separate", () => {
  for (const feature of FREE_CORE_FEATURES)
    assert.equal(canUseFeature("free", feature), true, feature);
  assert.equal(canUseFeature("free", "flo_account_chat"), true);
  for (const feature of [
    "flo_creation",
    "debt_strategies",
    "saved_scenarios",
    "scenario_comparison",
    "cloud_scenarios",
    "long_term_reports",
    "plaid_sync",
    "connected_insights",
  ] as const)
    assert.equal(canUseFeature("free", feature), false, feature);
  for (const feature of PLAN_FEATURES)
    assert.equal(canUseFeature("pro", feature), true, feature);
});
test("founding access freezes existing planning without adding bank or cloud access", () => {
  const parsed = parseHouseholdFeatureAccess(
    access({
      foundingPlanning: true,
      features: [...FOUNDING_PLANNING_FEATURES],
      flo: {
        period: "day",
        limit: 100,
        used: 5,
        remaining: 95,
        resetsAt: "2026-11-01T00:00:00Z",
        canCreate: true,
      },
    }),
    householdId,
  );
  assert.equal(parsed.plan.tier, "free");
  assert.equal(parsed.foundingPlanning, true);
  assert.equal(parsed.features.includes("saved_scenarios"), true);
  assert.equal(parsed.features.includes("cloud_scenarios"), false);
  assert.equal(parsed.features.includes("plaid_sync"), false);
});
test("actual permanent Pro plan survives a server-verified Free preview", () => {
  const parsed = parseHouseholdFeatureAccess(
    access({ plan: { tier: "pro", source: "grandfathered" } }),
    householdId,
  );
  assert.equal(parsed.plan.tier, "pro");
  assert.equal(parsed.plan.source, "grandfathered");
  assert.equal(parsed.features.includes("debt_strategies"), false);
  assert.equal(
    mapHouseholdPlan({ tier: "pro", source: "grandfathered" }, householdId)
      .source,
    "grandfathered",
  );
});
test("normalizes invalid stored plans safely and only admins resolve previews", () => {
  assert.equal(normalizePlanTier("plus"), "free");
  assert.equal(mapHouseholdPlan({ tier: "unknown" }, householdId).tier, "free");
  assert.equal(resolvePreviewTier(true, "free"), "free");
  assert.equal(resolvePreviewTier(true, "pro"), "pro");
  assert.equal(resolvePreviewTier(false, "pro"), null);
  assert.equal(resolvePreviewTier(true, "plus"), null);
});
test("rejects malformed, foreign or invented capability receipts", () => {
  for (const invalid of [
    null,
    access({ householdId: "another" }),
    access({ version: 2 }),
    access({ plan: { tier: "plus", source: "default" } }),
    access({ features: ["manual_budgeting"] }),
    access({ features: [...PLAN_CATALOG.free.features, "made_up"] }),
    access({ features: [...PLAN_CATALOG.free.features, "flo_basic"] }),
    access({ foundingPlanning: "yes" }),
  ])
    assert.throws(() => parseHouseholdFeatureAccess(invalid, householdId));
});
test("validates quota fields without rejecting an already-used downgraded allowance", () => {
  const downgraded = parseHouseholdFeatureAccess(
    access({
      flo: {
        period: "month",
        limit: 10,
        used: 200,
        remaining: 0,
        resetsAt: "2026-11-01T00:00:00Z",
        canCreate: false,
      },
    }),
    householdId,
  );
  assert.equal(downgraded.flo.used, 200);
  assert.equal(downgraded.flo.remaining, 0);
  assert.equal(downgraded.features.includes("flo_account_chat"), true);
  for (const patch of [
    { used: -1 },
    { remaining: 9 },
    { limit: Infinity },
    { used: 2.5 },
    { period: "year" },
    { resetsAt: "bad" },
    { canCreate: true },
  ])
    assert.throws(() =>
      parseHouseholdFeatureAccess(
        access({ flo: { ...(access().flo as object), ...patch } }),
        householdId,
      ),
    );
});
test("viewers can retain a Pro feature list without creation permission", () => {
  const parsed = parseHouseholdFeatureAccess(
    access({
      plan: { tier: "pro", source: "billing" },
      features: [...PLAN_FEATURES],
      flo: {
        period: "month",
        limit: 300,
        used: 2,
        remaining: 298,
        resetsAt: "2026-11-01T00:00:00Z",
        canCreate: false,
      },
    }),
    householdId,
  );
  assert.equal(parsed.flo.canCreate, false);
});
function client(sessionUserId = userA) {
  const calls: unknown[] = [];
  const sdk: FeatureAccessClient = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: sessionUserId },
            access_token: "verified-token-a",
          },
        },
      }),
    },
    rpc: (...args) => {
      calls.push(args);
      return {
        setHeader: async (name, value) => {
          calls.push(["setHeader", name, value]);
          return { data: access(), error: null };
        },
      };
    },
  };
  return { sdk, calls };
}
test("access RPC pins the verified SDK token and expected household/preview", async () => {
  const c = client();
  const result = await requestHouseholdFeatureAccess(
    c.sdk,
    { userId: userA, householdId, previewTier: null },
    () => true,
  );
  assert.equal(result?.householdId, householdId);
  assert.deepEqual(c.calls, [
    [
      "get_household_feature_access",
      { p_expected_household_id: householdId, p_preview_tier: null },
    ],
    ["setHeader", "Authorization", "Bearer verified-token-a"],
  ]);
});
test("a changed SDK identity cannot dispatch under a prior React user", async () => {
  const c = client(userB);
  await assert.rejects(
    requestHouseholdFeatureAccess(
      c.sdk,
      { userId: userA, householdId, previewTier: null },
      () => true,
    ),
    /account changed/,
  );
  assert.equal(c.calls.length, 0);
});
test("scope changes during session lookup prevent even an A-to-B-to-A stale dispatch", async () => {
  const c = client();
  let release!: () => void,
    revision = 1;
  const original = c.sdk.auth.getSession;
  c.sdk.auth.getSession = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return original();
  };
  const request = requestHouseholdFeatureAccess(
    c.sdk,
    { userId: userA, householdId, previewTier: null },
    () => revision === 1,
  );
  revision = 3;
  release();
  assert.equal(await request, null);
  assert.equal(c.calls.length, 0);
});
test("scope changes while the RPC is in flight discard the old receipt", async () => {
  const c = client();
  let current = true;
  c.sdk.rpc = () => ({
    setHeader: async () => {
      current = false;
      return { data: access(), error: null };
    },
  });
  assert.equal(
    await requestHouseholdFeatureAccess(
      c.sdk,
      { userId: userA, householdId, previewTier: null },
      () => current,
    ),
    null,
  );
});
test("access errors fail rather than inventing a founder or Pro grant", async () => {
  const c = client();
  c.sdk.rpc = () => ({
    setHeader: async () => ({
      data: null,
      error: { message: "Temporarily unavailable" },
    }),
  });
  await assert.rejects(
    requestHouseholdFeatureAccess(
      c.sdk,
      { userId: userA, householdId, previewTier: null },
      () => true,
    ),
    /Temporarily unavailable/,
  );
});
test("the real installed Supabase RPC transport retains the captured token after auth changes", async () => {
  const transport: Array<{
    path: string;
    authorization: string | null;
    body: unknown;
  }> = [];
  const realClient = createClient(
    "https://unit-test.invalid",
    "unit-public-anon-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          transport.push({
            path: new URL(String(input)).pathname,
            authorization: new Headers(init?.headers).get("Authorization"),
            body: JSON.parse(String(init?.body)),
          });
          return new Response(JSON.stringify(access()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    },
  );
  await realClient.auth.initialize();
  const makeSession = (id: string, token: string): Session => ({
    access_token: token,
    refresh_token: "unit-refresh",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  });
  const usersRead: string[] = [];
  realClient.auth.getSession = async () => {
    const id = usersRead.length === 0 ? userA : userB;
    usersRead.push(id);
    return {
      data: {
        session: makeSession(
          id,
          id === userA ? "captured-token-a" : "new-global-token-b",
        ),
      },
      error: null,
    };
  };
  const result = await requestHouseholdFeatureAccess(
    realClient,
    { userId: userA, householdId, previewTier: null },
    () => true,
  );
  assert.equal(result?.householdId, householdId);
  assert.deepEqual(usersRead.slice(0, 2), [userA, userB]);
  assert.deepEqual(transport, [
    {
      path: "/rest/v1/rpc/get_household_feature_access",
      authorization: "Bearer captured-token-a",
      body: { p_expected_household_id: householdId, p_preview_tier: null },
    },
  ]);
  realClient.realtime.disconnect();
});
const annual = {
  identifier: "flowledger_pro_annual",
  price: 79.99,
  priceString: "$79.99",
  currencyCode: "USD",
  subscriptionPeriod: "P1Y",
  subscription: true,
};
test("store quote checks SKU, cadence and current USD standard price", () => {
  assert.equal(verifiedBillingQuote(annual, annual.identifier).price, 79.99);
  assert.throws(
    () => verifiedBillingQuote({ ...annual, price: 89 }, annual.identifier),
    /not ready/,
  );
  assert.throws(() =>
    verifiedBillingQuote(
      { ...annual, subscriptionPeriod: "P1M" },
      annual.identifier,
    ),
  );
  assert.throws(() =>
    verifiedBillingQuote({ ...annual, subscription: false }, annual.identifier),
  );
  assert.throws(() => verifiedBillingQuote(annual, "unknown_product"));
  assert.throws(() =>
    verifiedBillingQuote({ ...annual, priceString: "" }, annual.identifier),
  );
  assert.equal(
    verifiedBillingQuote(
      { ...annual, currencyCode: "EUR", price: 74.99, priceString: "74,99 €" },
      annual.identifier,
    ).currencyCode,
    "EUR",
  );
});
test("only a verified eligible one-year paid introduction is advertised", () => {
  const intro = {
    price: 59.99,
    priceString: "$59.99",
    period: "P1Y",
    cycles: 1,
    eligible: true,
  };
  const quoted = verifiedBillingQuote(annual, annual.identifier, intro);
  assert.deepEqual(quoted.introductory, {
    price: 59.99,
    priceString: "$59.99",
    renewalPriceString: "$79.99",
  });
  assert.match(
    billingQuoteDisclosure(quoted),
    /\$59.99 for the first year, then \$79.99 per year/,
  );
  for (const patch of [
    { eligible: false },
    { cycles: 2 },
    { period: "P1M" },
    { price: 0 },
    { price: 69.99 },
  ])
    assert.equal(
      verifiedBillingQuote(annual, annual.identifier, { ...intro, ...patch })
        .introductory,
      undefined,
    );
  assert.match(
    billingQuoteDisclosure(verifiedBillingQuote(annual, annual.identifier)),
    /^\$79.99 per year/,
  );
});
