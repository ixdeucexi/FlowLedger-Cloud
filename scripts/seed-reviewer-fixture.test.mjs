import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertReviewerFixturePreflight,
  fixtureIds,
  seedReviewerFixture,
} from "./seed-reviewer-fixture.mjs";

const source = await readFile(new URL("./seed-reviewer-fixture.mjs", import.meta.url), "utf8");
const fixture = JSON.parse(await readFile(new URL("../store-assets/v1/fixture/reviewer-v1.json", import.meta.url), "utf8"));
const userId = "00000000-0000-4000-8000-000000000111";
const householdId = "00000000-0000-4000-8000-000000000222";
const budgetId = "00000000-0000-4000-8000-000000000333";

const reviewerUser = (metadata = {}) => ({
  id: userId,
  email: "reviewer@example.com",
  email_confirmed_at: "2026-08-25T00:00:00.000Z",
  is_anonymous: false,
  app_metadata: { flowledger_reviewer_fixture: true, ...metadata },
});

const emptyRows = () => ({
  accounts: [], incomes: [], bills: [], transactions: [], goals: [],
  account_balances: [], monthly_overrides: [], extra_payments: [], categories: [], decisions: [],
  bill_date_moves: [], category_budgets: [], bill_transaction_matches: [],
  transaction_reconciliations: [], pending_plan_matches: [], subscription_bill_links: [], plan_simulations: [],
});

const emptySnapshot = overrides => ({
  ownedHouseholds: [], membershipsForUser: [], householdMembers: [], budgets: [], householdPlans: [],
  settings: [], householdSettings: [], userPreferences: [], feedbackAdmins: [], billingSandboxTesters: [],
  financialRows: emptyRows(),
  plaidRows: { plaid_items: [], plaid_accounts: [], plaid_transactions: [] },
  billingRows: {
    billing_purchase_intents: [], billing_purchase_bindings: [], billing_entitlements: [], billing_events: [],
  },
  ...overrides,
});

const freshBootstrapSnapshot = overrides => emptySnapshot({
  ownedHouseholds: [{ id: householdId, name: "My Household", created_by: userId, is_personal: true }],
  membershipsForUser: [{ household_id: householdId, user_id: userId, role: "owner" }],
  householdMembers: [{ household_id: householdId, user_id: userId, role: "owner" }],
  budgets: [{ id: budgetId, household_id: householdId, name: "Main Budget", is_default: true }],
  householdPlans: [{ household_id: householdId, tier: "free", source: "default" }],
  ...overrides,
});

const pristinePreferences = () => ({
  user_id: userId,
  active_household_id: householdId,
  decision_hub_settings: {},
  onboarding_preferences: {},
  dashboard_layouts: {},
  notification_center_states: {},
});

async function runWith(snapshot, user = reviewerUser()) {
  const events = [];
  const repository = {
    async getUser() { events.push("read:user"); return user; },
    async readSnapshot() { events.push("read:snapshot"); return snapshot; },
    async applyFixture() { events.push("write:fixture"); return { householdId, budgetId }; },
  };
  const result = await seedReviewerFixture({ repository, fixture, userId, confirmation: "FICTIONAL_ONLY" });
  return { events, result };
}

test("reviewer fixture is explicitly fictional, guarded and credential-free", () => {
  assert.equal(fixture.version, 1);
  assert.equal(typeof fixture.householdName, "string");
  assert.match(source, /FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM/);
  assert.match(source, /flowledger_reviewer_fixture/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(JSON.stringify(fixture), /access_token|password|secret|plaid_item/i);
});

test("all fail-closed reads and validation complete before the first mutation", async () => {
  const { events } = await runWith(freshBootstrapSnapshot());
  assert.deepEqual(events, ["read:user", "read:snapshot", "write:fixture"]);
  const applyIndex = source.indexOf("async applyFixture");
  assert.ok(applyIndex > 0);
  assert.doesNotMatch(source.slice(0, applyIndex), /\.insert\(|\.update\(|\.upsert\(/);
});

test("missing reviewer auth metadata fails before snapshot reads or writes", async () => {
  const events = [];
  const repository = {
    async getUser() {
      events.push("read:user");
      return reviewerUser({ flowledger_reviewer_fixture: false, flowledger_store_reviewer: true });
    },
    async readSnapshot() { events.push("read:snapshot"); return freshBootstrapSnapshot(); },
    async applyFixture() { events.push("write:fixture"); },
  };
  await assert.rejects(
    seedReviewerFixture({ repository, fixture, userId, confirmation: "FICTIONAL_ONLY" }),
    /explicitly marked flowledger_reviewer_fixture/,
  );
  assert.deepEqual(events, ["read:user"]);
});

test("Pro, grandfathered, admin or billing plans fail closed before writes", async () => {
  for (const plan of [
    { tier: "pro", source: "admin" },
    { tier: "pro", source: "grandfathered" },
    { tier: "pro", source: "billing" },
    { tier: "free", source: "billing" },
  ]) {
    const events = [];
    const repository = {
      getUser: async () => reviewerUser(),
      readSnapshot: async () => freshBootstrapSnapshot({ householdPlans: [{ household_id: householdId, ...plan }] }),
      applyFixture: async () => events.push("write:fixture"),
    };
    await assert.rejects(
      seedReviewerFixture({ repository, fixture, userId, confirmation: "FICTIONAL_ONLY" }),
      /fresh\/default Free plan/,
    );
    assert.deepEqual(events, []);
  }
});

test("any Plaid item, account or transaction fails closed before writes", async () => {
  for (const table of ["plaid_items", "plaid_accounts", "plaid_transactions"]) {
    const events = [];
    const snapshot = freshBootstrapSnapshot({
      plaidRows: {
        plaid_items: [], plaid_accounts: [], plaid_transactions: [],
        [table]: [{ id: `${table}-existing`, user_id: userId, household_id: householdId }],
      },
    });
    const repository = {
      getUser: async () => reviewerUser(),
      readSnapshot: async () => snapshot,
      applyFixture: async () => events.push("write:fixture"),
    };
    await assert.rejects(
      seedReviewerFixture({ repository, fixture, userId, confirmation: "FICTIONAL_ONLY" }),
      new RegExp(table),
    );
    assert.deepEqual(events, []);
  }
});

test("non-fixture financial data and household contamination fail closed", () => {
  const nonfresh = freshBootstrapSnapshot({
    financialRows: {
      ...emptyRows(),
      transactions: [{ id: "personal-row", user_id: userId, household_id: householdId, budget_id: budgetId }],
    },
  });
  assert.throws(
    () => assertReviewerFixturePreflight({ fixture, userId, user: reviewerUser(), snapshot: nonfresh }),
    /non-fixture transactions row/,
  );

  const shared = freshBootstrapSnapshot({
    householdMembers: [
      { household_id: householdId, user_id: userId, role: "owner" },
      { household_id: householdId, user_id: "00000000-0000-4000-8000-000000000999", role: "viewer" },
    ],
  });
  assert.throws(
    () => assertReviewerFixturePreflight({ fixture, userId, user: reviewerUser(), snapshot: shared }),
    /must not contain another member/,
  );
});

test("pre-existing onboarding metadata without a known fixture fails closed", () => {
  const snapshot = freshBootstrapSnapshot({
    settings: [{
      user_id: userId, payment_method: "snowball", planning_mode: "snowball", starting_balance: 42,
      starting_balance_date: fixture.anchorDate, safety_floor: 200, forecast_horizon_months: 6,
      onboarding_completed: true,
    }],
  });
  assert.throws(
    () => assertReviewerFixturePreflight({ fixture, userId, user: reviewerUser(), snapshot }),
    /pre-existing settings/,
  );
});

test("the database-triggered pristine household settings row is safe to initialize", async () => {
  const snapshot = freshBootstrapSnapshot({
    householdSettings: [{
      household_id: householdId, budget_id: budgetId,
      payment_method: "snowball", planning_mode: "snowball",
      starting_balance: 0, starting_balance_date: null,
      safety_floor: 200, forecast_horizon_months: 6, onboarding_completed: false,
      zero_based_budget_enabled: false, debt_payoff_enabled: true,
      calendar_start_date: null, time_zone: "UTC",
    }],
    userPreferences: [pristinePreferences()],
  });
  const eligibility = assertReviewerFixturePreflight({ fixture, userId, user: reviewerUser(), snapshot });
  assert.equal(eligibility.householdSettingsState, "pristine");
  assert.equal(eligibility.userPreferencesState, "pristine");
  const { events } = await runWith(snapshot);
  assert.deepEqual(events, ["read:user", "read:snapshot", "write:fixture"]);
});

test("non-pristine household planning settings fail closed", () => {
  const snapshot = freshBootstrapSnapshot({
    householdSettings: [{
      household_id: householdId, budget_id: budgetId,
      payment_method: "snowball", planning_mode: "snowball",
      starting_balance: 125, starting_balance_date: fixture.anchorDate,
      safety_floor: 200, forecast_horizon_months: 6, onboarding_completed: false,
      zero_based_budget_enabled: false, debt_payoff_enabled: true,
      calendar_start_date: null, time_zone: "UTC",
    }],
  });
  assert.throws(
    () => assertReviewerFixturePreflight({ fixture, userId, user: reviewerUser(), snapshot }),
    /non-fixture planning data/,
  );
});

test("billing history fails closed even when the plan row still says Free", async () => {
  const events = [];
  const repository = {
    getUser: async () => reviewerUser(),
    readSnapshot: async () => freshBootstrapSnapshot({
      billingRows: {
        billing_purchase_intents: [], billing_purchase_bindings: [], billing_events: [],
        billing_entitlements: [{ id: "old-entitlement", purchaser_user_id: userId, household_id: householdId, status: "expired" }],
      },
    }),
    applyFixture: async () => events.push("write:fixture"),
  };
  await assert.rejects(
    seedReviewerFixture({ repository, fixture, userId, confirmation: "FICTIONAL_ONLY" }),
    /billing_entitlements/,
  );
  assert.deepEqual(events, []);
});

test("an exact or partial known fixture can be rerun idempotently", async () => {
  const ids = fixtureIds(fixture, userId);
  const snapshot = freshBootstrapSnapshot({
    ownedHouseholds: [{ id: householdId, name: fixture.householdName, created_by: userId, is_personal: true }],
    financialRows: {
      ...emptyRows(),
      accounts: [{ id: ids.accounts[0], user_id: userId, household_id: householdId, budget_id: budgetId }],
      bills: ids.bills.map(id => ({ id, user_id: userId, household_id: householdId, budget_id: budgetId })),
    },
    settings: [{
      user_id: userId, payment_method: "snowball", planning_mode: "snowball",
      starting_balance: fixture.startingBalance, starting_balance_date: fixture.anchorDate,
      safety_floor: fixture.safetyFloor, forecast_horizon_months: 6, onboarding_completed: true,
    }],
    householdSettings: [{
      household_id: householdId, budget_id: budgetId, payment_method: "snowball", planning_mode: "snowball",
      starting_balance: fixture.startingBalance, starting_balance_date: fixture.anchorDate,
      safety_floor: fixture.safetyFloor, forecast_horizon_months: 6, onboarding_completed: true,
    }],
    userPreferences: [pristinePreferences()],
  });
  const { events } = await runWith(snapshot);
  assert.deepEqual(events, ["read:user", "read:snapshot", "write:fixture"]);
});

test("Founding Free fixture never grants Pro or administrator access", () => {
  assert.doesNotMatch(source, /tier:\s*"pro"/);
  assert.doesNotMatch(source, /source:\s*"admin"/);
  assert.doesNotMatch(source, /from\("feedback_admins"\)\.(insert|upsert|update)/);
  assert.match(source, /tier:\s*"free",\s*source:\s*"default"/);
});

test("reviewer fixture activates a fully onboarded household-scoped budget", () => {
  assert.match(source, /from\("household_settings"\)\.insert/);
  assert.match(source, /budget_id:\s*budget\.id/);
  assert.match(source, /onboarding_completed:\s*true/);
  assert.match(source, /payment_method:\s*"snowball"/);
  assert.match(source, /from\("user_preferences"\)\.insert/);
  assert.match(source, /active_household_id:\s*household\.id/);
});
