import { orderDebts, type DatedDebtAllocation, type DatedSnowballMonthPlanResult, type DebtMethod } from "./snowball";
import type { DebtMonthSettlement } from "./debtPlanDomain";

export type SnowballPlannerDebt = {
  id: string;
  name: string;
  balance: number;
  minimum: number;
  apr: number;
  dueDay: number;
  included: boolean;
};

export type SnowballPlannerRow = SnowballPlannerDebt & {
  rank: number;
  forecastPayment: number;
  plannedToDebt: number;
  paymentStatusLabel: "PLANNED TO DEBT" | "REMAINING REQUIRED";
  paymentStatusAmount: number;
  payoffExtraRemaining: number;
  rolloverReceived: number;
  rolloverSent: number;
  rolloverTargets: string[];
  extraReceived: number;
  balanceAfter: number;
  paidOffThisMonth: boolean;
  settlement: DebtMonthSettlement;
  rolloverEvents: Array<{ date: string; amount: number; targets: string[] }>;
};

export type SnowballTimelineGroup = {
  date: string;
  allocations: DatedDebtAllocation[];
  total: number;
};

export type SnowballPlanHistoryStatus = "Scheduled" | "Awaiting match" | "Partially paid" | "Applied";

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export function buildSnowballPlannerRows(
  debts: readonly SnowballPlannerDebt[],
  method: DebtMethod,
  remainingPlan: DatedSnowballMonthPlanResult | null,
  fullPlan: DatedSnowballMonthPlanResult | null = remainingPlan,
  settlements: ReadonlyMap<string, DebtMonthSettlement> = new Map(),
): SnowballPlannerRow[] {
  const canonicalDebts = fullPlan
    ? debts.flatMap(debt => {
        if (!debt.included) return [];
        const payment = fullPlan.payments.find(item => item.billId === debt.id);
        const selectedMonthBalance = payment?.balanceBefore ?? fullPlan.balances.get(debt.id) ?? 0;
        return selectedMonthBalance > 0.009 ? [{ ...debt, balance: selectedMonthBalance }] : [];
      })
    : debts.filter(debt => debt.included && debt.balance > 0.009).map(debt => ({ ...debt }));
  const ordered = orderDebts(
    canonicalDebts,
    method,
  );
  return ordered.map((debt, index) => {
    const allocations = remainingPlan?.allocations.filter(allocation => allocation.targetBillId === debt.id) ?? [];
    const sourcedAllocations = remainingPlan?.allocations.filter(allocation => allocation.sourceBillId === debt.id) ?? [];
    const settlement = settlements.get(debt.id) ?? {
      configuredObligation: cents(debt.minimum),
      paidAmount: 0,
      remainingRequired: cents(debt.minimum),
      status: "scheduled" as const,
    };
    const sourcePayments = new Map<string, number>();
    sourcedAllocations.forEach(allocation => {
      const key = `${allocation.sourceBillId}:${allocation.date}`;
      sourcePayments.set(key, cents((sourcePayments.get(key) ?? 0) + allocation.amount));
    });
    const rolloversSent = sourcedAllocations.filter(allocation => allocation.kind === "rollover");
    const plannedToDebt = cents(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    const payoffExtraRemaining = cents(allocations
      .filter(allocation => allocation.kind === "rollover" || allocation.kind === "extra")
      .reduce((sum, allocation) => sum + allocation.amount, 0));
    const projectedMonthEnd = cents(Math.max(0, debt.balance - plannedToDebt));
    const rolloverEvents = new Map<string, typeof rolloversSent>();
    rolloversSent.forEach(allocation => {
      rolloverEvents.set(allocation.date, [...(rolloverEvents.get(allocation.date) ?? []), allocation]);
    });
    return {
      ...debt,
      rank: index + 1,
      forecastPayment: cents(Array.from(sourcePayments.values()).reduce((sum, amount) => sum + amount, 0)),
      plannedToDebt,
      paymentStatusLabel: settlement.status === "scheduled" ? "PLANNED TO DEBT" : "REMAINING REQUIRED",
      paymentStatusAmount: settlement.status === "scheduled" ? plannedToDebt : settlement.remainingRequired,
      payoffExtraRemaining,
      rolloverReceived: cents(allocations
        .filter(allocation => allocation.kind === "rollover")
        .reduce((sum, allocation) => sum + allocation.amount, 0)),
      rolloverSent: cents(rolloversSent.reduce((sum, allocation) => sum + allocation.amount, 0)),
      rolloverTargets: [...new Set(rolloversSent.map(allocation => allocation.targetBillName))],
      extraReceived: cents(allocations
        .filter(allocation => allocation.kind === "extra")
        .reduce((sum, allocation) => sum + allocation.amount, 0)),
      balanceAfter: projectedMonthEnd,
      paidOffThisMonth: plannedToDebt > 0.009 && projectedMonthEnd <= 0.009,
      settlement,
      rolloverEvents: Array.from(rolloverEvents, ([date, eventAllocations]) => ({
        date,
        amount: cents(eventAllocations.reduce((sum, allocation) => sum + allocation.amount, 0)),
        targets: [...new Set(eventAllocations.map(allocation => allocation.targetBillName))],
      })).sort((left, right) => left.date.localeCompare(right.date)),
    };
  });
}

export function buildSnowballTimeline(
  allocations: readonly DatedDebtAllocation[],
): SnowballTimelineGroup[] {
  const groups = new Map<string, DatedDebtAllocation[]>();
  allocations
    .filter(allocation => allocation.amount > 0.009)
    .forEach(allocation => {
      groups.set(allocation.date, [...(groups.get(allocation.date) ?? []), allocation]);
    });

  return Array.from(groups, ([date, datedAllocations]) => ({
      date,
      allocations: datedAllocations,
      total: cents(datedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0)),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function payoffMonthsSooner(
  baselineDebtFreeDate: string | null,
  plannedDebtFreeDate: string | null,
): number | null {
  if (!baselineDebtFreeDate || !plannedDebtFreeDate) return null;
  const parseMonth = (value: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || month < 1 || month > 12) return null;
    return year * 12 + month - 1;
  };
  const baseline = parseMonth(baselineDebtFreeDate);
  const planned = parseMonth(plannedDebtFreeDate);
  if (baseline === null || planned === null) return null;
  return baseline - planned;
}

export function snowballPlanHistoryStatus(
  plan: {
    month: number;
    year: number;
    payment_date?: string;
    allocations: readonly { billId: string; payment: number; paymentDate?: string }[];
    sources?: readonly { pendingBalanceApply?: boolean }[];
  },
  matches: ReadonlyMap<string, { amount?: number }>,
  today: string,
): SnowballPlanHistoryStatus {
  const fallbackDate = plan.payment_date
    ?? `${plan.year}-${String(plan.month + 1).padStart(2, "0")}-01`;
  const planned = plan.allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.payment), 0);
  const applied = plan.allocations.reduce((sum, allocation) => {
    const date = (allocation.paymentDate ?? fallbackDate).slice(0, 10);
    const match = matches.get(`${allocation.billId}:${date}`);
    return sum + Math.min(allocation.payment, Math.max(0, Number(match?.amount) || 0));
  }, 0);
  if (planned > 0.009 && applied + 0.005 >= planned) return "Applied";
  if (applied > 0.009) return "Partially paid";
  if (fallbackDate > today) return "Scheduled";
  return plan.sources?.some(source => source.pendingBalanceApply) ? "Awaiting match" : "Applied";
}
