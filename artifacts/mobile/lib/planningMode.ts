export interface PlanningTools {
  zeroBasedBudgetEnabled: boolean;
  debtPayoffEnabled: boolean;
}

export const DEFAULT_PLANNING_TOOLS: PlanningTools = {
  zeroBasedBudgetEnabled: false,
  debtPayoffEnabled: true,
};

export function normalizePlanningTools(value: {
  zero_based_budget_enabled?: unknown;
  debt_payoff_enabled?: unknown;
  planning_mode?: unknown;
} | null | undefined): PlanningTools {
  const legacyMode = value?.planning_mode;
  const legacyDefaults = legacyMode === "zero_budget"
    ? { zeroBasedBudgetEnabled: true, debtPayoffEnabled: false }
    : legacyMode === "free_flow"
      ? { zeroBasedBudgetEnabled: false, debtPayoffEnabled: false }
      : DEFAULT_PLANNING_TOOLS;

  return {
    zeroBasedBudgetEnabled: typeof value?.zero_based_budget_enabled === "boolean"
      ? value.zero_based_budget_enabled
      : legacyDefaults.zeroBasedBudgetEnabled,
    debtPayoffEnabled: typeof value?.debt_payoff_enabled === "boolean"
      ? value.debt_payoff_enabled
      : legacyDefaults.debtPayoffEnabled,
  };
}
