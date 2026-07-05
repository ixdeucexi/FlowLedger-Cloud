import { evaluateDecision, type DecisionBaselineDay, type DecisionScenario } from "./decisions";

export interface SafetyStopWarning {
  itemName: string;
  amount: number;
  scheduledDate: string;
  lowestBalance: number;
  lowestBalanceDate: string;
  safetyFloor: number;
  shortfall: number;
}

export interface BuildSafetyStopInput {
  baseline: DecisionBaselineDay[];
  scenario: DecisionScenario;
  safetyFloor: number;
}

export function buildSafetyStop({ baseline, scenario, safetyFloor }: BuildSafetyStopInput): SafetyStopWarning | null {
  const amount = Math.abs(Number(scenario.amount));
  if (!baseline.length || !Number.isFinite(amount) || amount <= 0) return null;
  const result = evaluateDecision(baseline, { ...scenario, amount }, safetyFloor);
  if (result.verdict !== "unsafe") return null;
  const shortfall = Math.max(0, safetyFloor - result.lowestBalance);
  return {
    itemName: scenario.name || "this scheduled item",
    amount,
    scheduledDate: scenario.date,
    lowestBalance: result.lowestBalance,
    lowestBalanceDate: result.lowestBalanceDate,
    safetyFloor,
    shortfall,
  };
}
