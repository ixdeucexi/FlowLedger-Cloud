export type DebtPaymentPlanSummary = {
  extraPayment: number;
  requiredMinimum: number;
  totalPlanned: number;
};

export type SnowballPaymentTransactionLike = {
  amount: number;
  category?: string | null;
  note?: string | null;
  import_hash?: string | null;
  linked_bill_id?: string | null;
  debt_applied_bill_id?: string | null;
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
