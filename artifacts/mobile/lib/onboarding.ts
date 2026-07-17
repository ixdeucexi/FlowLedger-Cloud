export type SetupHelpOption =
  | "track_spending"
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

export type SetupStartingPoint =
  | "first_budget"
  | "switching_apps"
  | "catching_up"
  | "paycheck_to_paycheck"
  | "building_room";

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

export interface SetupPathItem {
  key: MoneySetupKey;
  title: string;
  shortLabel: string;
  detail: string;
}

export interface OnboardingPreferences {
  startingPoint: SetupStartingPoint | null;
  help: SetupHelpOption[];
  goals: SetupGoalOption[];
  savingsGoal: SavingsGoalOption | null;
  updatedAt?: string;
}

export const DEFAULT_ONBOARDING_PREFERENCES: OnboardingPreferences = {
  startingPoint: null,
  help: [],
  goals: [],
  savingsGoal: null,
};

const STARTING_POINTS = new Set<SetupStartingPoint>([
  "first_budget",
  "switching_apps",
  "catching_up",
  "paycheck_to_paycheck",
  "building_room",
]);

const HELP_OPTIONS = new Set<SetupHelpOption>([
  "track_spending",
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
    startingPoint: typeof parsed.startingPoint === "string" && STARTING_POINTS.has(parsed.startingPoint as SetupStartingPoint)
      ? parsed.startingPoint as SetupStartingPoint
      : null,
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
  const wantsBills = preferences.help.includes("create_budget");

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

export function getSetupPathItem(key: MoneySetupKey): SetupPathItem {
  const items: Record<MoneySetupKey, SetupPathItem> = {
    account: {
      key,
      title: "Connect the money source",
      shortLabel: "Account",
      detail: "Add the account FlowLedger should forecast from.",
    },
    money: {
      key,
      title: "Anchor today's balance",
      shortLabel: "Balance",
      detail: "Set the real starting point for the forecast.",
    },
    income: {
      key,
      title: "Add money coming in",
      shortLabel: "Income",
      detail: "Add paychecks, deposits, or recurring income.",
    },
    bills: {
      key,
      title: "Map monthly obligations",
      shortLabel: "Bills",
      detail: "Add recurring bills so tight weeks show early.",
    },
    debts: {
      key,
      title: "Build the payoff path",
      shortLabel: "Debt",
      detail: "Add debts so the snowball can protect cash flow.",
    },
    goals: {
      key,
      title: "Name the savings target",
      shortLabel: "Goals",
      detail: "Add savings goals so extra money has a job.",
    },
    safety: {
      key,
      title: "Choose the safety cushion",
      shortLabel: "Cushion",
      detail: "Tell Flo how much breathing room to protect.",
    },
    reconcile: {
      key,
      title: "Confirm the real balance",
      shortLabel: "Confirm",
      detail: "Match FlowLedger to the bank before decisions.",
    },
    finish: {
      key,
      title: "Ask the first decision",
      shortLabel: "Ask Flo",
      detail: "Use the setup to answer a real money question.",
    },
  };
  return items[key];
}

export function buildSetupCompletionMessage(preferences: OnboardingPreferences): string {
  const focus = describeSetupPlan(preferences);
  const setupLabels = buildPersonalizedSetupKeys(preferences)
    .filter(key => key !== "finish")
    .map(key => getSetupPathItem(key).shortLabel.toLowerCase());
  return `${focus} Once ${setupLabels.join(", ")} are in place, your real forecast can show what is protected through payday, how many stability days you have, and the next action that helps most.`;
}

export function describeSetupPlan(preferences: OnboardingPreferences): string {
  const parts: string[] = [];
  if (preferences.goals.includes("pay_off_debt") || preferences.help.includes("pay_off_debt")) {
    parts.push("debt payoff");
  }
  if (preferences.goals.includes("grow_savings") || preferences.help.includes("grow_savings")) {
    parts.push("savings goals");
  }
  if (preferences.help.includes("track_spending") || preferences.help.includes("create_budget")) {
    parts.push("spending and budget setup");
  }
  const startingPoint = describeStartingPoint(preferences.startingPoint);
  if (parts.length === 0) return `${startingPoint} I'll build the full forecast path: accounts, income, bills, debt, goals, and your safety floor.`;
  return `${startingPoint} I'll focus setup around ${parts.join(", ")} while still protecting your forecast.`;
}

export function describeStartingPoint(startingPoint: SetupStartingPoint | null): string {
  switch (startingPoint) {
    case "first_budget":
      return "I'll explain each step and start with only the money facts needed for your first useful plan.";
    case "switching_apps":
      return "I'll keep setup efficient and help you confirm imported or existing information instead of making you start over.";
    case "catching_up":
      return "I'll put overdue necessities and the next low-balance day first.";
    case "paycheck_to_paycheck":
      return "I'll focus first on reaching the next paycheck safely, then building protected days.";
    case "building_room":
      return "I'll help turn safe extra money into 7, 30, 60, then 90 days of Must Pay backup.";
    default:
      return "I'll meet you where your money plan is today.";
  }
}
