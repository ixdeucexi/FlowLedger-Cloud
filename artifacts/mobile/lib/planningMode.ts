export type PlanningMode = "snowball" | "zero_budget" | "free_flow";

export interface PlanningModeOption {
  id: PlanningMode;
  label: string;
  shortDescription: string;
  description: string;
}

export const PLANNING_MODE_OPTIONS: readonly PlanningModeOption[] = [
  {
    id: "snowball",
    label: "Snowball",
    shortDescription: "Focus extra cash on debt",
    description: "Track bills and cash flow while rolling safe extra money into your debt payoff plan.",
  },
  {
    id: "zero_budget",
    label: "Zero Budget",
    shortDescription: "Give every dollar a job",
    description: "Plan income by category, monitor what is left, and move money between categories.",
  },
  {
    id: "free_flow",
    label: "Free Flow",
    shortDescription: "Track without a budget",
    description: "Track balances, bills, income, and transactions without category budgets or snowball automation.",
  },
] as const;

export function normalizePlanningMode(value: unknown): PlanningMode {
  return value === "zero_budget" || value === "free_flow" ? value : "snowball";
}

export function usesSnowball(mode: PlanningMode): boolean {
  return mode === "snowball";
}

export function usesZeroBudget(mode: PlanningMode): boolean {
  return mode === "zero_budget";
}
