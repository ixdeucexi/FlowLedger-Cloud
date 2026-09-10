import type { PlanSimulationBaseline } from "./planSimulator";

export interface GoalContributionReview {
  expected: { householdId: string; goalId: string; currentAmount: number; targetAmount: number; date: string; revision: unknown };
  amount: number;
  accountId: string | null;
  message: string;
}
export type GoalContributionStep =
  | { stage: "entry" }
  | { stage: "review" | "saving"; review: GoalContributionReview };
export type GoalContributionStepAction =
  | { type: "review"; review: GoalContributionReview }
  | { type: "edit" | "record" | "retry" | "reset" };

/** Entry and confirmation deliberately share one native Modal surface. */
export function goalContributionStepReducer(state: GoalContributionStep, action: GoalContributionStepAction): GoalContributionStep {
  if (action.type === "reset") return { stage: "entry" };
  if (action.type === "retry" && state.stage === "saving") return { stage: "review", review: state.review };
  if (state.stage === "saving") return state;
  if (action.type === "edit") return { stage: "entry" };
  if (action.type === "review") return { stage: "review", review: action.review };
  if (action.type === "record" && state.stage === "review") return { stage: "saving", review: state.review };
  return state;
}

/** One shared, dated estimate—not a monthly allocation for every goal. */
export function goalFundingCushion(baseline: PlanSimulationBaseline, safetyFloor: number): number | null {
  if (!baseline.days.length || !Number.isFinite(safetyFloor) || safetyFloor < 0
    || !Number.isFinite(baseline.openingBalance)
    || baseline.days.some(day => !Number.isFinite(day.balance))) return null;
  const minimum = baseline.days.reduce((value, day) => Math.min(value, day.balance), baseline.openingBalance);
  return Math.floor(Math.max(0, minimum - safetyFloor) * 100) / 100;
}

export function parseGoalContribution(text: string, remaining: number): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text.trim())) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 && Number.isFinite(remaining)
    && Math.round(amount * 100) <= Math.round(remaining * 100) ? amount : null;
}

export function goalContributionSnapshotMatches(
  expected: { householdId: string; goalId: string; currentAmount: number; targetAmount: number; date: string; revision: unknown },
  current: { householdId?: string; goals: { id: string; current_amount: number; target_amount: number }[]; date: string; revision: unknown; canEdit: boolean },
): boolean {
  const goal = current.goals.find(item => item.id === expected.goalId);
  return current.canEdit && current.householdId === expected.householdId && current.date === expected.date
    && current.revision === expected.revision && goal?.current_amount === expected.currentAmount
    && goal?.target_amount === expected.targetAmount;
}
