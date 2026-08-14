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
 * bill surplus. A required or rollover allocation determines the next date;
 * the displayed amount includes every allocation already planned for that
 * debt on that date so the add flow matches Forecast exactly.
 */
export function nextPlannedDebtPayment(
  allocations: readonly DatedDebtAllocation[],
  debtId: string | undefined,
  onOrAfterDate: string,
): NextPlannedDebtPayment | undefined {
  if (!debtId || !/^\d{4}-\d{2}-\d{2}$/.test(onOrAfterDate)) return undefined;

  const nextDate = allocations
    .filter(allocation => allocation.kind !== "extra")
    .filter(allocation => allocation.targetBillId === debtId)
    .filter(allocation => allocation.date >= onOrAfterDate && allocation.amount > 0.005)
    .map(allocation => allocation.date)
    .sort((left, right) => left.localeCompare(right))[0];
  if (!nextDate) return undefined;

  const paymentsOnDate = allocations.filter(allocation =>
    allocation.targetBillId === debtId
    && allocation.date === nextDate
    && allocation.amount > 0.005,
  );
  const first = paymentsOnDate[0];
  if (!first) return undefined;

  return {
    amount: cents(paymentsOnDate.reduce((total, allocation) => total + allocation.amount, 0)),
    date: nextDate,
    debtId: first.targetBillId,
    debtName: first.targetBillName,
  };
}
