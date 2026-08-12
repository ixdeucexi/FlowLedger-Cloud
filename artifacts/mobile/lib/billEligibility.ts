export const CLOSED_DEBT_BALANCE_THRESHOLD = 0.009;

/** Closed debts stay available for history, but must not create future obligations. */
export function isBillEligibleForUpcomingPlan(
  bill: { is_debt: boolean; balance?: number | null },
) {
  return !bill.is_debt || Number(bill.balance ?? 0) > CLOSED_DEBT_BALANCE_THRESHOLD;
}
