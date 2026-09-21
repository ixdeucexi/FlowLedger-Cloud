import type {
  PendingBankTransaction,
  Transaction,
} from "@/context/BudgetContext";

export function pendingChargeTransactionDraft(
  pending: PendingBankTransaction,
  categories: string[],
): Omit<Transaction, "id"> {
  const pendingCategory = pending.category?.trim();
  const category =
    pendingCategory && categories.includes(pendingCategory)
      ? pendingCategory
      : categories.includes("Other")
        ? "Other"
        : categories[0] || "Other";

  return {
    amount: -Math.abs(Number(pending.amount) || 0),
    category,
    note: (pending.merchant_name || pending.name || "Pending charge").trim(),
    date: pending.transaction_date,
  };
}

export function pendingDraftStaysInChargeMonth(
  pendingDate: string,
  transactionDate: string,
): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(pendingDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(transactionDate) &&
    pendingDate.slice(0, 7) === transactionDate.slice(0, 7)
  );
}
