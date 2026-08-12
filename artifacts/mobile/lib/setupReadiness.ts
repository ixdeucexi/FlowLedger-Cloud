import type {
  OnboardingPreferences,
  SetupConfirmationId,
  SetupScopeProgress,
  SetupStageId,
} from "./onboarding";

export const SETUP_STAGE_ORDER: SetupStageId[] = [
  "priorities",
  "starting_money",
  "cashflow",
  "debt_savings",
  "review",
];

export interface SetupReadinessAccount {
  is_active?: boolean;
  balance_as_of?: string;
}

export interface SetupReadinessBill {
  is_debt?: boolean;
  is_recurring?: boolean;
}

export interface SetupReadinessInput {
  preferences: OnboardingPreferences;
  progress: SetupScopeProgress;
  accounts: SetupReadinessAccount[];
  incomeCount: number;
  bills: SetupReadinessBill[];
  goalCount: number;
  safetyFloor: number;
  forecastMonths: number;
}

export interface SetupStageStatus {
  id: SetupStageId;
  label: string;
  shortLabel: string;
  detail: string;
  complete: boolean;
}

export interface SetupReadiness {
  stages: SetupStageStatus[];
  completeCount: number;
  isComplete: boolean;
  firstIncompleteStage: SetupStageId;
  wantsSavings: boolean;
}

const STAGE_COPY: Record<SetupStageId, Omit<SetupStageStatus, "id" | "complete">> = {
  priorities: {
    label: "Choose your priorities",
    shortLabel: "Priorities",
    detail: "Tell Flo where you are starting and what should come first.",
  },
  starting_money: {
    label: "Set your starting money",
    shortLabel: "Starting money",
    detail: "Add the everyday account, balance, and balance date in one place.",
  },
  cashflow: {
    label: "Add income and bills",
    shortLabel: "Cash flow",
    detail: "Add what comes in and what must go out, or confirm that a section does not apply.",
  },
  debt_savings: {
    label: "Add debt and savings",
    shortLabel: "Debt & savings",
    detail: "Build the payoff and savings branches that matter to your plan.",
  },
  review: {
    label: "Review your first plan",
    shortLabel: "Review",
    detail: "Confirm the safety cushion, check the facts, and open your Forecast.",
  },
};

export function setupScopeKey(userId?: string | null, householdId?: string | null): string {
  return householdId || (userId ? `personal-${userId}` : "signed-out");
}

export function hasSetupConfirmation(progress: SetupScopeProgress, confirmation: SetupConfirmationId): boolean {
  return progress.confirmations.includes(confirmation);
}

export function withSetupConfirmation(
  progress: SetupScopeProgress,
  confirmation: SetupConfirmationId,
  enabled: boolean,
  now = new Date().toISOString(),
): SetupScopeProgress {
  const confirmations = enabled
    ? Array.from(new Set([...progress.confirmations, confirmation]))
    : progress.confirmations.filter(item => item !== confirmation);
  return { ...progress, confirmations, updatedAt: now };
}

export function buildSetupReadiness(input: SetupReadinessInput): SetupReadiness {
  const activeAccounts = input.accounts.filter(account => account.is_active !== false);
  const prioritiesComplete = Boolean(input.preferences.startingPoint) && input.preferences.help.length > 0;
  const startingMoneyComplete = activeAccounts.some(account => Boolean(account.balance_as_of));
  const incomeComplete = input.incomeCount > 0 || hasSetupConfirmation(input.progress, "income_none");
  const recurringBillCount = input.bills.filter(bill => !bill.is_debt && bill.is_recurring !== false).length;
  const billsComplete = recurringBillCount > 0 || hasSetupConfirmation(input.progress, "bills_none");
  const debtCount = input.bills.filter(bill => bill.is_debt).length;
  const debtsComplete = debtCount > 0 || hasSetupConfirmation(input.progress, "debts_none");
  const wantsSavings = input.preferences.help.includes("grow_savings") || input.preferences.goals.includes("grow_savings");
  const goalsComplete = !wantsSavings || input.goalCount > 0 || hasSetupConfirmation(input.progress, "goals_none");
  const reviewComplete =
    Number.isFinite(input.safetyFloor) && input.safetyFloor >= 0 &&
    Number.isFinite(input.forecastMonths) && input.forecastMonths >= 1 &&
    hasSetupConfirmation(input.progress, "safety_reviewed");

  const completeByStage: Record<SetupStageId, boolean> = {
    priorities: prioritiesComplete,
    starting_money: startingMoneyComplete,
    cashflow: incomeComplete && billsComplete,
    debt_savings: debtsComplete && goalsComplete,
    review: prioritiesComplete && startingMoneyComplete && incomeComplete && billsComplete && debtsComplete && goalsComplete && reviewComplete,
  };
  const stages = SETUP_STAGE_ORDER.map(id => ({ id, ...STAGE_COPY[id], complete: completeByStage[id] }));
  return {
    stages,
    completeCount: stages.filter(stage => stage.complete).length,
    isComplete: stages.every(stage => stage.complete),
    firstIncompleteStage: stages.find(stage => !stage.complete)?.id ?? "review",
    wantsSavings,
  };
}

export function setupStageIndex(stage: SetupStageId): number {
  return Math.max(0, SETUP_STAGE_ORDER.indexOf(stage));
}

export function canonicalResumeStage(readiness: SetupReadiness, progress: SetupScopeProgress): SetupStageId {
  if (readiness.isComplete) return "review";
  const firstIncompleteIndex = setupStageIndex(readiness.firstIncompleteStage);
  const storedIndex = setupStageIndex(progress.currentStage);
  return SETUP_STAGE_ORDER[Math.min(firstIncompleteIndex, storedIndex)] ?? readiness.firstIncompleteStage;
}
