export type DebtPaymentPlanSummary = {
  extraPayment: number;
  requiredMinimum: number;
  totalPlanned: number;
};

export type DebtPaymentProgress = {
  requiredAmount: number;
  plannedAmount: number;
  paidAmount: number;
  requiredRemaining: number;
  optionalExtraRemaining: number;
  isPaid: boolean;
  isPartial: boolean;
};

export type RetainedDebtPaymentBreakdown = {
  alreadyPaid: number;
  minimumRequired: number;
  minimumRemaining: number;
  scheduledPayment: number;
  extraPrincipal: number;
};

export type SnowballPaymentTransactionLike = {
  amount: number;
  date?: string | null;
  category?: string | null;
  note?: string | null;
  source?: string | null;
  review_resolution?: string | null;
  import_hash?: string | null;
  linked_bill_id?: string | null;
  debt_applied_bill_id?: string | null;
  debt_applied_amount?: number | null;
};

export type DatedSnowballPlanLike = {
  amount: number;
  date?: string | null;
};

export type SnowballTransactionEditDraft = {
  amount: number;
  debtId: string;
  paymentDate: string;
};

export type RequiredDebtPaymentLike = {
  amount: number;
  snowball_minimum_boost?: number | null;
};

export type SnowballRolloverPaymentLike = {
  snowball_minimum_boost?: number | null;
  include_in_snowball?: boolean | null;
};

function money(value: number) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

export const SNOWBALL_PLAN_SOURCE = "snowball_plan";

export function buildDebtPaymentPlanSummary(requiredMinimum: number, extraPayment: number): DebtPaymentPlanSummary {
  const minimum = money(requiredMinimum);
  const extra = money(extraPayment);
  return {
    extraPayment: extra,
    requiredMinimum: minimum,
    totalPlanned: money(minimum + extra),
  };
}

/** Status follows the lender minimum while optional payoff money stays visible. */
export function debtPaymentProgress(
  requiredAmount: number,
  plannedAmount: number,
  paidAmount: number,
): DebtPaymentProgress {
  const required = money(requiredAmount);
  const planned = money(plannedAmount);
  const paid = money(paidAmount);
  const requiredRemaining = money(required - paid);
  const optionalExtraRemaining = money(planned - Math.max(required, paid));
  const isPaid = required > 0.005 && requiredRemaining <= 0.005;
  return {
    requiredAmount: required,
    plannedAmount: planned,
    paidAmount: paid,
    requiredRemaining,
    optionalExtraRemaining,
    isPaid,
    isPartial: paid > 0.005 && !isPaid,
  };
}

/** Explains a choice to keep the original payment after an earlier payment. */
export function retainedDebtPaymentBreakdown(
  scheduledPayment: number,
  minimumRequired: number,
  alreadyPaid: number,
): RetainedDebtPaymentBreakdown | null {
  const scheduled = money(scheduledPayment);
  const minimum = money(minimumRequired);
  const paid = money(alreadyPaid);
  const minimumRemaining = money(minimum - paid);
  const extraPrincipal = money(scheduled - minimumRemaining);
  if (scheduled <= 0.005 || minimum <= 0.005 || paid <= 0.005 || extraPrincipal <= 0.005) return null;
  return {
    alreadyPaid: paid,
    minimumRequired: minimum,
    minimumRemaining,
    scheduledPayment: scheduled,
    extraPrincipal,
  };
}

export function isScheduledSnowballPlanTransaction(transaction: SnowballPaymentTransactionLike): boolean {
  return transaction.source === SNOWBALL_PLAN_SOURCE;
}

export function isSnowballPaymentTransaction(transaction: SnowballPaymentTransactionLike): boolean {
  if (transaction.review_resolution === "snowball" && Number(transaction.amount) < 0) return true;
  const linkedDebtId = transaction.debt_applied_bill_id ?? transaction.linked_bill_id;
  if (!linkedDebtId || Number(transaction.amount) >= 0) return false;

  const isGeneratedDebtSurplus = String(transaction.import_hash ?? "").startsWith("flowledger:debt-surplus:");
  const isNamedSnowballPayment = String(transaction.category ?? "").toLowerCase() === "debt"
    && /\bsnowball\b/i.test(String(transaction.note ?? ""));

  return isScheduledSnowballPlanTransaction(transaction) || isGeneratedDebtSurplus || isNamedSnowballPayment;
}

export function snowballPlanTotalThroughDate(
  plans: DatedSnowballPlanLike[],
  throughDate: string,
): number {
  const monthPrefix = /^\d{4}-\d{2}-\d{2}$/.test(throughDate) ? throughDate.slice(0, 7) : "";
  if (!monthPrefix) return 0;
  return money(plans.reduce((total, plan) => {
    const date = String(plan.date ?? "");
    if (!date.startsWith(`${monthPrefix}-`) || date > throughDate) return total;
    return total + Math.abs(Number(plan.amount) || 0);
  }, 0));
}

export function snowballPaymentName(transaction: SnowballPaymentTransactionLike, fallback = "Debt payment"): string {
  const name = String(transaction.note ?? "").replace(/\s+snowball(?:\s+payment)?$/i, "").trim();
  return name || fallback;
}

export function snowballTransactionEditDraft(
  transaction: SnowballPaymentTransactionLike,
): SnowballTransactionEditDraft | null {
  const debtId = transaction.debt_applied_bill_id ?? transaction.linked_bill_id;
  const paymentDate = String(transaction.date ?? "");
  if (!isSnowballPaymentTransaction(transaction) || !debtId || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return null;
  return {
    amount: money(Math.abs(Number(transaction.amount))),
    debtId,
    paymentDate,
  };
}

export function replacementSnowballSafeMaximum(safeMaximum: number, existingAmount: number): number {
  return money(safeMaximum + existingAmount);
}

export function requiredDebtPlanTotal(
  debt: RequiredDebtPaymentLike,
  occurrenceCount = 1,
): number {
  const requiredPerOccurrence = Math.max(0, Number(debt.amount) || 0);
  return money(requiredPerOccurrence * Math.max(0, occurrenceCount));
}

/** Existing freed minimums form one monthly extra pool, never one per occurrence. */
export function snowballRolloverPlanTotal(
  debts: readonly SnowballRolloverPaymentLike[],
): number {
  return money(debts.reduce((total, debt) => (
    debt.include_in_snowball === false
      ? total
      : total + Math.max(0, Number(debt.snowball_minimum_boost) || 0)
  ), 0));
}

export function upsertSnowballPlanById<T extends { id: string }>(plans: T[], nextPlan: T): T[] {
  const existingIndex = plans.findIndex(plan => plan.id === nextPlan.id);
  if (existingIndex < 0) return [...plans, nextPlan];
  return plans.map(plan => plan.id === nextPlan.id ? nextPlan : plan);
}
