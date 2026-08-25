import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const required = (environment, name) => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

const FIXTURE_TABLES = [
  { name: "accounts", select: "id,user_id,household_id,budget_id" },
  { name: "incomes", select: "id,user_id,household_id,budget_id" },
  { name: "bills", select: "id,user_id,household_id,budget_id" },
  { name: "transactions", select: "id,user_id,household_id,budget_id" },
  { name: "goals", select: "id,user_id,household_id,budget_id" },
];

// Any row in these tables means the account has already been used for real
// financial planning. The fixture never deletes or rewrites these rows.
const EMPTY_FINANCIAL_TABLES = [
  { name: "account_balances", select: "id,user_id,household_id,budget_id" },
  { name: "monthly_overrides", select: "id,user_id,household_id,budget_id" },
  { name: "extra_payments", select: "id,user_id,household_id,budget_id" },
  { name: "categories", select: "name,user_id,household_id,budget_id", key: "name" },
  { name: "decisions", select: "id,user_id,household_id,budget_id" },
  { name: "bill_date_moves", select: "id,user_id,household_id,budget_id" },
  { name: "category_budgets", select: "id,user_id,household_id,budget_id" },
  { name: "bill_transaction_matches", select: "transaction_id,user_id,household_id,budget_id", key: "transaction_id" },
  { name: "transaction_reconciliations", select: "transaction_id,user_id,household_id,budget_id", key: "transaction_id" },
  { name: "pending_plan_matches", select: "id,user_id,household_id,budget_id" },
  { name: "subscription_bill_links", select: "id,user_id,household_id" },
  { name: "plan_simulations", select: "id,created_by,household_id", userColumn: "created_by" },
];

const PLAID_TABLES = [
  {
    name: "plaid_items",
    select: "id,user_id,household_id,status,encrypted_access_token,access_token_ciphertext",
  },
  { name: "plaid_accounts", select: "id,user_id,household_id,plaid_item_record_id,plaid_account_id" },
  { name: "plaid_transactions", select: "id,user_id,household_id,plaid_account_id,plaid_transaction_id" },
];

const BILLING_TABLES = [
  { name: "billing_purchase_intents", select: "id,user_id,household_id", userColumn: "user_id" },
  { name: "billing_purchase_bindings", select: "id,purchaser_user_id,household_id", userColumn: "purchaser_user_id" },
  { name: "billing_entitlements", select: "id,purchaser_user_id,household_id,status", userColumn: "purchaser_user_id" },
  { name: "billing_events", select: "id,app_user_id", userColumn: "app_user_id", householdColumn: null },
];

const fixtureRowId = (fixture, userId, kind, key) =>
  `reviewer-v${fixture.version}-${kind}-${userId}-${key}`;

export function fixtureIds(fixture, userId) {
  return {
    accounts: fixture.accounts.map(row => fixtureRowId(fixture, userId, "account", row.key)),
    incomes: fixture.incomes.map(row => fixtureRowId(fixture, userId, "income", row.key)),
    bills: fixture.bills.map(row => fixtureRowId(fixture, userId, "bill", row.key)),
    transactions: fixture.transactions.map(row => fixtureRowId(fixture, userId, "transaction", row.key)),
    goals: fixture.goals.map(row => fixtureRowId(fixture, userId, "goal", row.key)),
  };
}

function asNumber(value) {
  return typeof value === "number" ? value : Number(value);
}

function settingsMatchFixture(row, fixture) {
  return row?.payment_method === "snowball"
    && row?.planning_mode === "snowball"
    && asNumber(row?.starting_balance) === fixture.startingBalance
    && row?.starting_balance_date === fixture.anchorDate
    && asNumber(row?.safety_floor) === fixture.safetyFloor
    && asNumber(row?.forecast_horizon_months) === 6
    && row?.onboarding_completed === true;
}

function householdSettingsMatchFixture(row, fixture, householdId, budgetId) {
  return row?.household_id === householdId
    && row?.budget_id === budgetId
    && row?.payment_method === "snowball"
    && row?.planning_mode === "snowball"
    && asNumber(row?.starting_balance) === fixture.startingBalance
    && row?.starting_balance_date === fixture.anchorDate
    && asNumber(row?.safety_floor) === fixture.safetyFloor
    && asNumber(row?.forecast_horizon_months) === 6
    && row?.onboarding_completed === true;
}

function householdSettingsArePristine(row, householdId, budgetId) {
  return row?.household_id === householdId
    && row?.budget_id === budgetId
    && row?.payment_method === "snowball"
    && row?.planning_mode === "snowball"
    && asNumber(row?.starting_balance) === 0
    && row?.starting_balance_date === null
    && asNumber(row?.safety_floor) === 200
    && asNumber(row?.forecast_horizon_months) === 6
    && row?.onboarding_completed === false
    && row?.zero_based_budget_enabled === false
    && row?.debt_payoff_enabled === true
    && row?.calendar_start_date === null;
}

function userPreferencesArePristine(row, userId, householdId) {
  const emptyObject = value => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
  return row?.user_id === userId
    && row?.active_household_id === householdId
    && emptyObject(row?.decision_hub_settings)
    && emptyObject(row?.onboarding_preferences)
    && emptyObject(row?.dashboard_layouts)
    && emptyObject(row?.notification_center_states);
}

function assertAtMostOne(rows, label) {
  if (rows.length > 1) throw new Error(`Reviewer fixture preflight found multiple ${label}; refusing to mutate this account.`);
}

function assertEmpty(rows, label) {
  if (rows.length > 0) throw new Error(`Reviewer fixture preflight found existing ${label}; refusing to mix fixture and account data.`);
}

export function assertReviewerAuthMetadata(user, userId) {
  if (!user || user.id !== userId) throw new Error("Reviewer user was not found or did not match the requested user ID.");
  if (user.app_metadata?.flowledger_reviewer_fixture !== true) {
    throw new Error("Reviewer user must be explicitly marked flowledger_reviewer_fixture by an authorized operator.");
  }
  if (!user.email || !user.email_confirmed_at || user.is_anonymous === true) {
    throw new Error("Reviewer fixture requires a confirmed, non-anonymous reviewer login.");
  }
}

export function assertReviewerFixturePreflight({ fixture, userId, user, snapshot }) {
  assertReviewerAuthMetadata(user, userId);

  assertAtMostOne(snapshot.ownedHouseholds, "owned households");
  const household = snapshot.ownedHouseholds[0] ?? null;
  const budget = snapshot.budgets[0] ?? null;

  if (!household) {
    assertEmpty(snapshot.membershipsForUser, "household memberships");
    assertEmpty(snapshot.budgets, "budgets without an owned personal household");
  } else {
    if (household.created_by !== userId || household.is_personal !== true) {
      throw new Error("Reviewer fixture requires one personal household owned by the reviewer.");
    }
    if (!["My Household", fixture.householdName].includes(household.name)) {
      throw new Error("Reviewer household has a non-fixture name; refusing to rename or overwrite it.");
    }
    if (snapshot.membershipsForUser.length !== 1
      || snapshot.membershipsForUser[0].household_id !== household.id
      || snapshot.membershipsForUser[0].role !== "owner") {
      throw new Error("Reviewer fixture account must belong only to its personal household as owner.");
    }
    if (snapshot.householdMembers.length !== 1
      || snapshot.householdMembers[0].user_id !== userId
      || snapshot.householdMembers[0].role !== "owner") {
      throw new Error("Reviewer household must not contain another member or an unexpected role.");
    }
    assertAtMostOne(snapshot.budgets, "household budgets");
    if (budget && (budget.household_id !== household.id || budget.is_default !== true || budget.name !== "Main Budget")) {
      throw new Error("Reviewer household contains a non-default or non-fixture budget.");
    }
  }

  assertAtMostOne(snapshot.householdPlans, "household plan rows");
  const plan = snapshot.householdPlans[0];
  if (plan && (plan.tier !== "free" || plan.source !== "default")) {
    throw new Error("Founding Free reviewer must use a fresh/default Free plan; refusing to overwrite an elevated plan.");
  }

  for (const table of PLAID_TABLES) assertEmpty(snapshot.plaidRows[table.name] ?? [], `${table.name} or retained Plaid credentials`);
  for (const table of BILLING_TABLES) assertEmpty(snapshot.billingRows[table.name] ?? [], `${table.name} billing history`);
  for (const table of EMPTY_FINANCIAL_TABLES) assertEmpty(snapshot.financialRows[table.name] ?? [], table.name);
  assertEmpty(snapshot.feedbackAdmins, "administrator access");

  const expected = fixtureIds(fixture, userId);
  let knownFixtureRowCount = 0;
  for (const table of FIXTURE_TABLES) {
    const allowedIds = new Set(expected[table.name]);
    for (const row of snapshot.financialRows[table.name] ?? []) {
      if (!allowedIds.has(row.id)) {
        throw new Error(`Reviewer fixture preflight found a non-fixture ${table.name} row; refusing to overwrite financial data.`);
      }
      if (!household || !budget
        || row.user_id !== userId
        || row.household_id !== household.id
        || row.budget_id !== budget.id) {
        throw new Error(`Reviewer fixture preflight found incorrectly scoped ${table.name} data.`);
      }
      knownFixtureRowCount += 1;
    }
  }

  const knownFixtureState = knownFixtureRowCount > 0 || household?.name === fixture.householdName;
  assertAtMostOne(snapshot.settings, "settings rows");
  assertAtMostOne(snapshot.householdSettings, "household settings rows");
  assertAtMostOne(snapshot.userPreferences, "user preference rows");
  const householdSettingsState = !snapshot.householdSettings[0]
    ? "absent"
    : householdSettingsMatchFixture(snapshot.householdSettings[0], fixture, household?.id, budget?.id)
      ? "fixture"
      : householdSettingsArePristine(snapshot.householdSettings[0], household?.id, budget?.id)
        ? "pristine"
        : "unknown";
  if (householdSettingsState === "unknown") {
    throw new Error("Reviewer household settings contain non-fixture planning data; refusing to overwrite them.");
  }
  const userPreferencesState = !snapshot.userPreferences[0]
    ? "absent"
    : userPreferencesArePristine(snapshot.userPreferences[0], userId, household?.id)
      ? "pristine"
      : "unknown";
  if (userPreferencesState === "unknown") {
    throw new Error("Reviewer account preferences contain non-fixture state; refusing to overwrite them.");
  }
  if (!knownFixtureState) {
    assertEmpty(snapshot.settings, "pre-existing settings");
  } else {
    if (snapshot.settings[0] && !settingsMatchFixture(snapshot.settings[0], fixture)) {
      throw new Error("Reviewer settings no longer match the known fixture; refusing to overwrite them.");
    }
  }

  assertAtMostOne(snapshot.billingSandboxTesters, "billing sandbox tester rows");
  if (snapshot.billingSandboxTesters[0]
    && (user.app_metadata?.flowledger_store_reviewer !== true
      || snapshot.billingSandboxTesters[0].purpose !== "store_review")) {
    throw new Error("Reviewer account contains unexpected billing sandbox access.");
  }

  return {
    household,
    budget,
    plan,
    householdSettingsState,
    userPreferencesState,
    storeReviewer: user.app_metadata?.flowledger_store_reviewer === true,
  };
}

export async function seedReviewerFixture({ repository, fixture, userId, confirmation }) {
  if (confirmation !== "FICTIONAL_ONLY") {
    throw new Error("Set FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM=FICTIONAL_ONLY. Never run this against a real customer account.");
  }

  // These repository calls are read-only. Every eligibility check completes
  // before applyFixture is allowed to perform the first write.
  const user = await repository.getUser(userId);
  assertReviewerAuthMetadata(user, userId);
  const snapshot = await repository.readSnapshot(userId);
  const eligibility = assertReviewerFixturePreflight({ fixture, userId, user, snapshot });
  return repository.applyFixture({ fixture, userId, user, snapshot, eligibility });
}

function uniqueRows(rows, key = "id") {
  const unique = new Map();
  rows.forEach((row, index) => {
    const identity = row?.[key] ?? JSON.stringify(row) ?? String(index);
    unique.set(identity, row);
  });
  return [...unique.values()];
}

function createSupabaseRepository(db) {
  const readRows = async (query, label) => {
    const { data, error } = await query;
    if (error) throw new Error(`Reviewer fixture preflight could not read ${label}: ${error.message}`, { cause: error });
    return data ?? [];
  };
  const write = async (query, label) => {
    const { data, error } = await query;
    if (error) throw new Error(`Reviewer fixture could not write ${label}: ${error.message}`, { cause: error });
    return data;
  };

  const readScopedTable = async (spec, userId, householdId) => {
    const userColumn = spec.userColumn === undefined ? "user_id" : spec.userColumn;
    const householdColumn = spec.householdColumn === undefined ? "household_id" : spec.householdColumn;
    const reads = [];
    if (userColumn) reads.push(readRows(db.from(spec.name).select(spec.select).eq(userColumn, userId), `${spec.name} by reviewer`));
    if (householdId && householdColumn) reads.push(readRows(db.from(spec.name).select(spec.select).eq(householdColumn, householdId), `${spec.name} by household`));
    return uniqueRows((await Promise.all(reads)).flat(), spec.key);
  };

  return {
    async getUser(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data.user) throw error || new Error("Reviewer user was not found.");
      return data.user;
    },

    async readSnapshot(userId) {
      const [ownedHouseholds, membershipsForUser, settings, userPreferences, feedbackAdmins, billingSandboxTesters] = await Promise.all([
        readRows(db.from("households").select("id,name,created_by,is_personal").eq("created_by", userId), "owned households"),
        readRows(db.from("household_members").select("household_id,user_id,role").eq("user_id", userId), "reviewer household memberships"),
        readRows(db.from("settings").select("*").eq("user_id", userId), "reviewer settings"),
        readRows(db.from("user_preferences").select("*").eq("user_id", userId), "reviewer preferences"),
        readRows(db.from("feedback_admins").select("user_id").eq("user_id", userId), "administrator access"),
        readRows(db.from("billing_sandbox_testers").select("user_id,purpose").eq("user_id", userId), "billing sandbox access"),
      ]);

      const candidateHousehold = ownedHouseholds.length === 1 ? ownedHouseholds[0] : null;
      const householdId = candidateHousehold?.id ?? null;
      const [householdMembers, budgets, householdPlans, householdSettings, fixtureRows, emptyRows, plaidRows, billingRows] = await Promise.all([
        householdId ? readRows(db.from("household_members").select("household_id,user_id,role").eq("household_id", householdId), "household members") : [],
        householdId ? readRows(db.from("budgets").select("id,household_id,name,is_default").eq("household_id", householdId), "household budgets") : [],
        householdId ? readRows(db.from("household_plans").select("household_id,tier,source").eq("household_id", householdId), "household plan") : [],
        householdId ? readRows(db.from("household_settings").select("*").eq("household_id", householdId), "household settings") : [],
        Promise.all(FIXTURE_TABLES.map(async spec => [spec.name, await readScopedTable(spec, userId, householdId)])),
        Promise.all(EMPTY_FINANCIAL_TABLES.map(async spec => [spec.name, await readScopedTable(spec, userId, householdId)])),
        Promise.all(PLAID_TABLES.map(async spec => [spec.name, await readScopedTable(spec, userId, householdId)])),
        Promise.all(BILLING_TABLES.map(async spec => [spec.name, await readScopedTable(spec, userId, householdId)])),
      ]);

      return {
        ownedHouseholds,
        membershipsForUser,
        householdMembers,
        budgets,
        householdPlans,
        settings,
        householdSettings,
        userPreferences,
        feedbackAdmins,
        billingSandboxTesters,
        financialRows: Object.fromEntries([...fixtureRows, ...emptyRows]),
        plaidRows: Object.fromEntries(plaidRows),
        billingRows: Object.fromEntries(billingRows),
      };
    },

    async applyFixture({ fixture, userId, snapshot, eligibility }) {
      let household = eligibility.household;
      const createdHousehold = !household;
      if (!household) {
        household = await write(
          db.from("households").insert({ name: fixture.householdName, created_by: userId, is_personal: true }).select("id,name,created_by,is_personal").single(),
          "reviewer household",
        );
      } else {
        if (household.name !== fixture.householdName) {
          household = await write(
            db.from("households").update({ name: fixture.householdName }).eq("id", household.id).eq("created_by", userId).eq("is_personal", true).eq("name", "My Household").select("id,name,created_by,is_personal").single(),
            "reviewer household name",
          );
        }
      }
      if (createdHousehold) {
        await write(db.from("household_members").insert(
          { household_id: household.id, user_id: userId, role: "owner" },
        ), "reviewer membership");
      }

      let budget = eligibility.budget;
      if (!budget) {
        budget = await write(
          db.from("budgets").insert({ household_id: household.id, name: "Main Budget", is_default: true }).select("id,household_id,name,is_default").single(),
          "reviewer budget",
        );
      }

      const scoped = row => ({ ...row, user_id: userId, household_id: household.id, budget_id: budget.id });
      const id = (kind, key) => fixtureRowId(fixture, userId, kind, key);
      const now = `${fixture.anchorDate}T12:00:00.000Z`;

      if (snapshot.settings.length === 0) {
        await write(db.from("settings").insert({
          user_id: userId, payment_method: "snowball", planning_mode: "snowball", debt_payoff_enabled: true,
          starting_balance: fixture.startingBalance, starting_balance_date: fixture.anchorDate,
          safety_floor: fixture.safetyFloor, forecast_horizon_months: 6, onboarding_completed: true,
        }), "reviewer settings");
      }
      const fixtureHouseholdSettings = {
        household_id: household.id, budget_id: budget.id,
        payment_method: "snowball", planning_mode: "snowball", zero_based_budget_enabled: false, debt_payoff_enabled: true,
        starting_balance: fixture.startingBalance, starting_balance_date: fixture.anchorDate,
        calendar_start_date: `${fixture.anchorDate.slice(0, 7)}-01`, safety_floor: fixture.safetyFloor,
        forecast_horizon_months: 6, onboarding_completed: true, time_zone: "America/Chicago",
        automatic_rollover_started_on: fixture.anchorDate, updated_at: now,
      };
      if (eligibility.householdSettingsState === "absent" && eligibility.budget) {
        await write(db.from("household_settings").insert(fixtureHouseholdSettings), "reviewer household settings");
      } else if (eligibility.householdSettingsState !== "fixture") {
        await write(
          db.from("household_settings").update(fixtureHouseholdSettings)
            .eq("household_id", household.id).eq("budget_id", budget.id)
            .eq("payment_method", "snowball").eq("planning_mode", "snowball")
            .eq("starting_balance", 0).is("starting_balance_date", null)
            .eq("safety_floor", 200).eq("forecast_horizon_months", 6)
            .eq("onboarding_completed", false).eq("zero_based_budget_enabled", false)
            .eq("debt_payoff_enabled", true).is("calendar_start_date", null)
            .select("household_id").single(),
          "pristine reviewer household settings",
        );
      }
      if (eligibility.userPreferencesState === "absent") {
        await write(db.from("user_preferences").insert({ user_id: userId, active_household_id: household.id, updated_at: now }), "reviewer preferences");
      }
      await write(db.from("accounts").upsert(fixture.accounts.map(account => scoped({
        id: id("account", account.key), ...account, key: undefined,
        balance_as_of: fixture.anchorDate, last_reconciled_at: now, is_active: true,
      })), { onConflict: "id" }), "fixture accounts");
      await write(db.from("incomes").upsert(fixture.incomes.map(income => scoped({
        id: id("income", income.key), ...income, key: undefined,
        amount_history: [], excluded_dates: [], last_reviewed_at: now,
      })), { onConflict: "id" }), "fixture incomes");
      await write(db.from("bills").upsert(fixture.bills.map((bill, index) => scoped({
        id: id("bill", bill.key), ...bill, key: undefined, priority: bill.is_debt ? index + 1 : 0,
        is_recurring: true, frequency: "monthly", include_in_snowball: true,
        start_date: "2026-08-01", created_at: now, last_reviewed_at: now,
      })), { onConflict: "id" }), "fixture bills");
      await write(db.from("transactions").upsert(fixture.transactions.map(transaction => scoped({
        id: id("transaction", transaction.key), ...transaction, key: undefined,
      })), { onConflict: "id" }), "fixture transactions");
      await write(db.from("goals").upsert(fixture.goals.map(goal => scoped({
        id: id("goal", goal.key), ...goal, key: undefined, created_at: now,
      })), { onConflict: "id" }), "fixture goals");
      if (!eligibility.plan && !createdHousehold) {
        await write(db.from("household_plans").insert(
          { household_id: household.id, tier: "free", source: "default" },
        ), "Founding Free plan");
      }
      if (eligibility.storeReviewer && snapshot.billingSandboxTesters.length === 0) {
        await write(db.from("billing_sandbox_testers").insert(
          { user_id: userId, purpose: "store_review" },
        ), "store reviewer sandbox marker");
      }
      return { householdId: household.id, budgetId: budget.id };
    },
  };
}

export async function main(environment = process.env) {
  const fixture = JSON.parse(await readFile(new URL("../store-assets/v1/fixture/reviewer-v1.json", import.meta.url), "utf8"));
  const userId = required(environment, "FLOWLEDGER_REVIEWER_USER_ID");
  const db = createClient(
    required(environment, "SUPABASE_URL"),
    required(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const result = await seedReviewerFixture({
    repository: createSupabaseRepository(db), fixture, userId,
    confirmation: environment.FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM,
  });
  console.log(`Seeded fictional reviewer fixture v${fixture.version} for household ${result.householdId}. No Plaid Item or access token was created.`);
  return result;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
