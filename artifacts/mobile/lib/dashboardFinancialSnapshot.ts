import { isActiveTransaction, isCheckingBalanceTransaction } from "./billMatching";
import { isBillEligibleForUpcomingPlan } from "./billEligibility";
import {
  buildDashboardFinancialModel,
  type DashboardBill,
  type DashboardCashFlow,
  type DashboardFinancialModel,
  type DashboardFinancialModelInput,
  type DashboardTransaction,
} from "./dashboardFinancialModel";
import { dateOnlyToLocalDate } from "./dateLabels";
import { buildReviewQueue } from "./reviewCenter";
import type { DatedDebtAllocation } from "./snowball";
import {
  buildTodaysDecisions,
  summarizeDatedDebtDecision,
  type TodayDecision,
} from "./todaysDecisions";

/**
 * Exact identity for one render-ready Dashboard snapshot.
 *
 * The provider owns both revisions. `dataRevision` must change whenever a
 * financial source changes; `planInputRevision` must change when the
 * household-local date or category-budget input changes. Forecast's browsed
 * year is deliberately not part of Dashboard identity.
 */
export interface DashboardFinancialSnapshotIdentity {
  userId: string;
  householdId: string;
  budgetId: string | null;
  dataRevision: string;
  planInputRevision: string;
}

/**
 * Everything the mobile Dashboard may derive from expensive financial state.
 * Consumers render this immutable result and never call projection getters.
 */
export interface DashboardFinancialSnapshot {
  model: DashboardFinancialModel;
  categoryBudgets: Readonly<Record<string, number>>;
  reviewCenterCount: number;
  todayDecisions: TodayDecision[];
  desktopTodayDecisions: TodayDecision[];
  upcoming: DashboardUpcomingBill[];
  recentActivity: DashboardTransaction[];
  postedIncome: number;
}

export interface DashboardUpcomingBill {
  key: string;
  id: string;
  name: string;
  category: string;
  amount: number;
  day: number;
  month: number;
  year: number;
  isDebt: boolean;
  frequency?: "monthly" | "quarterly" | "biweekly" | "weekly";
  pending: boolean;
  sourceId?: string;
  kind?: "required" | "rollover" | "extra";
  paidOff?: boolean;
}

interface DashboardSnapshotDebtSettlement {
  configuredObligation: number;
  paidAmount: number;
  occurrences?: Array<{
    occurrenceDate: string;
    configuredObligation: number;
    paidAmount: number;
    remainingRequired?: number;
  }>;
}

interface DashboardFinancialSnapshotStateBase {
  key: string;
  identity: DashboardFinancialSnapshotIdentity;
}

export interface DashboardFinancialSnapshotPending extends DashboardFinancialSnapshotStateBase {
  status: "pending";
  value: null;
}

export interface DashboardFinancialSnapshotReady extends DashboardFinancialSnapshotStateBase {
  status: "ready";
  value: DashboardFinancialSnapshot;
  computedAt: string;
}

export interface DashboardFinancialSnapshotError extends DashboardFinancialSnapshotStateBase {
  status: "error";
  value: null;
  message: string;
}

export type DashboardFinancialSnapshotState =
  | DashboardFinancialSnapshotPending
  | DashboardFinancialSnapshotReady
  | DashboardFinancialSnapshotError;

export interface DashboardFinancialSnapshotBuildInput
  extends Omit<DashboardFinancialModelInput, "cashFlow" | "currentMonthBalances"> {
  allBills: DashboardBill[];
  allTransactions: DashboardTransaction[];
  /** Provider-prepared selectors avoid rescanning a large ledger in the final stage. */
  reviewCenterCount?: number;
  postedIncome?: number;
  recentActivity?: DashboardTransaction[];
  preparedCashFlow?: DashboardCashFlow;
  preparedCurrentMonthBalances?: DashboardFinancialModelInput["currentMonthBalances"];
  getCashFlow: (month: number, year: number) => DashboardCashFlow;
  getRemainingDebtPlanForMonth: (
    month: number,
    year: number,
  ) => { allocations: DatedDebtAllocation[] } | null;
}

function encodedKeyPart(value: string): string {
  return `${value.length}:${value}`;
}

/** Length-prefixing keeps keys unambiguous even when IDs contain separators. */
export function dashboardFinancialSnapshotKey(
  identity: DashboardFinancialSnapshotIdentity,
): string {
  return [
    identity.userId,
    identity.householdId,
    identity.budgetId === null ? "null" : `value:${identity.budgetId}`,
    identity.dataRevision,
    identity.planInputRevision,
  ].map(encodedKeyPart).join("|");
}

function copyIdentity(
  identity: DashboardFinancialSnapshotIdentity,
): DashboardFinancialSnapshotIdentity {
  return { ...identity };
}

/**
 * Selects the four newest active rows in linear time and preserves source order
 * for same-day activity. The provider runs this as its own cancellable stage so
 * atomic snapshot publication never sorts a dense current-month ledger.
 */
export function selectRecentDashboardActivity(
  transactions: readonly DashboardTransaction[],
): DashboardTransaction[] {
  const newest: DashboardTransaction[] = [];
  transactions.forEach(transaction => {
    if (!isActiveTransaction(transaction)) return;
    const insertAt = newest.findIndex(candidate => transaction.date > candidate.date);
    if (insertAt < 0) {
      if (newest.length < 4) newest.push(transaction);
      return;
    }
    newest.splice(insertAt, 0, transaction);
    if (newest.length > 4) newest.pop();
  });
  return newest;
}

export function sumPostedDashboardIncome(
  transactions: readonly DashboardTransaction[],
  connectedBankAccounts: DashboardFinancialModelInput["connectedBankAccounts"],
): number {
  return transactions.reduce((sum, transaction) => (
    transaction.amount > 0
      && transaction.review_status !== "transfer"
      && isCheckingBalanceTransaction(transaction, connectedBankAccounts)
      ? sum + transaction.amount
      : sum
  ), 0);
}

export function pendingDashboardFinancialSnapshot(
  identity: DashboardFinancialSnapshotIdentity,
): DashboardFinancialSnapshotPending {
  return {
    status: "pending",
    key: dashboardFinancialSnapshotKey(identity),
    identity: copyIdentity(identity),
    value: null,
  };
}

export function errorDashboardFinancialSnapshot(
  identity: DashboardFinancialSnapshotIdentity,
  message: string,
): DashboardFinancialSnapshotError {
  return {
    status: "error",
    key: dashboardFinancialSnapshotKey(identity),
    identity: copyIdentity(identity),
    value: null,
    message,
  };
}

export function buildDashboardUpcomingBills(
  input: DashboardFinancialSnapshotBuildInput,
  model: DashboardFinancialModel,
): DashboardUpcomingBill[] {
  const candidates: DashboardUpcomingBill[] = [];
  const currentMonth = input.now.getMonth();
  const today = input.now.getDate();
  const appendMonth = (month: number, year: number, minimumDay: number) => {
    const debtPlan = input.getRemainingDebtPlanForMonth(month, year);
    const debtSettlements: ReadonlyMap<string, DashboardSnapshotDebtSettlement> =
      input.getDebtMonthSettlements?.(month, year) ?? new Map();
    input.getMonthlyBills(month, year)
      .filter(isBillEligibleForUpcomingPlan)
      .filter((bill) => !bill.is_debt || !debtPlan)
      .forEach((bill) => {
        const days = input.getBillOccurrencesInMonth(bill, month, year)
          .slice()
          .sort((left, right) => left - right);
        if (!days.length) return;
        const debtSettlement = bill.is_debt
          ? debtSettlements.get(bill.id)
          : undefined;
        const exactDebtOccurrences = new Map(
          debtSettlement?.occurrences?.map((occurrence) => [
            Number(occurrence.occurrenceDate.slice(8, 10)),
            occurrence,
          ]),
        );
        const monthlyTotal = debtSettlement?.configuredObligation
          ?? input.getBillMonthlyTotal(bill, month, year);
        const occurrenceAmount = monthlyTotal / days.length;
        let paidRemaining = debtSettlement?.paidAmount
          ?? input.getPaidAmount(bill.id, month, year);
        days.forEach((day) => {
          const exactDebtOccurrence = exactDebtOccurrences.get(day);
          const required = exactDebtOccurrence?.configuredObligation ?? occurrenceAmount;
          const paid = exactDebtOccurrence
            ? Math.min(required, exactDebtOccurrence.paidAmount)
            : Math.min(required, Math.max(0, paidRemaining));
          paidRemaining = Math.max(0, paidRemaining - paid);
          const remaining = exactDebtOccurrence?.remainingRequired
            ?? Math.max(0, required - paid);
          if (remaining <= 0.005 || day < minimumDay) return;
          const occurrenceDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          candidates.push({
            key: `${bill.id}:${occurrenceDate}`,
            id: bill.id,
            name: bill.name,
            category: bill.is_debt ? "Debt payment" : bill.category || "Bill",
            amount: remaining,
            day,
            month,
            year,
            isDebt: bill.is_debt,
            frequency: bill.frequency,
            pending: model.activePendingMatches.some(
              (match) => match.target_id === bill.id
                && match.occurrence_date === occurrenceDate,
            ),
          });
        });
      });
    debtPlan?.allocations.forEach((allocation) => {
      const [allocationYear, allocationMonth, allocationDay] = allocation.date
        .split("-")
        .map(Number);
      if (
        allocationYear !== year
        || allocationMonth !== month + 1
        || allocationDay < minimumDay
        || allocation.amount <= 0.005
      ) return;
      const pendingTargetId = allocation.sourceBillId ?? allocation.targetBillId;
      candidates.push({
        key: allocation.id,
        id: allocation.targetBillId,
        name: allocation.targetBillName,
        category: allocation.kind === "rollover"
          ? "Snowball rollover"
          : "Debt payment",
        amount: allocation.amount,
        day: allocationDay,
        month,
        year,
        isDebt: true,
        pending: model.activePendingMatches.some(
          (match) => match.target_id === pendingTargetId
            && match.occurrence_date === allocation.date,
        ),
        sourceId: allocation.sourceBillId,
        kind: allocation.kind,
        paidOff: allocation.paidOff,
      });
    });
  };

  appendMonth(currentMonth, input.selectedYear, today);
  if (candidates.length < 5) {
    const nextMonth = (currentMonth + 1) % 12;
    const nextYear = input.selectedYear + (currentMonth === 11 ? 1 : 0);
    appendMonth(nextMonth, nextYear, 1);
  }
  return candidates
    .sort(
      (left, right) => left.year - right.year
        || left.month - right.month
        || left.day - right.day,
    )
    .slice(0, 5);
}

/**
 * Provider-only builder. This is the deliberate boundary around every heavy
 * current-month projection used by the mobile Dashboard.
 */
export function buildDashboardFinancialSnapshot(
  identity: DashboardFinancialSnapshotIdentity,
  input: DashboardFinancialSnapshotBuildInput,
): DashboardFinancialSnapshotReady {
  const {
    allBills,
    allTransactions,
    reviewCenterCount: preparedReviewCenterCount,
    postedIncome: preparedPostedIncome,
    recentActivity: preparedRecentActivity,
    preparedCashFlow,
    preparedCurrentMonthBalances,
    getCashFlow,
    getRemainingDebtPlanForMonth,
    ...modelInput
  } = input;
  const currentMonth = input.now.getMonth();
  const today = input.now.getDate();
  const cashFlow = preparedCashFlow
    ?? getCashFlow(currentMonth, input.selectedYear);
  const currentMonthBalances = preparedCurrentMonthBalances
    ?? input.getDailyBalances(currentMonth, input.selectedYear);
  const model = buildDashboardFinancialModel({
    ...modelInput,
    cashFlow,
    currentMonthBalances,
  });
  const reviewCenterCount = preparedReviewCenterCount
    ?? buildReviewQueue(allTransactions, model.todayIso).length;
  const upcoming = buildDashboardUpcomingBills(input, model);
  const priorityBill = model.algorithmSuite.billPriority.nextBill;
  let priorityDate: Date | null = null;
  if (priorityBill) {
    const priorityMonth = priorityBill.dueDay >= today
      ? currentMonth
      : (currentMonth + 1) % 12;
    const priorityYear = priorityBill.dueDay >= today || currentMonth < 11
      ? input.selectedYear
      : input.selectedYear + 1;
    priorityDate = new Date(priorityYear, priorityMonth, priorityBill.dueDay);
  }
  const priorityBillRecord = priorityBill
    ? allBills.find((bill) => bill.id === priorityBill.id) ?? null
    : null;
  const priorityMonth = priorityDate?.getMonth() ?? currentMonth;
  const priorityYear = priorityDate?.getFullYear() ?? input.selectedYear;
  const debtDecision = priorityBillRecord?.is_debt && priorityBill
    ? summarizeDatedDebtDecision(
        getRemainingDebtPlanForMonth(priorityMonth, priorityYear)?.allocations ?? [],
        priorityBill.id,
      )
    : null;
  if (debtDecision) priorityDate = dateOnlyToLocalDate(debtDecision.date);

  const todayStart = new Date(
    input.now.getFullYear(),
    input.now.getMonth(),
    input.now.getDate(),
  );
  const daysAway = priorityDate
    ? Math.max(0, Math.round((priorityDate.getTime() - todayStart.getTime()) / 86_400_000))
    : 0;
  const lowestDate = model.algorithmSuite.safeCushion.lowestDay
    ? new Date(
        input.selectedYear,
        currentMonth,
        model.algorithmSuite.safeCushion.lowestDay,
      ).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const snowballTarget = allBills
    .filter(
      (bill) => bill.is_debt
        && bill.balance > 0.005
        && bill.include_in_snowball !== false,
    )
    .sort(
      (left, right) => left.balance - right.balance || left.priority - right.priority,
    )[0] ?? null;
  const nearlyCompleteGoal = model.currentGoals
    .filter(
      (goal) => goal.target_amount > 0 && goal.current_amount < goal.target_amount,
    )
    .sort(
      (left, right) => (right.current_amount / right.target_amount)
        - (left.current_amount / left.target_amount),
    )[0] ?? null;
  const todayDecisions = buildTodaysDecisions({
    reviewCount: reviewCenterCount,
    lowestBalance: model.algorithmSuite.safeCushion.lowestBalance,
    lowestDate,
    safetyFloor: input.settings.safety_floor,
    safeToSpend: model.algorithmSuite.safeCushion.amount,
    nextBill: priorityBill && priorityDate ? {
      id: priorityBill.id,
      name: debtDecision?.name ?? priorityBill.name,
      amount: debtDecision?.amount ?? priorityBill.amount,
      dateLabel: daysAway === 0
        ? "today"
        : daysAway === 1
          ? "tomorrow"
          : priorityDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      daysAway,
      isDebt: Boolean(priorityBillRecord?.is_debt),
      closed: Boolean(
        priorityBillRecord?.is_debt && priorityBillRecord.balance <= 0.009,
      ),
      frequency: priorityBillRecord?.frequency,
      paidOff: debtDecision?.paidOff,
      rollover: debtDecision?.rollover,
    } : null,
    snowballTarget: snowballTarget
      ? { name: snowballTarget.name, balance: snowballTarget.balance }
      : null,
    goal: nearlyCompleteGoal ? {
      name: nearlyCompleteGoal.name,
      current: nearlyCompleteGoal.current_amount,
      target: nearlyCompleteGoal.target_amount,
    } : null,
  }).filter((decision) => decision.id !== "breathing-room-opportunity");
  const desktopNext = upcoming[0];
  const desktopNextDate = desktopNext
    ? new Date(desktopNext.year, desktopNext.month, desktopNext.day)
    : null;
  const desktopDaysAway = desktopNextDate
    ? Math.max(
        0,
        Math.round((desktopNextDate.getTime() - todayStart.getTime()) / 86_400_000),
      )
    : 0;
  const sameSourceRollovers = desktopNext?.isDebt && desktopNext.sourceId
    ? upcoming.filter((candidate) => (
        candidate.key !== desktopNext.key
          && candidate.sourceId === desktopNext.sourceId
          && candidate.year === desktopNext.year
          && candidate.month === desktopNext.month
          && candidate.day === desktopNext.day
          && candidate.kind === "rollover"
      ))
    : [];
  const rolloverAmount = sameSourceRollovers.reduce(
    (sum, candidate) => sum + candidate.amount,
    0,
  );
  const rolloverNames = [
    ...new Set(sameSourceRollovers.map((candidate) => candidate.name)),
  ];
  const desktopTodayDecisions = buildTodaysDecisions({
    reviewCount: reviewCenterCount,
    lowestBalance: model.algorithmSuite.safeCushion.lowestBalance,
    lowestDate,
    safetyFloor: input.settings.safety_floor,
    safeToSpend: model.algorithmSuite.safeCushion.amount,
    nextBill: desktopNext && desktopNextDate ? {
      id: desktopNext.id,
      name: desktopNext.name,
      amount: desktopNext.amount,
      dateLabel: desktopDaysAway === 0
        ? "today"
        : desktopDaysAway === 1
          ? "tomorrow"
          : desktopNextDate.toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" },
            ),
      daysAway: desktopDaysAway,
      isDebt: desktopNext.isDebt,
      frequency: desktopNext.frequency,
      paidOff: desktopNext.paidOff,
      rollover: rolloverAmount > 0.005 ? {
        name: rolloverNames.length === 1 ? rolloverNames[0] : "your next debts",
        amount: rolloverAmount,
      } : null,
    } : null,
    snowballTarget: snowballTarget
      ? { name: snowballTarget.name, balance: snowballTarget.balance }
      : null,
    goal: nearlyCompleteGoal ? {
      name: nearlyCompleteGoal.name,
      current: nearlyCompleteGoal.current_amount,
      target: nearlyCompleteGoal.target_amount,
    } : null,
  }).filter((decision) => decision.id !== "breathing-room-opportunity");

  const postedIncome = preparedPostedIncome ?? sumPostedDashboardIncome(
    model.monthTransactions,
    input.connectedBankAccounts,
  );
  const recentActivity = preparedRecentActivity
    ?? selectRecentDashboardActivity(model.monthTransactions);

  return {
    status: "ready",
    key: dashboardFinancialSnapshotKey(identity),
    identity: copyIdentity(identity),
    value: {
      model,
      categoryBudgets: { ...input.categoryBudgets },
      reviewCenterCount,
      todayDecisions,
      desktopTodayDecisions,
      upcoming,
      recentActivity,
      postedIncome,
    },
    computedAt: new Date().toISOString(),
  };
}

export function isDashboardFinancialSnapshotReadyForScope(
  state: DashboardFinancialSnapshotState | null | undefined,
  userId: string | null | undefined,
  householdId: string | null | undefined,
  budgetId?: string | null,
): state is DashboardFinancialSnapshotReady {
  return Boolean(
    state
      && state.status === "ready"
      && userId
      && householdId
      && state.key === dashboardFinancialSnapshotKey(state.identity)
      && state.identity.userId === userId
      && state.identity.householdId === householdId
      && (budgetId === undefined || state.identity.budgetId === budgetId),
  );
}
