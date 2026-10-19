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

/** Preview the same dated, one-time reservation used by the bucket forecast.
 * Start at the target (even outside the dashboard horizon) and include a full
 * forecast horizon so later bills cannot be hidden by a target-day surplus.
 */
export function buildBucketSafetyStop(input: {
  name: string;
  amount: number;
  targetDate: string;
  safetyFloor: number;
  horizonMonths: number;
  getDailyBalances: (month: number, year: number) => { day: number; balance: number }[];
}): SafetyStopWarning | null {
  const baseline = buildSafetyStopBaseline(input.targetDate, input.horizonMonths, input.getDailyBalances);
  return buildSafetyStop({
    baseline,
    safetyFloor: input.safetyFloor,
    scenario: { type: "one_time_purchase", name: input.name, amount: input.amount, date: input.targetDate, frequency: "once" },
  });
}

/** Daily balances already include existing buckets; only the proposed amount is added by evaluateDecision. */
export function buildSafetyStopBaseline(
  startDate: string,
  horizonMonths: number,
  getDailyBalances: (month: number, year: number) => { day: number; balance: number }[],
): DecisionBaselineDay[] {
  const [year, month] = startDate.split("-").map(Number);
  if (!year || !month) return [];
  const horizon = Math.max(1, horizonMonths || 6);
  const baseline: DecisionBaselineDay[] = [];
  for (let index = 0; index < horizon; index += 1) {
    const date = new Date(year, month - 1 + index, 1);
    const forecastYear = date.getFullYear();
    const forecastMonth = date.getMonth();
    for (const day of getDailyBalances(forecastMonth, forecastYear)) {
      const key = `${forecastYear}-${String(forecastMonth + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
      if (key >= startDate) baseline.push({ date: key, balance: day.balance });
    }
  }
  return baseline.sort((left, right) => left.date.localeCompare(right.date));
}
