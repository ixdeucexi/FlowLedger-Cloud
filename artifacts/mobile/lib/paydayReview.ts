import { buildPaycheckPlan, makeDateKey, type PaycheckPlanResult } from "./paycheckPlanning";
import type { FinancialEvent } from "./forecast";

export interface PaydayReviewSource {
  getDailyBalances: (month: number, year: number) => Array<{ day: number; balance: number; projectionEvents?: FinancialEvent[] }>;
}
export type PaydayReviewPlan = PaycheckPlanResult & { forecastComplete: boolean };

/** One shared input assembly for Flo and the local, read-only payday overlay. */
export function buildPaydayReviewPlan(source: PaydayReviewSource, now: Date, horizonMonths: number, safetyFloor: number): PaydayReviewPlan {
  const incomes: Parameters<typeof buildPaycheckPlan>[0] = [];
  const bills: Parameters<typeof buildPaycheckPlan>[1] = [];
  const balances: Parameters<typeof buildPaycheckPlan>[2] = [];
  const eventCoverage = new Set<string>();
  const horizon = Math.max(2, Math.min(horizonMonths, 6));
  for (let i = 0; i < horizon; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = date.getMonth(), year = date.getFullYear();
    source.getDailyBalances(month, year).forEach(day => {
      const dayDate = makeDateKey(year, month, day.day);
      balances.push({ date: dayDate, balance: day.balance });
      if (day.projectionEvents && day.projectionEvents.every(event => Number.isFinite(event.amount))) eventCoverage.add(dayDate);
      // These are the cash-impact events used for this exact forecast balance,
      // after matching, occurrence overrides, debt settlement and deduplication.
      day.projectionEvents?.forEach(event => {
        if (event.kind === "scheduled_income" && event.amount > 0) incomes.push({ id: event.id, name: event.name ?? "Paycheck", amount: event.amount, date: event.date });
        if ((event.kind === "bill" || event.kind === "debt_payment") && event.amount < -0.005) bills.push({ id: event.id, name: event.name ?? "Planned payment", amount: -event.amount, dueDate: event.date });
      });
    });
  }
  const plan = buildPaycheckPlan(incomes, bills, balances, safetyFloor, makeDateKey(now.getFullYear(), now.getMonth(), now.getDate()));
  const recorded = new Set(balances.filter(day => Number.isFinite(day.balance)).map(day => day.date));
  let forecastComplete = Number.isFinite(safetyFloor) && incomes.every(income => Number.isFinite(income.amount)) && bills.every(bill => Number.isFinite(bill.amount));
  for (const date = new Date(`${plan.windowStart}T12:00:00`); makeDateKey(date.getFullYear(), date.getMonth(), date.getDate()) <= plan.windowEnd; date.setDate(date.getDate() + 1)) {
    const dayDate = makeDateKey(date.getFullYear(), date.getMonth(), date.getDate());
    if (!recorded.has(dayDate) || !eventCoverage.has(dayDate)) forecastComplete = false;
  }
  return { ...plan, forecastComplete };
}

function money(value: number) { return value.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
function dateLabel(iso: string) { return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

/** Presentation only: all amounts come from the canonical paycheck/forecast result. */
export function paydayReviewMessage(plan: PaycheckPlanResult & { forecastComplete?: boolean }, safetyFloor: number, confidence: "high" | "medium" | "low", balanceAvailable: boolean): string[] {
  if (!balanceAvailable) return ["I need a current checking balance before I can review how much is safe to spend. Add or refresh your checking account, then review your plan again."];
  if (!plan.nextPaycheck) return ["I couldn't confirm your next paycheck in the forecast window. Add its expected date and amount so I can show which bills it needs to cover and what you can safely spend."];
  if (plan.forecastComplete === false || ![plan.billsTotal, plan.lowestBalance, plan.safeToSpend, safetyFloor, plan.nextPaycheck.amount].every(Number.isFinite)) return ["I can't verify the full forecast through payday yet. Refresh your account and confirm the expected paycheck and planned payments before treating any money as safe to spend."];
  const paragraphs = [
    `Here's your payday review. Your next expected paycheck is ${money(plan.nextPaycheck.amount)} from ${plan.nextPaycheck.name} on ${dateLabel(plan.nextPaycheck.date)}.`,
    `Before then, ${money(plan.billsTotal)} is still planned for bills and debt payments. Your tightest forecast point is ${money(plan.lowestBalance)} on ${dateLabel(plan.lowestBalanceDate)}.`,
    `I'm protecting your ${money(safetyFloor)} safety cushion. That leaves ${money(plan.safeToSpend)} of projected room to spend before payday—not extra money on top of your current balance.`,
  ];
  if (plan.lowestBalance < safetyFloor) paragraphs.push(`Your forecast falls ${money(safetyFloor - plan.lowestBalance)} below that cushion on ${dateLabel(plan.lowestBalanceDate)}. Hold off on extra debt payments or purchases and review what can be reduced or rescheduled.`);
  else paragraphs.push(plan.safeToSpend < 100 ? "Your room is tight. Keep the remaining money available for essentials until payday." : "Keep your bill money and cushion untouched, and stay within that spending room until payday.");
  paragraphs.push(confidence === "high" ? "This is a forecast based on your recorded income, planned payments, and forecast spending—not a guarantee. Unrecorded purchases or changes can reduce that room." : "Some forecast information still needs checking. Treat these amounts as estimates, not approval to spend; confirm your balances, paycheck, and upcoming payments first.");
  return paragraphs;
}
