export type SetupHelpOption =
  | "track_spending"
  | "lower_bills"
  | "pay_off_debt"
  | "grow_savings"
  | "create_budget"
  | "stay_organized";

export type SetupGoalOption =
  | "reduce_spending"
  | "pay_off_debt"
  | "grow_savings"
  | "stay_on_top"
  | "something_else";

export type SavingsGoalOption =
  | "emergency_fund"
  | "house"
  | "car"
  | "debt_payoff"
  | "something_else";

export type MoneySetupKey =
  | "account"
  | "money"
  | "income"
  | "bills"
  | "debts"
  | "goals"
  | "safety"
  | "reconcile"
  | "finish";

export interface OnboardingPreferences {
  help: SetupHelpOption[];
  goals: SetupGoalOption[];
  savingsGoal: SavingsGoalOption | null;
  updatedAt?: string;
}

export const DEFAULT_ONBOARDING_PREFERENCES: OnboardingPreferences = {
  help: [],
  goals: [],
  savingsGoal: null,
};

const HELP_OPTIONS = new Set<SetupHelpOption>([
  "track_spending",
  "lower_bills",
  "pay_off_debt",
  "grow_savings",
  "create_budget",
  "stay_organized",
]);

const GOAL_OPTIONS = new Set<SetupGoalOption>([
  "reduce_spending",
  "pay_off_debt",
  "grow_savings",
  "stay_on_top",
  "something_else",
]);

const SAVINGS_OPTIONS = new Set<SavingsGoalOption>([
  "emergency_fund",
  "house",
  "car",
  "debt_payoff",
  "something_else",
]);

function normalizeArray<T extends string>(value: unknown, valid: Set<T>): T[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is T => typeof item === "string" && valid.has(item as T))));
}

export function normalizeOnboardingPreferences(value: unknown): OnboardingPreferences {
  const parsed = value && typeof value === "object" ? value as Partial<OnboardingPreferences> : {};
  const savingsGoal = typeof parsed.savingsGoal === "string" && SAVINGS_OPTIONS.has(parsed.savingsGoal as SavingsGoalOption)
    ? parsed.savingsGoal as SavingsGoalOption
    : null;
  return {
    help: normalizeArray(parsed.help, HELP_OPTIONS),
    goals: normalizeArray(parsed.goals, GOAL_OPTIONS),
    savingsGoal,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
  };
}

export function shouldAskSavingsGoal(preferences: OnboardingPreferences): boolean {
  return preferences.help.includes("grow_savings") || preferences.goals.includes("grow_savings");
}

export function buildPersonalizedSetupKeys(preferences: OnboardingPreferences): MoneySetupKey[] {
  const keys: MoneySetupKey[] = ["account", "money"];
  const add = (key: MoneySetupKey) => {
    if (!keys.includes(key)) keys.push(key);
  };

  const wantsBudget =
    preferences.help.includes("create_budget") ||
    preferences.help.includes("track_spending") ||
    preferences.goals.includes("reduce_spending") ||
    preferences.goals.includes("stay_on_top") ||
    preferences.goals.includes("something_else");
  const wantsDebt = preferences.help.includes("pay_off_debt") || preferences.goals.includes("pay_off_debt");
  const wantsSavings = preferences.help.includes("grow_savings") || preferences.goals.includes("grow_savings");
  const wantsBills = preferences.help.includes("lower_bills") || preferences.help.includes("create_budget");

  add("income");
  if (wantsBudget || wantsBills || preferences.help.length === 0) add("bills");
  if (wantsDebt) add("debts");
  if (wantsSavings) add("goals");

  // If the user did not reveal a strong preference, keep the original full setup.
  if (!wantsBudget && !wantsBills && !wantsDebt && !wantsSavings) {
    add("bills");
    add("debts");
    add("goals");
  }

  add("safety");
  add("reconcile");
  add("finish");
  return keys;
}

export function describeSetupPlan(preferences: OnboardingPreferences): string {
  const parts: string[] = [];
  if (preferences.goals.includes("pay_off_debt") || preferences.help.includes("pay_off_debt")) {
    parts.push("debt payoff");
  }
  if (preferences.goals.includes("grow_savings") || preferences.help.includes("grow_savings")) {
    parts.push("savings goals");
  }
  if (preferences.help.includes("lower_bills")) parts.push("bill review");
  if (preferences.help.includes("track_spending") || preferences.help.includes("create_budget")) {
    parts.push("spending and budget setup");
  }
  if (parts.length === 0) return "I’ll build the full forecast path: accounts, income, bills, debt, goals, and your safety cushion.";
  return `I’ll focus setup around ${parts.join(", ")} while still protecting your forecast.`;
}
