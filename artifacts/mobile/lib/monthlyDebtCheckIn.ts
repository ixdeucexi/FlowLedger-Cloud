export type MonthlyDebtReviewItem = {
  balance: number;
  is_debt: boolean;
  end_date?: string;
  last_reviewed_at?: string;
};

export function calendarMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthlyDebtCheckInStorageKey(
  userId: string,
  householdId: string,
  monthKey: string,
): string {
  return `flowledger:monthly-debt-check-in:${userId}:${householdId}:${monthKey}`;
}

export function needsMonthlyDebtCheckIn(
  debts: readonly MonthlyDebtReviewItem[],
  date = new Date(),
): boolean {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  return debts.some((debt) => {
    if (!debt.is_debt || debt.balance <= 0.009 || debt.end_date) return false;
    const reviewedAt = debt.last_reviewed_at ? Date.parse(debt.last_reviewed_at) : Number.NaN;
    return !Number.isFinite(reviewedAt) || reviewedAt < monthStart;
  });
}
