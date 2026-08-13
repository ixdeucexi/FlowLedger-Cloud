import type { DatedDebtAllocation } from "./snowball";

export type NextPlannedDebtPayment = {
  amount: number;
  date: string;
  debtId: string;
  debtName: string;
};

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

/**
 * Finds the next canonical payment for the debt that will receive a routed
 * bill surplus. Saved extras are intentionally ignored so the choice means
 * "add this to the next required/rollover payment", not another extra.
 */
export function nextPlannedDebtPayment(
  allocations: readonly DatedDebtAllocation[],
  debtId: string | undefined,
  onOrAfterDate: string,
): NextPlannedDebtPayment | undefined {
  if (!debtId || !/^\d{4}-\d{2}-\d{2}$/.test(onOrAfterDate)) return undefined;

  const byDate = new Map<string, NextPlannedDebtPayment>();
  allocations
    .filter(allocation => allocation.kind !== "extra")
    .filter(allocation => allocation.targetBillId === debtId)
    .filter(allocation => allocation.date >= onOrAfterDate && allocation.amount > 0.005)
    .forEach(allocation => {
      const existing = byDate.get(allocation.date);
      byDate.set(allocation.date, {
        amount: cents((existing?.amount ?? 0) + allocation.amount),
        date: allocation.date,
        debtId: allocation.targetBillId,
        debtName: allocation.targetBillName,
      });
    });

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))[0];
}
