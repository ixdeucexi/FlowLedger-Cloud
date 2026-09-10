import {
  monthlyDebtAmount,
  orderDebts,
  projectDatedSnowballMonth,
  remainingDatedDebtAllocations,
  type DatedDebtSettlement,
  type DatedSnowballDebtInput,
  type DatedSnowballMonthPlanResult,
} from "./snowball";
import {
  requiredDebtPlanTotal,
  snowballRolloverPlanTotal,
} from "./debtPaymentPlan";
import {
  advanceDebtProjectionWithCommitments,
  applyDebtSourceCommitments,
  authoritativeDebtPaidAmountForMonth,
  automaticDebtRolloverForMonth,
  debtPlanPaymentBreakdown,
  effectiveDebtOccurrenceAmount,
  exactDebtPlanTotal,
  isValidExtraPaymentPlan,
  remainingDebtAllocationsAfterReviewedPayments,
  resolveDebtOccurrenceSettlement,
  summarizeDebtOccurrenceSettlements,
  type DebtMonthSettlement,
} from "./debtPlanDomain";
import {
  anchorForecastToBankBalance,
  forecastBalances,
  suppressDebtBillPlanDuplicates,
  type FinancialEvent,
} from "./forecast";
import {
  applyBillDateMovesToOccurrenceDays,
  getBillOccurrenceDays,
  getEffectiveIncomeAmount,
  getIncomeOccurrenceDays,
  getLatestRecordedIncomeAmount,
  isBillActiveForMonth,
  isIncomeActiveForMonth,
  resolveFinalizedBillOccurrenceDays,
} from "./schedule";
import {
  bankBalanceAdjustment,
  connectedCheckingObservedAnchor,
  historicalMonthOpeningBalance,
  operatingAccountAnchor,
  type AccountSnapshot,
} from "./accounts";
import { localDateInTimeZone } from "./dailyCheckingClose";
import { scenarioDates } from "./decisions";
import { occurrenceKey } from "./reviewCenter";
import { spendingBucketSummary } from "./spendingBuckets";
import { isBillEligibleForUpcomingPlan } from "./billEligibility";
import { buildTransactionLedger, remainingPlannedAmount } from "./ledgerEngine";
import { debtSourceCommitmentsForDebts } from "./pendingPlanMatches";
import {
  buildMatchedFinancialAllocationIndexes,
  financialProjectionMonthCacheKey,
  getOrComputeRevisionValue,
  indexRecordsByMonth,
} from "./financialProjectionCache";
import type {
  Bill,
  MonthlyOverride,
  ReviewAllocation,
  Account,
  IncomeItem,
  Goal,
  ExtraPayment,
  CashFlow,
  GoalExpense,
  DailyBalance,
} from "./financialProjectionTypes";

import type {
  FinancialProjectionSnapshot,
  FinancialProjectionOptions,
} from "./financialProjectionTypes";

export function billBaseAmountForMonth(
  bill: Bill,
  override?: MonthlyOverride,
): number {
  const customAmount = override?.custom_amount;
  if (customAmount === undefined || !Number.isFinite(customAmount))
    return bill.amount;
  // Debt bills should never disappear because of a stale/blank $0 override.
  // Positive overrides still allow one-month debt payment changes from Monthly.
  if (bill.is_debt && customAmount <= 0.005) return bill.amount;
  return Math.max(0, customAmount);
}

export function toAccountSnapshot(account: Account): AccountSnapshot {
  return {
    id: account.id,
    name: account.name,
    type: account.account_type,
    currentBalance: account.current_balance,
    balanceAsOf: account.balance_as_of,
    lastReconciledAt: account.last_reconciled_at,
    active: account.is_active,
  };
}

export function parseGoalTargetDate(
  targetDate: string,
): { year: number; month: number; day: number } | null {
  const datePart = targetDate.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (
    ![year, month, day].every(Number.isFinite) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return null;
  return { year, month: month - 1, day };
}

export function getGoalRemainingAmount(
  goal: Pick<Goal, "target_amount" | "current_amount" | "closed_at">,
): number {
  return spendingBucketSummary(goal).remaining;
}

export const hasPendingSnowballBalanceApply = (
  payment: Pick<ExtraPayment, "sources">,
) => (payment.sources ?? []).some((source) => source.pendingBalanceApply);

export const remainingSnowballAllocationAmount = (
  plannedAmount: number,
  match: ReviewAllocation | undefined,
) => {
  if (!match) return Math.max(0, Number(plannedAmount) || 0);
  if (match.settlement !== "partial") return 0;
  return Math.max(
    0,
    Number(match.plannedAmount ?? plannedAmount) - Number(match.amount || 0),
  );
};

export function incomeToMonthly(
  amount: number,
  frequency: IncomeItem["frequency"],
): number {
  if (frequency === "biweekly") return (amount * 26) / 12;
  if (frequency === "weekly") return (amount * 52) / 12;
  return amount;
}

export function safeLocalDateInTimeZone(date: Date, timeZone: string): string {
  try {
    return localDateInTimeZone(date, timeZone);
  } catch {
    return localDateInTimeZone(date, "UTC");
  }
}

/** Canonical read-only projection, extracted unchanged from BudgetContext. */
export function createFinancialProjection(
  snapshot: FinancialProjectionSnapshot,
  options: FinancialProjectionOptions,
) {
  const {
    settings,
    bills,
    overrides,
    billDateMoves,
    transactions,
    deletedTransactions,
    incomes,
    goals,
    extraPayments,
    decisions,
    accounts,
    connectedBankAccounts,
    transactionAccountIdentities,
    pendingBankTransactions,
    pendingPlanMatches,
  } = snapshot;
  const now = new Date(options.now.getTime());
  const householdTimeZone = options.timeZone;
  if (!Number.isFinite(now.getTime()))
    throw new Error("A valid projection clock is required");
  // ─── Overrides ────────────────────────────────────────────────────────────────
  const overridesByBillMonth = (() => {
    const index = new Map<string, MonthlyOverride>();
    overrides.forEach((override) => {
      index.set(
        `${override.bill_id}:${override.year}-${override.month}`,
        override,
      );
    });
    return index;
  })();

  const getOverride = (billId: string, month: number, year: number) =>
    overridesByBillMonth.get(`${billId}:${year}-${month}`);

  const matchedAllocationIndexes = (() =>
    buildMatchedFinancialAllocationIndexes(transactions))();

  const reviewedBillSettlements =
    matchedAllocationIndexes.reviewedBillSettlements;

  const reviewedBillOccurrences =
    matchedAllocationIndexes.reviewedBillOccurrences;

  const debtSourceCommitments = (() =>
    debtSourceCommitmentsForDebts(
      pendingPlanMatches,
      pendingBankTransactions,
      transactions,
      bills,
    ))();

  const debtSourceCommitmentsByOccurrence = (() =>
    new Map(
      debtSourceCommitments.map((commitment) => [
        `${commitment.sourceBillId}:${commitment.date}`,
        commitment,
      ]),
    ))();

  const getDebtSourceCommitment = (billId: string, occurrenceDate: string) =>
    debtSourceCommitmentsByOccurrence.get(`${billId}:${occurrenceDate}`);

  const getAmount = (bill: Bill, month: number, year: number): number => {
    const o = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
    if (bill.is_debt && o?.planned_debt_amount !== undefined) {
      return effectiveDebtOccurrenceAmount(0, 0, o.planned_debt_amount);
    }
    const base = billBaseAmountForMonth(bill, o);
    if (!bill.is_debt) return base;
    let settledAmount: number | undefined;
    if (bill.frequency === "monthly") {
      const settlementKey = `${bill.id}:${year}-${String(month + 1).padStart(2, "0")}`;
      const reviewedSettlement = reviewedBillSettlements.get(settlementKey);
      if (reviewedSettlement?.status === "settled")
        settledAmount = reviewedSettlement.actualAmount;
      else if (
        !reviewedSettlement &&
        o?.actual_amount !== undefined &&
        o.paid_date
      )
        settledAmount = o.actual_amount;
    }
    return monthlyDebtAmount(
      base,
      Number(bill.snowball_minimum_boost ?? 0),
      settledAmount,
    );
  };

  const getPaidAmount = (billId: string, month: number, year: number): number =>
    overridesByBillMonth.get(`${billId}:${year}-${month}`)?.paid_amount ?? 0;

  const getCustomDueDay = (
    billId: string,
    month: number,
    year: number,
  ): number | undefined =>
    overridesByBillMonth.get(`${billId}:${year}-${month}`)?.custom_due_day;

  const applyBillDateMovesToOccurrences = (
    bill: Bill,
    month: number,
    year: number,
    occurrences: number[],
  ): number[] =>
    applyBillDateMovesToOccurrenceDays(
      bill.id,
      month,
      year,
      occurrences,
      billDateMoves,
    );

  const getBillOccurrencesInMonth = (
    bill: Bill,
    month: number,
    year: number,
  ): number[] => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let occ = getBillOccurrenceDays(bill, month, year);
    const o = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
    if (
      o?.custom_due_day !== undefined &&
      (bill.frequency === "monthly" || bill.frequency === "quarterly")
    ) {
      occ = [Math.min(o.custom_due_day, daysInMonth)];
    }
    return applyBillDateMovesToOccurrences(bill, month, year, occ);
  };

  const getBillMonthlyTotal = (
    bill: Bill,
    month: number,
    year: number,
  ): number => {
    const occurrences = getBillOccurrencesInMonth(bill, month, year);
    if (occurrences.length === 0) return 0;
    return getAmount(bill, month, year) * occurrences.length;
  };

  const getBillEffectiveMonthlyTotal = (
    bill: Bill,
    month: number,
    year: number,
  ): number => {
    const override = overridesByBillMonth.get(`${bill.id}:${year}-${month}`);
    return override?.actual_amount !== undefined
      ? Math.max(0, override.actual_amount)
      : getBillMonthlyTotal(bill, month, year);
  };

  const monthlyBillsCache = (() => new Map<string, Bill[]>())();

  const getMonthlyBills = (month: number, year: number): Bill[] => {
    const key = `${year}-${month}`;
    const cached = monthlyBillsCache.get(key);
    if (cached) return cached;
    const result = bills.filter(
      (b) =>
        (b.is_recurring || b.is_debt) &&
        (isBillActiveForMonth(b, month, year) ||
          getBillOccurrencesInMonth(b, month, year).length > 0),
    );
    monthlyBillsCache.set(key, result);
    return result;
  };

  const debtMonthSettlementsCache = (() =>
    new Map<string, Map<string, DebtMonthSettlement>>())();

  const getDebtMonthSettlements = (month: number, year: number) => {
    const cacheKey = `${year}-${month}`;
    const cached = debtMonthSettlementsCache.get(cacheKey);
    if (cached) return cached;
    const result = new Map<string, DebtMonthSettlement>();
    getMonthlyBills(month, year)
      .filter((bill) => bill.is_debt)
      .forEach((bill) => {
        const override = overridesByBillMonth.get(
          `${bill.id}:${year}-${month}`,
        );
        const occurrenceDates = getBillOccurrencesInMonth(
          bill,
          month,
          year,
        ).map(
          (day) =>
            `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        );
        const reviewedForMonth = occurrenceDates.map((date) =>
          reviewedBillOccurrences.get(occurrenceKey(bill.id, date)),
        );
        const hasReviewedOccurrence = reviewedForMonth.some(Boolean);
        const rawSnapshotTotal = override?.required_debt_amount;
        const snapshotTotal =
          rawSnapshotTotal !== undefined && Number.isFinite(rawSnapshotTotal)
            ? Math.max(0, rawSnapshotTotal)
            : undefined;
        const snapshotParts = occurrenceDates.map((_, index) => {
          if (snapshotTotal === undefined || occurrenceDates.length === 0)
            return undefined;
          const allocatedBefore =
            Math.round((snapshotTotal / occurrenceDates.length) * index * 100) /
            100;
          const allocatedThrough =
            index === occurrenceDates.length - 1
              ? snapshotTotal
              : Math.round(
                  (snapshotTotal / occurrenceDates.length) * (index + 1) * 100,
                ) / 100;
          return Math.max(0, allocatedThrough - allocatedBefore);
        });
        const fallbackPaidByDate = new Map<string, number>();
        if (!hasReviewedOccurrence && occurrenceDates.length > 0) {
          let paidRemaining = Math.max(
            0,
            Number(override?.actual_amount ?? override?.paid_amount) || 0,
          );
          const paidDate = override?.paid_date?.slice(0, 10);
          const orderedDates = [
            ...(paidDate && occurrenceDates.includes(paidDate)
              ? [paidDate]
              : []),
            ...occurrenceDates.filter((date) => date !== paidDate),
          ];
          orderedDates.forEach((date) => {
            const index = occurrenceDates.indexOf(date);
            const required =
              snapshotParts[index] ?? Math.max(0, Number(bill.amount) || 0);
            const applied = Math.min(required, paidRemaining);
            fallbackPaidByDate.set(date, applied);
            paidRemaining = Math.max(0, paidRemaining - applied);
          });
          if (paidRemaining > 0.005) {
            const extraDate =
              paidDate && occurrenceDates.includes(paidDate)
                ? paidDate
                : orderedDates[orderedDates.length - 1];
            if (extraDate) {
              fallbackPaidByDate.set(
                extraDate,
                (fallbackPaidByDate.get(extraDate) ?? 0) + paidRemaining,
              );
            }
          }
        }
        const occurrenceSettlements = occurrenceDates.map((date, index) =>
          resolveDebtOccurrenceSettlement({
            occurrenceDate: date,
            configuredObligation: bill.amount,
            reviewed: reviewedForMonth[index],
            paidAmount: fallbackPaidByDate.get(date) ?? 0,
            requiredAmountSnapshot: snapshotParts[index],
          }),
        );
        result.set(
          bill.id,
          summarizeDebtOccurrenceSettlements(
            occurrenceSettlements,
            override?.planned_debt_amount,
          ),
        );
      });
    debtMonthSettlementsCache.set(cacheKey, result);
    return result;
  };

  const getExtraPayment = (month: number, year: number) =>
    extraPayments.find(
      (ep) =>
        ep.month === month && ep.year === year && isValidExtraPaymentPlan(ep),
    );

  const debtSourceCommitmentsByMonth = (() =>
    indexRecordsByMonth(debtSourceCommitments))();

  const extraPaymentsByMonth = (() =>
    new Map(
      extraPayments
        .filter(isValidExtraPaymentPlan)
        .map(
          (payment) => [`${payment.year}-${payment.month}`, payment] as const,
        ),
    ))();

  interface DebtPlanProjectionCacheEntry {
    result: DatedSnowballMonthPlanResult;
    endingBalances: Map<string, number>;
    rolledPayment: number;
  }

  const debtPlanProjectionCache = (() =>
    new Map<string, DebtPlanProjectionCacheEntry>())();

  const getDebtPlanForMonth = (
    month: number,
    year: number,
  ): DatedSnowballMonthPlanResult | null => {
    if (!settings.debtPayoffEnabled) return null;
    const debtPlanAsOfMonth = safeLocalDateInTimeZone(
      now,
      householdTimeZone,
    ).slice(0, 7);
    const [startYear, startMonthNumber] = debtPlanAsOfMonth
      .split("-")
      .map(Number);
    const startMonth = startMonthNumber - 1;
    if (year < startYear || (year === startYear && month < startMonth))
      return null;
    const requestedKey = financialProjectionMonthCacheKey(
      debtPlanAsOfMonth,
      month,
      year,
    );
    const cachedRequested = debtPlanProjectionCache.get(requestedKey);
    if (cachedRequested) return cachedRequested.result;
    const debtBills = bills.filter((bill) => bill.is_debt);
    if (!debtBills.length) return null;
    const debtBillsById = new Map(debtBills.map((bill) => [bill.id, bill]));
    let balances = new Map(
      debtBills.map((bill) => [
        bill.id,
        Math.max(0, Number(bill.balance) || 0),
      ]),
    );
    // Persisted boosts are the already-freed snowball pool. Keep that money in
    // the forecast, but feed it to the allocator as rollover so it never becomes
    // part of a creditor's required minimum.
    let rolledPayment = snowballRolloverPlanTotal(debtBills);
    let result: DatedSnowballMonthPlanResult | null = null;
    let cursorMonth = startMonth;
    let cursorYear = startYear;
    let guard = 0;
    // Reuse the closest completed predecessor. A September read after August
    // no longer replays the complete August snowball projection.
    let priorMonth = month - 1;
    let priorYear = year;
    if (priorMonth < 0) {
      priorMonth = 11;
      priorYear -= 1;
    }
    while (
      priorYear > startYear ||
      (priorYear === startYear && priorMonth >= startMonth)
    ) {
      const predecessor = debtPlanProjectionCache.get(
        financialProjectionMonthCacheKey(
          debtPlanAsOfMonth,
          priorMonth,
          priorYear,
        ),
      );
      if (predecessor) {
        balances = new Map(predecessor.endingBalances);
        rolledPayment = predecessor.rolledPayment;
        cursorMonth = priorMonth + 1;
        cursorYear = priorYear;
        if (cursorMonth > 11) {
          cursorMonth = 0;
          cursorYear += 1;
        }
        break;
      }
      priorMonth -= 1;
      if (priorMonth < 0) {
        priorMonth = 11;
        priorYear -= 1;
      }
    }
    while (
      (cursorYear < year || (cursorYear === year && cursorMonth <= month)) &&
      guard < 240
    ) {
      const monthSettlements = getDebtMonthSettlements(cursorMonth, cursorYear);
      const cursorPrefix = `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}`;
      const authoritativePaidByDebtId = new Map(
        debtBills.map((bill) => [
          bill.id,
          authoritativeDebtPaidAmountForMonth(
            monthSettlements.get(bill.id)?.paidAmount ?? 0,
            debtSourceCommitments,
            bill.id,
            cursorPrefix,
          ),
        ]),
      );
      const exactPlanDebtIds = new Set<string>();
      const debtsForMonth: DatedSnowballDebtInput[] = debtBills
        .filter((bill) => isBillActiveForMonth(bill, cursorMonth, cursorYear))
        .map((bill) => {
          const occurrenceCount = getBillOccurrencesInMonth(
            bill,
            cursorMonth,
            cursorYear,
          ).length;
          const currentRequiredAmount = requiredDebtPlanTotal(
            bill,
            occurrenceCount,
          );
          const override = overridesByBillMonth.get(
            `${bill.id}:${cursorYear}-${cursorMonth}`,
          );
          const exactPlannedAmount = exactDebtPlanTotal({
            plannedDebtAmount: override?.planned_debt_amount,
            customAmount: override?.custom_amount,
            occurrenceCount,
          });
          if (exactPlannedAmount !== undefined) exactPlanDebtIds.add(bill.id);
          const settlement = monthSettlements.get(bill.id);
          const requiredObligation =
            settlement?.configuredObligation ?? currentRequiredAmount;
          const payment = debtPlanPaymentBreakdown(
            requiredObligation,
            exactPlannedAmount,
          );
          const paidTowardExtra = Math.max(
            0,
            (authoritativePaidByDebtId.get(bill.id) ?? 0) - requiredObligation,
          );
          let requiredCashRemaining =
            settlement?.status === "settled" ? 0 : payment.requiredPayment;
          const requiredPaymentsByDate = settlement?.occurrences?.length
            ? new Map(
                settlement.occurrences.map((occurrence) => {
                  const amount = Math.min(
                    occurrence.configuredObligation,
                    requiredCashRemaining,
                  );
                  requiredCashRemaining = Math.max(
                    0,
                    requiredCashRemaining - amount,
                  );
                  return [occurrence.occurrenceDate, amount] as const;
                }),
              )
            : undefined;
          return {
            id: bill.id,
            name: bill.name,
            balance:
              balances.get(bill.id) ?? Math.max(0, Number(bill.balance) || 0),
            // `minimum` is always the original lender requirement. Current
            // Forecast edits are split into required cash and targeted extra.
            minimum: currentRequiredAmount,
            requiredPayment:
              settlement?.status === "settled" ? 0 : payment.requiredPayment,
            requiredPaymentsByDate,
            plannedExtraPayment: Math.max(
              0,
              payment.plannedExtraPayment - paidTowardExtra,
            ),
            apr: Number(bill.interest_rate) || 0,
            dueDay: bill.due_day,
            included: bill.include_in_snowball !== false,
          };
        });
      const paymentDatesByDebtId = new Map(
        debtsForMonth.map((debt) => {
          const bill = debtBillsById.get(debt.id);
          const dates = bill
            ? getBillOccurrencesInMonth(bill, cursorMonth, cursorYear).map(
                (day) =>
                  `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
              )
            : [];
          return [debt.id, dates] as const;
        }),
      );
      const savedExtra = extraPaymentsByMonth.get(
        `${cursorYear}-${cursorMonth}`,
      );
      const automaticTarget = orderDebts(
        debtsForMonth.filter((debt) => debt.included && debt.balance > 0.009),
        settings.paymentMethod,
      )[0];
      // A reviewed, pending, or posted-review payment above the lender minimum
      // has already consumed that much of this month's automatic rollover.
      const rolloverAlreadyPaid = automaticTarget
        ? Math.max(
            0,
            (authoritativePaidByDebtId.get(automaticTarget.id) ?? 0) -
              (monthSettlements.get(automaticTarget.id)?.configuredObligation ??
                automaticTarget.minimum),
          )
        : 0;
      const rolledPaymentForMonth = automaticDebtRolloverForMonth(
        rolledPayment,
        automaticTarget?.id,
        exactPlanDebtIds,
        rolloverAlreadyPaid,
      );
      result = projectDatedSnowballMonth({
        debts: debtsForMonth,
        method: settings.paymentMethod,
        month: cursorMonth,
        year: cursorYear,
        paymentDatesByDebtId,
        startingBalances: balances,
        rolledPayment: rolledPaymentForMonth,
        extraPayment: savedExtra
          ? {
              amount: savedExtra.amount,
              date:
                savedExtra.payment_date ??
                `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}-01`,
            }
          : undefined,
      });
      const allocationsAfterReviewedPayments =
        remainingDebtAllocationsAfterReviewedPayments(
          result.allocations,
          monthSettlements,
        );
      const advancePlan = {
        ...result,
        allocations: allocationsAfterReviewedPayments,
        plannedPayment: allocationsAfterReviewedPayments.reduce(
          (sum, allocation) => sum + allocation.amount,
          0,
        ),
      };
      const projected = advanceDebtProjectionWithCommitments(
        advancePlan,
        debtsForMonth,
        rolledPayment,
        debtSourceCommitmentsByMonth.get(cursorPrefix) ?? [],
        result.allocations,
      );
      balances = projected.balances;
      rolledPayment = projected.rolledPayment;
      debtPlanProjectionCache.set(
        financialProjectionMonthCacheKey(
          debtPlanAsOfMonth,
          cursorMonth,
          cursorYear,
        ),
        {
          result,
          endingBalances: new Map(balances),
          rolledPayment,
        },
      );
      if (cursorYear === year && cursorMonth === month) break;
      cursorMonth += 1;
      if (cursorMonth > 11) {
        cursorMonth = 0;
        cursorYear += 1;
      }
      guard += 1;
    }
    return result;
  };

  const remainingDebtPlanCache = (() =>
    new Map<string, DatedSnowballMonthPlanResult | null>())();

  const getRemainingDebtPlanForMonth = (
    month: number,
    year: number,
  ): DatedSnowballMonthPlanResult | null => {
    const cacheKey = financialProjectionMonthCacheKey(
      safeLocalDateInTimeZone(now, householdTimeZone).slice(0, 7),
      month,
      year,
    );
    if (remainingDebtPlanCache.has(cacheKey)) {
      return remainingDebtPlanCache.get(cacheKey) ?? null;
    }
    const plan = getDebtPlanForMonth(month, year);
    if (!plan) {
      remainingDebtPlanCache.set(cacheKey, null);
      return null;
    }
    const billMatches = matchedAllocationIndexes.bill;
    const snowballMatches = matchedAllocationIndexes.snowball;
    const debtSettlements = getDebtMonthSettlements(month, year);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const reviewedBillIds =
      matchedAllocationIndexes.reviewedBillIdsByMonth.get(monthPrefix) ??
      new Set<string>();
    const overridePaidRemaining = new Map(
      Array.from(debtSettlements)
        .filter(
          ([billId, settlement]) =>
            !reviewedBillIds.has(billId) && settlement.paidAmount > 0.005,
        )
        .map(([billId, settlement]) => [billId, settlement.paidAmount]),
    );
    const settlements: DatedDebtSettlement[] = [];
    const seen = new Set<string>();
    plan.allocations.forEach((allocation) => {
      const sourceType = allocation.kind === "extra" ? "extra" : "bill";
      const billId =
        allocation.kind === "extra"
          ? allocation.targetBillId
          : allocation.sourceBillId;
      if (!billId) return;
      const key = `${sourceType}:${billId}:${allocation.date}`;
      if (seen.has(key)) return;
      seen.add(key);
      const match =
        sourceType === "extra"
          ? snowballMatches.get(occurrenceKey(billId, allocation.date))
          : billMatches.get(occurrenceKey(billId, allocation.date));
      if (match && Number(match.amount) > 0.005) {
        settlements.push({
          sourceType,
          billId,
          date: allocation.date,
          amount: Number(match.amount),
        });
      } else if (sourceType === "bill") {
        const fallbackPaid = overridePaidRemaining.get(billId) ?? 0;
        if (fallbackPaid <= 0.005) return;
        const applied = Math.min(
          fallbackPaid,
          Math.max(allocation.sourceAmount, allocation.amount),
        );
        settlements.push({
          sourceType,
          billId,
          date: allocation.date,
          amount: applied,
        });
        overridePaidRemaining.set(billId, Math.max(0, fallbackPaid - applied));
      }
    });
    const allocationsAfterSettlements = remainingDatedDebtAllocations(
      plan.allocations,
      settlements,
    );
    const sourceCommitments =
      debtSourceCommitmentsByMonth.get(monthPrefix) ?? [];
    const allocations = applyDebtSourceCommitments(
      allocationsAfterSettlements,
      sourceCommitments,
    );
    const result = {
      ...plan,
      allocations,
      plannedPayment: allocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      ),
    };
    remainingDebtPlanCache.set(cacheKey, result);
    return result;
  };

  const getMonthlyIncome = (month?: number, year?: number) =>
    incomes
      .filter((i) =>
        month !== undefined && year !== undefined
          ? isIncomeActiveForMonth(i, month, year)
          : true,
      )
      .reduce((s, i) => {
        if (month !== undefined && year !== undefined) {
          const amt = getEffectiveIncomeAmount(i, month, year);
          return s + getIncomeOccurrenceDays(i, month, year).length * amt;
        }
        return (
          s + incomeToMonthly(getLatestRecordedIncomeAmount(i), i.frequency)
        );
      }, 0);

  const getIncomeOccurrencesInMonth = (month: number, year: number) =>
    incomes
      .filter((i) => isIncomeActiveForMonth(i, month, year))
      .map((i) => ({
        income: i,
        days: getIncomeOccurrenceDays(i, month, year),
        effectiveAmount: getEffectiveIncomeAmount(i, month, year),
      }))
      .filter((x) => x.days.length > 0);

  // ─── Cash Flow ────────────────────────────────────────────────────────────────
  const transactionLedger = (() =>
    buildTransactionLedger(
      [...transactions, ...deletedTransactions],
      transactions,
      transactionAccountIdentities,
    ))();

  const forecastTransactionsByMonth = transactionLedger.cashTransactionsByMonth;

  const visibleCheckingTransactionsByDate =
    transactionLedger.visibleCheckingTransactionsByDate;

  const visibleTransactionIds = (() =>
    new Set(
      transactionLedger.visibleTransactions.map(
        (transaction) => transaction.id,
      ),
    ))();

  const buildCashFlow = (month: number, year: number): CashFlow => {
    const billMatches = matchedAllocationIndexes.bill;
    const incomeMatches = matchedAllocationIndexes.income;
    const snowballMatches = matchedAllocationIndexes.snowball;
    const monthlyIncome = incomes
      .filter((i) => isIncomeActiveForMonth(i, month, year))
      .reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, month, year);
        return (
          sum +
          getIncomeOccurrenceDays(income, month, year).reduce(
            (occurrenceSum, day) => {
              const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const match = incomeMatches.get(occurrenceKey(income.id, date));
              const remaining = remainingPlannedAmount(amount, match);
              return occurrenceSum + remaining;
            },
            0,
          )
        );
      }, 0);
    const activeBills = getMonthlyBills(month, year).filter(
      isBillEligibleForUpcomingPlan,
    );
    const debtPlan = getRemainingDebtPlanForMonth(month, year);
    const totalBillsDue = activeBills.reduce((sum, bill) => {
      if (bill.is_debt && debtPlan) return sum;
      const occurrences = getBillOccurrencesInMonth(bill, month, year);
      const amount =
        occurrences.length > 0
          ? getBillMonthlyTotal(bill, month, year) / occurrences.length
          : 0;
      return (
        sum +
        occurrences.reduce((occurrenceSum, day) => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const match = billMatches.get(occurrenceKey(bill.id, date));
          const remaining = remainingPlannedAmount(amount, match);
          return occurrenceSum + remaining;
        }, 0)
      );
    }, debtPlan?.plannedPayment ?? 0);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const totalPaid =
      matchedAllocationIndexes.paidBillAmountByMonth.get(monthPrefix) ?? 0;
    const monthTxs = forecastTransactionsByMonth.get(monthPrefix) ?? [];
    const netTransactions = monthTxs.reduce((s, t) => s + t.amount, 0);
    const snowballPayment = extraPayments.find(
      (ep) => ep.month === month && ep.year === year,
    );
    const snowballPaymentDate =
      snowballPayment?.payment_date ??
      `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const snowballExtra = debtPlan
      ? 0
      : (snowballPayment?.allocations.reduce(
          (sum, allocation) =>
            sum +
            remainingSnowballAllocationAmount(
              allocation.payment,
              snowballMatches.get(
                occurrenceKey(allocation.billId, snowballPaymentDate),
              ),
            ),
          0,
        ) ?? 0);
    const monthEnd = `${monthPrefix}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
    const plannedDecisionNet = decisions
      .filter((d) => d.status === "planned" || d.status === "calendar")
      .reduce((sum, d) => {
        const occurrences = scenarioDates(d.scenario, monthEnd).filter((date) =>
          date.startsWith(monthPrefix),
        ).length;
        const signedAmount =
          d.scenario.type === "income_change"
            ? Math.abs(d.scenario.amount)
            : -Math.abs(d.scenario.amount);
        return sum + occurrences * signedAmount;
      }, 0);
    const goalAllocations = goals.reduce((sum, goal) => {
      if (goal.goal_type !== "planned_expense" || !goal.target_date) return sum;
      const target = parseGoalTargetDate(goal.target_date);
      return target?.year === year && target.month === month
        ? sum + getGoalRemainingAmount(goal)
        : sum;
    }, 0);
    return {
      monthlyIncome,
      totalBillsDue,
      totalPaid,
      netTransactions,
      goalAllocations,
      remaining:
        monthlyIncome -
        totalBillsDue -
        goalAllocations -
        snowballExtra +
        netTransactions +
        plannedDecisionNet,
    };
  };

  const cashFlowComputationCache = (() => new Map<string, CashFlow>())();

  const getCashFlow = (month: number, year: number): CashFlow =>
    getOrComputeRevisionValue(
      cashFlowComputationCache,
      financialProjectionMonthCacheKey(
        safeLocalDateInTimeZone(now, householdTimeZone),
        month,
        year,
      ),
      () => buildCashFlow(month, year),
    );

  // ─── Daily Balances ───────────────────────────────────────────────────────────
  const balanceComputationCache = (() => ({
    monthNet: new Map<string, number>(),
    carryover: new Map<string, number>(),
    bankAnchoredCarryover: new Set<string>(),
    daily: new Map<string, DailyBalance[]>(),
  }))();

  const buildDailyBalances = (month: number, year: number): DailyBalance[] => {
    const projectionAsOfDate = safeLocalDateInTimeZone(now, householdTimeZone);
    const requestedDebtPlan = getRemainingDebtPlanForMonth(month, year);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const connectedBankAnchor = connectedCheckingObservedAnchor(
      connectedBankAccounts,
      householdTimeZone,
    );
    const bankAnchor =
      connectedBankAnchor ??
      operatingAccountAnchor(accounts.map(toAccountSnapshot));
    const computeMonthNet = (
      m: number,
      y: number,
      startExclusive?: string,
    ): number => {
      const key = financialProjectionMonthCacheKey(projectionAsOfDate, m, y);
      const cached = startExclusive
        ? undefined
        : balanceComputationCache.monthNet.get(key);
      if (cached !== undefined) return cached;
      const monthPrefix = `${y}-${String(m + 1).padStart(2, "0")}`;
      const planStartDate = settings.starting_balance_date;
      const includeDate = (date: string) =>
        (!planStartDate ||
          !planStartDate.startsWith(monthPrefix) ||
          date >= planStartDate) &&
        (!startExclusive || date > startExclusive);
      const billMatches = matchedAllocationIndexes.bill;
      const incomeMatches = matchedAllocationIndexes.income;
      const snowballMatches = matchedAllocationIndexes.snowball;
      const inc = incomes.reduce((sum, income) => {
        const amount = getEffectiveIncomeAmount(income, m, y);
        return (
          sum +
          getIncomeOccurrenceDays(income, m, y).reduce((occurrenceSum, day) => {
            const date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
            if (!includeDate(date)) return occurrenceSum;
            const match = incomeMatches.get(occurrenceKey(income.id, date));
            return occurrenceSum + remainingPlannedAmount(amount, match);
          }, 0)
        );
      }, 0);
      const debtPlan = getRemainingDebtPlanForMonth(m, y);
      const bil = bills
        .filter(
          (b) =>
            (b.is_recurring || b.is_debt) && isBillEligibleForUpcomingPlan(b),
        )
        .reduce((s, b) => {
          const occ = getBillOccurrencesInMonth(b, m, y);
          if (occ.length === 0) return s;
          const hasReviewedOccurrence =
            matchedAllocationIndexes.reviewedBillIdsByMonth
              .get(monthPrefix)
              ?.has(b.id) ?? false;
          if (b.is_debt && debtPlan) return s;
          const total = hasReviewedOccurrence
            ? getBillMonthlyTotal(b, m, y)
            : getBillEffectiveMonthlyTotal(b, m, y);
          if (total <= 0.005) return s;
          const dates = occ.map(
            (day) => `${monthPrefix}-${String(day).padStart(2, "0")}`,
          );
          const amountPerOccurrence = total / dates.length;
          return (
            s +
            dates.filter(includeDate).reduce((occurrenceSum, date) => {
              const match = billMatches.get(occurrenceKey(b.id, date));
              return (
                occurrenceSum +
                remainingPlannedAmount(amountPerOccurrence, match)
              );
            }, 0)
          );
        }, 0);
      const tx = (forecastTransactionsByMonth.get(monthPrefix) ?? [])
        .filter((t) => includeDate(t.date))
        .reduce((s, t) => s + t.amount, 0);
      const goalDeductions = goals.reduce((s, g) => {
        if (g.goal_type !== "planned_expense") return s;
        if (!g.target_date) return s;
        const targetDate = parseGoalTargetDate(g.target_date);
        const date = targetDate
          ? `${targetDate.year}-${String(targetDate.month + 1).padStart(2, "0")}-${String(targetDate.day).padStart(2, "0")}`
          : "";
        if (
          targetDate?.year === y &&
          targetDate.month === m &&
          includeDate(date)
        )
          return s + getGoalRemainingAmount(g);
        return s;
      }, 0);
      const snowball = debtPlan
        ? debtPlan.allocations
            .filter((allocation) => includeDate(allocation.date))
            .reduce((sum, allocation) => sum + allocation.amount, 0)
        : (() => {
            const monthlyExtra = extraPayments.find(
              (ep) => ep.month === m && ep.year === y,
            );
            const monthlyExtraDate =
              monthlyExtra?.payment_date ?? `${monthPrefix}-01`;
            return monthlyExtra && includeDate(monthlyExtraDate)
              ? monthlyExtra.allocations.reduce(
                  (sum, allocation) =>
                    sum +
                    remainingSnowballAllocationAmount(
                      allocation.payment,
                      snowballMatches.get(
                        occurrenceKey(allocation.billId, monthlyExtraDate),
                      ),
                    ),
                  0,
                )
              : 0;
          })();
      const monthEnd = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
      const decisionNet = decisions
        .filter((d) => d.status === "planned" || d.status === "calendar")
        .reduce((sum, d) => {
          const count = scenarioDates(d.scenario, monthEnd).filter(
            (date) => date.startsWith(monthPrefix) && includeDate(date),
          ).length;
          const signed =
            d.scenario.type === "income_change"
              ? d.scenario.amount
              : -Math.abs(d.scenario.amount);
          return sum + count * signed;
        }, 0);
      const net = inc + tx - bil - goalDeductions - snowball + decisionNet;
      if (!startExclusive) balanceComputationCache.monthNet.set(key, net);
      return net;
    };
    const computeCarryover = (toMonth: number, toYear: number): number => {
      const key = financialProjectionMonthCacheKey(
        projectionAsOfDate,
        toMonth,
        toYear,
      );
      const cached = balanceComputationCache.carryover.get(key);
      if (cached !== undefined) return cached;
      const previousMonth = toMonth === 0 ? 11 : toMonth - 1;
      const previousYear = toMonth === 0 ? toYear - 1 : toYear;
      const previousKey = financialProjectionMonthCacheKey(
        projectionAsOfDate,
        previousMonth,
        previousYear,
      );
      if (bankAnchor) {
        const [bankYear, bankMonth] = bankAnchor.date.split("-").map(Number);
        const bankMonthIndex = bankMonth - 1;
        if (
          toYear > bankYear ||
          (toYear === bankYear && toMonth > bankMonthIndex)
        ) {
          const previousOpening =
            balanceComputationCache.carryover.get(previousKey);
          if (
            previousOpening !== undefined &&
            balanceComputationCache.bankAnchoredCarryover.has(previousKey)
          ) {
            const running =
              previousOpening + computeMonthNet(previousMonth, previousYear);
            balanceComputationCache.carryover.set(key, running);
            balanceComputationCache.bankAnchoredCarryover.add(key);
            return running;
          }
          let running =
            bankAnchor.balance +
            computeMonthNet(bankMonthIndex, bankYear, bankAnchor.date);
          let m = bankMonthIndex + 1;
          let y = bankYear;
          if (m > 11) {
            m = 0;
            y += 1;
          }
          balanceComputationCache.carryover.set(
            financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
            running,
          );
          balanceComputationCache.bankAnchoredCarryover.add(
            financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
          );
          while (!(y === toYear && m === toMonth)) {
            running += computeMonthNet(m, y);
            m += 1;
            if (m > 11) {
              m = 0;
              y += 1;
            }
            balanceComputationCache.carryover.set(
              financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
              running,
            );
            balanceComputationCache.bankAnchoredCarryover.add(
              financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
            );
          }
          balanceComputationCache.carryover.set(key, running);
          return running;
        }
      }
      const previousOpening =
        balanceComputationCache.carryover.get(previousKey);
      if (previousOpening !== undefined) {
        const running =
          previousOpening + computeMonthNet(previousMonth, previousYear);
        balanceComputationCache.carryover.set(key, running);
        return running;
      }
      let anchorM: number, anchorY: number;
      if (settings.starting_balance_date) {
        const [sbY, sbM] = settings.starting_balance_date
          .split("-")
          .map(Number);
        anchorY = sbY;
        anchorM = sbM - 1;
      } else {
        const [asOfYear, asOfMonthNumber] = projectionAsOfDate
          .split("-")
          .map(Number);
        anchorM = asOfMonthNumber - 2;
        anchorY = asOfYear;
        if (anchorM < 0) {
          anchorM = 11;
          anchorY -= 1;
        }
      }
      if (toYear < anchorY || (toYear === anchorY && toMonth < anchorM))
        return 0;
      if (toYear === anchorY && toMonth === anchorM) {
        balanceComputationCache.carryover.set(key, settings.starting_balance);
        return settings.starting_balance;
      }
      let running = settings.starting_balance;
      let m = anchorM,
        y = anchorY;
      while (!(y === toYear && m === toMonth)) {
        running += computeMonthNet(m, y);
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
        balanceComputationCache.carryover.set(
          financialProjectionMonthCacheKey(projectionAsOfDate, m, y),
          running,
        );
      }
      balanceComputationCache.carryover.set(key, running);
      return running;
    };
    const carryover = computeCarryover(month, year);
    const financialEvents: FinancialEvent[] = [];
    const billMatches = matchedAllocationIndexes.bill;
    const incomeMatches = matchedAllocationIndexes.income;
    const snowballMatches = matchedAllocationIndexes.snowball;
    const incomeByDay: Record<number, number> = {};
    incomes.forEach((i) => {
      const occ = getIncomeOccurrenceDays(i, month, year);
      const amt = getEffectiveIncomeAmount(i, month, year);
      occ.forEach((d) => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const match = incomeMatches.get(occurrenceKey(i.id, date));
        const scheduledAmount = remainingPlannedAmount(amt, match);
        if (scheduledAmount <= 0.005) return;
        incomeByDay[d] = (incomeByDay[d] ?? 0) + scheduledAmount;
        financialEvents.push({
          id: `income:${i.id}:${year}-${month + 1}-${d}`,
          sourceType: "income",
          sourceId: i.id,
          date,
          kind: "scheduled_income",
          amount: scheduledAmount,
          status: "scheduled",
          name: i.name,
          configuredOccurrenceAmount: amt,
          settledOccurrenceAmount: Math.abs(Number(match?.amount) || 0),
        });
      });
    });
    const monthTxs =
      forecastTransactionsByMonth.get(
        `${year}-${String(month + 1).padStart(2, "0")}`,
      ) ?? [];
    monthTxs.forEach((t) => {
      const isBankActivity =
        t.source === "plaid" ||
        t.source === "statement" ||
        Boolean(t.import_hash);
      financialEvents.push({
        id: `transaction:${t.id}`,
        sourceType: "transaction",
        sourceId: t.id,
        date: t.date,
        kind: t.amount >= 0 ? "transaction_income" : "transaction_expense",
        amount: t.amount,
        status:
          !isBankActivity && t.amount > 0 && t.date >= projectionAsOfDate
            ? "scheduled"
            : "actual",
        name: t.note || t.category,
      });
    });
    const billsByDay: Record<number, number> = {};
    const debtPlan = requestedDebtPlan;
    bills
      .filter(
        (b) =>
          (b.is_recurring || b.is_debt) && isBillEligibleForUpcomingPlan(b),
      )
      .forEach((b) => {
        let occ = getBillOccurrencesInMonth(b, month, year);
        if (occ.length === 0) return;
        const o = overrides.find(
          (o) => o.bill_id === b.id && o.month === month && o.year === year,
        );
        const hasReviewedOccurrence =
          matchedAllocationIndexes.reviewedBillIdsByMonth
            .get(`${year}-${String(month + 1).padStart(2, "0")}`)
            ?.has(b.id) ?? false;
        if (b.is_debt && debtPlan) return;
        const total = hasReviewedOccurrence
          ? getBillMonthlyTotal(b, month, year)
          : getBillEffectiveMonthlyTotal(b, month, year);
        if (total <= 0.005) return;
        if (o?.actual_amount !== undefined && !hasReviewedOccurrence) {
          const finalizedOccurrences = resolveFinalizedBillOccurrenceDays(
            occ,
            o.paid_date,
            month,
            year,
          );
          const finalizedAmount =
            finalizedOccurrences.length > 0
              ? total / finalizedOccurrences.length
              : 0;
          finalizedOccurrences.forEach((d) => {
            const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const match = billMatches.get(occurrenceKey(b.id, date));
            const remaining = remainingPlannedAmount(finalizedAmount, match);
            if (remaining <= 0.005) return;
            billsByDay[d] = (billsByDay[d] ?? 0) + remaining;
            financialEvents.push({
              id: `bill:${b.id}:${year}-${month + 1}-${d}`,
              sourceType: "bill",
              sourceId: b.id,
              date,
              kind: "bill",
              amount: -remaining,
              status: match ? "planned" : "finalized",
              name: b.name,
              configuredOccurrenceAmount: finalizedAmount,
              settledOccurrenceAmount: Math.abs(Number(match?.amount) || 0),
            });
          });
          return;
        }
        const amt = occ.length > 0 ? total / occ.length : 0;
        occ.forEach((d) => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const match = billMatches.get(occurrenceKey(b.id, date));
          const remaining = remainingPlannedAmount(amt, match);
          if (remaining <= 0.005) return;
          billsByDay[d] = (billsByDay[d] ?? 0) + remaining;
          financialEvents.push({
            id: `bill:${b.id}:${year}-${month + 1}-${d}`,
            sourceType: "bill",
            sourceId: b.id,
            date,
            kind: "bill",
            amount: -remaining,
            status: "planned",
            name: b.name,
            configuredOccurrenceAmount: amt,
            settledOccurrenceAmount: Math.abs(Number(match?.amount) || 0),
          });
        });
      });
    const debtExtrasByDay: Record<number, number> = {};
    if (debtPlan) {
      const savedExtra = getExtraPayment(month, year);
      debtPlan.allocations.forEach((allocation) => {
        const day = Number(allocation.date.split("-")[2]);
        if (
          !Number.isFinite(day) ||
          day < 1 ||
          day > daysInMonth ||
          allocation.amount <= 0.005
        )
          return;
        debtExtrasByDay[day] = (debtExtrasByDay[day] ?? 0) + allocation.amount;
        const canonicalSourceId =
          allocation.sourceBillId ?? allocation.targetBillId;
        const sourceCommitment =
          allocation.kind === "extra"
            ? undefined
            : getDebtSourceCommitment(canonicalSourceId, allocation.date);
        financialEvents.push({
          id: allocation.id,
          sourceType: "extra_payment",
          sourceId:
            allocation.kind === "extra"
              ? (savedExtra?.id ?? allocation.targetBillId)
              : canonicalSourceId,
          date: allocation.date,
          kind: "debt_payment",
          amount: -allocation.amount,
          status:
            sourceCommitment?.state === "pending"
              ? "pending"
              : allocation.date > projectionAsOfDate
                ? "scheduled"
                : "planned",
          name: `${allocation.targetBillName} debt payment`,
          debtPlanSource:
            allocation.kind === "extra" ? "saved_extra" : "canonical",
          debtPlanAllocationKind: allocation.kind,
          debtTargetBillId: allocation.targetBillId,
        });
      });
    } else
      extraPayments
        .filter((ep) => ep.month === month && ep.year === year)
        .forEach((ep) => {
          const paymentDate =
            ep.payment_date ??
            `${year}-${String(month + 1).padStart(2, "0")}-01`;
          const day = Number(paymentDate.split("-")[2]);
          if (!Number.isFinite(day) || day < 1 || day > daysInMonth) return;
          const pending =
            hasPendingSnowballBalanceApply(ep) ||
            paymentDate > projectionAsOfDate;
          const remainingAllocations = ep.allocations
            .map((allocation) => ({
              ...allocation,
              remaining: remainingSnowballAllocationAmount(
                allocation.payment,
                snowballMatches.get(
                  occurrenceKey(allocation.billId, paymentDate),
                ),
              ),
            }))
            .filter((allocation) => allocation.remaining > 0.005);
          const remainingAmount = remainingAllocations.reduce(
            (sum, allocation) => sum + allocation.remaining,
            0,
          );
          if (remainingAmount <= 0.005) return;
          const targetNames = Array.from(
            new Set(
              remainingAllocations
                .map(
                  (allocation) =>
                    allocation.billName ||
                    bills.find((bill) => bill.id === allocation.billId)?.name,
                )
                .filter(Boolean),
            ),
          ).join(", ");
          debtExtrasByDay[day] = (debtExtrasByDay[day] ?? 0) + remainingAmount;
          financialEvents.push({
            id: `extra:${ep.id}:${year}-${month + 1}-${day}`,
            sourceType: "extra_payment",
            sourceId: ep.id,
            date: paymentDate,
            kind: "debt_payment",
            amount: -remainingAmount,
            status: pending ? "scheduled" : "applied",
            name: targetNames
              ? `${targetNames} debt payment`
              : "Snowball debt payment",
          });
        });
    const goalsByDay: Record<number, GoalExpense[]> = {};
    goals.forEach((g) => {
      if (g.goal_type !== "planned_expense") return;
      if (!g.target_date) return;
      const targetDate = parseGoalTargetDate(g.target_date);
      if (!targetDate || targetDate.year !== year || targetDate.month !== month)
        return;
      const day = targetDate.day;
      if (!goalsByDay[day]) goalsByDay[day] = [];
      const remaining = getGoalRemainingAmount(g);
      if (remaining > 0) {
        goalsByDay[day].push({ id: g.id, name: g.name, amount: remaining });
        financialEvents.push({
          id: `goal:${g.id}:${year}-${month + 1}-${day}`,
          sourceType: "goal",
          sourceId: g.id,
          date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          kind: "goal",
          amount: -remaining,
          status: "planned",
          name: g.name,
        });
      }
    });
    const plannedDecisionByDay: Record<number, number> = {};
    const rangeEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    decisions
      .filter((d) => d.status === "planned" || d.status === "calendar")
      .forEach((decision) => {
        scenarioDates(decision.scenario, rangeEnd)
          .filter((date) =>
            date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`),
          )
          .forEach((date) => {
            const day = Number(date.slice(8, 10));
            const signed =
              decision.scenario.type === "income_change"
                ? decision.scenario.amount
                : -Math.abs(decision.scenario.amount);
            plannedDecisionByDay[day] =
              (plannedDecisionByDay[day] ?? 0) + signed;
            financialEvents.push({
              id: `decision:${decision.id}:${date}`,
              sourceType: "decision",
              sourceId: decision.id,
              date,
              kind: signed >= 0 ? "scheduled_income" : "transaction_expense",
              amount: signed,
              status: "planned",
              name: decision.name,
            });
          });
      });
    const currentMonthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    let openingBalance = carryover;
    // Bank anchoring may remove an unresolved plan dated before the bank's
    // latest balance so it does not reduce cash twice. Keep the canonical,
    // de-duplicated plan separately for calendar visibility: an overdue debt
    // remainder still belongs on its original date even when its cash impact
    // is excluded from the anchored projection.
    const displayEvents = suppressDebtBillPlanDuplicates(financialEvents);
    let balanceEvents = [...displayEvents];
    if (connectedBankAnchor?.date.startsWith(currentMonthPrefix)) {
      const settledTransactionEventIds = new Set(
        monthTxs
          .filter(
            (transaction) =>
              transaction.source === "plaid" ||
              transaction.source === "statement" ||
              Boolean(transaction.import_hash),
          )
          .map((transaction) => `transaction:${transaction.id}`),
      );
      const anchored = anchorForecastToBankBalance(
        balanceEvents,
        connectedBankAnchor.balance,
        connectedBankAnchor.date,
        settledTransactionEventIds,
        historicalMonthOpeningBalance(
          openingBalance,
          settings.starting_balance_date,
          `${currentMonthPrefix}-01`,
        ),
      );
      openingBalance = anchored.openingBalance;
      balanceEvents = anchored.events;
    } else if (bankAnchor?.date.startsWith(currentMonthPrefix)) {
      const adjustment = bankBalanceAdjustment(
        openingBalance,
        bankAnchor.balance,
        bankAnchor.date,
        balanceEvents,
      );
      if (Math.abs(adjustment) >= 0.005) {
        balanceEvents.push({
          id: `bank-adjustment:${bankAnchor.date}`,
          sourceType: "reconciliation",
          sourceId: bankAnchor.date,
          date: bankAnchor.date,
          kind: "bank_adjustment",
          amount: adjustment,
          status: "actual",
          name: "Bank balance update",
        });
      }
    }
    const forecast = forecastBalances({
      openingBalance,
      startDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      endDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
      events: balanceEvents,
    });

    const visibleEventsByDate = new Map<string, FinancialEvent[]>();
    displayEvents.forEach((event) => {
      if (
        event.sourceType === "transaction" &&
        !visibleTransactionIds.has(event.sourceId)
      )
        return;
      const bucket = visibleEventsByDate.get(event.date);
      if (bucket) bucket.push(event);
      else visibleEventsByDate.set(event.date, [event]);
    });
    const result: DailyBalance[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayTxs = visibleCheckingTransactionsByDate.get(dayDate) ?? [];
      const scheduledIncome = incomeByDay[day] ?? 0;
      const txIncome = dayTxs
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const incomeToday = scheduledIncome + txIncome;
      const decisionNet = plannedDecisionByDay[day] ?? 0;
      const expenseToday =
        dayTxs
          .filter((t) => t.amount < 0)
          .reduce((s, t) => s + Math.abs(t.amount), 0) +
        (debtExtrasByDay[day] ?? 0) +
        Math.max(0, -decisionNet);
      const billsToday = billsByDay[day] ?? 0;
      const dayGoals = goalsByDay[day] ?? [];
      const forecastDay = forecast.days[day - 1];
      const visibleEvents = visibleEventsByDate.get(forecastDay.date) ?? [];
      const projectedInflow = forecastDay.events.reduce(
        (sum, event) => sum + Math.max(0, event.amount),
        0,
      );
      const projectedOutflow = forecastDay.events.reduce(
        (sum, event) => sum + Math.max(0, -event.amount),
        0,
      );
      result.push({
        day,
        income: incomeToday,
        scheduledIncome,
        expense: expenseToday,
        bills: billsToday,
        goalExpenses: dayGoals,
        net: forecastDay.net,
        balance: forecastDay.balance,
        balanceSource: "projected",
        balanceDate: forecastDay.date,
        projectedInflow,
        projectedOutflow,
        events: visibleEvents,
        projectionEvents: forecastDay.events.map((event) => ({ ...event })),
      });
    }
    return result;
  };

  const getDailyBalances = (month: number, year: number): DailyBalance[] =>
    getOrComputeRevisionValue(
      balanceComputationCache.daily,
      financialProjectionMonthCacheKey(
        safeLocalDateInTimeZone(now, householdTimeZone),
        month,
        year,
      ),
      () => buildDailyBalances(month, year),
    );
  return {
    getOverride,
    getAmount,
    getPaidAmount,
    getCustomDueDay,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
    getBillEffectiveMonthlyTotal,
    getMonthlyBills,
    getDebtMonthSettlements,
    getDebtSourceCommitment,
    getExtraPayment,
    getDebtPlanForMonth,
    getRemainingDebtPlanForMonth,
    getMonthlyIncome,
    getIncomeOccurrencesInMonth,
    getCashFlow,
    getDailyBalances,
    transactionLedger,
    matchedAllocationIndexes,
    debtSourceCommitments,
  };
}
export type FinancialProjection = ReturnType<typeof createFinancialProjection>;
