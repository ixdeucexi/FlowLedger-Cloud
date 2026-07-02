export type AlgorithmGrowthStage = "starter" | "growing" | "advanced" | "power";

export const GROWTH_STAGE_ORDER: AlgorithmGrowthStage[] = ["starter", "growing", "advanced", "power"];

export const GROWTH_STAGE_LABELS: Record<AlgorithmGrowthStage, string> = {
  starter: "Starter",
  growing: "Growing",
  advanced: "Advanced",
  power: "Power User",
};

export const ALGORITHM_CATALOG = [
  { id: "flowScore", name: "Flow Score", stage: "starter", icon: "activity", desc: "A 0-100 view of plan health with the next best action." },
  { id: "safeCushion", name: "Safe Cushion", stage: "starter", icon: "shield", desc: "Money safely available after your forecast and floor." },
  { id: "purchaseDecision", name: "Purchase Decision", stage: "starter", icon: "shopping-bag", desc: "Shows whether a purchase is safe, tight, or should wait." },
  { id: "billPriority", name: "Bill Priority", stage: "starter", icon: "file-text", desc: "Ranks bills by urgency, due date, amount, and risk." },
  { id: "lowBalanceWarning", name: "Low Balance Warning", stage: "starter", icon: "alert-triangle", desc: "Warns before balances get too low or negative." },

  { id: "paydaySplit", name: "Payday Split", stage: "growing", icon: "git-branch", desc: "Recommends how each paycheck should be divided." },
  { id: "debtPayoff", name: "Debt Payoff", stage: "growing", icon: "trending-down", desc: "Compares snowball, avalanche, and cash-flow payoff options." },
  { id: "spendingLimit", name: "Spending Limit", stage: "growing", icon: "sliders", desc: "Recommends safe daily and weekly spending limits." },
  { id: "savingsSweep", name: "Savings Sweep", stage: "growing", icon: "corner-up-right", desc: "Suggests safe leftover money to move into savings." },

  { id: "goalAcceleration", name: "Goal Acceleration", stage: "advanced", icon: "target", desc: "Shows how to reach goals faster with safe extra savings." },
  { id: "spendingPattern", name: "Spending Pattern", stage: "advanced", icon: "pie-chart", desc: "Detects category spikes and spending habits." },
  { id: "billShock", name: "Bill Shock", stage: "advanced", icon: "zap", desc: "Flags bills that are unusually higher than normal." },
] as const;

export type AlgorithmId = typeof ALGORITHM_CATALOG[number]["id"];

export type AlgorithmToggleMap = Partial<Record<AlgorithmId, boolean>>;

export interface AlgorithmSettingsShape {
  algorithmSuiteEnabled: boolean;
  algorithmGrowthStage: AlgorithmGrowthStage;
  algorithmToggles: AlgorithmToggleMap;
}

export function defaultAlgorithmToggles(): Record<AlgorithmId, boolean> {
  return ALGORITHM_CATALOG.reduce((toggles, algorithm) => {
    toggles[algorithm.id] = true;
    return toggles;
  }, {} as Record<AlgorithmId, boolean>);
}

export function normalizeAlgorithmGrowthStage(value: unknown): AlgorithmGrowthStage {
  return value === "starter" || value === "growing" || value === "advanced" || value === "power"
    ? value
    : "starter";
}

export function normalizeAlgorithmToggles(value: unknown): Record<AlgorithmId, boolean> {
  const defaults = defaultAlgorithmToggles();
  const parsed = value && typeof value === "object" ? value as Partial<Record<string, unknown>> : {};
  ALGORITHM_CATALOG.forEach(algorithm => {
    defaults[algorithm.id] = parsed[algorithm.id] !== false;
  });
  return defaults;
}

export function algorithmStageRank(stage: AlgorithmGrowthStage): number {
  return GROWTH_STAGE_ORDER.indexOf(stage);
}

export function isAlgorithmAvailableForStage(stage: AlgorithmGrowthStage, algorithmId: AlgorithmId): boolean {
  const algorithm = ALGORITHM_CATALOG.find(item => item.id === algorithmId);
  if (!algorithm) return false;
  return algorithmStageRank(algorithm.stage) <= algorithmStageRank(stage);
}

export function isAlgorithmEnabled(settings: AlgorithmSettingsShape, algorithmId: AlgorithmId): boolean {
  if (!settings.algorithmSuiteEnabled) return false;
  if (!isAlgorithmAvailableForStage(settings.algorithmGrowthStage, algorithmId)) return false;
  return settings.algorithmToggles[algorithmId] !== false;
}

export function enabledAlgorithmCount(settings: AlgorithmSettingsShape): number {
  return ALGORITHM_CATALOG.filter(algorithm => isAlgorithmEnabled(settings, algorithm.id)).length;
}
