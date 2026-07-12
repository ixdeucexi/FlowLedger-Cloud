export const ALGORITHM_CATALOG = [
  { id: "flowScore", name: "Flow Score", icon: "activity", desc: "A simple score for how much breathing room your money plan has." },
  { id: "safeCushion", name: "Safe Cushion", icon: "shield", desc: "Money I protect so you do not drop below your safety floor." },
  { id: "purchaseDecision", name: "Purchase Decision", icon: "shopping-bag", desc: "Checks if a purchase is safe before you spend." },
  { id: "billPriority", name: "Bill Priority", icon: "file-text", desc: "Shows which bill needs attention first." },

  { id: "paydaySplit", name: "Payday Split", icon: "git-branch", desc: "Shows what each paycheck should cover before spending." },
  { id: "cashFlowGap", name: "Cash Flow Gap", icon: "clock", desc: "Finds the tightest days between paychecks." },
  { id: "debtPayoff", name: "Debt Payoff", icon: "trending-down", desc: "Shows the next debt to attack and what rolls forward." },
  { id: "spendingLimit", name: "Spending Limit", icon: "sliders", desc: "Gives a daily and weekly spending limit that protects your cushion." },

  { id: "extraMoneyRouter", name: "Extra Money Router", icon: "corner-up-right", desc: "Shows where leftover money should go next: debt, savings, bills, or stay available." },
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
