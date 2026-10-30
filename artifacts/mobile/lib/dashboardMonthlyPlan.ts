/** Shared presentation values from the existing Dashboard cash-flow snapshot. */
export function dashboardMonthlyPlan(input: {
  plannedIncome: number;
  incomeStillExpected: number;
  billsDue: number;
  bucketAllocations: number;
}) {
  const planned = Math.max(0, input.billsDue + input.bucketAllocations);
  const remaining = input.incomeStillExpected - planned;
  return {
    planned,
    remaining,
    noMoreIncomeExpected: input.plannedIncome > 0 && input.incomeStillExpected <= 0,
    isShort: remaining < 0,
    commitmentPercent: input.incomeStillExpected > 0
      ? Math.max(0, Math.round((planned / input.incomeStillExpected) * 100))
      : 0,
    progress: input.incomeStillExpected > 0
      ? Math.max(0, Math.min(1, planned / input.incomeStillExpected))
      : 0,
  };
}
