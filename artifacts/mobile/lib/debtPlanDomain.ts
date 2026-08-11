export type DebtMonthSettlementStatus = "scheduled" | "partial" | "settled";

export type DebtMonthSettlement = {
  configuredObligation: number;
  paidAmount: number;
  remainingRequired: number;
  status: DebtMonthSettlementStatus;
  plannedDebtAmount?: number;
};

type ReviewedSettlement = { status: "partial" | "settled"; actualAmount: number };
type OverrideSettlement = { paid_amount: number; actual_amount?: number; paid_date?: string };

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

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
  return cents(effectiveDebtOccurrenceAmount(
    input.baseMinimum,
    input.snowballMinimumBoost,
    input.plannedDebtAmount,
  ) * Math.max(0, input.occurrenceCount));
}

export function plannedDebtAmountError(amount: number, pendingAmount = 0): string | undefined {
  if (!Number.isFinite(amount) || amount < 0) return "Enter an amount of zero or more.";
  if (cents(amount) + 0.005 < cents(pendingAmount)) {
    return `A ${cents(pendingAmount).toFixed(2)} payment is already pending. The planned amount cannot be lower until it posts or disappears.`;
  }
  return undefined;
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
  const result = allocations.flatMap(allocation => {
    if (allocation.kind === "extra" || !allocation.sourceBillId) return [{ ...allocation }];
    const key = `${allocation.sourceBillId}:${allocation.date}`;
    const commitment = commitmentByKey.get(key);
    if (!commitment) return [{ ...allocation }];
    if (emittedKeys.has(key)) return [];
    emittedKeys.add(key);
    if (commitment.state === "posted" || commitment.amount <= 0.005) return [];
    const sourceTemplate = allocations.find(candidate => candidate.sourceBillId === commitment.sourceBillId
      && candidate.date === commitment.date
      && candidate.targetBillId === commitment.sourceBillId) ?? allocation;
    const balanceBefore = cents(sourceTemplate.balanceBefore ?? commitment.sourceBalance ?? 0);
    const balanceAfter = cents(balanceBefore - commitment.amount);
    return [{
      ...sourceTemplate,
      id: `pending-debt:${commitment.sourceBillId}:${commitment.date}`,
      sourceBillId: commitment.sourceBillId,
      sourceBillName: commitment.sourceBillName ?? sourceTemplate.sourceBillName ?? sourceTemplate.targetBillName,
      targetBillId: commitment.sourceBillId,
      targetBillName: commitment.sourceBillName ?? sourceTemplate.sourceBillName ?? sourceTemplate.targetBillName,
      kind: "required" as const,
      amount: cents(commitment.amount),
      sourceAmount: cents(commitment.amount),
      balanceBefore,
      balanceAfter,
      paidOff: balanceAfter <= 0.005,
    }];
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
      kind: "required",
      amount: cents(commitment.amount),
      sourceAmount: cents(commitment.amount),
      balanceBefore,
      balanceAfter,
      paidOff: balanceAfter <= 0.005,
    });
  });
  return result;
}

export function advanceDebtProjectionWithCommitments(
  plan: DatedSnowballMonthPlanResult,
  debts: readonly SnowballDebtInput[],
  openingRolledPayment: number,
  commitments: readonly DebtSourceCommitment[],
): { balances: Map<string, number>; rolledPayment: number; allocations: DatedDebtAllocation[] } {
  const allocations = applyDebtSourceCommitments(plan.allocations, commitments);
  const balances = new Map(plan.balances);
  plan.allocations.forEach(allocation => {
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
  reviewed?: ReviewedSettlement;
  override?: OverrideSettlement;
  plannedDebtAmount?: number;
}): DebtMonthSettlement {
  const configuredObligation = cents(input.configuredObligation);
  const reviewedPaid = input.reviewed ? cents(input.reviewed.actualAmount) : undefined;
  const overridePaid = input.override
    ? cents(input.override.actual_amount ?? input.override.paid_amount)
    : 0;
  const paidAmount = reviewedPaid ?? overridePaid;
  const explicitlySettled = input.reviewed?.status === "settled"
    || Boolean(!input.reviewed && input.override?.actual_amount !== undefined && input.override.paid_date);
  const status: DebtMonthSettlementStatus = explicitlySettled || (configuredObligation > 0.005 && paidAmount + 0.005 >= configuredObligation)
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
