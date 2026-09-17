import type { DatedDebtAllocation } from "./snowball";

export type NextPlannedDebtPayment = {
  amount: number;
  date: string;
  debtId: string;
  debtName: string;
};

/**
 * Resolves the debt that receives the current month's snowball money. The
 * first dated allocation is not guaranteed to be that debt because required
 * payments are emitted in calendar order, so callers must use the month's
 * target metadata when it is available.
 */
export function snowballTargetDebtId(preview: {
  allocations: readonly { billId: string; billName: string }[];
  months: readonly { targetName: string | null }[];
}): string | undefined {
  const targetName = preview.months[0]?.targetName;
  if (targetName) {
    const target = preview.allocations.find(allocation => allocation.billName === targetName);
    if (target) return target.billId;
  }
  return preview.allocations[0]?.billId;
}

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

/**
 * Finds the next planned payment for the debt that will receive a routed bill
 * surplus. Required/rollover allocations are preferred because they are the
 * canonical recurring payment schedule. If those have already been consumed
 * or are absent, an existing saved extra allocation is still a valid planned
 * date (and is visible on Forecast), so we use it as a fallback. The displayed
 * amount includes every allocation already planned for that debt on that date
 * so the add flow matches Forecast exactly.
 */
export function nextPlannedDebtPayment(
  allocations: readonly DatedDebtAllocation[],
  debtId: string | undefined,
  onOrAfterDate: string,
): NextPlannedDebtPayment | undefined {
  if (!debtId || !/^\d{4}-\d{2}-\d{2}$/.test(onOrAfterDate)) return undefined;

  const matchingAllocations = allocations
    .filter(allocation => allocation.targetBillId === debtId)
    .filter(allocation => allocation.date >= onOrAfterDate && allocation.amount > 0.005);
  const canonicalDates = matchingAllocations
    .filter(allocation => allocation.kind !== "extra")
    .map(allocation => allocation.date)
    .sort((left, right) => left.localeCompare(right))[0];
  const nextDate = canonicalDates ?? matchingAllocations
    .filter(allocation => allocation.kind === "extra")
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
