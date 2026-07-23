export type DebtPaymentPlanSummary = {
  extraPayment: number;
  requiredMinimum: number;
  totalPlanned: number;
};

export type SnowballPaymentTransactionLike = {
  amount: number;
  date?: string | null;
  category?: string | null;
  note?: string | null;
  import_hash?: string | null;
  linked_bill_id?: string | null;
  debt_applied_bill_id?: string | null;
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

function money(value: number) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

export function buildDebtPaymentPlanSummary(requiredMinimum: number, extraPayment: number): DebtPaymentPlanSummary {
  const minimum = money(requiredMinimum);
  const extra = money(extraPayment);
  return {
    extraPayment: extra,
    requiredMinimum: minimum,
    totalPlanned: money(minimum + extra),
  };
}

export function isSnowballPaymentTransaction(transaction: SnowballPaymentTransactionLike): boolean {
  const linkedDebtId = transaction.debt_applied_bill_id ?? transaction.linked_bill_id;
  if (!linkedDebtId || Number(transaction.amount) >= 0) return false;

  const isGeneratedDebtSurplus = String(transaction.import_hash ?? "").startsWith("flowledger:debt-surplus:");
  const isNamedSnowballPayment = String(transaction.category ?? "").toLowerCase() === "debt"
    && /\bsnowball\b/i.test(String(transaction.note ?? ""));

  return isGeneratedDebtSurplus || isNamedSnowballPayment;
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
