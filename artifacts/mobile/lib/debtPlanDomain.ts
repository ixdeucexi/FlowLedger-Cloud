export type DebtMonthSettlementStatus = "scheduled" | "partial" | "settled";

export type DebtOccurrenceSettlement = {
  occurrenceDate: string;
  configuredObligation: number;
  paidAmount: number;
  remainingRequired: number;
  status: DebtMonthSettlementStatus;
};

export type DebtMonthSettlement = {
  configuredObligation: number;
  paidAmount: number;
  remainingRequired: number;
  status: DebtMonthSettlementStatus;
  plannedDebtAmount?: number;
  /** Exact due-date truth used by overdue, Forecast, Flo, and Flow Score. */
  occurrences?: DebtOccurrenceSettlement[];
};

type ReviewedSettlement = {
  status: "partial" | "settled";
  actualAmount: number;
  /** Historical obligation captured by the reviewed occurrence. */
  requiredAmount?: number;
  occurrenceCount?: number;
};
type OverrideSettlement = { paid_amount: number; actual_amount?: number; paid_date?: string };

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export function resolveDebtOccurrenceSettlement(input: {
  occurrenceDate: string;
  configuredObligation: number;
  reviewed?: Pick<ReviewedSettlement, "status" | "actualAmount" | "requiredAmount">;
  paidAmount?: number;
  requiredAmountSnapshot?: number;
}): DebtOccurrenceSettlement {
  const reviewedRequired = Number(input.reviewed?.requiredAmount);
  const snapshotRequired = Number(input.requiredAmountSnapshot);
  const configuredObligation = cents(
    Number.isFinite(reviewedRequired) && reviewedRequired >= 0
      ? reviewedRequired
      : Number.isFinite(snapshotRequired) && snapshotRequired >= 0
        ? snapshotRequired
        : input.configuredObligation,
  );
  const paidAmount = input.reviewed
    ? cents(input.reviewed.actualAmount)
    : cents(input.paidAmount ?? 0);
  const hasHistoricalRequirement = Boolean(input.reviewed)
    || (Number.isFinite(snapshotRequired) && snapshotRequired >= 0);
  const status: DebtMonthSettlementStatus = configuredObligation <= 0.005 && hasHistoricalRequirement
    ? "settled"
    : configuredObligation > 0.005 && paidAmount + 0.005 >= configuredObligation
      ? "settled"
      : paidAmount > 0.005
        ? "partial"
        : "scheduled";
  return {
    occurrenceDate: input.occurrenceDate,
    configuredObligation,
    paidAmount,
    remainingRequired: status === "settled" ? 0 : cents(configuredObligation - paidAmount),
    status,
  };
}

export function summarizeDebtOccurrenceSettlements(
  occurrences: readonly DebtOccurrenceSettlement[],
  plannedDebtAmount?: number,
): DebtMonthSettlement {
  const configuredObligation = cents(occurrences.reduce(
    (sum, occurrence) => sum + occurrence.configuredObligation,
    0,
  ));
  const paidAmount = cents(occurrences.reduce(
    (sum, occurrence) => sum + occurrence.paidAmount,
    0,
  ));
  const remainingRequired = cents(occurrences.reduce(
    (sum, occurrence) => sum + occurrence.remainingRequired,
    0,
  ));
  const status: DebtMonthSettlementStatus = occurrences.length > 0
    && occurrences.every(occurrence => occurrence.status === "settled")
    ? "settled"
    : paidAmount > 0.005
      ? "partial"
      : "scheduled";
  return {
    configuredObligation,
    paidAmount,
    remainingRequired,
    status,
    occurrences: [...occurrences],
    ...(plannedDebtAmount !== undefined ? { plannedDebtAmount: cents(plannedDebtAmount) } : {}),
  };
}

export function effectiveDebtOccurrenceAmount(
  baseMinimum: number,
  snowballMinimumBoost: number,
  plannedDebtAmount?: number,
): number {
  return plannedDebtAmount !== undefined
    ? cents(plannedDebtAmount)
    : cents(Math.max(0, baseMinimum) + Math.max(0, snowballMinimumBoost));
}

export function configuredDebtMonthObligation(input: {
  baseMinimum: number;
  snowballMinimumBoost: number;
  occurrenceCount: number;
  plannedDebtAmount?: number;
}): number {
  // A forecast edit or snowball boost can change the planned cash outflow,
  // but neither changes what the lender required. Settlement and overdue
  // status therefore stay anchored to the saved original minimum.
  return cents(Math.max(0, input.baseMinimum) * Math.max(0, input.occurrenceCount));
}

/**
 * Splits one exact Forecast commitment without redefining the lender minimum.
 * An omitted override schedules the required amount; an explicit zero skips
 * the cash outflow while the full requirement remains available to status
 * and overdue calculations.
 */
export function debtPlanPaymentBreakdown(
  requiredAmount: number,
  exactPlannedAmount?: number,
): {
  requiredAmount: number;
  requiredPayment: number;
  plannedExtraPayment: number;
  plannedPayment: number;
} {
  const required = cents(requiredAmount);
  const planned = exactPlannedAmount === undefined ? required : cents(exactPlannedAmount);
  const requiredPayment = cents(Math.min(required, planned));
  return {
    requiredAmount: required,
    requiredPayment,
    plannedExtraPayment: cents(planned - requiredPayment),
    plannedPayment: planned,
  };
}

export function exactDebtPlanTotal(input: {
  plannedDebtAmount?: number;
  customAmount?: number;
  occurrenceCount: number;
}): number | undefined {
  const exactPerOccurrence = input.plannedDebtAmount !== undefined
    ? input.plannedDebtAmount
    : input.customAmount !== undefined
      && Number.isFinite(input.customAmount)
      && input.customAmount > 0.005
      ? input.customAmount
      : undefined;
  return exactPerOccurrence === undefined
    ? undefined
    : cents(Math.max(0, exactPerOccurrence) * Math.max(0, input.occurrenceCount));
}

/** An exact edit on the active target replaces, rather than stacks with, rollover. */
export function automaticDebtRolloverForMonth(
  rolloverAmount: number,
  automaticTargetId: string | undefined,
  exactPlanDebtIds: ReadonlySet<string>,
  targetPaidAboveRequired = 0,
): number {
  return automaticTargetId && exactPlanDebtIds.has(automaticTargetId)
    ? 0
    : cents(Math.max(0, rolloverAmount - Math.max(0, targetPaidAboveRequired)));
}

export function plannedDebtAmountError(amount: number, pendingAmount = 0): string | undefined {
  if (!Number.isFinite(amount) || amount < 0) return "Enter an amount of zero or more.";
  if (cents(amount) + 0.005 < cents(pendingAmount)) {
    return `A ${cents(pendingAmount).toFixed(2)} payment is already pending. The planned amount cannot be lower until it posts or disappears.`;
  }
  return undefined;
}

/** Converts an edited remaining payment back to the configured occurrence total. */
export function configuredDebtAmountForRemainingPayment(
  remainingPayment: number,
  settledPayment: number,
): number {
  return cents(Math.max(0, remainingPayment) + Math.max(0, settledPayment));
}

export function parsePlannedDebtAmount(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? cents(amount) : undefined;
}

export function parsePlannedDebtOccurrenceDate(value?: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, monthNumber - 1, day, 12);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== monthNumber - 1 || parsed.getDate() !== day) return undefined;
  return { year, month: monthNumber - 1, day };
}

export function isPlannedDebtOccurrenceDate(value: string | undefined, occurrenceDays: readonly number[]): boolean {
  const parsed = parsePlannedDebtOccurrenceDate(value);
  return Boolean(parsed && occurrenceDays.includes(parsed.day));
}

export type DebtSourceCommitment = {
  sourceBillId: string;
  sourceBillName?: string;
  sourceBalance?: number;
  date: string;
  amount: number;
  state: "pending" | "posted";
};

/**
 * Pending/posted-review commitments are unreconciled payments in addition to
 * reviewed payments already applied this month. A bank item leaves the live
 * commitment set when review makes it part of `reviewedPaidAmount`, so the two
 * states cannot represent the same item at once.
 */
export function authoritativeDebtPaidAmountForMonth(
  reviewedPaidAmount: number,
  commitments: readonly DebtSourceCommitment[],
  sourceBillId: string,
  monthPrefix: string,
): number {
  const liveCommitments = commitments.filter(commitment => (
    commitment.sourceBillId === sourceBillId && commitment.date.startsWith(monthPrefix)
  ));
  return cents(reviewedPaidAmount + liveCommitments.reduce(
    (sum, commitment) => sum + commitment.amount,
    0,
  ));
}

/** Replaces each canonical source/date group with its authoritative bank commitment. */
export function applyDebtSourceCommitments(
  allocations: readonly DatedDebtAllocation[],
  commitments: readonly DebtSourceCommitment[],
): DatedDebtAllocation[] {
  const commitmentByKey = new Map(commitments.map(commitment => [
    `${commitment.sourceBillId}:${commitment.date}`,
    commitment,
  ]));
  const emittedKeys = new Set<string>();

  const pendingReplacement = (
    commitment: DebtSourceCommitment,
    group: readonly DatedDebtAllocation[],
    fallback: DatedDebtAllocation,
  ): DatedDebtAllocation[] => {
    const commitmentAmount = cents(commitment.amount);
    if (commitmentAmount <= 0.005) return [];
    const sourceName = commitment.sourceBillName ?? fallback.sourceBillName ?? fallback.targetBillName;
    const orderedTemplates = [
      ...group.filter(candidate => candidate.kind === "required"),
      ...group.filter(candidate => candidate.kind === "rollover"),
    ];
    const runningBalances = new Map<string, number>();
    const replacement: DatedDebtAllocation[] = [];
    let remaining = commitmentAmount;

    const append = (
      template: DatedDebtAllocation,
      amount: number,
      kind: "required" | "rollover",
    ) => {
      const payment = cents(amount);
      if (payment <= 0.005) return;
      const balanceBefore = runningBalances.get(template.targetBillId)
        ?? cents(template.balanceBefore ?? (template.targetBillId === commitment.sourceBillId ? commitment.sourceBalance : 0) ?? 0);
      const balanceAfter = cents(balanceBefore - payment);
      runningBalances.set(template.targetBillId, balanceAfter);
      replacement.push({
        ...template,
        id: `pending-debt:${commitment.sourceBillId}:${commitment.date}:${kind}:${replacement.length}`,
        sourceBillId: commitment.sourceBillId,
        sourceBillName: sourceName,
        kind,
        amount: payment,
        sourceAmount: commitmentAmount,
        balanceBefore,
        balanceAfter,
        paidOff: balanceAfter <= 0.005,
      });
    };

    orderedTemplates.forEach(template => {
      if (remaining <= 0.005) return;
      const applied = cents(Math.min(remaining, template.amount));
      append(template, applied, template.kind === "required" ? "required" : "rollover");
      remaining = cents(remaining - applied);
    });

    if (remaining > 0.005) {
      const lastRollover = [...orderedTemplates].reverse().find(template => template.kind === "rollover");
      const extraTemplate = lastRollover ?? group.find(template => template.targetBillId === commitment.sourceBillId) ?? fallback;
      append(extraTemplate, remaining, "rollover");
    }
    return replacement;
  };

  const result = allocations.flatMap(allocation => {
    if (allocation.kind === "extra" || !allocation.sourceBillId) return [{ ...allocation }];
    const key = `${allocation.sourceBillId}:${allocation.date}`;
    const commitment = commitmentByKey.get(key);
    if (!commitment) return [{ ...allocation }];
    if (emittedKeys.has(key)) return [];
    emittedKeys.add(key);
    if (commitment.state === "posted" || commitment.amount <= 0.005) return [];
    const group = allocations.filter(candidate => candidate.kind !== "extra"
      && candidate.sourceBillId === commitment.sourceBillId
      && candidate.date === commitment.date);
    const sourceTemplate = group.find(candidate => candidate.targetBillId === commitment.sourceBillId) ?? allocation;
    return pendingReplacement(commitment, group, sourceTemplate);
  });

  commitments.forEach(commitment => {
    const key = `${commitment.sourceBillId}:${commitment.date}`;
    if (emittedKeys.has(key) || commitment.state === "posted" || commitment.amount <= 0.005 || commitment.sourceBalance === undefined) return;
    const balanceBefore = cents(commitment.sourceBalance);
    const balanceAfter = cents(balanceBefore - commitment.amount);
    result.push({
      id: `pending-debt:${commitment.sourceBillId}:${commitment.date}`,
      date: commitment.date,
      sourceBillId: commitment.sourceBillId,
      sourceBillName: commitment.sourceBillName ?? "Debt payment",
      targetBillId: commitment.sourceBillId,
      targetBillName: commitment.sourceBillName ?? "Debt payment",
      // No canonical required row remains, so this live amount is payoff extra
      // rather than a new lender requirement.
      kind: "rollover",
      amount: cents(commitment.amount),
      sourceAmount: cents(commitment.amount),
      balanceBefore,
      balanceAfter,
      paidOff: balanceAfter <= 0.005,
    });
  });
  return result;
}

/** Removes reviewed month-to-date cash before advancing already-reduced balances. */
export function remainingDebtAllocationsAfterReviewedPayments(
  allocations: readonly DatedDebtAllocation[],
  settlements: ReadonlyMap<string, Pick<DebtMonthSettlement, "paidAmount" | "occurrences">>,
): DatedDebtAllocation[] {
  const remainingPaidByOccurrence = new Map<string, number>();
  const remainingPaidByBill = new Map<string, number>();
  settlements.forEach((settlement, billId) => {
    if (settlement.occurrences?.length) {
      settlement.occurrences.forEach(occurrence => {
        remainingPaidByOccurrence.set(
          `${billId}:${occurrence.occurrenceDate}`,
          cents(occurrence.paidAmount),
        );
      });
      return;
    }
    remainingPaidByBill.set(billId, cents(settlement.paidAmount));
  });
  const absorbedByIndex = new Map<number, number>();
  allocations
    .map((allocation, index) => ({ allocation, index }))
    // When the live balance already reflects a payment, canonical rollover is
    // the first duplicated portion. This matches dated remaining-plan math.
    .sort((left, right) => Number(left.allocation.kind !== "rollover") - Number(right.allocation.kind !== "rollover"))
    .forEach(({ allocation, index }) => {
      if (allocation.kind === "extra" || !allocation.sourceBillId) return;
      const occurrenceKey = `${allocation.sourceBillId}:${allocation.date}`;
      const hasOccurrencePayment = remainingPaidByOccurrence.has(occurrenceKey);
      const remainingPaid = hasOccurrencePayment
        ? remainingPaidByOccurrence.get(occurrenceKey) ?? 0
        : remainingPaidByBill.get(allocation.sourceBillId) ?? 0;
      if (remainingPaid <= 0.005) return;
      const absorbed = cents(Math.min(remainingPaid, allocation.amount));
      if (hasOccurrencePayment) {
        remainingPaidByOccurrence.set(occurrenceKey, cents(remainingPaid - absorbed));
      } else {
        remainingPaidByBill.set(allocation.sourceBillId, cents(remainingPaid - absorbed));
      }
      absorbedByIndex.set(index, absorbed);
    });
  return allocations.flatMap((allocation, index) => {
    const remaining = cents(allocation.amount - (absorbedByIndex.get(index) ?? 0));
    return remaining > 0.005 ? [{ ...allocation, amount: remaining }] : [];
  });
}

export function advanceDebtProjectionWithCommitments(
  plan: DatedSnowballMonthPlanResult,
  debts: readonly SnowballDebtInput[],
  openingRolledPayment: number,
  commitments: readonly DebtSourceCommitment[],
  openingAllocations: readonly DatedDebtAllocation[] = plan.allocations,
): { balances: Map<string, number>; rolledPayment: number; allocations: DatedDebtAllocation[] } {
  const allocations = applyDebtSourceCommitments(plan.allocations, commitments);
  const balances = new Map(plan.balances);
  openingAllocations.forEach(allocation => {
    balances.set(allocation.targetBillId, Math.max(
      balances.get(allocation.targetBillId) ?? 0,
      cents(allocation.balanceBefore),
    ));
  });
  const activeAtStart = new Set(debts
    .filter(debt => debt.included && (balances.get(debt.id) ?? 0) > 0.005)
    .map(debt => debt.id));
  const projectedAllocations = allocations.map(allocation => {
    const balanceBefore = cents(balances.get(allocation.targetBillId) ?? 0);
    const balanceAfter = cents(balanceBefore - allocation.amount);
    balances.set(allocation.targetBillId, balanceAfter);
    return { ...allocation, balanceBefore, balanceAfter, paidOff: balanceAfter <= 0.005 };
  });
  const rolledPayment = cents(openingRolledPayment + debts.reduce((sum, debt) => (
    debt.included && activeAtStart.has(debt.id) && (balances.get(debt.id) ?? 0) <= 0.005
      ? sum + Math.max(0, debt.minimum)
      : sum
  ), 0));
  return { balances, rolledPayment, allocations: projectedAllocations };
}

export function resolveDebtMonthSettlement(input: {
  configuredObligation: number;
  occurrenceCount?: number;
  reviewed?: ReviewedSettlement;
  override?: OverrideSettlement;
  plannedDebtAmount?: number;
}): DebtMonthSettlement {
  // A later edit to the recurring minimum applies to future occurrences. It
  // must not retroactively turn a previously reviewed exact payment into a
  // shortage. The review allocation preserves the obligation as it existed
  // when that occurrence was matched.
  const currentConfiguredObligation = cents(input.configuredObligation);
  const reviewedRequired = Number(input.reviewed?.requiredAmount);
  const reviewedOccurrenceCount = Math.max(0, Number(input.reviewed?.occurrenceCount) || 0);
  const configuredOccurrenceCount = Math.max(
    reviewedOccurrenceCount,
    Number(input.occurrenceCount) || reviewedOccurrenceCount,
  );
  const currentRequiredPerOccurrence = configuredOccurrenceCount > 0
    ? currentConfiguredObligation / configuredOccurrenceCount
    : currentConfiguredObligation;
  const unreviewedOccurrenceCount = Math.max(0, configuredOccurrenceCount - reviewedOccurrenceCount);
  const configuredObligation = cents(
    Number.isFinite(reviewedRequired)
      && reviewedRequired > 0.005
      && reviewedOccurrenceCount > 0
      // Preserve reviewed requirements occurrence by occurrence, then use
      // the current lender minimum only for dates that have not been reviewed.
      ? reviewedRequired + currentRequiredPerOccurrence * unreviewedOccurrenceCount
      : currentConfiguredObligation,
  );
  const reviewedPaid = input.reviewed ? cents(input.reviewed.actualAmount) : undefined;
  const overridePaid = input.override
    ? cents(input.override.actual_amount ?? input.override.paid_amount)
    : 0;
  const paidAmount = reviewedPaid ?? overridePaid;
  // Exact/full review choices have already normalized that occurrence's
  // required amount. Compare the accumulated dollars here so a reviewed date
  // cannot settle other weekly/biweekly occurrences that remain unpaid.
  const status: DebtMonthSettlementStatus = configuredObligation > 0.005 && paidAmount + 0.005 >= configuredObligation
    ? "settled"
    : paidAmount > 0.005
      ? "partial"
      : "scheduled";

  return {
    configuredObligation,
    paidAmount,
    remainingRequired: status === "settled" ? 0 : cents(configuredObligation - paidAmount),
    status,
    ...(input.plannedDebtAmount !== undefined ? { plannedDebtAmount: cents(input.plannedDebtAmount) } : {}),
  };
}

export type ExtraPaymentPlanLike = {
  amount: number;
  allocations: readonly { payment: number }[];
};

export function isValidExtraPaymentPlan(plan: ExtraPaymentPlanLike): boolean {
  const amount = cents(plan.amount);
  if (amount <= 0.005) return false;
  const allocationAmounts = plan.allocations.map(allocation => Number(allocation.payment) || 0);
  if (!allocationAmounts.some(payment => payment > 0.005) || allocationAmounts.some(payment => payment < -0.005)) return false;
  const allocationTotal = cents(allocationAmounts.reduce((sum, payment) => sum + payment, 0));
  return Math.abs(allocationTotal - amount) < 0.01;
}
import type { DatedDebtAllocation, DatedSnowballMonthPlanResult, SnowballDebtInput } from "./snowball";

/** Stable cache input for every dated allocation that changes Forecast cash or chips. */
export function datedDebtPlanCacheSignature(plan: DatedSnowballMonthPlanResult | null): string {
  if (!plan) return "none";
  return plan.allocations
    .map(allocation => [
      allocation.id,
      allocation.date,
      allocation.sourceBillId ?? "",
      allocation.targetBillId,
      allocation.kind,
      cents(allocation.amount).toFixed(2),
    ].join(":"))
    .join("|");
}
