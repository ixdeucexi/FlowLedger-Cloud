export const ALGORITHM_CATALOG = [
  { id: "flowScore", name: "Flow Score", icon: "activity", desc: "A 0–100 view of protected days, required bills, reserve progress, and forecast confidence." },
  { id: "safeCushion", name: "Breathing Room", icon: "shield", desc: "Money left after your upcoming plan and safety floor stay protected." },
  { id: "purchaseDecision", name: "Purchase Check", icon: "shopping-bag", desc: "Tests an amount and date before you commit to spending." },
  { id: "billPriority", name: "Next Bill", icon: "file-text", desc: "Shows which required bill needs attention first and why." },

  { id: "paydaySplit", name: "Paycheck Plan", icon: "git-branch", desc: "Protects bills and minimum payments before assigning flexible spending." },
  { id: "cashFlowGap", name: "Tightest Stretch", icon: "clock", desc: "Finds the upcoming days where timing puts the most pressure on your plan." },
  { id: "debtPayoff", name: "Debt Payoff", icon: "trending-down", desc: "Compares payoff methods and protects cash flow before extra payments." },
  { id: "spendingLimit", name: "Spending Pace", icon: "sliders", desc: "Gives a daily and weekly pace that protects required money." },

  { id: "extraMoneyRouter", name: "Next Dollar", icon: "corner-up-right", desc: "Shows the safest job for extra money after required expenses are protected." },
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
  void value;
  return defaultAlgorithmToggles();
}

export function isAlgorithmEnabled(settings: AlgorithmSettingsShape, algorithmId: AlgorithmId): boolean {
  void settings;
  void algorithmId;
  return true;
}

export function enabledAlgorithmCount(settings: AlgorithmSettingsShape): number {
  return ALGORITHM_CATALOG.filter(algorithm => isAlgorithmEnabled(settings, algorithm.id)).length;
}
