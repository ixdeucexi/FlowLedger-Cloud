export type DebtMonthSettlementStatus = "scheduled" | "partial" | "settled";

export type DebtMonthSettlement = {
  configuredObligation: number;
  paidAmount: number;
  remainingRequired: number;
  status: DebtMonthSettlementStatus;
};

type ReviewedSettlement = { status: "partial" | "settled"; actualAmount: number };
type OverrideSettlement = { paid_amount: number; actual_amount?: number; paid_date?: string };

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export function resolveDebtMonthSettlement(input: {
  configuredObligation: number;
  reviewed?: ReviewedSettlement;
  override?: OverrideSettlement;
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
