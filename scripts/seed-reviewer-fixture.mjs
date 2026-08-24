import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const required = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixture = JSON.parse(await readFile(new URL("../store-assets/v1/fixture/reviewer-v1.json", import.meta.url), "utf8"));
const userId = required("FLOWLEDGER_REVIEWER_USER_ID");
if (process.env.FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM !== "FICTIONAL_ONLY") {
  throw new Error("Set FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM=FICTIONAL_ONLY. Never run this against a real customer account.");
}
const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const { data: userResult, error: userError } = await db.auth.admin.getUserById(userId);
if (userError || !userResult.user) throw userError || new Error("Reviewer user was not found.");
const storeReviewer = userResult.user.app_metadata?.flowledger_store_reviewer === true;
if (userResult.user.app_metadata?.flowledger_reviewer_fixture !== true && !storeReviewer) {
  throw new Error("Reviewer user must be marked flowledger_reviewer_fixture or flowledger_store_reviewer by an authorized operator.");
}

let { data: household, error: householdError } = await db.from("households").select("id").eq("created_by", userId).eq("is_personal", true).maybeSingle();
if (householdError) throw householdError;
if (!household) {
  const result = await db.from("households").insert({ name: fixture.householdName, created_by: userId, is_personal: true }).select("id").single();
  if (result.error) throw result.error;
  household = result.data;
} else {
  const { error } = await db.from("households").update({ name: fixture.householdName }).eq("id", household.id).eq("created_by", userId);
  if (error) throw error;
}
await db.from("household_members").upsert({ household_id: household.id, user_id: userId, role: "owner" }, { onConflict: "household_id,user_id" }).throwOnError();
let { data: budget, error: budgetError } = await db.from("budgets").select("id").eq("household_id", household.id).eq("is_default", true).maybeSingle();
if (budgetError) throw budgetError;
if (!budget) {
  const result = await db.from("budgets").insert({ household_id: household.id, name: "Main Budget", is_default: true }).select("id").single();
  if (result.error) throw result.error;
  budget = result.data;
}

const scoped = row => ({ ...row, user_id: userId, household_id: household.id, budget_id: budget.id });
const id = (kind, key) => `reviewer-v${fixture.version}-${kind}-${userId}-${key}`;
const now = `${fixture.anchorDate}T12:00:00.000Z`;

await db.from("settings").upsert({
  user_id: userId, payment_method: "snowball", planning_mode: "snowball", debt_payoff_enabled: true,
  starting_balance: fixture.startingBalance, starting_balance_date: fixture.anchorDate,
  safety_floor: fixture.safetyFloor, forecast_horizon_months: 6, onboarding_completed: true,
}, { onConflict: "user_id" }).throwOnError();
await db.from("household_settings").upsert({
  household_id: household.id, budget_id: budget.id,
  payment_method: "snowball", planning_mode: "snowball",
  zero_based_budget_enabled: false, debt_payoff_enabled: true,
  starting_balance: fixture.startingBalance, starting_balance_date: fixture.anchorDate,
  calendar_start_date: `${fixture.anchorDate.slice(0, 7)}-01`,
  safety_floor: fixture.safetyFloor, forecast_horizon_months: 6,
  onboarding_completed: true, time_zone: "America/Chicago",
  automatic_rollover_started_on: fixture.anchorDate, updated_at: now,
}, { onConflict: "household_id" }).throwOnError();
await db.from("user_preferences").upsert({
  user_id: userId, active_household_id: household.id, updated_at: now,
}, { onConflict: "user_id" }).throwOnError();
await db.from("accounts").upsert(fixture.accounts.map(account => scoped({ id: id("account", account.key), ...account, key: undefined, balance_as_of: fixture.anchorDate, last_reconciled_at: now, is_active: true })), { onConflict: "id" }).throwOnError();
await db.from("incomes").upsert(fixture.incomes.map(income => scoped({ id: id("income", income.key), ...income, key: undefined, amount_history: [], excluded_dates: [], last_reviewed_at: now })), { onConflict: "id" }).throwOnError();
await db.from("bills").upsert(fixture.bills.map((bill, index) => scoped({ id: id("bill", bill.key), ...bill, key: undefined, priority: bill.is_debt ? index + 1 : 0, is_recurring: true, frequency: "monthly", include_in_snowball: true, start_date: "2026-08-01", created_at: now, last_reviewed_at: now })), { onConflict: "id" }).throwOnError();
await db.from("transactions").upsert(fixture.transactions.map(transaction => scoped({ id: id("transaction", transaction.key), ...transaction, key: undefined })), { onConflict: "id" }).throwOnError();
await db.from("goals").upsert(fixture.goals.map(goal => scoped({ id: id("goal", goal.key), ...goal, key: undefined, created_at: now })), { onConflict: "id" }).throwOnError();
const { data: existingPlan, error: existingPlanError } = await db.from("household_plans").select("tier,source").eq("household_id", household.id).maybeSingle();
if (existingPlanError) throw existingPlanError;
if (existingPlan && (existingPlan.source !== "default" || existingPlan.tier !== "free")) {
  throw new Error("Founding Free reviewer must use a fresh Free account; refusing to overwrite an existing plan.");
}
await db.from("household_plans").upsert({ household_id: household.id, tier: "free", source: "default" }, { onConflict: "household_id" }).throwOnError();
if (storeReviewer) {
  // Kept only for a later paid-release sandbox. Founding Free review uses the
  // ordinary feature-reviewer account and exposes no purchase controls.
  await db.from("billing_sandbox_testers").upsert({ user_id: userId, purpose: "store_review" }, { onConflict: "user_id" }).throwOnError();
}

console.log(`Seeded fictional reviewer fixture v${fixture.version} for household ${household.id}. No Plaid Item or access token was created.`);
