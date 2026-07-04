export const ALGORITHM_CATALOG = [
  { id: "flowScore", name: "Flow Score", icon: "activity", desc: "A 0-100 view of plan health with the next best action." },
  { id: "safeCushion", name: "Safe Cushion", icon: "shield", desc: "Money safely available after your forecast and floor." },
  { id: "purchaseDecision", name: "Purchase Decision", icon: "shopping-bag", desc: "Shows whether a purchase is safe, tight, or should wait." },
  { id: "billPriority", name: "Bill Priority", icon: "file-text", desc: "Ranks bills by timing, unpaid status, due date, and forecast pressure." },

  { id: "paydaySplit", name: "Payday Split", icon: "git-branch", desc: "Recommends how each paycheck should be divided." },
  { id: "cashFlowGap", name: "Cash Flow Gap", icon: "clock", desc: "Finds the tightest stretch between paychecks so bills can be moved before the squeeze." },
  { id: "debtPayoff", name: "Debt Payoff", icon: "trending-down", desc: "Compares snowball, avalanche, and cash-flow payoff options." },
  { id: "spendingLimit", name: "Spending Limit", icon: "sliders", desc: "Recommends safe daily and weekly spending limits." },

  { id: "extraMoneyRouter", name: "Extra Money Router", icon: "corner-up-right", desc: "Helps route safe leftover money to debt, savings, upcoming bills, or available cash." },
] as const;

export type AlgorithmId = typeof ALGORITHM_CATALOG[number]["id"];

export type AlgorithmToggleMap = Partial<Record<AlgorithmId, boolean>>;

export interface AlgorithmSettingsShape {
  algorithmSuiteEnabled: boolean;
  algorithmToggles: AlgorithmToggleMap;
}

export function defaultAlgorithmToggles(): Record<AlgorithmId, boolean> {
  return ALGORITHM_CATALOG.reduce((toggles, algorithm) => {
    toggles[algorithm.id] = true;
    return toggles;
  }, {} as Record<AlgorithmId, boolean>);
}

export function normalizeAlgorithmToggles(value: unknown): Record<AlgorithmId, boolean> {
  const defaults = defaultAlgorithmToggles();
  const parsed = value && typeof value === "object" ? value as Partial<Record<string, unknown>> : {};
  ALGORITHM_CATALOG.forEach(algorithm => {
    const legacyValue = algorithm.id === "extraMoneyRouter" ? parsed.savingsSweep : undefined;
    defaults[algorithm.id] = (parsed[algorithm.id] ?? legacyValue) !== false;
  });
  return defaults;
}

export function isAlgorithmEnabled(settings: AlgorithmSettingsShape, algorithmId: AlgorithmId): boolean {
  if (!settings.algorithmSuiteEnabled) return false;
  return settings.algorithmToggles[algorithmId] !== false;
}

export function enabledAlgorithmCount(settings: AlgorithmSettingsShape): number {
  return ALGORITHM_CATALOG.filter(algorithm => isAlgorithmEnabled(settings, algorithm.id)).length;
}
