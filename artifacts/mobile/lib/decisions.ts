export type DecisionType = "one_time_purchase" | "recurring_bill" | "income_change" | "payment_date_change" | "savings_contribution" | "extra_debt_payment";
export type DecisionVerdict = "safe" | "caution" | "unsafe";

export interface DecisionScenario {
  type: DecisionType;
  name: string;
  amount: number;
  date: string;
  frequency?: "once" | "weekly" | "biweekly" | "monthly";
  sourceId?: string;
  oldDate?: string;
}
export interface DecisionBaselineDay { date: string; balance: number }
export interface DecisionResult {
  verdict: DecisionVerdict;
  lowestBalance: number;
  lowestBalanceDate: string;
  monthlyCashFlowChange: number;
  saferAmount: number;
  explanation: string;
  affectedDates: string[];
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
function addMonth(date: string) {
  const [y, m, d] = date.split("-").map(Number); const next = new Date(Date.UTC(y, m, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate())).padStart(2, "0")}`;
}
export function scenarioDates(scenario: DecisionScenario, endDate: string): string[] {
  if (scenario.type === "payment_date_change") return [scenario.date];
  const frequency = scenario.frequency ?? (scenario.type === "recurring_bill" || scenario.type === "income_change" ? "monthly" : "once");
  const dates: string[] = []; let date = scenario.date;
  while (date <= endDate) { dates.push(date); if (frequency === "once") break; date = frequency === "weekly" ? addDays(date, 7) : frequency === "biweekly" ? addDays(date, 14) : addMonth(date); }
  return dates;
}
export function evaluateDecision(days: DecisionBaselineDay[], scenario: DecisionScenario, safetyFloor: number): DecisionResult {
  if (!days.length) throw new Error("Decision forecast requires baseline days");
  const dates = scenarioDates(scenario, days[days.length - 1].date);
  const expense = scenario.type === "income_change" ? -scenario.amount : Math.abs(scenario.amount);
  let lowestBalance = Infinity, lowestBalanceDate = days[0].date;
  for (const day of days) {
    let adjustment = dates.filter(date => date <= day.date).length * expense;
    if (scenario.type === "payment_date_change" && scenario.oldDate) {
      adjustment = (scenario.oldDate <= day.date ? -Math.abs(scenario.amount) : 0) + (scenario.date <= day.date ? Math.abs(scenario.amount) : 0);
    }
    const balance = day.balance - adjustment;
    if (balance < lowestBalance) { lowestBalance = balance; lowestBalanceDate = day.date; }
  }
  const headroom = Math.max(0, lowestBalance - safetyFloor);
  const cautionBand = Math.max(100, safetyFloor * 0.5);
  const verdict: DecisionVerdict = lowestBalance < safetyFloor ? "unsafe" : lowestBalance < safetyFloor + cautionBand ? "caution" : "safe";
  const monthlyMultiplier = (scenario.frequency ?? "once") === "weekly" ? 52 / 12 : scenario.frequency === "biweekly" ? 26 / 12 : 1;
  const monthlyCashFlowChange = scenario.type === "payment_date_change" ? 0 : -expense * monthlyMultiplier;
  const saferAmount = verdict === "unsafe" ? Math.max(0, Math.abs(scenario.amount) - (safetyFloor - lowestBalance)) : Math.abs(scenario.amount) + headroom;
  const explanation = verdict === "safe" ? `This keeps at least $${lowestBalance.toFixed(0)} available.` : verdict === "caution" ? `This stays above your floor, but leaves only $${headroom.toFixed(0)} of headroom.` : `This falls $${(safetyFloor - lowestBalance).toFixed(0)} below your safety floor.`;
  return { verdict, lowestBalance, lowestBalanceDate, monthlyCashFlowChange, saferAmount, explanation, affectedDates: dates };
}
export function compareDecisionVariants(days: DecisionBaselineDay[], scenarios: DecisionScenario[], safetyFloor: number) {
  return scenarios.slice(0, 3).map(scenario => ({ scenario, result: evaluateDecision(days, scenario, safetyFloor) }));
}
