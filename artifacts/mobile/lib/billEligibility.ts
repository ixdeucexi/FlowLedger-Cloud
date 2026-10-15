export const CLOSED_DEBT_BALANCE_THRESHOLD = 0.009;

/** Closed debts stay available for history, but must not create future obligations. */
export function isBillEligibleForUpcomingPlan(
  bill: { is_debt: boolean; balance?: number | null },
) {
  return !bill.is_debt || Number(bill.balance ?? 0) > CLOSED_DEBT_BALANCE_THRESHOLD;
}

/** Past months keep their history; current and future planning omit closed debts. */
export function isBillVisibleForPlanningMonth(
  bill: { is_debt: boolean; balance?: number | null },
  month: number,
  year: number,
  currentMonth: number,
  currentYear: number,
) {
  const viewedMonth = year * 12 + month;
  const currentMonthIndex = currentYear * 12 + currentMonth;
  return viewedMonth < currentMonthIndex || isBillEligibleForUpcomingPlan(bill);
}
